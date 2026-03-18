const puppeteer = require('puppeteer-core');
const path = require('path');
const db = require('../db');
const { computeOverall } = require('./scorer');
const metricsTracking = require('./metrics-tracking');
const metricsPopups = require('./metrics-popups');
const metricsAds = require('./metrics-ads');
const metricsPaywalls = require('./metrics-paywalls');
const metricsDark = require('./metrics-dark');
const metricsBloat = require('./metrics-bloat');

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';
const CRAWL_TIMEOUT = 30000;
const POLL_INTERVAL = 10000;
const RESTART_EVERY = 50; // restart browser every N crawls
const MAX_RSS_MB = 700;

let browser = null;
let crawlCount = 0;
let running = false;
let pollTimer = null;
let recrawlTimer = null;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--disable-component-extensions-with-background-pages',
  '--mute-audio',
  '--no-first-run',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-ipc-flooding-protection',
  '--disable-hang-monitor',
];

async function launchBrowser() {
  if (browser) {
    try { await browser.close(); } catch {}
  }
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });
  browser.on('disconnected', () => {
    browser = null;
    db.log('warn', 'Browser disconnected unexpectedly');
  });
  crawlCount = 0;
  db.log('info', 'Browser launched');
}

async function ensureBrowser() {
  if (!browser || !browser.isConnected()) {
    await launchBrowser();
  }
  if (crawlCount >= RESTART_EVERY) {
    db.log('info', `Restarting browser after ${crawlCount} crawls`);
    await launchBrowser();
  }
}

function checkMemory() {
  const rss = process.memoryUsage().rss / (1024 * 1024);
  if (rss > MAX_RSS_MB) {
    db.log('warn', `High memory: ${Math.round(rss)}MB RSS, skipping crawl`);
    return false;
  }
  return true;
}

function forceGC() {
  if (global.gc) {
    global.gc();
  }
}

async function crawlSite(queueItem) {
  const { id: queueId, site_id, domain, url } = queueItem;

  db.startQueueItem(queueId);
  db.updateSiteStatus(site_id, 'crawling');
  db.log('info', `Crawling ${domain}`);

  let page = null;
  const requestUrls = [];
  const netStats = { totalBytes: 0, jsBytes: 0, requestCount: 0, loadTime: 0 };

  try {
    await ensureBrowser();
    page = await browser.newPage();

    // Block images, fonts, media to save bandwidth
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Track network requests
    page.on('response', async (response) => {
      try {
        const url = response.url();
        requestUrls.push(url);
        netStats.requestCount++;
        const headers = response.headers();
        const contentLength = parseInt(headers['content-length'] || '0');
        netStats.totalBytes += contentLength;
        if (response.request().resourceType() === 'script') {
          netStats.jsBytes += contentLength;
        }
      } catch {}
    });

    await page.setViewport({ width: 1280, height: 800 });

    const startTime = Date.now();

    // Navigate with timeout
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: CRAWL_TIMEOUT - 5000, // leave room for metrics
    });

    netStats.loadTime = Date.now() - startTime;

    // Wait a bit for lazy-loaded content
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    // Run all 6 metric collectors
    const [tracking, popups, ads, paywalls, dark, bloat] = await Promise.all([
      metricsTracking.evaluate(page, requestUrls),
      metricsPopups.evaluate(page, requestUrls),
      metricsAds.evaluate(page, requestUrls),
      metricsPaywalls.evaluate(page, requestUrls),
      metricsDark.evaluate(page, requestUrls),
      metricsBloat.evaluate(page, requestUrls, netStats),
    ]);

    const scores = {
      tracking: tracking.score,
      popups: popups.score,
      ads: ads.score,
      paywalls: paywalls.score,
      dark_patterns: dark.score,
      bloat: bloat.score,
    };
    scores.overall = computeOverall(scores);

    // Screenshot
    let screenshotPath = null;
    try {
      const filename = `${domain.replace(/[^a-z0-9.-]/gi, '_')}_${Date.now()}.png`;
      screenshotPath = `screenshots/${filename}`;
      await page.screenshot({
        path: path.join(__dirname, '..', '..', 'public', screenshotPath),
        type: 'png',
        quality: undefined,
        fullPage: false,
      });
    } catch (e) {
      db.log('warn', `Screenshot failed for ${domain}: ${e.message}`);
    }

    // Store results
    db.updateSiteScores(site_id, scores);

    db.insertResult({
      site_id,
      score_overall: scores.overall,
      score_tracking: scores.tracking,
      score_popups: scores.popups,
      score_ads: scores.ads,
      score_paywalls: scores.paywalls,
      score_dark_patterns: scores.dark_patterns,
      score_bloat: scores.bloat,
      metrics_tracking: JSON.stringify(tracking.metrics),
      metrics_popups: JSON.stringify(popups.metrics),
      metrics_ads: JSON.stringify(ads.metrics),
      metrics_paywalls: JSON.stringify(paywalls.metrics),
      metrics_dark_patterns: JSON.stringify(dark.metrics),
      metrics_bloat: JSON.stringify(bloat.metrics),
      page_load_time_ms: netStats.loadTime,
      page_size_bytes: netStats.totalBytes,
      request_count: netStats.requestCount,
      js_size_bytes: netStats.jsBytes,
      dom_node_count: bloat.metrics.dom_node_count,
      screenshot_path: screenshotPath,
    });

    db.completeQueueItem(queueId);
    db.log('info', `Completed ${domain}: overall=${scores.overall}`);
    crawlCount++;

  } catch (err) {
    db.failQueueItem(queueId, err.message);
    db.updateSiteStatus(site_id, 'error');
    db.log('error', `Failed ${domain}: ${err.message}`);
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
    forceGC();
  }
}

async function pollQueue() {
  if (!running) return;

  if (!checkMemory()) {
    // Memory too high, try restarting browser
    try { await launchBrowser(); } catch {}
    forceGC();
    return;
  }

  const item = db.getNextInQueue();
  if (item) {
    await crawlSite(item);
  }
}

function scheduleRecrawls() {
  const intervalHours = parseInt(db.getSetting('recrawl_interval_hours') || '24');
  const sites = db.getSitesNeedingRecrawl(intervalHours, 5);
  for (const site of sites) {
    db.enqueue(site.id, 0);
    db.log('info', `Re-queued ${site.domain} for recrawl`);
  }
}

function start() {
  if (running) return;
  running = true;
  db.log('info', 'Crawler worker started');

  // Poll queue
  pollTimer = setInterval(async () => {
    try { await pollQueue(); } catch (err) {
      db.log('error', `Poll error: ${err.message}`);
    }
  }, POLL_INTERVAL);

  // Recrawl scheduler - every hour
  recrawlTimer = setInterval(() => {
    try { scheduleRecrawls(); } catch (err) {
      db.log('error', `Recrawl scheduler error: ${err.message}`);
    }
  }, 60 * 60 * 1000);

  // Initial poll after 5s
  setTimeout(() => pollQueue().catch(() => {}), 5000);
}

function stop() {
  running = false;
  if (pollTimer) clearInterval(pollTimer);
  if (recrawlTimer) clearInterval(recrawlTimer);
  if (browser) browser.close().catch(() => {});
  db.log('info', 'Crawler worker stopped');
}

module.exports = { start, stop };
