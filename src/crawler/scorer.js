const WEIGHTS = {
  tracking: 0.20,
  popups: 0.15,
  ads: 0.20,
  paywalls: 0.15,
  dark_patterns: 0.15,
  bloat: 0.15,
};

/**
 * Compute overall score from individual category scores.
 * Each category score is 0-10 (10 = most enshittified).
 */
function computeOverall(scores) {
  let overall = 0;
  for (const [cat, weight] of Object.entries(WEIGHTS)) {
    overall += (scores[cat] || 0) * weight;
  }
  return Math.round(overall * 100) / 100;
}

/**
 * Clamp and scale a raw count to a 0-10 score.
 * e.g., linearScale(count, 0, 15) maps 0→0, 15+→10
 */
function linearScale(value, min, max) {
  if (value <= min) return 0;
  if (value >= max) return 10;
  return Math.round(((value - min) / (max - min)) * 10 * 100) / 100;
}

module.exports = { computeOverall, linearScale, WEIGHTS };
