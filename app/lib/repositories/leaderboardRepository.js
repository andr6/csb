const fs = require("node:fs");
const path = require("node:path");

const {
  DATA_DIR,
  DB_PATH,
  escapeSqlString,
  runSql,
  queryJson,
} = require("../sqlite");
const { applyPendingMigrations } = require("../migrations");

const LEGACY_HISTORY_FILE = path.join(DATA_DIR, "leaderboard.json");
const MAX_HISTORY = 20;

function createLeaderboardRepository() {
  function init() {
    applyPendingMigrations();
    migrateLegacyJson();
  }

  function migrateLegacyJson() {
    if (!fs.existsSync(LEGACY_HISTORY_FILE)) return;
    const existing = queryJson("SELECT COUNT(*) AS count FROM leaderboard_entries;");
    if (existing[0] && Number(existing[0].count) > 0) return;

    try {
      const raw = fs.readFileSync(LEGACY_HISTORY_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return;

      parsed.slice(0, MAX_HISTORY).forEach(function(entry) {
        insertEntry(entry);
      });
    } catch (error) {
      console.error("[leaderboard] legacy migration failed:", error.message);
    }
  }

  function normalizeEntry(entry) {
    return {
      modelId: String(entry.modelId || ""),
      prompt: String(entry.prompt || "").slice(0, 500),
      score: Math.max(0, Math.min(100, Math.round(Number(entry.score || 0)))),
      createdAt: entry.createdAt || new Date().toISOString(),
    };
  }

  function insertEntry(entry) {
    const item = normalizeEntry(entry);
    runSql([
      "INSERT INTO leaderboard_entries (model_id, prompt, score, created_at)",
      "VALUES (",
      "  '" + escapeSqlString(item.modelId) + "',",
      "  '" + escapeSqlString(item.prompt) + "',",
      "  " + item.score + ",",
      "  '" + escapeSqlString(item.createdAt) + "'",
      ");",
    ].join("\n"));
    trim();
    return item;
  }

  function trim() {
    runSql([
      "DELETE FROM leaderboard_entries",
      "WHERE id NOT IN (",
      "  SELECT id FROM leaderboard_entries",
      "  ORDER BY score DESC, created_at DESC, id DESC",
      "  LIMIT " + MAX_HISTORY,
      ");",
    ].join("\n"));
  }

  function listTop(limit) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || MAX_HISTORY)));
    return queryJson([
      "SELECT",
      "  model_id AS modelId,",
      "  prompt,",
      "  score,",
      "  created_at AS createdAt",
      "FROM leaderboard_entries",
      "ORDER BY score DESC, created_at DESC, id DESC",
      "LIMIT " + safeLimit + ";",
    ].join("\n"));
  }

  function stats() {
    const rows = queryJson([
      "SELECT",
      "  COUNT(*) AS totalEntries,",
      "  COALESCE(MAX(score), 0) AS bestScore,",
      "  COALESCE(MIN(score), 0) AS worstScore",
      "FROM leaderboard_entries;",
    ].join("\n"));
    return rows[0] || { totalEntries: 0, bestScore: 0, worstScore: 0 };
  }

  init();

  return {
    type: "sqlite",
    init: init,
    insertEntry: insertEntry,
    listTop: listTop,
    stats: stats,
    dbPath: DB_PATH,
    legacyHistoryFile: LEGACY_HISTORY_FILE,
  };
}

module.exports = {
  createLeaderboardRepository: createLeaderboardRepository,
  MAX_HISTORY: MAX_HISTORY,
};
