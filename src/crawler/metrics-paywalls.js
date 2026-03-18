const { linearScale } = require('./scorer');

async function evaluate(page, requestUrls) {
  const domMetrics = await page.evaluate(() => {
    const body = document.body ? document.body.innerText.substring(0, 20000).toLowerCase() : '';
    const html = document.documentElement.innerHTML.substring(0, 50000).toLowerCase();
    const details = {};

    // Paywall text patterns
    const paywallPatterns = [
      'subscribe to read', 'subscribe to continue', 'subscription required',
      'premium content', 'premium article', 'members only', 'member-only',
      'sign up to read', 'sign in to read', 'create a free account',
      'already a subscriber', 'already a member', 'unlock this article',
      'start your free trial', 'get unlimited access',
      'you have reached your limit', 'free articles remaining',
      'article limit', 'monthly limit',
    ];
    details.paywall_text_matches = paywallPatterns.filter(p => body.includes(p)).length;

    // "X free articles" messaging
    const freeArticlePattern = /\d+\s*(free\s*)?articles?\s*(left|remaining)/i;
    details.free_article_counter = freeArticlePattern.test(body) ? 1 : 0;

    // Login/signup overlays
    const overlaySelectors = [
      '[class*="paywall"]', '[id*="paywall"]',
      '[class*="meter-"]', '[id*="meter-"]',
      '[class*="regwall"]', '[class*="registration-wall"]',
      '[class*="subscribe-wall"]', '[class*="premium-wall"]',
      '[class*="gate-"]', '[class*="content-gate"]',
    ];
    details.paywall_elements = overlaySelectors.filter(sel => {
      try { return document.querySelector(sel) !== null; } catch { return false; }
    }).length;

    // Content truncation with gradient fade
    const truncationSelectors = [
      '[class*="truncat"]', '[class*="fade-out"]', '[class*="gradient-fade"]',
      '[class*="content-preview"]', '[class*="article-preview"]',
    ];
    details.content_truncation = truncationSelectors.filter(sel => {
      try { return document.querySelector(sel) !== null; } catch { return false; }
    }).length;

    // Check for CSS gradient overlays that hide content
    const allElements = document.querySelectorAll('[style*="gradient"]');
    let gradientOverlays = 0;
    allElements.forEach(el => {
      const style = el.getAttribute('style') || '';
      if (style.includes('linear-gradient') && (style.includes('transparent') || style.includes('white'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 50) gradientOverlays++;
      }
    });
    details.gradient_overlays = gradientOverlays;

    return details;
  });

  const textScore = linearScale(domMetrics.paywall_text_matches, 0, 3);
  const elementScore = linearScale(domMetrics.paywall_elements, 0, 2);
  const truncScore = linearScale(domMetrics.content_truncation + domMetrics.gradient_overlays, 0, 2);
  const counterScore = domMetrics.free_article_counter * 5;

  const score = Math.round(
    (textScore * 0.35 + elementScore * 0.30 + truncScore * 0.20 + counterScore * 0.15) * 100
  ) / 100;

  return {
    score: Math.min(10, score),
    metrics: domMetrics,
  };
}

module.exports = { evaluate };
