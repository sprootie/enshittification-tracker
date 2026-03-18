const { layout, escHtml } = require('./layout');

function scoreColor(score) {
  if (score == null) return '#999';
  if (score <= 3) return '#2d9a2d';
  if (score <= 6) return '#d4a017';
  return '#d32f2f';
}

function scoreBar(label, score, maxScore = 10) {
  const pct = score != null ? (score / maxScore) * 100 : 0;
  const color = scoreColor(score);
  return `<div class="score-bar-row">
    <span class="score-bar-label">${escHtml(label)}</span>
    <div class="score-bar-track">
      <div class="score-bar-fill" style="width:${pct}%; background:${color}"></div>
    </div>
    <span class="score-bar-value" style="color:${color}">${score != null ? score.toFixed(1) : '—'}</span>
  </div>`;
}

function render({ site, results, isAdmin = false, safetyCheck = null, submissions = null }) {
  const s = site;
  const latestResult = results[0];
  const screenshotUrl = latestResult?.screenshot_path
    ? `/static/${latestResult.screenshot_path}` : null;

  // Build history data for chart
  const historyData = results.slice().reverse().map(r => ({
    date: r.crawled_at,
    score: r.score_overall,
  }));

  const isBlocked = s.status === 'blocked';
  const isDisallowed = s.status === 'disallowed';
  const isUnscorable = isBlocked || isDisallowed;

  const body = `
    <section class="site-header">
      <h1>${escHtml(s.domain)}</h1>
      ${isDisallowed ? `
        <div class="blocked-badge disallowed-badge">DISALLOWED</div>
        <p class="blocked-msg">This site has been flagged by automated safety checks and will not be analyzed.</p>
      ` : isBlocked ? `
        <div class="blocked-badge">BLOCKED</div>
        <p class="blocked-msg">This site blocks automated access from both datacenter IPs and Tor exit nodes. We can't score it — but blocking bots to prevent analysis is itself a form of enshittification.</p>
      ` : `
        <div class="overall-score" style="border-color:${scoreColor(s.score_overall)}">
          <span class="overall-number" style="color:${scoreColor(s.score_overall)}">${s.score_overall != null ? s.score_overall.toFixed(1) : '—'}</span>
          <span class="overall-label">/ 10</span>
        </div>
      `}
      <p class="site-meta">
        First seen: ${escHtml(s.first_seen)} |
        Last crawled: ${escHtml(s.last_crawled || 'Never')} |
        Crawl count: ${s.crawl_count} |
        Status: ${escHtml(s.status)}
      </p>
      ${isAdmin ? `<div class="admin-actions">
        <form method="POST" action="/admin/sites/rescan/${encodeURIComponent(s.domain)}" class="inline-action">
          <button type="submit" class="btn-small">Rescan</button>
        </form>
        <form method="POST" action="/admin/sites/delete/${encodeURIComponent(s.domain)}" class="inline-action"
              onsubmit="return confirm('Delete ${escHtml(s.domain)} and all its data?')">
          <button type="submit" class="btn-small btn-danger">Delete</button>
        </form>
      </div>` : ''}
    </section>

    ${!isUnscorable ? `<section class="card">
      <h2>Score Breakdown</h2>
      ${scoreBar('Tracking', s.score_tracking)}
      ${scoreBar('Popups & Overlays', s.score_popups)}
      ${scoreBar('Advertising', s.score_ads)}
      ${scoreBar('Paywalls', s.score_paywalls)}
      ${scoreBar('Dark Patterns', s.score_dark_patterns)}
      ${scoreBar('Page Bloat', s.score_bloat)}
    </section>` : ''}

    ${latestResult ? `<section class="card">
      <h2>Latest Crawl Details</h2>
      <div class="metrics-grid">
        <div class="metric"><strong>Load Time</strong><span>${latestResult.page_load_time_ms ? (latestResult.page_load_time_ms / 1000).toFixed(1) + 's' : '—'}</span></div>
        <div class="metric"><strong>Page Size</strong><span>${latestResult.page_size_bytes ? (latestResult.page_size_bytes / 1024).toFixed(0) + ' KB' : '—'}</span></div>
        <div class="metric"><strong>Requests</strong><span>${latestResult.request_count || '—'}</span></div>
        <div class="metric"><strong>JS Size</strong><span>${latestResult.js_size_bytes ? (latestResult.js_size_bytes / 1024).toFixed(0) + ' KB' : '—'}</span></div>
        <div class="metric"><strong>DOM Nodes</strong><span>${latestResult.dom_node_count || '—'}</span></div>
      </div>
    </section>` : ''}

    ${screenshotUrl ? `<section class="card">
      <h2>Latest Screenshot</h2>
      <img class="screenshot" src="${escHtml(screenshotUrl)}" alt="Screenshot of ${escHtml(s.domain)}">
    </section>` : ''}

    ${isAdmin && results.filter(r => r.screenshot_path).length > 1 ? `<section class="card">
      <h2>Screenshot History (Admin Only)</h2>
      <div class="screenshot-grid">
        ${results.filter(r => r.screenshot_path).map(r => `<div class="screenshot-item">
          <img class="screenshot-thumb" src="/static/${escHtml(r.screenshot_path)}" alt="Screenshot from ${escHtml(r.crawled_at)}">
          <span class="screenshot-date">${escHtml(r.crawled_at)}</span>
        </div>`).join('')}
      </div>
      <form method="POST" action="/admin/sites/clear-screenshots/${encodeURIComponent(s.domain)}" style="margin-top:12px">
        <button type="submit" class="btn-small btn-danger" onclick="return confirm('Delete all screenshots except the latest?')">Clear Old Screenshots</button>
      </form>
    </section>` : ''}

    ${results.length > 1 ? `<section class="card">
      <h2>Score History</h2>
      <canvas id="history-chart" data-history='${escHtml(JSON.stringify(historyData))}'></canvas>
    </section>` : ''}

    <section class="card">
      <h2>Past Crawls</h2>
      <table class="site-table">
        <thead><tr><th>Date</th><th>Overall</th><th>Track</th><th>Popups</th><th>Ads</th><th>Paywall</th><th>Dark</th><th>Bloat</th></tr></thead>
        <tbody>
          ${results.map(r => `<tr>
            <td>${escHtml(r.crawled_at)}</td>
            <td style="color:${scoreColor(r.score_overall)}">${r.score_overall?.toFixed(1) || '—'}</td>
            <td>${r.score_tracking?.toFixed(1) || '—'}</td>
            <td>${r.score_popups?.toFixed(1) || '—'}</td>
            <td>${r.score_ads?.toFixed(1) || '—'}</td>
            <td>${r.score_paywalls?.toFixed(1) || '—'}</td>
            <td>${r.score_dark_patterns?.toFixed(1) || '—'}</td>
            <td>${r.score_bloat?.toFixed(1) || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${results.length === 0 ? '<p class="empty">No crawl results yet.</p>' : ''}
    </section>

    ${isAdmin && safetyCheck ? `<section class="card">
      <h2>Safety Check Details (Admin Only)</h2>
      <p class="site-meta">Checked: ${escHtml(safetyCheck.checked_at)} | Overall: ${safetyCheck.is_safe ? 'SAFE' : 'FAILED'}</p>
      <table class="site-table">
        <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>
          <tr>
            <td>Cloudflare Family DNS</td>
            <td class="${safetyCheck.cloudflare_safe ? 'safe-pass' : 'safe-fail'}">${safetyCheck.cloudflare_safe ? 'Pass' : 'FAIL'}</td>
            <td>${escHtml(safetyCheck.cloudflare_detail)}</td>
          </tr>
          <tr>
            <td>Google Safe Browsing</td>
            <td class="${safetyCheck.google_safe ? 'safe-pass' : 'safe-fail'}">${safetyCheck.google_safe ? 'Pass' : 'FAIL'}</td>
            <td>${escHtml(safetyCheck.google_detail)}</td>
          </tr>
          <tr>
            <td>VirusTotal</td>
            <td class="${safetyCheck.virustotal_safe ? 'safe-pass' : 'safe-fail'}">${safetyCheck.virustotal_safe ? 'Pass' : 'FAIL'}</td>
            <td>${escHtml(safetyCheck.virustotal_detail)}</td>
          </tr>
        </tbody>
      </table>
    </section>` : ''}

    ${isAdmin && submissions && submissions.length > 0 ? `<section class="card">
      <h2>Submission History (Admin Only)</h2>
      <table class="site-table">
        <thead><tr><th>IP Address</th><th>User Agent</th><th>Submitted</th></tr></thead>
        <tbody>
          ${submissions.map(sub => `<tr>
            <td><code>${escHtml(sub.ip)}</code></td>
            <td class="ua-cell">${escHtml(sub.user_agent || '—')}</td>
            <td>${escHtml(sub.submitted_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>` : ''}
  `;

  return layout(s.domain, body, { isAdmin });
}

module.exports = { render };
