const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const db = require('./src/db');
const auth = require('./src/auth');
const crawler = require('./src/crawler/worker');
const { runSafetyChecks } = require('./src/safety-check');

// Templates
const homeTemplate = require('./src/templates/home');
const siteDetailTemplate = require('./src/templates/site-detail');
const searchTemplate = require('./src/templates/search');
const adminLoginTemplate = require('./src/templates/admin-login');
const adminStatusTemplate = require('./src/templates/admin-status');
const adminSettingsTemplate = require('./src/templates/admin-settings');
const adminSitesTemplate = require('./src/templates/admin-sites');

const PORT = parseInt(process.env.PORT || '3000');

// ── SSRF Protection (reused from old app) ───────────────────────
function isBlockedHost(hostname) {
  const blocked = [
    /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./, /^169\.254\./, /^0\./, /^\[::1\]$/,
    /^\[fc/i, /^\[fd/i, /^\[fe80/i, /^metadata\.google/i, /^169\.254\.169\.254/,
  ];
  return blocked.some(re => re.test(hostname));
}

function validateAndNormalizeUrl(rawUrl) {
  if (!rawUrl) return null;
  let urlStr = rawUrl.trim();
  if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (isBlockedHost(parsed.hostname)) return null;
    if (parsed.port && !['80', '443', ''].includes(parsed.port)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ── Rate Limiter (submissions: 5/hr per IP, DB-backed) ──────────
const SUBMIT_RATE_LIMIT = 5; // max submissions per hour per IP

function isSubmitLimited(ip) {
  return db.countRecentSubmissionsByIp(ip) >= SUBMIT_RATE_LIMIT;
}

// ── Static File Serving ─────────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ── Helpers ─────────────────────────────────────────────────────
function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function redirect(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['cf-connecting-ip'] ||
         req.socket.remoteAddress;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 10) { req.destroy(); reject(new Error('Body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      const params = new URLSearchParams(body);
      const obj = {};
      for (const [k, v] of params) obj[k] = v;
      resolve(obj);
    });
    req.on('error', reject);
  });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Routes ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const clientIp = getClientIp(req);
  let reqUrl;
  try { reqUrl = new URL(req.url, `http://${req.headers.host}`); } catch {
    res.writeHead(400); return res.end('Bad request');
  }

  const pathname = reqUrl.pathname;
  const method = req.method;

  try {
    // ── Static files ──
    if (pathname.startsWith('/static/')) {
      const safeName = path.basename(pathname);
      // Allow serving from screenshots subdirectory
      if (pathname.startsWith('/static/screenshots/')) {
        return serveStatic(res, path.join(__dirname, 'public', 'screenshots', path.basename(pathname)));
      }
      return serveStatic(res, path.join(__dirname, 'public', safeName));
    }

    // ── Robots.txt ──
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\nDisallow: /admin\n');
    }

    // ── Health check ──
    if (pathname === '/health') {
      return sendJson(res, { status: 'ok', uptime: process.uptime() });
    }

    // ── HOME ──
    if (pathname === '/' && method === 'GET') {
      const topSites = db.getTopSites(5);
      const worstSites = db.getWorstSites(5);
      const latestCrawled = db.getLatestCrawled(10);
      return sendHtml(res, homeTemplate.render({ topSites, worstSites, latestCrawled }));
    }

    // ── SUBMIT URL ──
    if (pathname === '/submit' && method === 'POST') {
      if (isSubmitLimited(clientIp)) {
        return sendHtml(res, errorPage('Rate Limited', 'You can submit up to 5 URLs per hour. Please try again later.'), 429);
      }
      const body = await parseBody(req);
      const rawUrl = body.url;
      const normalizedUrl = validateAndNormalizeUrl(rawUrl);
      if (!normalizedUrl) {
        return sendHtml(res, errorPage('Invalid URL', 'Please provide a valid http or https URL.'), 400);
      }
      const domain = extractDomain(normalizedUrl);
      if (!domain) {
        return sendHtml(res, errorPage('Invalid URL', 'Could not extract domain from URL.'), 400);
      }

      const site = db.upsertSite(domain, normalizedUrl);

      // Check if already disallowed
      if (site.status === 'disallowed') {
        return redirect(res, `/site/${encodeURIComponent(domain)}`);
      }

      // Run safety checks for new or unchecked sites
      const existingCheck = db.getLatestSafetyCheck(site.id);
      if (!existingCheck) {
        const safetyResult = await runSafetyChecks(domain, normalizedUrl);

        // VT quota exceeded or API error — don't bypass, ask user to wait
        if (safetyResult.safe === null) {
          const waitMin = Math.ceil((safetyResult.retryAfterMs || 60000) / 60000);
          return sendHtml(res, errorPage(
            'Safety Check Unavailable',
            `Our safety verification service is temporarily at capacity. Please try again in about ${waitMin} minute${waitMin > 1 ? 's' : ''}.`
          ), 503);
        }

        db.insertSafetyCheck(site.id, safetyResult);

        if (!safetyResult.safe) {
          db.updateSiteStatus(site.id, 'disallowed');
          db.clearSiteScores(site.id);
          db.log('warn', `Site disallowed: ${domain} by ${clientIp}`);
          return redirect(res, `/site/${encodeURIComponent(domain)}`);
        }
      }

      // Record submission with IP and User-Agent
      const userAgent = req.headers['user-agent'] || null;
      db.recordSubmission(site.id, clientIp, userAgent);

      db.enqueue(site.id, 1); // priority 1 for user submissions
      db.log('info', `URL submitted: ${domain} by ${clientIp}`);
      return redirect(res, `/site/${encodeURIComponent(domain)}`);
    }

    // ── SITE DETAIL ──
    if (pathname.startsWith('/site/') && method === 'GET') {
      const domain = decodeURIComponent(pathname.slice(6));
      const site = db.getSiteByDomain(domain);
      if (!site) {
        return sendHtml(res, errorPage('Site Not Found', `No data for ${escHtml(domain)}. Submit it on the homepage!`), 404);
      }
      const results = db.getResultsForSite(site.id, 50);
      const isAdmin = auth.isAuthenticated(req);
      const safetyCheck = isAdmin ? db.getLatestSafetyCheck(site.id) : null;
      const submissions = isAdmin ? db.getSubmissionsForSite(site.id, 20) : null;
      return sendHtml(res, siteDetailTemplate.render({ site, results, isAdmin, safetyCheck, submissions }));
    }

    // ── SEARCH ──
    if (pathname === '/search' && method === 'GET') {
      const query = reqUrl.searchParams.get('q') || '';
      const sort = reqUrl.searchParams.get('sort') || 'score_overall';
      const dir = reqUrl.searchParams.get('dir') || 'desc';
      const page = Math.max(1, parseInt(reqUrl.searchParams.get('page')) || 1);
      const perPage = 20;
      const offset = (page - 1) * perPage;

      let result;
      if (query) {
        result = db.searchSites(query, perPage, offset);
      } else {
        result = db.getAllSitesSorted(sort, dir, perPage, offset);
      }

      return sendHtml(res, searchTemplate.render({
        sites: result.sites, total: result.total,
        query, sort, dir, page, perPage,
      }));
    }

    // ── API: Sites list ──
    if (pathname === '/api/sites' && method === 'GET') {
      const page = Math.max(1, parseInt(reqUrl.searchParams.get('page')) || 1);
      const perPage = 20;
      const sort = reqUrl.searchParams.get('sort') || 'score_overall';
      const dir = reqUrl.searchParams.get('dir') || 'desc';
      const result = db.getAllSitesSorted(sort, dir, perPage, (page - 1) * perPage);
      return sendJson(res, { sites: result.sites, total: result.total, page, perPage });
    }

    // ── API: Site history ──
    if (pathname.startsWith('/api/site/') && pathname.endsWith('/history') && method === 'GET') {
      const domain = decodeURIComponent(pathname.slice(10, -8));
      const site = db.getSiteByDomain(domain);
      if (!site) return sendJson(res, { error: 'Not found' }, 404);
      const results = db.getResultsForSite(site.id, 100);
      return sendJson(res, {
        domain: site.domain,
        history: results.map(r => ({
          date: r.crawled_at,
          overall: r.score_overall,
          tracking: r.score_tracking,
          popups: r.score_popups,
          ads: r.score_ads,
          paywalls: r.score_paywalls,
          dark_patterns: r.score_dark_patterns,
          bloat: r.score_bloat,
        })),
      });
    }

    // ── ADMIN: Login ──
    if (pathname === '/admin/login') {
      if (method === 'GET') {
        return sendHtml(res, adminLoginTemplate.render());
      }
      if (method === 'POST') {
        const body = await parseBody(req);
        const passwordHash = auth.getPasswordHash();
        if (!passwordHash) {
          // First login — set the password
          await auth.setPassword(body.password);
          const token = auth.generateToken();
          auth.setAuthCookie(res, token);
          db.log('info', 'Admin password set for the first time');
          return redirect(res, '/admin/status');
        }
        const valid = await auth.verifyPassword(body.password);
        if (!valid) {
          return sendHtml(res, adminLoginTemplate.render({ error: 'Invalid password' }), 401);
        }
        const token = auth.generateToken();
        auth.setAuthCookie(res, token);
        return redirect(res, '/admin/status');
      }
    }

    // ── ADMIN: Logout ──
    if (pathname === '/admin/logout') {
      auth.clearAuthCookie(res);
      return redirect(res, '/');
    }

    // ── Admin routes (require auth) ──
    if (pathname.startsWith('/admin/')) {
      if (!auth.isAuthenticated(req)) {
        return redirect(res, '/admin/login');
      }

      // ── ADMIN: Status ──
      if (pathname === '/admin/status' && method === 'GET') {
        const queueStats = db.getQueueStats();
        const activeQueue = db.getActiveQueue();
        const logs = db.getRecentLogs(50);
        const mem = process.memoryUsage();
        const memoryUsage = {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        };
        const disallowedSites = db.getDisallowedSites(20);
        const recentSubmissions = db.getRecentSubmissions(30);
        const topSubmitters = db.getTopSubmitters(15);
        return sendHtml(res, adminStatusTemplate.render({ queueStats, activeQueue, logs, memoryUsage, disallowedSites, recentSubmissions, topSubmitters }));
      }

      // ── ADMIN: Sites ──
      if (pathname === '/admin/sites' && method === 'GET') {
        const query = reqUrl.searchParams.get('q') || '';
        const statusFilter = reqUrl.searchParams.get('status') || 'all';
        const sort = reqUrl.searchParams.get('sort') || 'domain';
        const dir = reqUrl.searchParams.get('dir') || 'asc';
        const page = Math.max(1, parseInt(reqUrl.searchParams.get('page')) || 1);
        const perPage = 25;
        const result = db.adminGetAllSites(query, statusFilter, sort, dir, perPage, (page - 1) * perPage);
        return sendHtml(res, adminSitesTemplate.render({
          sites: result.sites, total: result.total,
          query, status: statusFilter, sort, dir, page, perPage, message: null,
        }));
      }

      // ── ADMIN: Rescan site (clears old scores, re-queues) ──
      if (pathname.startsWith('/admin/sites/rescan/') && method === 'POST') {
        const domain = decodeURIComponent(pathname.slice(20));
        const site = db.getSiteByDomain(domain);
        if (site) {
          db.clearSiteScores(site.id);
          db.updateSiteStatus(site.id, 'pending');
          db.enqueue(site.id, 2);
          db.log('info', `Admin rescanned ${domain}`);
        }
        return redirect(res, '/admin/sites');
      }

      // ── ADMIN: Delete site entirely ──
      if (pathname.startsWith('/admin/sites/delete/') && method === 'POST') {
        const domain = decodeURIComponent(pathname.slice(20));
        db.deleteSite(domain);
        db.log('info', `Admin deleted ${domain}`);
        return redirect(res, '/admin/sites');
      }

      // ── ADMIN: Settings ──
      if (pathname === '/admin/settings') {
        if (method === 'GET') {
          const settings = {
            recrawl_interval_hours: db.getSetting('recrawl_interval_hours') || '24',
            daily_bandwidth_mb: db.getSetting('daily_bandwidth_mb') || '500',
          };
          return sendHtml(res, adminSettingsTemplate.render({ settings, message: null }));
        }
        if (method === 'POST') {
          const body = await parseBody(req);
          let message = 'Settings saved.';

          if (body.action === 'change_password' && body.new_password) {
            await auth.setPassword(body.new_password);
            message = 'Password changed.';
            db.log('info', 'Admin password changed');
          } else {
            if (body.recrawl_interval_hours) {
              db.setSetting('recrawl_interval_hours', body.recrawl_interval_hours);
            }
            if (body.daily_bandwidth_mb) {
              db.setSetting('daily_bandwidth_mb', body.daily_bandwidth_mb);
            }
            db.log('info', 'Settings updated');
          }

          const settings = {
            recrawl_interval_hours: db.getSetting('recrawl_interval_hours') || '24',
            daily_bandwidth_mb: db.getSetting('daily_bandwidth_mb') || '500',
          };
          return sendHtml(res, adminSettingsTemplate.render({ settings, message }));
        }
      }

      // ── ADMIN: Recrawl ──
      if (pathname.startsWith('/admin/recrawl') && method === 'POST') {
        let domain = pathname.slice(15); // /admin/recrawl/domain
        if (!domain) {
          const body = await parseBody(req);
          domain = body.domain;
        }
        domain = decodeURIComponent(domain);
        const site = db.getSiteByDomain(domain);
        if (site) {
          db.enqueue(site.id, 2); // high priority
          db.log('info', `Admin re-queued ${domain}`);
        }
        return redirect(res, '/admin/status');
      }

      // ── ADMIN: Purge ──
      if (pathname.startsWith('/admin/purge') && method === 'POST') {
        let domain = pathname.slice(13); // /admin/purge/domain
        if (!domain) {
          const body = await parseBody(req);
          domain = body.domain;
        }
        domain = decodeURIComponent(domain);
        db.deleteSite(domain);
        db.log('info', `Admin purged ${domain}`);
        return redirect(res, '/admin/settings');
      }
    }

    // ── 404 ──
    sendHtml(res, errorPage('Not Found', 'Nothing here.'), 404);

  } catch (err) {
    console.error('Request error:', err);
    sendHtml(res, errorPage('Server Error', 'Something went wrong.'), 500);
  }
});

function errorPage(title, message) {
  return `<!DOCTYPE html>
<html><head><title>${escHtml(title)} — Enshittification Index</title>
<link rel="stylesheet" href="/static/style.css">
</head><body>
<nav class="nav"><div class="nav-inner">
  <a href="/" class="nav-brand">The <span>Enshittification</span> Index</a>
</div></nav>
<main class="main"><section class="error-page">
  <h1>${escHtml(title)}</h1>
  <p>${escHtml(message)}</p>
  <a href="/">Back to Home</a>
</section></main>
</body></html>`;
}

// ── Process safety ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[CRASH PREVENTED] Uncaught exception:', err.message);
  try { db.log('error', `Uncaught: ${err.message}`); } catch {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH PREVENTED] Unhandled rejection:', reason);
});

// ── Start ───────────────────────────────────────────────────────
server.maxConnections = 100;
server.listen(PORT, () => {
  console.log(`\n  The Enshittification Index running on port ${PORT}\n`);

  // Start crawler worker
  crawler.start();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  crawler.stop();
  db.close();
  process.exit(0);
});
process.on('SIGINT', () => {
  crawler.stop();
  db.close();
  process.exit(0);
});
