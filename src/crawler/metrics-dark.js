const { linearScale } = require('./scorer');

async function evaluate(page, requestUrls) {
  const domMetrics = await page.evaluate(() => {
    const body = document.body ? document.body.innerText.substring(0, 30000).toLowerCase() : '';
    const details = {};

    // Guilt-trip dismiss text (confirmshaming)
    const guiltPatterns = [
      'no thanks, i don\'t want', 'no, i prefer to pay full price',
      'i don\'t like saving', 'no thanks, i hate',
      'i\'ll pass on', 'no, i don\'t want to save',
      'i prefer not to', 'no thanks, i\'m not interested in saving',
      'maybe later, i don\'t like deals',
    ];
    details.guilt_trip_text = guiltPatterns.filter(p => body.includes(p)).length;

    // Pre-checked consent boxes
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    let prechecked = 0;
    checkboxes.forEach(cb => {
      if (cb.checked) {
        const label = cb.closest('label')?.textContent?.toLowerCase() || '';
        const nearby = cb.parentElement?.textContent?.toLowerCase() || '';
        const text = label + ' ' + nearby;
        if (text.includes('newsletter') || text.includes('marketing') ||
            text.includes('partner') || text.includes('third part') ||
            text.includes('promotional') || text.includes('consent') ||
            text.includes('agree') || text.includes('opt')) {
          prechecked++;
        }
      }
    });
    details.prechecked_consent = prechecked;

    // Misleading button hierarchy (big accept, tiny reject on consent)
    const buttons = document.querySelectorAll('button, a[class*="btn"], [role="button"]');
    let acceptButtons = [];
    let rejectButtons = [];
    buttons.forEach(btn => {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text.includes('accept') || text.includes('agree') || text.includes('allow') || text === 'ok') {
        acceptButtons.push(btn);
      }
      if (text.includes('reject') || text.includes('decline') || text.includes('deny') ||
          text.includes('manage') || text.includes('customize') || text.includes('necessary only')) {
        rejectButtons.push(btn);
      }
    });

    let deceptiveButtons = 0;
    if (acceptButtons.length > 0 && rejectButtons.length > 0) {
      const acceptRect = acceptButtons[0].getBoundingClientRect();
      const rejectRect = rejectButtons[0].getBoundingClientRect();
      const acceptArea = acceptRect.width * acceptRect.height;
      const rejectArea = rejectRect.width * rejectRect.height;
      if (acceptArea > rejectArea * 2) deceptiveButtons++;

      const acceptStyle = window.getComputedStyle(acceptButtons[0]);
      const rejectStyle = window.getComputedStyle(rejectButtons[0]);
      if (acceptStyle.backgroundColor !== rejectStyle.backgroundColor &&
          rejectStyle.backgroundColor === 'rgba(0, 0, 0, 0)') {
        deceptiveButtons++;
      }
    }
    details.deceptive_buttons = deceptiveButtons;

    // Countdown/urgency timers
    const urgencyPatterns = [
      /offer expires in/i, /only \d+ left/i, /limited time/i,
      /hurry/i, /act now/i, /don't miss out/i,
      /\d+:\d+:\d+/, // timer format HH:MM:SS
      /ending soon/i, /last chance/i,
    ];
    details.urgency_elements = urgencyPatterns.filter(p => p.test(body)).length;

    // Hidden unsubscribe / hard-to-find opt-out
    const links = document.querySelectorAll('a');
    let tinyLinks = 0;
    links.forEach(link => {
      const text = (link.textContent || '').toLowerCase();
      if (text.includes('unsubscribe') || text.includes('opt out') || text.includes('opt-out')) {
        const style = window.getComputedStyle(link);
        const size = parseFloat(style.fontSize);
        if (size < 10) tinyLinks++;
      }
    });
    details.hidden_opt_out = tinyLinks;

    // ── Disguised native ads ────────────────────────────────────
    // Detect how deceptively sponsored content is presented

    // 1. Sponsored items styled identically to organic content
    //    (same container class/structure but with a tiny "sponsored" label)
    let disguisedAds = 0;
    const sponsoredEls = document.querySelectorAll(
      '[data-promoted], [data-sponsored], [data-is-sponsored="true"], ' +
      '[class*="sponsored"], [class*="promoted"], ' +
      '[class*="brandvoice"], [class*="BrandVoice"], [class*="AdVoice"]'
    );
    sponsoredEls.forEach(el => {
      // Check if the sponsored label is tiny/hidden
      const label = el.querySelector(
        '[class*="sponsor"], [class*="promot"], [class*="paid"], [class*="ad-label"], ' +
        '[class*="brandvoice"], [class*="BrandVoice"]'
      );
      if (label) {
        const style = window.getComputedStyle(label);
        const fontSize = parseFloat(style.fontSize);
        const opacity = parseFloat(style.opacity);
        // Tiny font, low opacity, or low contrast = deceptive
        if (fontSize < 11 || opacity < 0.6) {
          disguisedAds++;
        }
      }
      // Sponsored item with no visible label at all
      const allText = (el.textContent || '').toLowerCase();
      if (!allText.includes('sponsored') && !allText.includes('promoted') &&
          !allText.includes('paid') && !allText.includes('ad') &&
          !allText.includes('brandvoice') && !allText.includes('brand voice')) {
        disguisedAds++;
      }
    });
    details.disguised_ads = disguisedAds;

    // 2. Clickbait headlines in recommendation widgets
    let clickbaitCount = 0;
    const recoContainers = document.querySelectorAll(
      '[class*="taboola"], [class*="outbrain"], [class*="mgid"], ' +
      '[class*="revcontent"], [class*="content-recommendation"], ' +
      '[class*="recommended"], .OUTBRAIN'
    );
    recoContainers.forEach(container => {
      const recoLinks = container.querySelectorAll('a');
      recoLinks.forEach(link => {
        const text = (link.textContent || '').trim().toLowerCase();
        const clickbaitPatterns = [
          /you won'?t believe/i, /doctors hate/i, /this one trick/i,
          /shocking/i, /jaw.?dropping/i, /mind.?blowing/i,
          /what happens next/i, /will blow your mind/i,
          /\d+ (things|ways|reasons|signs|secrets)/i,
          /before it'?s too late/i, /don'?t miss/i,
        ];
        if (clickbaitPatterns.some(p => p.test(text))) clickbaitCount++;
      });
    });
    details.clickbait_in_widgets = clickbaitCount;

    // 3. "Sponsored" disclosure buried in tiny text or far from content
    let buriedDisclosures = 0;
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.children.length > 3) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.length > 40) continue;
      if (text === 'sponsored' || text === 'promoted' || text === 'ad' ||
          text === 'paid content' || text === 'advertisement' ||
          text === 'paid program' || text === 'brandvoice' ||
          text.startsWith('| paid') || text.startsWith('paid program')) {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        const color = style.color;
        const bg = style.backgroundColor;
        // Check for low-contrast or tiny disclosure
        if (fontSize < 10) buriedDisclosures++;
        // Grey-on-grey type hiding
        if (color.includes('rgb') && bg.includes('rgb')) {
          const colorMatch = color.match(/\d+/g);
          const bgMatch = bg.match(/\d+/g);
          if (colorMatch && bgMatch) {
            const diff = Math.abs(parseInt(colorMatch[0]) - parseInt(bgMatch[0]));
            if (diff < 40) buriedDisclosures++; // very low contrast
          }
        }
      }
    }
    details.buried_disclosures = buriedDisclosures;

    return details;
  });

  const guiltScore = linearScale(domMetrics.guilt_trip_text, 0, 2);
  const precheckedScore = linearScale(domMetrics.prechecked_consent, 0, 3);
  const buttonScore = linearScale(domMetrics.deceptive_buttons, 0, 2);
  const urgencyScore = linearScale(domMetrics.urgency_elements, 0, 3);
  const optOutScore = linearScale(domMetrics.hidden_opt_out, 0, 2);
  const disguisedAdScore = linearScale(domMetrics.disguised_ads, 0, 5);
  const clickbaitScore = linearScale(domMetrics.clickbait_in_widgets, 0, 5);
  const buriedScore = linearScale(domMetrics.buried_disclosures, 0, 3);

  const score = Math.round(
    (guiltScore * 0.15 + precheckedScore * 0.12 + buttonScore * 0.15 +
     urgencyScore * 0.10 + optOutScore * 0.08 +
     disguisedAdScore * 0.18 + clickbaitScore * 0.12 + buriedScore * 0.10) * 100
  ) / 100;

  return {
    score: Math.min(10, score),
    metrics: domMetrics,
  };
}

module.exports = { evaluate };
