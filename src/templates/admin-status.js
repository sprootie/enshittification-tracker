const { layout, escHtml } = require('./layout');

function render({ queueStats, activeQueue, logs, memoryUsage, disallowedSites }) {
  const statsMap = {};
  queueStats.forEach(s => { statsMap[s.status] = s.count; });

  const body = `
    <section class="admin-section">
      <h1>Admin Status</h1>
      <div class="admin-nav">
        <a href="/admin/status" class="active">Status</a>
        <a href="/admin/settings">Settings</a>
        <a href="/admin/logout">Logout</a>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <h2>Queue</h2>
          <div class="metrics-grid">
            <div class="metric"><strong>Waiting</strong><span>${statsMap.waiting || 0}</span></div>
            <div class="metric"><strong>Processing</strong><span>${statsMap.processing || 0}</span></div>
            <div class="metric"><strong>Done</strong><span>${statsMap.done || 0}</span></div>
            <div class="metric"><strong>Failed</strong><span>${statsMap.failed || 0}</span></div>
          </div>
        </div>

        <div class="card">
          <h2>System</h2>
          <div class="metrics-grid">
            <div class="metric"><strong>RSS</strong><span>${memoryUsage.rss}MB</span></div>
            <div class="metric"><strong>Heap Used</strong><span>${memoryUsage.heapUsed}MB</span></div>
            <div class="metric"><strong>Heap Total</strong><span>${memoryUsage.heapTotal}MB</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Active Queue</h2>
        <table class="site-table">
          <thead><tr><th>Domain</th><th>Status</th><th>Priority</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${activeQueue.map(q => `<tr>
              <td><a href="/site/${escHtml(q.domain)}">${escHtml(q.domain)}</a></td>
              <td>${escHtml(q.status)}</td>
              <td>${q.priority}</td>
              <td>${escHtml(q.created_at)}</td>
              <td>
                <form method="POST" action="/admin/recrawl/${escHtml(q.domain)}" style="display:inline">
                  <button type="submit" class="btn-small">Recrawl</button>
                </form>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${activeQueue.length === 0 ? '<p class="empty">Queue is empty.</p>' : ''}
      </div>

      ${disallowedSites && disallowedSites.length > 0 ? `<div class="card">
        <h2>Disallowed Sites</h2>
        <table class="site-table">
          <thead><tr><th>Domain</th><th>Checked</th><th>Cloudflare</th><th>Google</th><th>VirusTotal</th></tr></thead>
          <tbody>
            ${disallowedSites.map(s => `<tr>
              <td><a href="/site/${escHtml(s.domain)}">${escHtml(s.domain)}</a></td>
              <td>${escHtml(s.checked_at)}</td>
              <td>${escHtml(s.cloudflare_detail || '—')}</td>
              <td>${escHtml(s.google_detail || '—')}</td>
              <td>${escHtml(s.virustotal_detail || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <div class="card">
        <h2>Recent Logs</h2>
        <div class="log-list">
          ${logs.map(log => `<div class="log-entry log-${escHtml(log.level)}">
            <span class="log-time">${escHtml(log.created_at)}</span>
            <span class="log-level">${escHtml(log.level)}</span>
            <span class="log-msg">${escHtml(log.message)}</span>
          </div>`).join('')}
        </div>
        ${logs.length === 0 ? '<p class="empty">No logs yet.</p>' : ''}
      </div>
    </section>
  `;

  return layout('Admin Status', body, { isAdmin: true });
}

module.exports = { render };
