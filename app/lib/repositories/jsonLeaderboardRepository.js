const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const HISTORY_FILE = process.env.CSB_HISTORY_FILE || path.join(DATA_DIR, "leaderboard.json");
const MAX_HISTORY = 20;

function createJsonLeaderboardRepository(options) {
  const filePath = options && options.filePath ? options.filePath : HISTORY_FILE;

  function ensureDataDir() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function readAll() {
    try {
      ensureDataDir();
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("[leaderboard-json] read failed:", error.message);
      return [];
    }
  }

  function writeAll(entries) {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2) + "\n", "utf8");
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
    const current = readAll();
    current.unshift(normalizeEntry(entry));
    current.sort(function(a, b) {
      return Number(b.score || 0) - Number(a.score || 0);
    });
    writeAll(current.slice(0, MAX_HISTORY));
    return entry;
  }

  function listTop(limit) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || MAX_HISTORY)));
    return readAll().slice(0, safeLimit);
  }

  function stats() {
    const rows = readAll();
    if (!rows.length) {
      return { totalEntries: 0, bestScore: 0, worstScore: 0 };
    }
    return {
      totalEntries: rows.length,
      bestScore: Math.max.apply(null, rows.map(function(row) { return Number(row.score || 0); })),
      worstScore: Math.min.apply(null, rows.map(function(row) { return Number(row.score || 0); })),
    };
  }

  return {
    type: "json",
    insertEntry: insertEntry,
    listTop: listTop,
    stats: stats,
    filePath: filePath,
  };
}

module.exports = {
  createJsonLeaderboardRepository: createJsonLeaderboardRepository,
};
