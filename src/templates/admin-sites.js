const { layout, escHtml } = require('./layout');

function scoreColor(score) {
  if (score == null) return '#666';
  if (score <= 3) return '#2d9a2d';
  if (score <= 6) return '#d4a017';
  return '#d32f2f';
}

function statusBadge(status) {
  const colors = {
    done: '#2d9a2d', pending: '#d4a017', crawling: '#2196f3',
    error: '#f44336', blocked: '#ff9800', disallowed: '#f44336',
  };
  const color = colors[status] || '#666';
  return `<span class="status-badge" style="color:${color};border-color:${color}">${escHtml(status)}</span>`;
}

function render({ sites, total, query, status, sort, dir, page, perPage, message }) {
  const totalPages = Math.ceil(total / perPage);

  const statusOptions = ['all', 'done', 'pending', 'crawling', 'error', 'blocked', 'disallowed'];

  const sortOptions = [
    ['domain', 'Domain'], ['status', 'Status'], ['score_overall', 'Overall'],
    ['score_tracking', 'Tracking'], ['score_popups', 'Popups'], ['score_ads', 'Ads'],
    ['score_paywalls', 'Paywalls'], ['score_dark_patterns', 'Dark Patterns'],
    ['score_bloat', 'Bloat'], ['last_crawled', 'Last Crawled'],
    ['first_seen', 'First Seen'], ['crawl_count', 'Crawl Count'],
  ];

  function pageUrl(p) {
    return `/admin/sites?q=${encodeURIComponent(query)}&status=${status}&sort=${sort}&dir=${dir}&page=${p}`;
  }

  function sortUrl(col) {
    const newDir = (sort === col && dir === 'desc') ? 'asc' : 'desc';
    return `/admin/sites?q=${encodeURIComponent(query)}&status=${status}&sort=${col}&dir=${newDir}&page=1`;
  }

  function sortArrow(col) {
    if (sort !== col) return '';
    return dir === 'asc' ? ' ↑' : ' ↓';
  }

  const body = `
    <section class="admin-section">
      <h1>Manage Sites</h1>
      <div class="admin-nav">
        <a href="/admin/status">Status</a>
        <a href="/admin/sites" class="active">Sites</a>
        <a href="/admin/settings">Settings</a>
        <a href="/admin/logout">Logout</a>
      </div>

      ${message ? `<div class="alert alert-success">${escHtml(message)}</div>` : ''}

      <form class="search-form" action="/admin/sites" method="GET">
        <input type="text" name="q" value="${escHtml(query)}" placeholder="Search domains...">
        <select name="status">
          ${statusOptions.map(s =>
            `<option value="${s}" ${status === s ? 'selected' : ''}>${s === 'all' ? 'All Statuses' : s}</option>`
          ).join('')}
        </select>
        <select name="sort">
          ${sortOptions.map(([val, label]) =>
            `<option value="${val}" ${sort === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
        <select name="dir">
          <option value="desc" ${dir === 'desc' ? 'selected' : ''}>Desc</option>
          <option value="asc" ${dir === 'asc' ? 'selected' : ''}>Asc</option>
        </select>
        <button type="submit">Filter</button>
      </form>

      <p class="result-count">${total} sites</p>

      <table class="site-table full-table">
        <thead>
          <tr>
            <th><a href="${sortUrl('domain')}">Domain${sortArrow('domain')}</a></th>
            <th><a href="${sortUrl('status')}">Status${sortArrow('status')}</a></th>
            <th><a href="${sortUrl('score_overall')}">Score${sortArrow('score_overall')}</a></th>
            <th><a href="${sortUrl('last_crawled')}">Last Crawled${sortArrow('last_crawled')}</a></th>
            <th><a href="${sortUrl('crawl_count')}">Crawls${sortArrow('crawl_count')}</a></th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${sites.map(s => `<tr data-domain="${escHtml(s.domain)}" data-status="${escHtml(s.status)}">
            <td><a href="/site/${escHtml(s.domain)}">${escHtml(s.domain)}</a></td>
            <td class="status-col">${statusBadge(s.status)}</td>
            <td class="score-col" style="color:${scoreColor(s.score_overall)};font-weight:700">${s.score_overall != null ? s.score_overall.toFixed(1) : '—'}</td>
            <td>${escHtml(s.last_crawled || '—')}</td>
            <td>${s.crawl_count}</td>
            <td class="action-cell">
              <form method="POST" action="/admin/sites/rescan/${encodeURIComponent(s.domain)}" class="inline-action">
                <button type="submit" class="btn-small" title="Re-queue for crawling">Rescan</button>
              </form>
              <form method="POST" action="/admin/sites/delete/${encodeURIComponent(s.domain)}" class="inline-action"
                    onsubmit="return confirm('Delete ${escHtml(s.domain)} and all its data?')">
                <button type="submit" class="btn-small btn-danger" title="Delete site and all data">Delete</button>
              </form>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${sites.length === 0 ? '<p class="empty">No sites match your filters.</p>' : ''}

      ${totalPages > 1 ? `<div class="pagination">
        ${page > 1 ? `<a href="${pageUrl(page - 1)}">Previous</a>` : '<span class="disabled">Previous</span>'}
        <span class="page-info">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a href="${pageUrl(page + 1)}">Next</a>` : '<span class="disabled">Next</span>'}
      </div>` : ''}
    </section>
  `;

  return layout('Manage Sites', body, { isAdmin: true });
}

module.exports = { render };
