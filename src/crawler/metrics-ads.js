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

function isAdUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return AD_NETWORK_DOMAINS.some(d => hostname.includes(d));
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

    return { adIframes, adElements, adAreaRatio: Math.round(adAreaRatio * 100) / 100 };
  });

  const requestScore = linearScale(adRequestCount, 0, 15);
  const networkScore = linearScale(uniqueAdNetworks.size, 0, 5);
  const iframeScore = linearScale(domMetrics.adIframes, 0, 5);
  const elementScore = linearScale(domMetrics.adElements, 0, 10);
  const areaScore = linearScale(domMetrics.adAreaRatio, 0, 0.4);

  const score = Math.round(
    (requestScore * 0.25 + networkScore * 0.20 + iframeScore * 0.15 +
     elementScore * 0.15 + areaScore * 0.25) * 100
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
    },
  };
}

module.exports = { evaluate };
