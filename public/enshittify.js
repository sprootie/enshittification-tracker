// ── The Enshittifier — Injected Runtime ─────────────────────────
// This script is injected into proxied pages by the server.
// It creates all overlay elements and manages the enshittification slider.

(function() {
  'use strict';

  const LEVEL = window.__ENSHITTIFIER_LEVEL || 5;
  const TARGET_URL = window.__ENSHITTIFIER_URL || '';

  // ── Respawn tracking ──
  let respawnTimers = [];
  let currentLevel = LEVEL;

  function randomDelay() {
    return (Math.random() * 10000) + 5000; // 5–15 seconds
  }

  function clearAllTimers() {
    respawnTimers.forEach(t => clearTimeout(t));
    respawnTimers = [];
  }

  // ── Helpers ──
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  function show(elem) { if (elem) elem.style.display = 'block'; }
  function showFlex(elem) { if (elem) elem.style.display = 'flex'; }
  function hide(elem) { if (elem) elem.style.display = 'none'; }

  // ── Build all overlay elements ──────────────────────────────

  // Push page content down
  document.body.classList.add('enshit-body-pushed');

  // -- Control Bar --
  const controlBar = el('div', 'enshit-control-bar');
  controlBar.innerHTML = `
    <h1><a href="https://www.enshittify.me" style="color:inherit;text-decoration:none">The <span>Enshittifier</span></a></h1>
    <div class="enshit-slider-wrap">
      <label>Level</label>
      <input type="range" class="enshit-slider" min="0" max="10" value="${LEVEL}" step="1">
    </div>
    <div class="enshit-level enshit-level-green">${LEVEL}</div>
    <button class="enshit-share-btn">Share This Atrocity</button>
  `;
  document.body.appendChild(controlBar);

  const slider = controlBar.querySelector('.enshit-slider');
  const levelDisplay = controlBar.querySelector('.enshit-level');
  const shareBtn = controlBar.querySelector('.enshit-share-btn');

  // -- Toast --
  const toastEl = el('div', 'enshit-toast', 'Link copied!');
  document.body.appendChild(toastEl);

  // -- Cookie Banner --
  const cookie = el('div', 'enshit-cookie');
  cookie.innerHTML = `
    <p>We use cookies, tracking pixels, device fingerprinting, and various surveillance technologies to enhance your browsing experience, serve personalized advertisements, sell your data to third parties, and monitor your every digital move. We share this information with 847 "trusted partners" who definitely have your best interests at heart.</p>
    <div class="enshit-btn-row">
      <button class="enshit-btn-accept">Accept All (Recommended!)</button>
      <button class="enshit-btn-manage">Manage 847 Individual Cookie Preferences</button>
    </div>
  `;
  document.body.appendChild(cookie);

  // -- Cookie Preferences Modal --
  const cookiePrefsCategories = [
    "Strictly Necessary Synergy Cookies", "Cross-Platform Behavioral Prediction Cookies",
    "Third-Party Emotional Analytics Cookies", "AI-Powered Mood Surveillance Cookies",
    "Retro-Active Consent Inference Cookies", "Inter-Dimensional Tracking Cookies",
    "Blockchain-Verified Engagement Cookies", "Quantum Entangled Session Cookies",
    "Predictive Doom-Scroll Optimization Cookies", "Subliminal Upsell Facilitation Cookies",
    "Dark Pattern Enablement Cookies", "Neural Pathway Mapping Cookies",
    "Passive-Aggressive Reminder Cookies", "Existential Dread Monetization Cookies",
    "Social Graph Exploitation Cookies", "Hyper-Targeted Dream Ad Cookies",
    "Cross-Device Guilt Trip Cookies", "Algorithmic Outrage Amplification Cookies",
    "Wellness-Washing Analytics Cookies", "Gamified Attention Extraction Cookies",
    "Post-Purchase Regret Tracking Cookies", "Infinite Scroll Dependency Cookies",
    "Dynamic Pricing Surveillance Cookies", "Fake Urgency Generation Cookies",
    "FOMO Induction Engine Cookies", "Shadow Profile Construction Cookies",
  ];
  const cookiePrefs = el('div', 'enshit-cookie-prefs');
  let cpRows = '';
  cookiePrefsCategories.forEach((name, i) => {
    cpRows += `<div class="enshit-cp-row">
      <input type="checkbox" ${i === 0 ? 'checked disabled' : ''}>
      <span class="enshit-cp-name">${name}</span>
      <select>
        <option>Allow</option><option>Deny</option>
        <option>Ask Every Time</option><option>Allow on Tuesdays</option>
        <option>Deny Unless Mercury Is in Retrograde</option>
      </select>
    </div>`;
  });
  cookiePrefs.innerHTML = `
    <div class="enshit-cp-box">
      <h3>Manage Your Cookie Preferences</h3>
      <p>We respect your privacy. That's why we've made this process as confusing and exhausting as possible. Please review each of our 847 cookie categories below. Showing 26 of 847.</p>
      <div class="enshit-cp-scroll">${cpRows}</div>
      <div class="enshit-cp-btns">
        <span class="enshit-cp-note">You must review all 847 categories to save</span>
        <button class="enshit-cp-cancel">Cancel</button>
        <button class="enshit-cp-save" disabled>Save Preferences</button>
      </div>
    </div>
  `;
  document.body.appendChild(cookiePrefs);

  cookiePrefs.querySelector('.enshit-cp-cancel').addEventListener('click', () => {
    hide(cookiePrefs);
    show(cookie);
  });

  // -- Newsletter Popup --
  const overlayBg = el('div', 'enshit-overlay-bg');
  document.body.appendChild(overlayBg);

  const newsletter = el('div', 'enshit-newsletter');
  newsletter.innerHTML = `
    <h3>Wait! Don't Go!</h3>
    <p>Get our FREE newsletter with content that's definitely not the same article rewritten 47 times!</p>
    <input type="email" placeholder="your@email.com" disabled>
    <button class="enshit-btn-sub">YES! I LOVE SPAM!</button>
    <button class="enshit-btn-dismiss">No thanks, I hate knowledge</button>
  `;
  document.body.appendChild(newsletter);

  // -- Signup Wall --
  const signupWall = el('div', 'enshit-signup-wall');
  signupWall.innerHTML = `
    <div class="enshit-wall-box">
      <h3>You've reached your free article limit</h3>
      <p>Create a free account to continue reading. It only takes 30 seconds. We promise. (We'll also email you 47 times a week.)</p>
      <button class="enshit-btn-wall">Sign Up Free</button>
      <button class="enshit-btn-wall-dismiss">No thanks, I enjoy not reading things</button>
    </div>
  `;
  document.body.appendChild(signupWall);

  // -- Floating Video --
  const video = el('div', 'enshit-video');
  video.innerHTML = `
    <iframe class="enshit-fv-iframe" src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ&controls=0&modestbranding=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    <div class="enshit-fv-label">NOW PLAYING</div>
    <button class="enshit-fv-close">\u2715</button>
  `;
  document.body.appendChild(video);

  // -- Push Notification --
  const push = el('div', 'enshit-push');
  push.innerHTML = `
    <div class="enshit-pn-icon">\uD83D\uDD14</div>
    <div class="enshit-pn-text">
      <p>${new URL(TARGET_URL).hostname || 'This site'} wants to send you notifications</p>
      <small>Get breaking updates and sponsored content!</small>
    </div>
    <div class="enshit-pn-btns">
      <button class="enshit-pn-block">Block</button>
      <button class="enshit-pn-allow">Allow</button>
    </div>
  `;
  document.body.appendChild(push);

  // -- Chat Widget --
  const chat = el('div', 'enshit-chat');
  chat.innerHTML = `
    <div class="enshit-cw-header">
      <span>\uD83D\uDCAC Live Support</span>
      <button class="enshit-cw-close">\u2715</button>
    </div>
    <div class="enshit-cw-body">
      <div class="enshit-cw-online"><span class="enshit-cw-dot"></span> Definitely a real human is online</div>
      <div class="enshit-cw-msg">Hi there! \uD83D\uDC4B I'm a REAL PERSON (not a bot!) and I noticed you've been on this page for 0.3 seconds. Can I interest you in our Premium Plus Ultra subscription? Only $49.99/mo!</div>
    </div>
    <div class="enshit-cw-input-row">
      <input type="text" class="enshit-cw-input" placeholder="Type a message...">
      <button class="enshit-cw-send">Send</button>
    </div>
  `;
  document.body.appendChild(chat);

  // -- Chat interaction --
  const chatBotResponses = [
    "I appreciate you reaching out! Unfortunately, I can only help with that if you rephrase your question. Could you try asking in a different way?",
    "Great question! That's outside my current capabilities. Have you tried describing your issue using different words?",
    "I'm here to help! However, I wasn't able to understand that. Could you try again with more detail?",
    "Thanks for your patience! I'd love to assist, but I need you to rephrase that. Perhaps try being more specific?",
  ];
  let chatResponseIdx = 0;
  const chatBody = chat.querySelector('.enshit-cw-body');
  const chatInput = chat.querySelector('.enshit-cw-input');
  const chatSend = chat.querySelector('.enshit-cw-send');

  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    // Append user bubble
    const userMsg = el('div', 'enshit-cw-msg-user', text);
    chatBody.appendChild(userMsg);
    chatInput.value = '';
    chatBody.scrollTop = chatBody.scrollHeight;
    // Show typing indicator
    const typing = el('div', 'enshit-cw-typing', 'Agent is typing...');
    chatBody.appendChild(typing);
    chatBody.scrollTop = chatBody.scrollHeight;
    // Bot reply after delay
    setTimeout(() => {
      typing.remove();
      const botMsg = el('div', 'enshit-cw-msg', chatBotResponses[chatResponseIdx % chatBotResponses.length]);
      chatBody.appendChild(botMsg);
      chatResponseIdx++;
      chatBody.scrollTop = chatBody.scrollHeight;
    }, 1000);
  }
  chatSend.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

  // -- Urgency Banner --
  const urgency = el('div', 'enshit-urgency');
  urgency.innerHTML = `<span>\uD83D\uDD25</span> <span><strong>7 other people are reading this right now!</strong> This article is trending in your area.</span>`;
  document.body.appendChild(urgency);

  // -- Ad Blocker Wall --
  const adblockWall = el('div', 'enshit-adblock-wall');
  adblockWall.innerHTML = `
    <div class="enshit-ab-box">
      <h3>\uD83D\uDED1 Ad Blocker Detected!</h3>
      <p>It looks like you're using an ad blocker. We understand, ads are terrible. That's why we filled the page with SO MANY that you needed a blocker in the first place. Please disable it so we can continue the cycle.</p>
      <button class="enshit-btn-disable">Disable Ad Blocker</button>
      <button class="enshit-btn-sub-instead">Or subscribe for $19.99/month to not be harassed</button>
    </div>
  `;
  document.body.appendChild(adblockWall);

  // -- Inline Ads (injected into page content) --
  const adData = [
    { style: '', gradient: 'linear-gradient(135deg,#f093fb,#f5576c)', title: 'Lose 30 Pounds With This ONE Weird Trick', text: 'Doctors are FURIOUS about this simple discovery. Local mom shares her shocking secret...', cta: 'Learn More \u2192', label: 'Sponsored' },
    { style: ' enshit-ad-banner', gradient: 'linear-gradient(90deg,#f5af19,#f12711)', title: '\uD83D\uDEA8 CRYPTO ALERT: This Coin Will 100x by Friday \uD83D\uDEA8', text: 'Top analysts are BEGGING you to buy before midnight. Limited wallets available.', cta: 'INVEST NOW \u2192', label: 'Advertisement' },
    { style: '', gradient: 'linear-gradient(135deg,#a18cd1,#fbc2eb)', title: 'Your Ex Doesn\'t Want You To See This', text: 'NEW AI tool reveals what anyone is REALLY thinking about you. Over 2 million heartbroken people can\'t be wrong.', cta: 'See What They Think \u2192', label: 'Sponsored' },
    { style: '', gradient: 'linear-gradient(135deg,#667eea,#764ba2)', title: 'Surgeons Don\'t Want You To Know This Knee Trick', text: '83-year-old grandma discovers kitchen remedy that rebuilds cartilage overnight. Big Pharma is trying to suppress this page!', cta: 'Watch Free Video \u2192', label: 'Promoted' },
    { style: ' enshit-ad-banner', gradient: 'linear-gradient(90deg,#11998e,#38ef7d)', title: 'WORK FROM HOME: Make $847/Day With This App', text: 'Single parent discovers passive income loophole. The IRS doesn\'t want you to see this. Spots filling fast!', cta: 'CLAIM YOUR SPOT \u2192', label: 'Sponsored Content' },
    { style: '', gradient: 'linear-gradient(135deg,#ee9ca7,#ffdde1)', title: 'She Ate ONE Food Every Morning And Lost 47 Pounds', text: 'Nutritionists are SPEECHLESS. This common breakfast item melts fat like butter on a hot sidewalk. Big Diet doesn\'t want you to know.', cta: 'See The Food \u2192', label: 'Sponsored' },
    { style: ' enshit-ad-banner', gradient: 'linear-gradient(90deg,#fc4a1a,#f7b733)', title: '\uD83D\uDCB0 BREAKING: Government Giving Away Free Money \uD83D\uDCB0', text: 'Most Americans don\'t know about this obscure federal program. You could be owed up to $4,291. Check eligibility before midnight!', cta: 'CHECK NOW \u2192', label: 'Advertisement' },
    { style: '', gradient: 'linear-gradient(135deg,#c471f5,#fa71cd)', title: 'Elon Musk\'s Secret Side Project Will SHOCK You', text: 'The billionaire has been quietly funding this technology. Insiders say it could replace the internet by 2027.', cta: 'Watch The Video \u2192', label: 'Promoted' },
    { style: '', gradient: 'linear-gradient(135deg,#f6d365,#fda085)', title: 'Dermatologists Hate This $2 Wrinkle Trick', text: 'A 73-year-old grandmother looks 35 using this kitchen ingredient every night. Botox clinics are PANICKING.', cta: 'Reveal The Secret \u2192', label: 'Sponsored' },
    { style: ' enshit-ad-banner', gradient: 'linear-gradient(90deg,#0f0c29,#302b63,#24243e)', title: '\u26A0\uFE0F YOUR DEVICE MAY BE COMPROMISED \u26A0\uFE0F', text: 'Our scan detected 3 potential threats on your device. Your personal data could be at risk. Act now before it\'s too late!', cta: 'SCAN NOW \u2192', label: 'Security Alert' },
  ];

  const injectedAds = [];

  function createAdEl(ad) {
    const adEl = el('div', 'enshit-inline-ad' + ad.style);
    adEl.innerHTML = `
      <div class="enshit-ad-label">${ad.label}</div>
      <div class="enshit-ad-row">
        <div class="enshit-ad-img" style="background:${ad.gradient};"></div>
        <div>
          <h4>${ad.title}</h4>
          <p>${ad.text}</p>
          <span class="enshit-ad-cta">${ad.cta}</span>
        </div>
      </div>
    `;
    return adEl;
  }

  // Find suitable content elements and aggressively inject ads
  function injectAdsIntoContent() {
    // Remove any previously injected ads
    injectedAds.forEach(a => a.remove());
    injectedAds.length = 0;

    // Target ALL block-level elements
    const selector = 'p, div, li, h2, h3, h4, section, article, blockquote, table, figure, ul, ol';
    const allBlocks = document.querySelectorAll(selector);
    const validBlocks = Array.from(allBlocks).filter(el => {
      // Skip enshittifier's own elements
      if (el.closest('[class*="enshit-"]:not(body)')) return false;
      // Skip tiny elements
      if (el.textContent.trim().length < 20) return false;
      // Skip elements whose parent is already in our list (avoid double-counting nested)
      return true;
    });

    if (validBlocks.length === 0) return;

    // Scale frequency with enshittification level
    // Level 3: every ~4 blocks, Level 6+: every ~2 blocks
    const interval = currentLevel >= 6 ? 2 : currentLevel >= 4 ? 3 : 4;
    let adIdx = 0;

    for (let i = interval; i < validBlocks.length; i += interval) {
      try {
        const adEl = createAdEl(adData[adIdx % adData.length]);
        adEl.style.display = 'block';
        validBlocks[i].after(adEl);
        injectedAds.push(adEl);
        adIdx++;
      } catch(e) { /* skip elements that can't accept siblings */ }
    }
    console.log('[Enshittifier] Injected', injectedAds.length, 'ads into', validBlocks.length, 'content blocks');
  }

  // ── Layer definitions ───────────────────────────────────────
  const allOverlays = [cookie, overlayBg, newsletter, signupWall, video, push, chat, urgency, adblockWall, cookiePrefs];

  const dismissableMap = {
    cookie:      { elem: cookie,      level: 1, display: 'block' },
    newsletter:  { elem: newsletter,  level: 2, display: 'block', also: [overlayBg] },
    overlayBg:   { elem: overlayBg,   level: 2, display: 'block' },
    signupWall:  { elem: signupWall,  level: 4, display: 'block' },
    video:       { elem: video,       level: 5, display: 'block' },
    push:        { elem: push,        level: 6, display: 'flex' },
    chat:        { elem: chat,        level: 8, display: 'block' },
    adblockWall: { elem: adblockWall, level: 10, display: 'flex' },
  };

  function scheduleRespawn(key) {
    const info = dismissableMap[key];
    if (!info) return;
    const timer = setTimeout(() => {
      if (currentLevel >= info.level) {
        info.elem.style.display = info.display;
        if (key === 'newsletter') show(overlayBg);
        if (key === 'signupWall') document.body.style.overflow = 'hidden';
      }
    }, randomDelay());
    respawnTimers.push(timer);
  }

  function dismissOverlay(key) {
    const info = dismissableMap[key];
    if (!info) return;
    hide(info.elem);
    if (key === 'newsletter') hide(overlayBg);
    if (key === 'signupWall') document.body.style.overflow = '';
    scheduleRespawn(key);
  }

  const layers = {
    1: () => show(cookie),
    2: () => { show(overlayBg); show(newsletter); },
    3: () => {
      injectAdsIntoContent();
      injectedAds.forEach(a => show(a));
    },
    4: () => { show(signupWall); document.body.style.overflow = 'hidden'; },
    5: () => show(video),
    6: () => showFlex(push),
    7: () => {}, // clickbait grid not injected in proxy mode (already ads)
    8: () => show(chat),
    9: () => showFlex(urgency),
    10: () => showFlex(adblockWall),
  };

  function hideAllOverlays() {
    allOverlays.forEach(o => hide(o));
    injectedAds.forEach(a => hide(a));
    document.body.style.overflow = '';
  }

  function updateLevel(level) {
    clearAllTimers();
    hideAllOverlays();
    currentLevel = level;
    levelDisplay.textContent = level;

    for (let i = 1; i <= level; i++) {
      if (layers[i]) layers[i]();
    }

    levelDisplay.className = 'enshit-level';
    if (level <= 2) levelDisplay.classList.add('enshit-level-green');
    else if (level <= 5) levelDisplay.classList.add('enshit-level-yellow');
    else if (level <= 7) levelDisplay.classList.add('enshit-level-orange');
    else levelDisplay.classList.add('enshit-level-red');
  }

  // ── Event Wiring ────────────────────────────────────────────

  slider.addEventListener('input', (e) => {
    const newLevel = parseInt(e.target.value);
    // Update URL without reload
    const url = new URL(window.location.href);
    url.searchParams.set('level', newLevel);
    history.replaceState(null, '', url.toString());
    updateLevel(newLevel);
  });

  // Share button
  shareBtn.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      toastEl.classList.add('enshit-show');
      setTimeout(() => toastEl.classList.remove('enshit-show'), 2000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toastEl.classList.add('enshit-show');
      setTimeout(() => toastEl.classList.remove('enshit-show'), 2000);
    });
  });

  // Dismiss buttons — cookie
  cookie.querySelector('.enshit-btn-accept').addEventListener('click', () => dismissOverlay('cookie'));
  cookie.querySelector('.enshit-btn-manage').addEventListener('click', () => {
    hide(cookie);
    cookiePrefs.style.display = 'flex';
  });

  // Dismiss buttons — newsletter
  newsletter.querySelector('.enshit-btn-dismiss').addEventListener('click', () => dismissOverlay('newsletter'));
  newsletter.querySelector('.enshit-btn-sub').addEventListener('click', () => dismissOverlay('newsletter'));
  overlayBg.addEventListener('click', () => dismissOverlay('newsletter'));

  // Dismiss buttons — signup wall
  signupWall.querySelector('.enshit-btn-wall').addEventListener('click', () => dismissOverlay('signupWall'));
  signupWall.querySelector('.enshit-btn-wall-dismiss').addEventListener('click', () => dismissOverlay('signupWall'));

  // Dismiss buttons — floating video
  video.querySelector('.enshit-fv-close').addEventListener('click', () => dismissOverlay('video'));

  // Dismiss buttons — push notification
  push.querySelector('.enshit-pn-block').addEventListener('click', () => dismissOverlay('push'));
  push.querySelector('.enshit-pn-allow').addEventListener('click', () => dismissOverlay('push'));

  // Dismiss buttons — chat widget
  chat.querySelector('.enshit-cw-close').addEventListener('click', () => dismissOverlay('chat'));

  // Dismiss buttons — adblock wall
  adblockWall.querySelector('.enshit-btn-disable').addEventListener('click', () => dismissOverlay('adblockWall'));
  adblockWall.querySelector('.enshit-btn-sub-instead').addEventListener('click', () => dismissOverlay('adblockWall'));

  // ── Initialize ──────────────────────────────────────────────

  // Detect JS-rendered pages with no server-side content
  // 77px = 52px control bar padding + 25px minimum content
  if (document.body.scrollHeight < 77) {
    window.location.href = 'https://enshittify.me/error?code=js-required&url=' + encodeURIComponent(TARGET_URL);
    return;
  }

  updateLevel(LEVEL);

})();