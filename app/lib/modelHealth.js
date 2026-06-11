const { runSqlParams, queryJsonParams } = require("./sqlite");

const HEALTH_WINDOW_SIZE = 10;
const MIN_SUCCESS_RATE = 0.5;

function recordOutcome(modelId, success, errorMessage) {
  try {
    runSqlParams(
      "INSERT INTO model_health_log (model_id, success, error_message) VALUES (?, ?, ?);",
      [modelId, success ? 1 : 0, errorMessage || null]
    );
  } catch (e) {
    console.warn("[model-health] record failed:", e.message);
  }
}

function getRecentStats(modelId, limit) {
  const n = Math.max(1, Math.min(100, Number(limit) || HEALTH_WINDOW_SIZE));
  try {
    const rows = queryJsonParams(
      "SELECT success FROM model_health_log WHERE model_id = ? ORDER BY created_at DESC LIMIT ?;",
      [modelId, n]
    );
    if (!rows.length) return { calls: 0, successes: 0, rate: 1 };
    const successes = rows.filter(function(r) { return r.success === 1; }).length;
    return { calls: rows.length, successes: successes, rate: successes / rows.length };
  } catch (e) {
    console.warn("[model-health] stats failed:", e.message);
    return { calls: 0, successes: 0, rate: 1 };
  }
}

function isModelHealthy(modelId, windowSize, minRate) {
  const stats = getRecentStats(modelId, windowSize);
  // Not enough data yet — treat as healthy
  if (stats.calls < 3) return true;
  const threshold = minRate !== undefined ? minRate : MIN_SUCCESS_RATE;
  return stats.rate >= threshold;
}

function getHealthyModelIds(modelIds, windowSize, minRate) {
  return (modelIds || []).filter(function(id) {
    return isModelHealthy(id, windowSize, minRate);
  });
}

module.exports = {
  recordOutcome,
  getRecentStats,
  isModelHealthy,
  getHealthyModelIds,
  HEALTH_WINDOW_SIZE,
  MIN_SUCCESS_RATE,
};
