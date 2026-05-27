const { queryJsonParams } = require("./sqlite");

/**
 * Get per-model score drift over the last N days.
 * Returns daily averages and a drift flag when the 7-day rolling average
 * shifts by more than threshold points compared to the prior 7-day window.
 */
function getModelDriftStats(days, threshold) {
  const windowDays = Math.max(7, Math.min(30, Number(days || 14)));
  const driftThreshold = Math.max(5, Math.min(50, Number(threshold || 15)));
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();

  // Q1: per-model daily average crown score (when the model was crowned)
  const q1 = queryJsonParams([
    "SELECT crown_model_id AS modelId, DATE(created_at) AS date,",
    "  AVG(CAST(crown_score AS REAL)) AS avgScore, COUNT(*) AS runs",
    "FROM analysis_runs",
    "WHERE created_at >= ? AND crown_model_id IS NOT NULL AND crown_model_id != ''",
    "GROUP BY crown_model_id, DATE(created_at)",
    "ORDER BY crown_model_id, date ASC;",
  ].join(" "), [since]);

  // Q2: per-model daily average score from judgement (all scored appearances)
  const q2 = queryJsonParams([
    "SELECT s.key AS modelId, DATE(r.created_at) AS date,",
    "  AVG(CAST(s.value AS REAL)) AS avgScore, COUNT(*) AS runs",
    "FROM (SELECT created_at, judgement_json FROM analysis_runs WHERE created_at >= ?) r",
    ", JSON_EACH(JSON_EXTRACT(r.judgement_json, '$.scores')) s",
    "GROUP BY s.key, DATE(r.created_at)",
    "ORDER BY s.key, date ASC;",
  ].join(" "), [since]);

  // Merge q1 and q2, preferring q2 (all appearances) but falling back to q1
  const modelMap = {};
  function ensureModel(id) {
    if (!modelMap[id]) modelMap[id] = { modelId: id, daily: [] };
    return modelMap[id];
  }

  q2.forEach(function(row) {
    ensureModel(row.modelId).daily.push({
      date: row.date,
      avgScore: Math.round(Number(row.avgScore || 0)),
      runs: Number(row.runs || 0),
    });
  });

  // For models with no q2 data, use q1 (crown-only) as fallback
  q1.forEach(function(row) {
    const m = ensureModel(row.modelId);
    if (m.daily.length === 0) {
      m.daily.push({
        date: row.date,
        avgScore: Math.round(Number(row.avgScore || 0)),
        runs: Number(row.runs || 0),
      });
    }
  });

  // Compute drift for each model
  const results = [];
  Object.keys(modelMap).forEach(function(modelId) {
    const m = modelMap[modelId];
    if (m.daily.length < 7) return; // Need at least 7 days of data

    // Calculate rolling 7-day averages
    const daily = m.daily;
    const windows = [];
    for (var i = 6; i < daily.length; i++) {
      var sum = 0;
      var count = 0;
      for (var j = i - 6; j <= i; j++) {
        sum += daily[j].avgScore * daily[j].runs;
        count += daily[j].runs;
      }
      windows.push({
        endDate: daily[i].date,
        avgScore: count > 0 ? Math.round(sum / count) : 0,
        totalRuns: count,
      });
    }

    if (windows.length < 2) return;

    // Compare latest window vs previous window
    var latest = windows[windows.length - 1];
    var previous = windows[windows.length - 2];
    var shift = latest.avgScore - previous.avgScore;
    var driftDetected = Math.abs(shift) >= driftThreshold;

    results.push({
      modelId: modelId,
      latestWindow: latest,
      previousWindow: previous,
      shift: shift,
      driftDetected: driftDetected,
      direction: shift > 0 ? "up" : "down",
      history: windows,
    });
  });

  return {
    windowDays: windowDays,
    threshold: driftThreshold,
    driftDetectedCount: results.filter(function(r) { return r.driftDetected; }).length,
    models: results.sort(function(a, b) {
      return Math.abs(b.shift) - Math.abs(a.shift);
    }),
  };
}

module.exports = { getModelDriftStats: getModelDriftStats };
