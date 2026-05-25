const { listTopAnalysisRunsByScore } = require("./analysisRuns");
const { queryJson } = require("./sqlite");

// leaderboard_entries was dropped in migration 007; history now reads from analysis_runs.

function readHistory(limit) {
  return listTopAnalysisRunsByScore(limit || 20).map(function(run) {
    return {
      modelId: String(run.crownModelId || ""),
      prompt: String(run.prompt || ""),
      score: Number(run.crownScore || 0),
      createdAt: run.createdAt || "",
    };
  });
}

function addHistoryEntry(_entry) {
  return readHistory();
}

function getHistoryStats() {
  try {
    const rows = queryJson(
      "SELECT COUNT(*) AS totalEntries, COALESCE(MAX(crown_score), 0) AS bestScore, " +
      "COALESCE(MIN(CASE WHEN crown_score > 0 THEN crown_score END), 0) AS worstScore " +
      "FROM analysis_runs WHERE crown_model_id IS NOT NULL;"
    );
    return rows[0] || { totalEntries: 0, bestScore: 0, worstScore: 0 };
  } catch (_) {
    return { totalEntries: 0, bestScore: 0, worstScore: 0 };
  }
}

module.exports = {
  readHistory: readHistory,
  addHistoryEntry: addHistoryEntry,
  getHistoryStats: getHistoryStats,
  storageType: "sqlite",
};
