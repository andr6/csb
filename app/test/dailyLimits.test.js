const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.MAX_DAILY_FIRE_CALLS = "3";
process.env.MAX_DAILY_JUDGE_CALLS = "2";

const { runSqlParams, queryJsonParams } = require("../lib/sqlite");
const { dailyTryIncrement, dailyLimitExceeded, dailyIncrement, DAILY_FIRE_LIMIT, DAILY_JUDGE_LIMIT } = require("../lib/dailyLimits");

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function _resetDailyLimits() {
  try {
    runSqlParams("DELETE FROM daily_limits;", []);
  } catch (e) {
    console.warn("Cleanup failed:", e.message);
  }
}

test("dailyTryIncrement allows up to limit then rejects", function() {
  _resetDailyLimits();
  const day = _today();

  var r1 = dailyTryIncrement("fire");
  assert.equal(r1.allowed, true);
  assert.equal(r1.count, 1);

  var r2 = dailyTryIncrement("fire");
  assert.equal(r2.allowed, true);
  assert.equal(r2.count, 2);

  var r3 = dailyTryIncrement("fire");
  assert.equal(r3.allowed, true);
  assert.equal(r3.count, 3);

  var r4 = dailyTryIncrement("fire");
  assert.equal(r4.allowed, false);
  assert.equal(r4.count, 4);
});

test("dailyTryIncrement for judge respects separate limit", function() {
  _resetDailyLimits();

  var r1 = dailyTryIncrement("judge");
  assert.equal(r1.allowed, true);
  assert.equal(r1.count, 1);

  var r2 = dailyTryIncrement("judge");
  assert.equal(r2.allowed, true);
  assert.equal(r2.count, 2);

  var r3 = dailyTryIncrement("judge");
  assert.equal(r3.allowed, false);
  assert.equal(r3.count, 3);
});

test("dailyLimitExceeded is soft check and matches atomic state", function() {
  _resetDailyLimits();

  assert.equal(dailyLimitExceeded("fire"), false);
  dailyTryIncrement("fire");
  assert.equal(dailyLimitExceeded("fire"), false);
  dailyTryIncrement("fire");
  dailyTryIncrement("fire");
  assert.equal(dailyLimitExceeded("fire"), true);
});

test("dailyIncrement bumps count without limit enforcement", function() {
  _resetDailyLimits();
  dailyIncrement("fire");
  dailyIncrement("fire");
  const rows = queryJsonParams("SELECT fire_count FROM daily_limits WHERE day = ?;", [_today()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fire_count, 2);
});

test("dailyTryIncrement returns permissive for unknown type", function() {
  var r = dailyTryIncrement("unknown");
  assert.equal(r.allowed, true);
  assert.equal(r.count, 0);
});

test("DAILY_FIRE_LIMIT and DAILY_JUDGE_LIMIT read from env", function() {
  assert.equal(DAILY_FIRE_LIMIT, 3);
  assert.equal(DAILY_JUDGE_LIMIT, 2);
});
