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
const bus = require('../events');
const piaForwarder = require('../proxy-forwarder');

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';
const PIA_PROXY = process.env.PIA_PROXY || '';
const TOR_SOCKS_PROXY = process.env.TOR_PROXY || 'socks5://127.0.0.1:9050';
const CRAWL_TIMEOUT = 30000;
const PROXY_CRAWL_TIMEOUT = 35000;
const TOR_CRAWL_TIMEOUT = 45000;
const POLL_INTERVAL = 10000;
const RESTART_EVERY = 50;
const MAX_RSS_MB = 700;

let browser = null;
let piaBrowser = null;
let torBrowser = null;
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

// ── Block page detection ────────────────────────────────────────
// These patterns indicate the site served a block/challenge page
// instead of real content. The page loaded with HTTP 200 but
// contains no actual site content.
const BLOCK_PAGE_PATTERNS = [
  // Reddit
  /you['']ve been blocked by network security/i,
  // Generic datacenter/bot blocks
  /access denied/i,
  /blocked by.*security/i,
  /bot detection/i,
  /please verify you['']?re? (a )?human/i,
  /are you a robot/i,
  /automated access/i,
  /suspicious activity/i,
  /does not have permission/i,
  /error:\s*forbidden/i,
  /403 forbidden/i,
  /experiencing an access issue/i,
  /your ip (address )?(has been|is) blocked/i,
  /include your ip address/i,
  // Cloudflare
  /checking your browser/i,
  /just a moment/i,
  /cf-challenge/i,
  /enable javascript and cookies to continue/i,
  /attention required/i,
  // PerimeterX / HUMAN Security
  /press & hold/i,
  /before you continue/i,
  // Akamai
  /access to .* has been denied/i,
  /reference #[0-9a-f.]+/i,
  // Imperva/Incapsula
  /incapsula incident/i,
  // DataDome
  /datadome/i,
];

// Patterns for pages that are essentially empty/error
const EMPTY_PAGE_PATTERNS = [
  /^unknown error$/i,
  /^error$/i,
  /^access denied$/i,
  /^forbidden$/i,
  /^not found$/i,
];

/**
 * Check if the loaded page is a block/challenge page rather than real content.
 * Returns { blocked: true, reason: string } or { blocked: false }
 */
async function detectBlockPage(page) {
  const result = await page.evaluate((blockPatterns, emptyPatterns) => {
    const bodyText = (document.body?.innerText || '').trim();
    const bodyLen = bodyText.length;
    const html = document.documentElement?.innerHTML || '';
    const title = document.title || '';

    // Very short page with error-like text
    if (bodyLen < 200) {
      for (const pattern of emptyPatterns) {
        if (new RegExp(pattern, 'i').test(bodyText)) {
          return { blocked: true, reason: `Empty page: "${bodyText.substring(0, 80)}"` };
        }
      }
    }

    // Very short page (likely not a real site)
    if (bodyLen < 50 && !html.includes('<canvas') && !html.includes('<video')) {
      return { blocked: true, reason: `Suspiciously short page (${bodyLen} chars)` };
    }

    // Very few DOM nodes — real sites have hundreds, block pages have < 50
    const nodeCount = document.querySelectorAll('*').length;
    if (nodeCount < 50) {
      return { blocked: true, reason: `Minimal page (${nodeCount} DOM nodes)` };
    }

    // Check body text and title against block patterns
    const checkText = (bodyText.substring(0, 5000) + ' ' + title).toLowerCase();
    for (const pattern of blockPatterns) {
      if (new RegExp(pattern, 'i').test(checkText)) {
        return { blocked: true, reason: `Block pattern matched: ${pattern}` };
      }
    }

    // Check for challenge iframes (Cloudflare turnstile, hCaptcha, etc.)
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = (iframe.src || '').toLowerCase();
      if (src.includes('challenges.cloudflare.com') ||
          src.includes('hcaptcha.com') ||
          src.includes('recaptcha') ||
          src.includes('captcha')) {
        return { blocked: true, reason: `Challenge iframe: ${src.substring(0, 80)}` };
      }
    }

    // Check for Cloudflare challenge meta tags
    const metas = document.querySelectorAll('meta[http-equiv="refresh"]');
    for (const meta of metas) {
      const content = (meta.getAttribute('content') || '').toLowerCase();
      if (content.includes('challenge')) {
        return { blocked: true, reason: 'Challenge meta refresh' };
      }
    }

    return { blocked: false };
  },
    BLOCK_PAGE_PATTERNS.map(r => r.source),
    EMPTY_PAGE_PATTERNS.map(r => r.source)
  );

  return result;
}

// ── Browser management ──────────────────────────────────────────
async function launchBrowser(proxyArg) {
  const args = [...LAUNCH_ARGS];
  if (proxyArg) args.push(`--proxy-server=${proxyArg}`);

  const b = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: 'new',
    args,
  });
  return b;
}

async function ensureDirectBrowser() {
  if (!browser || !browser.isConnected()) {
    if (browser) { try { await browser.close(); } catch {} }
    browser = await launchBrowser();
    browser.on('disconnected', () => {
      browser = null;
      db.log('warn', 'Direct browser disconnected');
    });
    crawlCount = 0;
    db.log('info', 'Direct browser launched');
  }
  if (crawlCount >= RESTART_EVERY) {
    db.log('info', `Restarting direct browser after ${crawlCount} crawls`);
    try { await browser.close(); } catch {}
    browser = await launchBrowser();
    browser.on('disconnected', () => { browser = null; });
    crawlCount = 0;
  }
}

async function ensurePiaBrowser() {
  if (!PIA_PROXY) return false;
  // Start local forwarder if needed (handles SOCKS5 auth that Chromium can't)
  let localProxy = piaForwarder.getLocalProxy();
  if (!localProxy) {
    const port = await piaForwarder.start(PIA_PROXY);
    localProxy = `socks5://127.0.0.1:${port}`;
    db.log('info', `PIA proxy forwarder started on port ${port}`);
  }
  if (!piaBrowser || !piaBrowser.isConnected()) {
    if (piaBrowser) { try { await piaBrowser.close(); } catch {} }
    piaBrowser = await launchBrowser(localProxy);
    piaBrowser.on('disconnected', () => {
      piaBrowser = null;
      db.log('warn', 'PIA browser disconnected');
    });
    db.log('info', 'PIA browser launched');
  }
  return true;
}

async function ensureTorBrowser() {
  if (!torBrowser || !torBrowser.isConnected()) {
    if (torBrowser) { try { await torBrowser.close(); } catch {} }
    torBrowser = await launchBrowser(TOR_SOCKS_PROXY);
    torBrowser.on('disconnected', () => {
      torBrowser = null;
      db.log('warn', 'Tor browser disconnected');
    });
    db.log('info', 'Tor browser launched');
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
  if (global.gc) global.gc();
}

const BOT_USER_AGENT = 'EnshittificationIndexBot/1.0 (+https://enshittify.me/bot) Chrome/131.0';

// ── Core crawl logic (shared between direct and Tor) ────────────
async function performCrawl(browserInstance, url, timeout, userAgent) {
  const page = await browserInstance.newPage();
  if (userAgent) {
    await page.setUserAgent(userAgent);
  }
  const requestUrls = [];
  const netStats = { totalBytes: 0, jsBytes: 0, requestCount: 0, loadTime: 0 };

  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on('response', async (response) => {
      try {
        requestUrls.push(response.url());
        netStats.requestCount++;
        const contentLength = parseInt(response.headers()['content-length'] || '0');
        netStats.totalBytes += contentLength;
        if (response.request().resourceType() === 'script') {
          netStats.jsBytes += contentLength;
        }
      } catch {}
    });

    await page.setViewport({ width: 1440, height: 900 });

    const startTime = Date.now();
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: timeout - 5000,
    });
    netStats.loadTime = Date.now() - startTime;

    // Wait for lazy content
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    return { page, requestUrls, netStats };
  } catch (err) {
    try { await page.close(); } catch {}
    throw err;
  }
}

// ── Metric helpers ──────────────────────────────────────────────
async function runAllMetrics(page, requestUrls, netStats, domain) {
  const results = {};
  const collectors = [
    ['tracking', () => metricsTracking.evaluate(page, requestUrls)],
    ['popups', () => metricsPopups.evaluate(page, requestUrls)],
    ['ads', () => metricsAds.evaluate(page, requestUrls)],
    ['paywalls', () => metricsPaywalls.evaluate(page, requestUrls)],
    ['dark', () => metricsDark.evaluate(page, requestUrls)],
    ['bloat', () => metricsBloat.evaluate(page, requestUrls, netStats)],
  ];

  for (const [name, fn] of collectors) {
    results[name] = await fn();
    if (domain) {
      bus.emit('crawl:metric', {
        domain,
        category: name,
        score: results[name].score,
      });
    }
  }

  return results;
}

function buildScores(metricResults) {
  const scores = {
    tracking: metricResults.tracking.score,
    popups: metricResults.popups.score,
    ads: metricResults.ads.score,
    paywalls: metricResults.paywalls.score,
    dark_patterns: metricResults.dark.score,
    bloat: metricResults.bloat.score,
  };
  scores.overall = computeOverall(scores);
  return scores;
}

// ── Main crawl function ─────────────────────────────────────────
async function crawlSite(queueItem) {
  const { id: queueId, site_id, domain, url } = queueItem;

  db.startQueueItem(queueId);
  db.updateSiteStatus(site_id, 'crawling');
  db.log('info', `Crawling ${domain}`);
  bus.emit('crawl:status', { domain, status: 'crawling', message: 'Loading page...' });

  let page = null;
  let requestUrls = [];
  let netStats = {};
  let proxyUsed = 'direct';
  const attempts = []; // track each method tried

  // Helper to try a crawl method and record the attempt
  async function tryMethod(name, browserInstance, timeout, userAgent) {
    const attempt = { method: name, status: 'trying', reason: null };
    attempts.push(attempt);
    bus.emit('crawl:status', { domain, status: 'crawling', message: `Trying ${name}...` });

    try {
      const result = await performCrawl(browserInstance, url, timeout, userAgent);
      const p = result.page;
      const blockCheck = await detectBlockPage(p);
      if (blockCheck.blocked) {
        attempt.status = 'blocked';
        attempt.reason = blockCheck.reason;
        db.log('warn', `${name} blocked for ${domain}: ${blockCheck.reason}`);
        try { await p.close(); } catch {}
        return null;
      }
      attempt.status = 'success';
      return result;
    } catch (err) {
      attempt.status = 'error';
      attempt.reason = err.message;
      db.log('warn', `${name} failed for ${domain}: ${err.message}`);
      return null;
    }
  }

  // Helper to save a blocked/failed result with attempts log
  function saveBlockedResult() {
    db.insertResult({
      site_id, score_overall: null, score_tracking: null, score_popups: null,
      score_ads: null, score_paywalls: null, score_dark_patterns: null, score_bloat: null,
      metrics_tracking: null, metrics_popups: null, metrics_ads: null,
      metrics_paywalls: null, metrics_dark_patterns: null, metrics_bloat: null,
      page_load_time_ms: null, page_size_bytes: null, request_count: null,
      js_size_bytes: null, dom_node_count: null, screenshot_path: null,
      bot_crawl: 0, crawl_attempts: JSON.stringify(attempts),
    });
  }

  try {
    // ── Tiered crawl: Direct → PIA → Tor → Bot UA ──
    await ensureDirectBrowser();
    let crawlResult;

    // Attempt 1: Direct
    crawlResult = await tryMethod('Direct', browser, CRAWL_TIMEOUT);

    // Attempt 2: PIA proxy
    if (!crawlResult && PIA_PROXY) {
      await ensurePiaBrowser();
      crawlResult = await tryMethod('PIA VPN', piaBrowser, PROXY_CRAWL_TIMEOUT);
      if (crawlResult) proxyUsed = 'pia';
    }

    // Attempt 3: Tor
    if (!crawlResult) {
      await ensureTorBrowser();
      crawlResult = await tryMethod('Tor', torBrowser, TOR_CRAWL_TIMEOUT);
      if (crawlResult) proxyUsed = 'tor';
    }

    // Attempt 4: Bot UA
    let botMode = false;
    if (!crawlResult) {
      await ensureDirectBrowser();
      crawlResult = await tryMethod('Bot UA', browser, CRAWL_TIMEOUT, BOT_USER_AGENT);
      if (crawlResult) botMode = true;
    }

    // All methods failed
    if (!crawlResult) {
      db.updateSiteStatus(site_id, 'blocked');
      db.clearSiteScores(site_id);
      db.completeQueueItem(queueId);
      saveBlockedResult();
      db.log('info', `Marked ${domain} as blocked (all methods failed)`);
      bus.emit('crawl:blocked', { domain, reason: 'All connection methods failed' });
      crawlCount++;
      return;
    }

    page = crawlResult.page;
    requestUrls = crawlResult.requestUrls;
    netStats = crawlResult.netStats;

    // ── Run metrics ──
    bus.emit('crawl:status', { domain, status: 'scoring', message: 'Analyzing page...' });
    let metricResults = await runAllMetrics(page, requestUrls, netStats, domain);
    let scores = buildScores(metricResults);

    // ── Low-score heuristic: block page we didn't pattern-match ──
    const SUSPICIOUS_SCORE_THRESHOLD = 0.5;
    if (proxyUsed === 'direct' && !botMode && scores.overall < SUSPICIOUS_SCORE_THRESHOLD) {
      db.log('warn', `Suspicious low score (${scores.overall}) for ${domain} — retrying`);
      attempts.push({ method: `${proxyUsed} (low score ${scores.overall})`, status: 'low_score', reason: 'Score below threshold' });
      try { await page.close(); } catch {}
      page = null;

      // Try PIA, then Tor
      let retryResult = null;
      if (PIA_PROXY) {
        await ensurePiaBrowser();
        retryResult = await tryMethod('PIA VPN (low-score retry)', piaBrowser, PROXY_CRAWL_TIMEOUT);
        if (retryResult) proxyUsed = 'pia';
      }
      if (!retryResult) {
        await ensureTorBrowser();
        retryResult = await tryMethod('Tor (low-score retry)', torBrowser, TOR_CRAWL_TIMEOUT);
        if (retryResult) proxyUsed = 'tor';
      }

      if (!retryResult) {
        db.updateSiteStatus(site_id, 'blocked');
        db.clearSiteScores(site_id);
        db.completeQueueItem(queueId);
        saveBlockedResult();
        bus.emit('crawl:blocked', { domain, reason: 'Blocked across all connection methods' });
        crawlCount++;
        return;
      }

      page = retryResult.page;
      requestUrls = retryResult.requestUrls;
      netStats = retryResult.netStats;

      bus.emit('crawl:status', { domain, status: 'scoring', message: 'Re-analyzing...' });
      metricResults = await runAllMetrics(page, requestUrls, netStats, domain);
      scores = buildScores(metricResults);

      if (scores.overall < SUSPICIOUS_SCORE_THRESHOLD) {
        db.log('warn', `Retry score still low (${scores.overall}) for ${domain} — marking as blocked`);
        attempts.push({ method: `${proxyUsed} (retry)`, status: 'low_score', reason: `Score still ${scores.overall}` });
        db.updateSiteStatus(site_id, 'blocked');
        db.clearSiteScores(site_id);
        db.completeQueueItem(queueId);
        saveBlockedResult();
        bus.emit('crawl:blocked', { domain, reason: 'Blocked across all connection methods' });
        crawlCount++;
        return;
      }

      db.log('info', `Retry rescore for ${domain}: overall=${scores.overall}`);
    }

    const { tracking, popups, ads, paywalls, dark, bloat } = metricResults;

    // Screenshot
    let screenshotPath = null;
    try {
      const filename = `${domain.replace(/[^a-z0-9.-]/gi, '_')}_${Date.now()}.png`;
      screenshotPath = `screenshots/${filename}`;
      await page.screenshot({
        path: path.join(__dirname, '..', '..', 'public', screenshotPath),
        type: 'png',
        fullPage: false,
      });
    } catch (e) {
      db.log('warn', `Screenshot failed for ${domain}: ${e.message}`);
    }

    // Store results
    db.updateSiteScores(site_id, scores, botMode);

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
      bot_crawl: botMode ? 1 : 0,
      crawl_attempts: JSON.stringify(attempts),
    });

    db.completeQueueItem(queueId);
    const via = proxyUsed !== 'direct' ? ` (via ${proxyUsed.toUpperCase()})` : '';
    const botLabel = botMode ? ' [BOT MODE]' : '';
    db.log('info', `Completed ${domain}: overall=${scores.overall}${via}${botLabel}`);
    bus.emit('crawl:complete', { domain, scores });
    crawlCount++;

  } catch (err) {
    db.failQueueItem(queueId, err.message);
    db.updateSiteStatus(site_id, 'error');
    db.log('error', `Failed ${domain}: ${err.message}`);
    attempts.push({ method: 'crawl', status: 'error', reason: err.message });
    saveBlockedResult();
    bus.emit('crawl:error', { domain, error: err.message });
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
    try {
      if (browser) { await browser.close(); browser = null; }
      if (piaBrowser) { await piaBrowser.close(); piaBrowser = null; }
      if (torBrowser) { await torBrowser.close(); torBrowser = null; }
    } catch {}
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

  pollTimer = setInterval(async () => {
    try { await pollQueue(); } catch (err) {
      db.log('error', `Poll error: ${err.message}`);
    }
  }, POLL_INTERVAL);

  recrawlTimer = setInterval(() => {
    try { scheduleRecrawls(); } catch (err) {
      db.log('error', `Recrawl scheduler error: ${err.message}`);
    }
  }, 60 * 60 * 1000);

  setTimeout(() => pollQueue().catch(() => {}), 5000);
}

function stop() {
  running = false;
  if (pollTimer) clearInterval(pollTimer);
  if (recrawlTimer) clearInterval(recrawlTimer);
  if (browser) browser.close().catch(() => {});
  if (piaBrowser) piaBrowser.close().catch(() => {});
  if (torBrowser) torBrowser.close().catch(() => {});
  piaForwarder.stop();
  db.log('info', 'Crawler worker stopped');
}

module.exports = { start, stop };
