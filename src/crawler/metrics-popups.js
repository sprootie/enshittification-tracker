const { linearScale } = require('./scorer');

/**
 * Evaluate popup/overlay metrics on a page.
 */
async function evaluate(page, requestUrls) {
  const domMetrics = await page.evaluate(() => {
    let score = 0;
    const details = {};

    // Cookie banners
    const cookieBannerSelectors = [
      '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
      '#CybotCookiebotDialog', '.cc-banner', '.cookie-banner',
      '#cookie-consent', '.cookie-consent', '[class*="cookie-banner"]',
      '[class*="cookie-consent"]', '[id*="cookie-banner"]',
      '[class*="gdpr"]', '#gdpr-banner',
    ];
    const cookieBanners = cookieBannerSelectors.filter(sel => {
      try { return document.querySelector(sel) !== null; } catch { return false; }
    });
    details.cookie_banners = cookieBanners.length;

    // Newsletter/signup modals
    const modalSelectors = [
      '[class*="newsletter"]', '[class*="subscribe-modal"]',
      '[class*="popup-modal"]', '[class*="email-capture"]',
      '[class*="signup-modal"]', '[class*="exit-intent"]',
    ];
    const modals = modalSelectors.filter(sel => {
      try { return document.querySelector(sel) !== null; } catch { return false; }
    });
    details.newsletter_modals = modals.length;

    // Notification request prompts (detected by permission API usage)
    details.notification_prompt = 'Notification' in window ? 1 : 0;

    // Chat widgets
    const chatSelectors = [
      '#intercom-container', '[class*="intercom"]',
      '#drift-widget', '[class*="drift-"]',
      '#hubspot-messages-iframe-container',
      '#zendesk-chat', '[class*="zopim"]',
      '[class*="livechat"]', '[class*="live-chat"]',
      '#crisp-chatbox', '[class*="tawk-"]',
    ];
    const chatWidgets = chatSelectors.filter(sel => {
      try { return document.querySelector(sel) !== null; } catch { return false; }
    });
    details.chat_widgets = chatWidgets.length;

    // Fixed overlays covering significant viewport
    const fixedElements = document.querySelectorAll('*');
    let largeOverlays = 0;
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const viewArea = viewH * viewW;

    for (const el of fixedElements) {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > viewArea * 0.3) {
          largeOverlays++;
        }
      }
    }
    details.large_overlays = largeOverlays;

    return details;
  });

  // Chat widget scripts from network
  const chatScriptDomains = [
    'intercom.io', 'drift.com', 'zendesk.com', 'zopim.com',
    'livechat.com', 'tawk.to', 'crisp.chat', 'hubspot.com',
  ];
  const chatScriptsLoaded = requestUrls.filter(u => {
    try { return chatScriptDomains.some(d => new URL(u).hostname.includes(d)); } catch { return false; }
  }).length;
  domMetrics.chat_scripts_loaded = Math.min(chatScriptsLoaded, 5);

  // Scoring
  const bannerScore = linearScale(domMetrics.cookie_banners, 0, 3);
  const modalScore = linearScale(domMetrics.newsletter_modals, 0, 2);
  const chatScore = linearScale(domMetrics.chat_widgets + domMetrics.chat_scripts_loaded, 0, 3);
  const overlayScore = linearScale(domMetrics.large_overlays, 0, 2);

  const score = Math.round(
    (bannerScore * 0.30 + modalScore * 0.25 + chatScore * 0.20 + overlayScore * 0.25) * 100
  ) / 100;

  return {
    score: Math.min(10, score),
    metrics: domMetrics,
  };
}

module.exports = { evaluate };
