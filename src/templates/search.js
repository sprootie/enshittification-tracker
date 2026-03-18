const { layout, escHtml } = require('./layout');

function scoreColor(score) {
  if (score == null) return '#999';
  if (score <= 3) return '#2d9a2d';
  if (score <= 6) return '#d4a017';
  return '#d32f2f';
}

function render({ sites, total, query, sort, dir, page, perPage }) {
  const totalPages = Math.ceil(total / perPage);

  const sortOptions = [
    ['score_overall', 'Overall Score'],
    ['score_tracking', 'Tracking'],
    ['score_popups', 'Popups'],
    ['score_ads', 'Ads'],
    ['score_paywalls', 'Paywalls'],
    ['score_dark_patterns', 'Dark Patterns'],
    ['score_bloat', 'Bloat'],
    ['domain', 'Domain'],
    ['last_crawled', 'Last Crawled'],
  ];

  function sortUrl(col) {
    const newDir = (sort === col && dir === 'desc') ? 'asc' : 'desc';
    return `/search?q=${encodeURIComponent(query)}&sort=${col}&dir=${newDir}&page=1`;
  }

  function pageUrl(p) {
    return `/search?q=${encodeURIComponent(query)}&sort=${sort}&dir=${dir}&page=${p}`;
  }

  const body = `
    <section class="search-section">
      <h1>Browse All Sites</h1>
      <form class="search-form" action="/search" method="GET">
        <input type="text" name="q" value="${escHtml(query)}" placeholder="Search domains...">
        <select name="sort">
          ${sortOptions.map(([val, label]) =>
            `<option value="${val}" ${sort === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
        <select name="dir">
          <option value="desc" ${dir === 'desc' ? 'selected' : ''}>High to Low</option>
          <option value="asc" ${dir === 'asc' ? 'selected' : ''}>Low to High</option>
        </select>
        <button type="submit">Search</button>
      </form>

      <p class="result-count">${total} sites found</p>

      <table class="site-table full-table">
        <thead>
          <tr>
            <th><a href="${sortUrl('domain')}">Domain${sort === 'domain' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
            <th><a href="${sortUrl('score_overall')}">Overall${sort === 'score_overall' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
            <th><a href="${sortUrl('score_tracking')}">Track${sort === 'score_tracking' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
            <th><a href="${sortUrl('score_popups')}">Pop${sort === 'score_popups' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
            <th><a href="${sortUrl('score_ads')}">Ads${sort === 'score_ads' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
            <th><a href="${sortUrl('score_paywalls')}">Pay${sort === 'score_paywalls' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
            <th><a href="${sortUrl('score_dark_patterns')}">Dark${sort === 'score_dark_patterns' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
            <th><a href="${sortUrl('score_bloat')}">Bloat${sort === 'score_bloat' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</a></th>
          </tr>
        </thead>
        <tbody>
          ${sites.map(s => `<tr>
            <td><a href="/site/${escHtml(s.domain)}">${escHtml(s.domain)}</a></td>
            <td style="color:${scoreColor(s.score_overall)}">${s.score_overall?.toFixed(1) || '—'}</td>
            <td>${s.score_tracking?.toFixed(1) || '—'}</td>
            <td>${s.score_popups?.toFixed(1) || '—'}</td>
            <td>${s.score_ads?.toFixed(1) || '—'}</td>
            <td>${s.score_paywalls?.toFixed(1) || '—'}</td>
            <td>${s.score_dark_patterns?.toFixed(1) || '—'}</td>
            <td>${s.score_bloat?.toFixed(1) || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${sites.length === 0 ? '<p class="empty">No results found.</p>' : ''}

      ${totalPages > 1 ? `<div class="pagination">
        ${page > 1 ? `<a href="${pageUrl(page - 1)}">Previous</a>` : '<span class="disabled">Previous</span>'}
        <span class="page-info">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a href="${pageUrl(page + 1)}">Next</a>` : '<span class="disabled">Next</span>'}
      </div>` : ''}
    </section>
  `;

  return layout('Browse All Sites', body);
}

module.exports = { render };
