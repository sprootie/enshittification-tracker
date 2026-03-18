const { layout, escHtml } = require('./layout');

function scoreColor(score) {
  if (score == null) return '#999';
  if (score <= 3) return '#2d9a2d';
  if (score <= 6) return '#d4a017';
  return '#d32f2f';
}

function scoreLabel(score) {
  if (score == null) return 'N/A';
  if (score <= 2) return 'Clean';
  if (score <= 4) return 'Mild';
  if (score <= 6) return 'Moderate';
  if (score <= 8) return 'Bad';
  return 'Terrible';
}

function siteRow(site) {
  const s = site.score_overall;
  return `<tr>
    <td><a href="/site/${escHtml(site.domain)}">${escHtml(site.domain)}</a></td>
    <td class="score-cell" style="color:${scoreColor(s)}">${s != null ? s.toFixed(1) : '—'}</td>
    <td class="score-label" style="color:${scoreColor(s)}">${scoreLabel(s)}</td>
  </tr>`;
}

function render({ topSites, worstSites, latestCrawled }) {
  const body = `
    <section class="hero">
      <h1>How enshittified is your favorite website?</h1>
      <p>We crawl websites and score them across 6 categories of enshittification: tracking, popups, ads, paywalls, dark patterns, and bloat.</p>
      <form class="submit-form" action="/submit" method="POST">
        <input type="text" name="url" placeholder="example.com" required autocomplete="url">
        <button type="submit">Analyze</button>
      </form>
      <form class="search-inline" action="/search" method="GET">
        <input type="text" name="q" placeholder="Search scanned sites..." autocomplete="off">
        <button type="submit">Search</button>
      </form>
    </section>

    <div class="dashboard-grid">
      <section class="card">
        <h2>Least Enshittified</h2>
        <table class="site-table">
          <thead><tr><th>Site</th><th>Score</th><th>Rating</th></tr></thead>
          <tbody>${topSites.map(siteRow).join('')}</tbody>
        </table>
        ${topSites.length === 0 ? '<p class="empty">No sites analyzed yet.</p>' : ''}
      </section>

      <section class="card">
        <h2>Most Enshittified</h2>
        <table class="site-table">
          <thead><tr><th>Site</th><th>Score</th><th>Rating</th></tr></thead>
          <tbody>${worstSites.map(siteRow).join('')}</tbody>
        </table>
        ${worstSites.length === 0 ? '<p class="empty">No sites analyzed yet.</p>' : ''}
      </section>

      <section class="card card-wide">
        <h2>Recently Analyzed</h2>
        <table class="site-table">
          <thead><tr><th>Site</th><th>Score</th><th>Rating</th></tr></thead>
          <tbody>${latestCrawled.map(siteRow).join('')}</tbody>
        </table>
        ${latestCrawled.length === 0 ? '<p class="empty">Submit a URL above to get started!</p>' : ''}
      </section>
    </div>
  `;

  return layout('Home', body);
}

module.exports = { render };
