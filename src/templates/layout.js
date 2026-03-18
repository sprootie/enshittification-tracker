function layout(title, body, { isAdmin = false } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — The Enshittification Index</title>
  <link rel="stylesheet" href="/static/style.css?v=2">
</head>
<body>
  <nav class="nav">
    <div class="nav-inner">
      <a href="/" class="nav-brand">The <span>Enshittification</span> Index</a>
      <div class="nav-links">
        <a href="/search">Browse All</a>
        ${isAdmin ? '<a href="/admin/status">Admin</a>' : ''}
      </div>
    </div>
  </nav>
  <main class="main">${body}</main>
  <footer class="footer">
    <p>The Enshittification Index — Measuring how platforms extract value from users.</p>
  </footer>
  <script src="/static/app.js"></script>
</body>
</html>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { layout, escHtml };
