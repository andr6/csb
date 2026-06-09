const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const { runSqlParams, queryJsonParams } = require("../lib/sqlite");
const { recordOutcome, getRecentStats, isModelHealthy, getHealthyModelIds, HEALTH_WINDOW_SIZE, MIN_SUCCESS_RATE } = require("../lib/modelHealth");

function _resetHealth() {
  try {
    runSqlParams("DELETE FROM model_health_log;", []);
  } catch (e) {
    console.warn("Health cleanup failed:", e.message);
  }
}

test("recordOutcome inserts a row", function() {
  _resetHealth();
  recordOutcome("alpha", true, null);
  var rows = queryJsonParams("SELECT * FROM model_health_log WHERE model_id = ?;", ["alpha"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model_id, "alpha");
  assert.equal(rows[0].success, 1);
});

test("getRecentStats returns correct rate over window", function() {
  _resetHealth();
  recordOutcome("beta", true, null);
  recordOutcome("beta", true, null);
  recordOutcome("beta", false, "timeout");
  var stats = getRecentStats("beta", 10);
  assert.equal(stats.calls, 3);
  assert.equal(stats.successes, 2);
  assert.equal(stats.rate, 2 / 3);
});

test("isModelHealthy returns true when insufficient data", function() {
  _resetHealth();
  assert.equal(isModelHealthy("gamma"), true);
  recordOutcome("gamma", false, "err");
  assert.equal(isModelHealthy("gamma"), true);
  recordOutcome("gamma", false, "err");
  assert.equal(isModelHealthy("gamma"), true);
});

test("isModelHealthy returns false when success rate below threshold", function() {
  _resetHealth();
  // 3 failures out of 3 = 0% success
  recordOutcome("delta", false, "err");
  recordOutcome("delta", false, "err");
  recordOutcome("delta", false, "err");
  assert.equal(isModelHealthy("delta"), false);
});

test("isModelHealthy respects custom window and rate", function() {
  _resetHealth();
  recordOutcome("epsilon", true, null);
  recordOutcome("epsilon", false, "err");
  recordOutcome("epsilon", false, "err");
  // 1 success / 3 = 0.33; default MIN_SUCCESS_RATE is 0.5, so unhealthy
  assert.equal(isModelHealthy("epsilon", 3, 0.5), false);
  // Require 0.2 — now healthy
  assert.equal(isModelHealthy("epsilon", 3, 0.2), true);
});

test("getHealthyModelIds filters sick models", function() {
  _resetHealth();
  recordOutcome("healthy", true, null);
  recordOutcome("healthy", true, null);
  recordOutcome("healthy", true, null);
  recordOutcome("sick", false, "err");
  recordOutcome("sick", false, "err");
  recordOutcome("sick", false, "err");
  var ids = getHealthyModelIds(["healthy", "sick", "unknown"]);
  assert.ok(ids.indexOf("healthy") !== -1);
  assert.ok(ids.indexOf("sick") === -1);
  assert.ok(ids.indexOf("unknown") !== -1); // no data = healthy by default
});

test("HEALTH_WINDOW_SIZE and MIN_SUCCESS_RATE are exported", function() {
  assert.equal(typeof HEALTH_WINDOW_SIZE, "number");
  assert.equal(typeof MIN_SUCCESS_RATE, "number");
});
