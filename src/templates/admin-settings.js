const { layout, escHtml } = require('./layout');

function render({ settings, message }) {
  const body = `
    <section class="admin-section">
      <h1>Admin Settings</h1>
      <div class="admin-nav">
        <a href="/admin/status">Status</a>
        <a href="/admin/settings" class="active">Settings</a>
        <a href="/admin/logout">Logout</a>
      </div>

      ${message ? `<div class="alert alert-success">${escHtml(message)}</div>` : ''}

      <div class="card">
        <h2>Crawler Settings</h2>
        <form method="POST" action="/admin/settings">
          <label>Recrawl Interval (hours)
            <input type="number" name="recrawl_interval_hours" value="${escHtml(settings.recrawl_interval_hours)}" min="1" max="720">
          </label>
          <label>Daily Bandwidth Limit (MB)
            <input type="number" name="daily_bandwidth_mb" value="${escHtml(settings.daily_bandwidth_mb)}" min="100" max="10000">
          </label>
          <button type="submit">Save Settings</button>
        </form>
      </div>

      <div class="card">
        <h2>Change Admin Password</h2>
        <form method="POST" action="/admin/settings">
          <input type="hidden" name="action" value="change_password">
          <label>New Password
            <input type="password" name="new_password" minlength="8" required>
          </label>
          <button type="submit">Change Password</button>
        </form>
      </div>

      <div class="card">
        <h2>Site Management</h2>
        <form method="POST" action="/admin/purge" class="inline-form">
          <input type="text" name="domain" placeholder="domain.com" required>
          <button type="submit" class="btn-danger">Purge Site</button>
        </form>
        <form method="POST" action="/admin/recrawl" class="inline-form">
          <input type="text" name="domain" placeholder="domain.com" required>
          <button type="submit">Force Recrawl</button>
        </form>
      </div>
    </section>
  `;

  return layout('Admin Settings', body, { isAdmin: true });
}

module.exports = { render };
