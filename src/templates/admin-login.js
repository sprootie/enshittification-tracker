const { layout, escHtml } = require('./layout');

function render({ error } = {}) {
  const body = `
    <section class="admin-login">
      <h1>Admin Login</h1>
      ${error ? `<div class="alert alert-error">${escHtml(error)}</div>` : ''}
      <form method="POST" action="/admin/login">
        <label>Password
          <input type="password" name="password" required autofocus>
        </label>
        <button type="submit">Login</button>
      </form>
    </section>
  `;
  return layout('Admin Login', body);
}

module.exports = { render };
