const { linearScale } = require('./scorer');

// Known tracker domains (subset — covers the big ones)
const TRACKER_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'facebook.com/tr', 'connect.facebook.net',
  'analytics.google.com', 'google.com/pagead', 'googlesyndication.com',
  'hotjar.com', 'fullstory.com', 'segment.io', 'segment.com',
  'mixpanel.com', 'amplitude.com', 'heapanalytics.com',
  'crazyegg.com', 'mouseflow.com', 'luckyorange.com',
  'newrelic.com', 'nr-data.net', 'sentry.io',
  'quantserve.com', 'scorecardresearch.com', 'comscore.com',
  'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net',
  'adnxs.com', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'casalemedia.com', 'adsrvr.org',
  'demdex.net', 'omtrdc.net', 'adobe.com/analytics',
  'clarity.ms', 'bing.com/bat', 'bat.bing.com',
  'snap.licdn.com', 'linkedin.com/px', 'ads-twitter.com',
  'analytics.tiktok.com', 'pinterest.com/ct',
  'hubspot.com', 'hs-analytics.net', 'pardot.com',
  'marketo.net', 'marketo.com', 'munchkin.marketo.net',
  'branch.io', 'app.link', 'appsflyer.com',
  'adjust.com', 'kochava.com',
];

function isTrackerUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return TRACKER_DOMAINS.some(t => hostname.includes(t));
  } catch {
    return false;
  }
}

/**
 * Evaluate tracking metrics on a page.
 * @param {import('puppeteer-core').Page} page
 * @param {string[]} requestUrls - all network request URLs captured during load
 * @returns {{ score: number, metrics: object }}
 */
async function evaluate(page, requestUrls) {
  const trackerRequests = requestUrls.filter(isTrackerUrl);
  const trackerCount = trackerRequests.length;
  const uniqueTrackerDomains = new Set(
    trackerRequests.map(u => { try { return new URL(u).hostname; } catch { return ''; } }).filter(Boolean)
  );

  const domMetrics = await page.evaluate(() => {
    const cookies = document.cookie ? document.cookie.split(';').length : 0;

    // Fingerprinting API usage detection
    let fingerprintSignals = 0;
    const fpApis = ['canvas', 'webgl', 'AudioContext', 'RTCPeerConnection'];
    const scripts = document.querySelectorAll('script');
    const inlineCode = Array.from(scripts).map(s => s.textContent).join(' ').substring(0, 50000);
    fpApis.forEach(api => {
      if (inlineCode.includes(api)) fingerprintSignals++;
    });

    // Tracking pixels (1x1 images)
    const images = document.querySelectorAll('img');
    let trackingPixels = 0;
    images.forEach(img => {
      if ((img.width <= 2 && img.height <= 2) || img.src.includes('pixel') || img.src.includes('/tr?')) {
        trackingPixels++;
      }
    });

    return { cookies, fingerprintSignals, trackingPixels };
  });

  // Score components (each 0-10, then averaged)
  const trackerCountScore = linearScale(trackerCount, 0, 20);
  const uniqueDomainScore = linearScale(uniqueTrackerDomains.size, 0, 10);
  const cookieScore = linearScale(domMetrics.cookies, 0, 15);
  const fpScore = linearScale(domMetrics.fingerprintSignals, 0, 3);
  const pixelScore = linearScale(domMetrics.trackingPixels, 0, 5);

  const score = Math.round(
    (trackerCountScore * 0.35 + uniqueDomainScore * 0.25 + cookieScore * 0.15 +
     fpScore * 0.15 + pixelScore * 0.10) * 100
  ) / 100;

  return {
    score: Math.min(10, score),
    metrics: {
      tracker_requests: trackerCount,
      unique_tracker_domains: uniqueTrackerDomains.size,
      tracker_domains_list: [...uniqueTrackerDomains].slice(0, 20),
      cookies: domMetrics.cookies,
      fingerprint_signals: domMetrics.fingerprintSignals,
      tracking_pixels: domMetrics.trackingPixels,
    },
  };
}

module.exports = { evaluate };
