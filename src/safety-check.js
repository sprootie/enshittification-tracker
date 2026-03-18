const dns = require('dns');
const https = require('https');
const db = require('./db');

// API keys from environment
const GOOGLE_SAFE_BROWSING_KEY = process.env.GOOGLE_SAFE_BROWSING_KEY || '';
const VIRUSTOTAL_KEY = process.env.VIRUSTOTAL_KEY || '';

// ── VirusTotal Rate Limiter ─────────────────────────────────────
// 4 lookups/min, 500/day. We track timestamps in memory and persist
// daily count in the settings table. If quota is hit, safety checks
// return a "quota_exceeded" status that prevents submission from
// proceeding (the check is NOT bypassed).

const VT_MAX_PER_MINUTE = 4;
const VT_MAX_PER_DAY = 500;

const vtMinuteWindow = []; // timestamps of recent lookups
let vtDayCount = 0;
let vtDayDate = '';

function vtLoadDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  if (vtDayDate !== today) {
    // New day — reset
    const stored = db.getSetting('vt_daily_count');
    const storedDate = db.getSetting('vt_daily_date');
    if (storedDate === today && stored) {
      vtDayCount = parseInt(stored) || 0;
    } else {
      vtDayCount = 0;
    }
    vtDayDate = today;
  }
}

function vtRecordLookup() {
  const now = Date.now();
  vtMinuteWindow.push(now);
  vtDayCount++;
  // Persist daily count
  db.setSetting('vt_daily_count', String(vtDayCount));
  db.setSetting('vt_daily_date', vtDayDate);
}

function vtCleanMinuteWindow() {
  const cutoff = Date.now() - 60000;
  while (vtMinuteWindow.length > 0 && vtMinuteWindow[0] < cutoff) {
    vtMinuteWindow.shift();
  }
}

/**
 * Check if we can make a VirusTotal API call right now.
 * Returns { allowed: true } or { allowed: false, reason, retryAfterMs }
 */
function vtCheckQuota() {
  vtLoadDailyCount();
  vtCleanMinuteWindow();

  if (vtDayCount >= VT_MAX_PER_DAY) {
    // Calculate ms until midnight UTC
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const retryAfterMs = tomorrow.getTime() - now.getTime();
    return {
      allowed: false,
      reason: `Daily quota exceeded (${vtDayCount}/${VT_MAX_PER_DAY})`,
      retryAfterMs,
    };
  }

  if (vtMinuteWindow.length >= VT_MAX_PER_MINUTE) {
    // Wait until oldest entry in window expires
    const oldestTs = vtMinuteWindow[0];
    const retryAfterMs = (oldestTs + 60000) - Date.now();
    return {
      allowed: false,
      reason: `Minute quota exceeded (${vtMinuteWindow.length}/${VT_MAX_PER_MINUTE})`,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    };
  }

  return { allowed: true };
}

// ── Cloudflare Family DNS Check ─────────────────────────────────
function dnsResolve(domain, server) {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver();
    resolver.setServers([server]);
    resolver.resolve4(domain, { ttl: false }, (err, addresses) => {
      if (err) {
        resolve({ resolved: false, addresses: [], error: err.code });
      } else {
        resolve({ resolved: true, addresses });
      }
    });
  });
}

async function checkCloudflareFamily(domain) {
  try {
    const [normal, family] = await Promise.all([
      dnsResolve(domain, '1.1.1.1'),
      dnsResolve(domain, '1.1.1.3'),
    ]);

    if (!normal.resolved) {
      return { safe: true, detail: 'Domain does not resolve' };
    }

    if (!family.resolved) {
      return { safe: false, detail: `Blocked by Cloudflare Family DNS (${family.error})` };
    }

    const blockedIps = ['0.0.0.0', '::'];
    const familyBlocked = family.addresses.some(ip => blockedIps.includes(ip));
    if (familyBlocked) {
      return { safe: false, detail: 'Resolved to 0.0.0.0 via Cloudflare Family DNS (malware/adult)' };
    }

    return { safe: true, detail: 'Passed Cloudflare Family DNS check' };
  } catch (err) {
    return { safe: true, detail: `DNS check error: ${err.message}` };
  }
}

// ── HTTP helpers ────────────────────────────────────────────────
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { ...headers },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── Google Safe Browsing Lookup API v4 ──────────────────────────
async function checkGoogleSafeBrowsing(siteUrl) {
  if (!GOOGLE_SAFE_BROWSING_KEY) {
    return { safe: true, detail: 'Google Safe Browsing API key not configured' };
  }

  try {
    const apiUrl = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GOOGLE_SAFE_BROWSING_KEY}`;
    const body = {
      client: { clientId: 'enshittification-index', clientVersion: '1.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url: siteUrl }],
      },
    };

    const result = await httpsPost(apiUrl, body);

    if (result.matches && result.matches.length > 0) {
      const threats = result.matches.map(m => m.threatType).join(', ');
      return { safe: false, detail: `Google Safe Browsing: ${threats}` };
    }

    return { safe: true, detail: 'Passed Google Safe Browsing check' };
  } catch (err) {
    return { safe: true, detail: `Safe Browsing check error: ${err.message}` };
  }
}

// ── VirusTotal URL Check ────────────────────────────────────────
async function checkVirusTotal(domain) {
  if (!VIRUSTOTAL_KEY) {
    return { safe: true, detail: 'VirusTotal API key not configured' };
  }

  // Check rate limits BEFORE making the API call
  const quota = vtCheckQuota();
  if (!quota.allowed) {
    // Return quota_exceeded — this is NOT a pass, the caller must handle it
    return {
      safe: null, // null = indeterminate, must not be bypassed
      quota_exceeded: true,
      detail: `VirusTotal ${quota.reason}`,
      retryAfterMs: quota.retryAfterMs,
    };
  }

  try {
    vtRecordLookup();

    const apiUrl = `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`;
    const result = await httpsGet(apiUrl, { 'x-apikey': VIRUSTOTAL_KEY });

    // API itself returned rate limit
    if (result.status === 429) {
      return {
        safe: null,
        quota_exceeded: true,
        detail: 'VirusTotal API returned 429 rate limit',
        retryAfterMs: 60000,
      };
    }

    if (result.status === 404) {
      return { safe: true, detail: 'Domain not found in VirusTotal' };
    }

    if (result.status !== 200) {
      // Non-200 that isn't 404 or 429 — treat as error, don't bypass
      return {
        safe: null,
        quota_exceeded: false,
        detail: `VirusTotal returned status ${result.status}`,
      };
    }

    const stats = result.data?.data?.attributes?.last_analysis_stats;
    if (!stats) {
      return { safe: true, detail: 'No VirusTotal analysis data available' };
    }

    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const total = (stats.harmless || 0) + (stats.undetected || 0) + malicious + suspicious;

    if (malicious >= 3) {
      return { safe: false, detail: `VirusTotal: ${malicious}/${total} engines flagged as malicious` };
    }
    if (malicious + suspicious >= 5) {
      return { safe: false, detail: `VirusTotal: ${malicious} malicious + ${suspicious} suspicious out of ${total} engines` };
    }

    return { safe: true, detail: `VirusTotal: ${malicious} malicious, ${suspicious} suspicious out of ${total} engines` };
  } catch (err) {
    // Network error — don't bypass, treat as indeterminate
    return {
      safe: null,
      quota_exceeded: false,
      detail: `VirusTotal check error: ${err.message}`,
    };
  }
}

// ── Main safety check ───────────────────────────────────────────
/**
 * Run all safety checks for a domain/URL.
 *
 * Returns:
 *   { safe: true,  checks: {...} }  — all checks passed, OK to crawl
 *   { safe: false, checks: {...} }  — failed a check, mark as disallowed
 *   { safe: null,  checks: {...}, retry: true, retryAfterMs: N }
 *       — VirusTotal quota exceeded or error, submission must wait
 */
async function runSafetyChecks(domain, siteUrl) {
  // Run Cloudflare and Google in parallel, but VirusTotal sequentially
  // (VT has tight rate limits so we check quota first)
  const [cloudflare, google] = await Promise.all([
    checkCloudflareFamily(domain),
    checkGoogleSafeBrowsing(siteUrl),
  ]);

  // If Cloudflare or Google already failed, no need to spend VT quota
  if (!cloudflare.safe || !google.safe) {
    const checks = {
      cloudflare,
      google,
      virustotal: { safe: true, detail: 'Skipped (already failed other checks)' },
    };
    db.log('warn', `Safety check for ${domain}: FAILED (${!cloudflare.safe ? 'cloudflare' : 'google'})`);
    return { safe: false, checks };
  }

  const virustotal = await checkVirusTotal(domain);
  const checks = { cloudflare, google, virustotal };

  // Handle VT quota exceeded / errors (safe === null)
  if (virustotal.safe === null) {
    db.log('warn', `Safety check for ${domain}: VT unavailable — ${virustotal.detail}`);
    return {
      safe: null,
      checks,
      retry: true,
      retryAfterMs: virustotal.retryAfterMs || 60000,
    };
  }

  const safe = cloudflare.safe && google.safe && virustotal.safe;

  const failedChecks = [];
  if (!cloudflare.safe) failedChecks.push('cloudflare');
  if (!google.safe) failedChecks.push('google');
  if (!virustotal.safe) failedChecks.push('virustotal');

  db.log(
    safe ? 'info' : 'warn',
    `Safety check for ${domain}: ${safe ? 'PASSED' : 'FAILED (' + failedChecks.join(', ') + ')'}`
  );

  return { safe, checks };
}

module.exports = { runSafetyChecks };
