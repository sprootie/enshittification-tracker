const { linearScale } = require('./scorer');

/**
 * Evaluate page bloat metrics.
 * @param {import('puppeteer-core').Page} page
 * @param {string[]} requestUrls
 * @param {{ totalBytes: number, jsBytes: number, requestCount: number, loadTime: number }} netStats
 */
async function evaluate(page, requestUrls, netStats) {
  const domNodeCount = await page.evaluate(() => document.querySelectorAll('*').length);

  const pageSizeMB = netStats.totalBytes / (1024 * 1024);
  const jsSizeMB = netStats.jsBytes / (1024 * 1024);
  const loadTimeSec = netStats.loadTime / 1000;

  // Scoring
  const sizeScore = linearScale(pageSizeMB, 0.5, 8);       // 0.5MB clean, 8MB+ bloated
  const requestScore = linearScale(netStats.requestCount, 10, 150); // 10 ok, 150+ bloated
  const jsScore = linearScale(jsSizeMB, 0.2, 4);            // 200KB ok, 4MB+ bloated
  const loadScore = linearScale(loadTimeSec, 1, 10);         // 1s ok, 10s+ bloated
  const domScore = linearScale(domNodeCount, 500, 5000);     // 500 ok, 5000+ bloated

  const score = Math.round(
    (sizeScore * 0.25 + requestScore * 0.20 + jsScore * 0.20 +
     loadScore * 0.15 + domScore * 0.20) * 100
  ) / 100;

  return {
    score: Math.min(10, score),
    metrics: {
      page_size_bytes: netStats.totalBytes,
      page_size_mb: Math.round(pageSizeMB * 100) / 100,
      request_count: netStats.requestCount,
      js_size_bytes: netStats.jsBytes,
      js_size_mb: Math.round(jsSizeMB * 100) / 100,
      load_time_ms: netStats.loadTime,
      dom_node_count: domNodeCount,
    },
  };
}

module.exports = { evaluate };
