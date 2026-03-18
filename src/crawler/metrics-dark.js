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

    return details;
  });

  const guiltScore = linearScale(domMetrics.guilt_trip_text, 0, 2);
  const precheckedScore = linearScale(domMetrics.prechecked_consent, 0, 3);
  const buttonScore = linearScale(domMetrics.deceptive_buttons, 0, 2);
  const urgencyScore = linearScale(domMetrics.urgency_elements, 0, 3);
  const optOutScore = linearScale(domMetrics.hidden_opt_out, 0, 2);

  const score = Math.round(
    (guiltScore * 0.25 + precheckedScore * 0.20 + buttonScore * 0.25 +
     urgencyScore * 0.15 + optOutScore * 0.15) * 100
  ) / 100;

  return {
    score: Math.min(10, score),
    metrics: domMetrics,
  };
}

module.exports = { evaluate };
