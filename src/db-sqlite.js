const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'enshittindex.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_crawled TEXT,
    crawl_count INTEGER NOT NULL DEFAULT 0,
    score_overall REAL,
    score_tracking REAL,
    score_popups REAL,
    score_ads REAL,
    score_paywalls REAL,
    score_dark_patterns REAL,
    score_bloat REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    bot_crawl INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS crawl_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS crawl_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    crawled_at TEXT NOT NULL DEFAULT (datetime('now')),
    score_overall REAL,
    score_tracking REAL,
    score_popups REAL,
    score_ads REAL,
    score_paywalls REAL,
    score_dark_patterns REAL,
    score_bloat REAL,
    metrics_tracking TEXT,
    metrics_popups TEXT,
    metrics_ads TEXT,
    metrics_paywalls TEXT,
    metrics_dark_patterns TEXT,
    metrics_bloat TEXT,
    page_load_time_ms INTEGER,
    page_size_bytes INTEGER,
    request_count INTEGER,
    js_size_bytes INTEGER,
    dom_node_count INTEGER,
    screenshot_path TEXT,
    bot_crawl INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS crawl_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    ip TEXT NOT NULL,
    user_agent TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS safety_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_safe INTEGER NOT NULL DEFAULT 1,
    cloudflare_safe INTEGER,
    cloudflare_detail TEXT,
    google_safe INTEGER,
    google_detail TEXT,
    virustotal_safe INTEGER,
    virustotal_detail TEXT
  );
`);

// ── Indexes ─────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
  CREATE INDEX IF NOT EXISTS idx_sites_score_overall ON sites(score_overall);
  CREATE INDEX IF NOT EXISTS idx_sites_score_tracking ON sites(score_tracking);
  CREATE INDEX IF NOT EXISTS idx_sites_score_popups ON sites(score_popups);
  CREATE INDEX IF NOT EXISTS idx_sites_score_ads ON sites(score_ads);
  CREATE INDEX IF NOT EXISTS idx_sites_score_paywalls ON sites(score_paywalls);
  CREATE INDEX IF NOT EXISTS idx_sites_score_dark_patterns ON sites(score_dark_patterns);
  CREATE INDEX IF NOT EXISTS idx_sites_score_bloat ON sites(score_bloat);
  CREATE INDEX IF NOT EXISTS idx_sites_last_crawled ON sites(last_crawled);
  CREATE INDEX IF NOT EXISTS idx_queue_status_priority ON crawl_queue(status, priority DESC);
  CREATE INDEX IF NOT EXISTS idx_log_created ON crawl_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_results_site_crawled ON crawl_results(site_id, crawled_at);
  CREATE INDEX IF NOT EXISTS idx_safety_site ON safety_checks(site_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_ip ON submissions(ip);
  CREATE INDEX IF NOT EXISTS idx_submissions_ip_time ON submissions(ip, submitted_at);
  CREATE INDEX IF NOT EXISTS idx_submissions_site ON submissions(site_id);
`);

// ── Migrations (add columns to existing tables) ─────────────────
try { db.exec('ALTER TABLE sites ADD COLUMN bot_crawl INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE crawl_results ADD COLUMN bot_crawl INTEGER NOT NULL DEFAULT 0'); } catch {}

// ── Default settings ────────────────────────────────────────────
const defaultSettings = {
  max_crawlers: '1',
  daily_bandwidth_mb: '500',
  recrawl_interval_hours: '24',
};

const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
);

for (const [key, value] of Object.entries(defaultSettings)) {
  upsertSetting.run(key, value);
}

// ── Prepared Statements ─────────────────────────────────────────

// Sites
const stmts = {
  getSiteByDomain: db.prepare('SELECT * FROM sites WHERE domain = ?'),
  getSiteById: db.prepare('SELECT * FROM sites WHERE id = ?'),
  insertSite: db.prepare(
    'INSERT INTO sites (domain, url) VALUES (?, ?) ON CONFLICT(domain) DO UPDATE SET url = excluded.url RETURNING *'
  ),
  updateSiteScores: db.prepare(`
    UPDATE sites SET
      score_overall = ?, score_tracking = ?, score_popups = ?,
      score_ads = ?, score_paywalls = ?, score_dark_patterns = ?, score_bloat = ?,
      last_crawled = datetime('now'), crawl_count = crawl_count + 1, status = 'done',
      bot_crawl = ?
    WHERE id = ?
  `),
  updateSiteStatus: db.prepare('UPDATE sites SET status = ? WHERE id = ?'),
  clearSiteScores: db.prepare(`
    UPDATE sites SET
      score_overall = NULL, score_tracking = NULL, score_popups = NULL,
      score_ads = NULL, score_paywalls = NULL, score_dark_patterns = NULL, score_bloat = NULL
    WHERE id = ?
  `),
  deleteSite: db.prepare('DELETE FROM sites WHERE domain = ?'),
  getTopSites: db.prepare(
    'SELECT * FROM sites WHERE score_overall IS NOT NULL ORDER BY score_overall ASC LIMIT ?'
  ),
  getWorstSites: db.prepare(
    'SELECT * FROM sites WHERE score_overall IS NOT NULL ORDER BY score_overall DESC LIMIT ?'
  ),
  getLatestCrawled: db.prepare(
    'SELECT * FROM sites WHERE last_crawled IS NOT NULL ORDER BY last_crawled DESC LIMIT ?'
  ),
  searchSites: db.prepare(
    'SELECT * FROM sites WHERE domain LIKE ? ORDER BY score_overall DESC LIMIT ? OFFSET ?'
  ),
  countSearchSites: db.prepare(
    'SELECT COUNT(*) as count FROM sites WHERE domain LIKE ?'
  ),
  getAllSitesSorted: db.prepare(
    'SELECT * FROM sites WHERE score_overall IS NOT NULL ORDER BY score_overall DESC LIMIT ? OFFSET ?'
  ),
  countAllScoredSites: db.prepare(
    'SELECT COUNT(*) as count FROM sites WHERE score_overall IS NOT NULL'
  ),
  getSitesNeedingRecrawl: db.prepare(`
    SELECT * FROM sites
    WHERE last_crawled IS NOT NULL
      AND datetime(last_crawled, '+' || ? || ' hours') < datetime('now')
      AND id NOT IN (SELECT site_id FROM crawl_queue WHERE status IN ('waiting', 'processing'))
    LIMIT ?
  `),

  // Queue
  enqueue: db.prepare(
    'INSERT INTO crawl_queue (site_id, priority) VALUES (?, ?)'
  ),
  getNextInQueue: db.prepare(
    `SELECT cq.*, s.domain, s.url FROM crawl_queue cq
     JOIN sites s ON s.id = cq.site_id
     WHERE cq.status = 'waiting'
     ORDER BY cq.priority DESC, cq.created_at ASC LIMIT 1`
  ),
  startQueueItem: db.prepare(
    `UPDATE crawl_queue SET status = 'processing', started_at = datetime('now') WHERE id = ?`
  ),
  completeQueueItem: db.prepare(
    `UPDATE crawl_queue SET status = 'done' WHERE id = ?`
  ),
  failQueueItem: db.prepare(
    `UPDATE crawl_queue SET status = 'failed', error = ? WHERE id = ?`
  ),
  getQueueStats: db.prepare(`
    SELECT status, COUNT(*) as count FROM crawl_queue GROUP BY status
  `),
  getActiveQueue: db.prepare(
    `SELECT cq.*, s.domain FROM crawl_queue cq
     JOIN sites s ON s.id = cq.site_id
     WHERE cq.status IN ('waiting', 'processing')
     ORDER BY cq.priority DESC, cq.created_at ASC LIMIT 50`
  ),
  getLatestQueueEntry: db.prepare(
    `SELECT * FROM crawl_queue WHERE site_id = ? ORDER BY created_at DESC LIMIT 1`
  ),
  isAlreadyQueued: db.prepare(
    `SELECT COUNT(*) as count FROM crawl_queue
     WHERE site_id = ? AND status IN ('waiting', 'processing')`
  ),

  // Results
  insertResult: db.prepare(`
    INSERT INTO crawl_results (
      site_id, score_overall, score_tracking, score_popups,
      score_ads, score_paywalls, score_dark_patterns, score_bloat,
      metrics_tracking, metrics_popups, metrics_ads,
      metrics_paywalls, metrics_dark_patterns, metrics_bloat,
      page_load_time_ms, page_size_bytes, request_count, js_size_bytes,
      dom_node_count, screenshot_path, bot_crawl
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getResultsForSite: db.prepare(
    'SELECT * FROM crawl_results WHERE site_id = ? ORDER BY crawled_at DESC LIMIT ?'
  ),
  deleteResultsForSite: db.prepare(
    'DELETE FROM crawl_results WHERE site_id = (SELECT id FROM sites WHERE domain = ?)'
  ),
  clearScreenshotPath: db.prepare(
    'UPDATE crawl_results SET screenshot_path = NULL WHERE id = ?'
  ),

  // Log
  insertLog: db.prepare(
    'INSERT INTO crawl_log (level, message) VALUES (?, ?)'
  ),
  getRecentLogs: db.prepare(
    'SELECT * FROM crawl_log ORDER BY created_at DESC LIMIT ?'
  ),

  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ),

  // Safety checks
  insertSafetyCheck: db.prepare(`
    INSERT INTO safety_checks (
      site_id, is_safe, cloudflare_safe, cloudflare_detail,
      google_safe, google_detail, virustotal_safe, virustotal_detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getLatestSafetyCheck: db.prepare(
    'SELECT * FROM safety_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT 1'
  ),
  getSafetyChecksForSite: db.prepare(
    'SELECT * FROM safety_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ?'
  ),
  getDisallowedSites: db.prepare(
    `SELECT s.*, sc.checked_at, sc.cloudflare_detail, sc.google_detail, sc.virustotal_detail
     FROM sites s
     JOIN safety_checks sc ON sc.site_id = s.id
     WHERE s.status = 'disallowed'
     AND sc.id = (SELECT MAX(id) FROM safety_checks WHERE site_id = s.id)
     ORDER BY sc.checked_at DESC LIMIT ?`
  ),

  // Submissions
  insertSubmission: db.prepare(
    'INSERT INTO submissions (site_id, ip, user_agent) VALUES (?, ?, ?)'
  ),
  countRecentSubmissionsByIp: db.prepare(
    `SELECT COUNT(*) as count FROM submissions
     WHERE ip = ? AND submitted_at > datetime('now', '-1 hour')`
  ),
  getSubmissionsForSite: db.prepare(
    'SELECT * FROM submissions WHERE site_id = ? ORDER BY submitted_at DESC LIMIT ?'
  ),
  getRecentSubmissions: db.prepare(
    `SELECT sub.*, s.domain FROM submissions sub
     JOIN sites s ON s.id = sub.site_id
     ORDER BY sub.submitted_at DESC LIMIT ?`
  ),
  getTopSubmitters: db.prepare(
    `SELECT ip, COUNT(*) as submission_count,
       MAX(submitted_at) as last_submission,
       COUNT(DISTINCT site_id) as unique_sites
     FROM submissions
     WHERE submitted_at > datetime('now', '-24 hours')
     GROUP BY ip ORDER BY submission_count DESC LIMIT ?`
  ),
};

// ── Public API ──────────────────────────────────────────────────
module.exports = {
  // Sites
  getSiteByDomain(domain) {
    return stmts.getSiteByDomain.get(domain);
  },
  getSiteById(id) {
    return stmts.getSiteById.get(id);
  },
  upsertSite(domain, url) {
    return stmts.insertSite.get(domain, url);
  },
  updateSiteScores(id, scores, botCrawl = false) {
    return stmts.updateSiteScores.run(
      scores.overall, scores.tracking, scores.popups,
      scores.ads, scores.paywalls, scores.dark_patterns, scores.bloat,
      botCrawl ? 1 : 0, id
    );
  },
  updateSiteStatus(id, status) {
    return stmts.updateSiteStatus.run(status, id);
  },
  clearSiteScores(id) {
    return stmts.clearSiteScores.run(id);
  },
  deleteSite(domain) {
    stmts.deleteResultsForSite.run(domain);
    return stmts.deleteSite.run(domain);
  },
  getTopSites(limit = 5) {
    return stmts.getTopSites.all(limit);
  },
  getWorstSites(limit = 5) {
    return stmts.getWorstSites.all(limit);
  },
  getLatestCrawled(limit = 10) {
    return stmts.getLatestCrawled.all(limit);
  },
  searchSites(query, limit = 20, offset = 0) {
    const pattern = `%${query}%`;
    return {
      sites: stmts.searchSites.all(pattern, limit, offset),
      total: stmts.countSearchSites.get(pattern).count,
    };
  },
  getAllSitesSorted(sortCol, sortDir, limit = 20, offset = 0) {
    // Validate sort column to prevent SQL injection
    const validCols = [
      'score_overall', 'score_tracking', 'score_popups', 'score_ads',
      'score_paywalls', 'score_dark_patterns', 'score_bloat', 'domain', 'last_crawled'
    ];
    const col = validCols.includes(sortCol) ? sortCol : 'score_overall';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    // Dynamic sort requires dynamic SQL - still safe because col is validated
    const stmt = db.prepare(
      `SELECT * FROM sites WHERE score_overall IS NOT NULL ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`
    );
    return {
      sites: stmt.all(limit, offset),
      total: stmts.countAllScoredSites.get().count,
    };
  },
  adminGetAllSites(query, statusFilter, sortCol, sortDir, limit = 20, offset = 0) {
    const validCols = [
      'score_overall', 'score_tracking', 'score_popups', 'score_ads',
      'score_paywalls', 'score_dark_patterns', 'score_bloat',
      'domain', 'last_crawled', 'first_seen', 'status', 'crawl_count'
    ];
    const col = validCols.includes(sortCol) ? sortCol : 'domain';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

    let where = '1=1';
    const params = [];
    if (query) {
      where += ' AND domain LIKE ?';
      params.push(`%${query}%`);
    }
    if (statusFilter && statusFilter !== 'all') {
      where += ' AND status = ?';
      params.push(statusFilter);
    }

    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM sites WHERE ${where}`);
    const dataStmt = db.prepare(
      `SELECT * FROM sites WHERE ${where} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`
    );
    return {
      sites: dataStmt.all(...params, limit, offset),
      total: countStmt.get(...params).count,
    };
  },
  getSitesNeedingRecrawl(intervalHours, limit = 10) {
    return stmts.getSitesNeedingRecrawl.all(String(intervalHours), limit);
  },

  // Queue
  enqueue(siteId, priority = 0) {
    const already = stmts.isAlreadyQueued.get(siteId);
    if (already.count > 0) return null;
    return stmts.enqueue.run(siteId, priority);
  },
  getNextInQueue() {
    return stmts.getNextInQueue.get();
  },
  startQueueItem(id) {
    return stmts.startQueueItem.run(id);
  },
  completeQueueItem(id) {
    return stmts.completeQueueItem.run(id);
  },
  failQueueItem(id, error) {
    return stmts.failQueueItem.run(error, id);
  },
  getQueueStats() {
    return stmts.getQueueStats.all();
  },
  getActiveQueue() {
    return stmts.getActiveQueue.all();
  },
  getLatestQueueEntry(siteId) {
    return stmts.getLatestQueueEntry.get(siteId);
  },

  // Results
  insertResult(result) {
    return stmts.insertResult.run(
      result.site_id, result.score_overall, result.score_tracking, result.score_popups,
      result.score_ads, result.score_paywalls, result.score_dark_patterns, result.score_bloat,
      result.metrics_tracking, result.metrics_popups, result.metrics_ads,
      result.metrics_paywalls, result.metrics_dark_patterns, result.metrics_bloat,
      result.page_load_time_ms, result.page_size_bytes, result.request_count,
      result.js_size_bytes, result.dom_node_count, result.screenshot_path,
      result.bot_crawl || 0
    );
  },
  getResultsForSite(siteId, limit = 50) {
    return stmts.getResultsForSite.all(siteId, limit);
  },
  clearScreenshotPath(resultId) {
    return stmts.clearScreenshotPath.run(resultId);
  },

  // Log
  log(level, message) {
    stmts.insertLog.run(level, message);
  },
  getRecentLogs(limit = 100) {
    return stmts.getRecentLogs.all(limit);
  },

  // Settings
  getSetting(key) {
    const row = stmts.getSetting.get(key);
    return row ? row.value : null;
  },
  setSetting(key, value) {
    return stmts.setSetting.run(key, String(value));
  },

  // Direct db access for cleanup
  close() {
    db.close();
  },

  // Safety checks
  insertSafetyCheck(siteId, result) {
    return stmts.insertSafetyCheck.run(
      siteId,
      result.safe ? 1 : 0,
      result.checks.cloudflare.safe ? 1 : 0,
      result.checks.cloudflare.detail,
      result.checks.google.safe ? 1 : 0,
      result.checks.google.detail,
      result.checks.virustotal.safe ? 1 : 0,
      result.checks.virustotal.detail
    );
  },
  getLatestSafetyCheck(siteId) {
    return stmts.getLatestSafetyCheck.get(siteId);
  },
  getSafetyChecksForSite(siteId, limit = 10) {
    return stmts.getSafetyChecksForSite.all(siteId, limit);
  },
  getDisallowedSites(limit = 50) {
    return stmts.getDisallowedSites.all(limit);
  },

  // Submissions
  recordSubmission(siteId, ip, userAgent) {
    return stmts.insertSubmission.run(siteId, ip, userAgent || null);
  },
  countRecentSubmissionsByIp(ip) {
    return stmts.countRecentSubmissionsByIp.get(ip).count;
  },
  getSubmissionsForSite(siteId, limit = 20) {
    return stmts.getSubmissionsForSite.all(siteId, limit);
  },
  getRecentSubmissions(limit = 50) {
    return stmts.getRecentSubmissions.all(limit);
  },
  getTopSubmitters(limit = 20) {
    return stmts.getTopSubmitters.all(limit);
  },
};
