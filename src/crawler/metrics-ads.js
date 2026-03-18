const { linearScale } = require('./scorer');

const AD_NETWORK_DOMAINS = [
  'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
  'google.com/pagead', 'google.com/adsense',
  'adservice.google.com', 'pagead2.googlesyndication.com',
  'taboola.com', 'outbrain.com', 'mgid.com',
  'amazon-adsystem.com', 'media.net',
  'pubmatic.com', 'rubiconproject.com', 'openx.net',
  'casalemedia.com', 'adsrvr.org', 'adnxs.com',
  'criteo.com', 'criteo.net', 'bidswitch.net',
  'contextweb.com', 'sharethrough.com',
  'revcontent.com', 'nativo.com', 'triplelift.com',
  'ad.doubleclick.net', 'securepubads.g.doubleclick.net',
];

// Native ad / content recommendation platforms
const NATIVE_AD_DOMAINS = [
  'taboola.com', 'outbrain.com', 'mgid.com', 'revcontent.com',
  'content.ad', 'nativo.com', 'sharethrough.com', 'triplelift.com',
  'zemanta.com', 'disqus.com/recommend', 'yahoogemini.com',
  'adblade.com', 'dianomi.com', 'livingly.com',
];

function isAdUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return AD_NETWORK_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return false;
  }
}

function isNativeAdUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return NATIVE_AD_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return false;
  }
}

async function evaluate(page, requestUrls) {
  const adRequests = requestUrls.filter(isAdUrl);
  const adRequestCount = adRequests.length;
  const uniqueAdNetworks = new Set(
    adRequests.map(u => { try { return new URL(u).hostname; } catch { return ''; } }).filter(Boolean)
  );

  // Native ad platform requests
  const nativeAdRequests = requestUrls.filter(isNativeAdUrl);
  const nativeAdPlatforms = new Set(
    nativeAdRequests.map(u => { try { return new URL(u).hostname; } catch { return ''; } }).filter(Boolean)
  );

  const domMetrics = await page.evaluate(() => {
    // Ad iframes
    const iframes = document.querySelectorAll('iframe');
    let adIframes = 0;
    iframes.forEach(f => {
      const src = (f.src || '').toLowerCase();
      if (src.includes('ad') || src.includes('doubleclick') || src.includes('googlesyndication')) {
        adIframes++;
      }
    });

    // Ad-class elements
    const adSelectors = [
      '[class*="ad-container"]', '[class*="ad-wrapper"]', '[class*="ad-slot"]',
      '[class*="advertisement"]', '[id*="ad-container"]', '[id*="ad-slot"]',
      '.ad', '.ads', '.adsbygoogle', 'ins.adsbygoogle',
      '[data-ad]', '[data-ad-slot]', '[data-ad-unit]',
    ];
    let adElements = 0;
    adSelectors.forEach(sel => {
      try { adElements += document.querySelectorAll(sel).length; } catch {}
    });

    // Estimate ad area vs content area
    const adNodes = document.querySelectorAll(
      '.ad, .ads, .adsbygoogle, [class*="ad-container"], [class*="advertisement"], ins.adsbygoogle'
    );
    let totalAdArea = 0;
    const viewArea = window.innerWidth * window.innerHeight;
    adNodes.forEach(node => {
      const rect = node.getBoundingClientRect();
      totalAdArea += rect.width * rect.height;
    });
    const adAreaRatio = viewArea > 0 ? totalAdArea / viewArea : 0;

    // ── Native ads / Sponsored content ──────────────────────────
    // Promoted/sponsored post detection via labels and attributes
    const sponsoredSelectors = [
      // Generic sponsored labels
      '[class*="sponsored"]', '[class*="promoted"]', '[class*="native-ad"]',
      '[class*="paid-content"]', '[class*="partner-content"]',
      '[data-promoted]', '[data-sponsored]', '[data-is-sponsored]',
      '[data-ad-type="sponsored"]', '[data-native-ad]',
      // Reddit
      '[data-promoted="true"]',
      // Platform-specific
      '[class*="paidContent"]', '[class*="advertorial"]',
      '[class*="brand-content"]', '[class*="commercial-content"]',
      // Forbes BrandVoice / paid programs
      '[class*="brandvoice"]', '[class*="BrandVoice"]',
      '[class*="advVoice"]', '[class*="AdVoice"]',
    ];
    let sponsoredElements = 0;
    sponsoredSelectors.forEach(sel => {
      try { sponsoredElements += document.querySelectorAll(sel).length; } catch {}
    });

    // Look for text labels marking sponsored content
    const allElements = document.querySelectorAll('*');
    let sponsoredLabels = 0;
    const sponsoredTextPatterns = [
      'sponsored', 'promoted', 'paid post', 'partner content',
      'advertorial', 'branded content', 'paid content', 'ad content',
      'paid partnership', 'presented by', 'brought to you by',
      'brandvoice', 'brand voice', 'paid program',
      'contributor content', 'content by',
    ];
    for (const el of allElements) {
      // Only check small text elements likely to be labels
      if (el.children.length > 2) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.length > 50) continue;
      if (sponsoredTextPatterns.some(p => text === p || text.startsWith(p))) {
        sponsoredLabels++;
      }
    }

    // Content recommendation widgets ("Around the web", "You may also like", etc.)
    const recoWidgetSelectors = [
      '[class*="taboola"]', '[id*="taboola"]',
      '[class*="outbrain"]', '[id*="outbrain"]',
      '.OUTBRAIN', '#outbrain_widget',
      '[class*="mgid"]', '[id*="mgid"]',
      '[class*="revcontent"]', '[id*="revcontent"]',
      '[class*="content-recommendation"]', '[class*="recommended-content"]',
      '[class*="around-the-web"]', '[class*="from-the-web"]',
      '[class*="you-may-like"]', '[class*="you-might-like"]',
      '[class*="more-from"]', '[class*="trending-now"]',
    ];
    let recoWidgets = 0;
    recoWidgetSelectors.forEach(sel => {
      try { recoWidgets += document.querySelectorAll(sel).length; } catch {}
    });

    // "Around the web" / "Recommended" section text headers
    let recoHeaders = 0;
    const headers = document.querySelectorAll('h2, h3, h4, [class*="heading"], [class*="title"]');
    const recoHeaderPatterns = [
      'around the web', 'from the web', 'you may also like',
      'you might like', 'recommended for you', 'more from the web',
      'trending now', 'stories from', 'paid stories',
      'suggested for you', 'more stories',
    ];
    headers.forEach(h => {
      const text = (h.textContent || '').trim().toLowerCase();
      if (recoHeaderPatterns.some(p => text.includes(p))) recoHeaders++;
    });

    return {
      adIframes,
      adElements,
      adAreaRatio: Math.round(adAreaRatio * 100) / 100,
      sponsoredElements,
      sponsoredLabels,
      recoWidgets,
      recoHeaders,
    };
  });

  // Scoring - add native ad signals
  const requestScore = linearScale(adRequestCount, 0, 15);
  const networkScore = linearScale(uniqueAdNetworks.size, 0, 5);
  const iframeScore = linearScale(domMetrics.adIframes, 0, 5);
  const elementScore = linearScale(domMetrics.adElements, 0, 10);
  const areaScore = linearScale(domMetrics.adAreaRatio, 0, 0.4);
  const nativeAdScore = linearScale(
    domMetrics.sponsoredElements + domMetrics.sponsoredLabels +
    domMetrics.recoWidgets + domMetrics.recoHeaders +
    nativeAdPlatforms.size,
    0, 8
  );

  const score = Math.round(
    (requestScore * 0.20 + networkScore * 0.15 + iframeScore * 0.10 +
     elementScore * 0.10 + areaScore * 0.20 + nativeAdScore * 0.25) * 100
  ) / 100;

  return {
    score: Math.min(10, score),
    metrics: {
      ad_requests: adRequestCount,
      unique_ad_networks: uniqueAdNetworks.size,
      ad_networks_list: [...uniqueAdNetworks].slice(0, 15),
      ad_iframes: domMetrics.adIframes,
      ad_elements: domMetrics.adElements,
      ad_area_ratio: domMetrics.adAreaRatio,
      sponsored_elements: domMetrics.sponsoredElements,
      sponsored_labels: domMetrics.sponsoredLabels,
      native_ad_platforms: [...nativeAdPlatforms],
      reco_widgets: domMetrics.recoWidgets,
      reco_headers: domMetrics.recoHeaders,
    },
  };
}

module.exports = { evaluate };
