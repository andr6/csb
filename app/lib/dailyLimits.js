const { runSqlParams, queryJsonParams } = require("./sqlite");

const DAILY_FIRE_LIMIT  = process.env.MAX_DAILY_FIRE_CALLS  ? Number(process.env.MAX_DAILY_FIRE_CALLS)  : 0;
const DAILY_JUDGE_LIMIT = process.env.MAX_DAILY_JUDGE_CALLS ? Number(process.env.MAX_DAILY_JUDGE_CALLS) : 0;

let _sqliteReady = true;

function _ensureTable() {
  if (!_sqliteReady) return;
  try {
    runSqlParams(
      "CREATE TABLE IF NOT EXISTS daily_limits (" +
      "  day TEXT PRIMARY KEY," +
      "  fire_count INTEGER NOT NULL DEFAULT 0," +
      "  judge_count INTEGER NOT NULL DEFAULT 0" +
      ");",
      []
    );
  } catch (e) {
    _sqliteReady = false;
    console.warn("[daily-limits] SQLite unavailable, falling back to permissive mode:", e.message);
  }
}

_ensureTable();

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function _ensureRow(day) {
  if (!_sqliteReady) return false;
  try {
    runSqlParams(
      "INSERT OR IGNORE INTO daily_limits (day, fire_count, judge_count) VALUES (?, 0, 0);",
      [day]
    );
    return true;
  } catch (e) {
    _sqliteReady = false;
    console.warn("[daily-limits] SQLite row insert failed:", e.message);
    return false;
  }
}

// ── Atomic increment with limit check ────────────────────────────────────────
// Returns { allowed: boolean, count: number }
// This is the PRIMARY API. It atomically increments the counter in SQLite,
// then reads it back to verify it did not exceed the limit.
function dailyTryIncrement(type) {
  if (type !== "fire" && type !== "judge") {
    return { allowed: true, count: 0 };
  }
  const limit = type === "fire" ? DAILY_FIRE_LIMIT : DAILY_JUDGE_LIMIT;
  if (!limit) return { allowed: true, count: 0 };

  const day = _today();
  if (!_ensureRow(day)) return { allowed: true, count: 0 };

  try {
    // Atomic increment — single UPDATE, no read-then-write race window
    runSqlParams(
      "UPDATE daily_limits SET " + type + "_count = " + type + "_count + 1 WHERE day = ?;",
      [day]
    );
    // Read back the new count
    const rows = queryJsonParams(
      "SELECT " + type + "_count FROM daily_limits WHERE day = ?;",
      [day]
    );
    const count = rows.length ? Number(rows[0][type + "_count"] || 0) : 0;
    if (count > limit) {
      return { allowed: false, count: count };
    }
    return { allowed: true, count: count };
  } catch (e) {
    console.warn("[daily-limits] atomic increment failed:", e.message);
    return { allowed: true, count: 0 };
  }
}

// ── Legacy API (kept for backward compatibility) ─────────────────────────────
// These are SOFT checks. In multi-process deployments, use dailyTryIncrement
// for correct behavior. The legacy functions read from DB on every call.
function dailyLimitExceeded(type) {
  if (type === "fire" && !DAILY_FIRE_LIMIT) return false;
  if (type === "judge" && !DAILY_JUDGE_LIMIT) return false;
  const day = _today();
  _ensureRow(day);
  if (!_sqliteReady) return false;
  try {
    const rows = queryJsonParams(
      "SELECT fire_count, judge_count FROM daily_limits WHERE day = ?;",
      [day]
    );
    if (!rows.length) return false;
    const count = Number(rows[0][type + "_count"] || 0);
    return count >= (type === "fire" ? DAILY_FIRE_LIMIT : DAILY_JUDGE_LIMIT);
  } catch (e) {
    return false;
  }
}

function dailyIncrement(type) {
  if (type !== "fire" && type !== "judge") return;
  const day = _today();
  _ensureRow(day);
  if (!_sqliteReady) return;
  try {
    runSqlParams(
      "UPDATE daily_limits SET " + type + "_count = " + type + "_count + 1 WHERE day = ?;",
      [day]
    );
  } catch (e) {
    console.warn("[daily-limits] increment failed:", e.message);
  }
}

module.exports = {
  dailyTryIncrement: dailyTryIncrement,
  dailyLimitExceeded: dailyLimitExceeded,
  dailyIncrement: dailyIncrement,
  DAILY_FIRE_LIMIT: DAILY_FIRE_LIMIT,
  DAILY_JUDGE_LIMIT: DAILY_JUDGE_LIMIT,
};
