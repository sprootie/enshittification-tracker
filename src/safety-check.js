const dns = require('dns');
const https = require('https');
const db = require('./db');

// API keys from environment
const GOOGLE_SAFE_BROWSING_KEY = process.env.GOOGLE_SAFE_BROWSING_KEY || '';
const VIRUSTOTAL_KEY = process.env.VIRUSTOTAL_KEY || '';

// ── Cloudflare Family DNS Check ─────────────────────────────────
// Cloudflare Family (1.1.1.3) blocks malware and adult content.
// If a domain resolves on 1.1.1.1 but returns 0.0.0.0 on 1.1.1.3,
// it's flagged by Cloudflare's threat/adult filters.

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

    // Domain doesn't exist at all — not a safety issue, just invalid
    if (!normal.resolved) {
      return { safe: true, detail: 'Domain does not resolve' };
    }

    // Family DNS blocked it (returns 0.0.0.0 or fails while normal works)
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
    // DNS check failed — don't block on errors, let it through
    return { safe: true, detail: `DNS check error: ${err.message}` };
  }
}

// ── Google Safe Browsing Lookup API v4 ──────────────────────────
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

  try {
    const apiUrl = `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`;
    const result = await httpsGet(apiUrl, { 'x-apikey': VIRUSTOTAL_KEY });

    if (result.status === 404) {
      return { safe: true, detail: 'Domain not found in VirusTotal' };
    }

    if (result.status !== 200) {
      return { safe: true, detail: `VirusTotal returned status ${result.status}` };
    }

    const stats = result.data?.data?.attributes?.last_analysis_stats;
    if (!stats) {
      return { safe: true, detail: 'No VirusTotal analysis data available' };
    }

    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const total = (stats.harmless || 0) + (stats.undetected || 0) + malicious + suspicious;

    // Flag if 3+ engines flag it as malicious, or 5+ flag as suspicious
    if (malicious >= 3) {
      return { safe: false, detail: `VirusTotal: ${malicious}/${total} engines flagged as malicious` };
    }
    if (malicious + suspicious >= 5) {
      return { safe: false, detail: `VirusTotal: ${malicious} malicious + ${suspicious} suspicious out of ${total} engines` };
    }

    return { safe: true, detail: `VirusTotal: ${malicious} malicious, ${suspicious} suspicious out of ${total} engines` };
  } catch (err) {
    return { safe: true, detail: `VirusTotal check error: ${err.message}` };
  }
}

// ── Main safety check ───────────────────────────────────────────
/**
 * Run all safety checks for a domain/URL.
 * Returns { safe: boolean, checks: { cloudflare, google, virustotal } }
 * If any check fails, safe=false and the site should be marked disallowed.
 */
async function runSafetyChecks(domain, siteUrl) {
  const [cloudflare, google, virustotal] = await Promise.all([
    checkCloudflareFamily(domain),
    checkGoogleSafeBrowsing(siteUrl),
    checkVirusTotal(domain),
  ]);

  const checks = { cloudflare, google, virustotal };
  const safe = cloudflare.safe && google.safe && virustotal.safe;

  // Store results in DB
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
