const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tempDir = fs.mkdtempSync("/tmp/csb-history-test-");
const { createJsonLeaderboardRepository } = require("../lib/repositories/jsonLeaderboardRepository");

test("json leaderboard repository writes and sorts entries", function() {
  const repo = createJsonLeaderboardRepository({
    filePath: path.join(tempDir, "leaderboard.json"),
  });

  repo.insertEntry({ modelId: "beta", prompt: "second", score: 42, createdAt: "2026-04-23T00:00:01.000Z" });
  repo.insertEntry({ modelId: "alpha", prompt: "first", score: 91, createdAt: "2026-04-23T00:00:00.000Z" });

  const rows = repo.listTop();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    modelId: "alpha",
    prompt: "first",
    score: 91,
    createdAt: "2026-04-23T00:00:00.000Z",
  });
  assert.deepEqual(rows[1], {
    modelId: "beta",
    prompt: "second",
    score: 42,
    createdAt: "2026-04-23T00:00:01.000Z",
  });
});

test("json leaderboard repository reports aggregate stats", function() {
  const repo = createJsonLeaderboardRepository({
    filePath: path.join(tempDir, "leaderboard.json"),
  });
  const stats = repo.stats();

  assert.equal(stats.totalEntries, 2);
  assert.equal(stats.bestScore, 91);
  assert.equal(stats.worstScore, 42);
});
