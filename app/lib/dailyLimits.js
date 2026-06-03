const { runSqlParams, queryJsonParams } = require("./sqlite");

const DAILY_FIRE_LIMIT  = process.env.MAX_DAILY_FIRE_CALLS  ? Number(process.env.MAX_DAILY_FIRE_CALLS)  : 0;
const DAILY_JUDGE_LIMIT = process.env.MAX_DAILY_JUDGE_CALLS ? Number(process.env.MAX_DAILY_JUDGE_CALLS) : 0;

let _daily = { day: "", fire: 0, judge: 0 };
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
    console.warn("[daily-limits] SQLite unavailable, falling back to process-local counters:", e.message);
  }
}

_ensureTable();

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function _loadFromDb(day) {
  if (!_sqliteReady) return null;
  try {
    var rows = queryJsonParams(
      "SELECT fire_count, judge_count FROM daily_limits WHERE day = ?;",
      [day]
    );
    if (rows.length) {
      return { day: day, fire: Number(rows[0].fire_count || 0), judge: Number(rows[0].judge_count || 0) };
    }
  } catch (e) {
    _sqliteReady = false;
    console.warn("[daily-limits] DB read failed, using local counters:", e.message);
  }
  return null;
}

function _saveToDb(day, fire, judge) {
  if (!_sqliteReady) return;
  try {
    runSqlParams(
      "INSERT OR REPLACE INTO daily_limits (day, fire_count, judge_count) VALUES (?, ?, ?);",
      [day, fire, judge]
    );
  } catch (e) {
    _sqliteReady = false;
    console.warn("[daily-limits] DB write failed, using local counters:", e.message);
  }
}

function _dailyReset() {
  var today = _today();
  if (_daily.day !== today) {
    var db = _loadFromDb(today);
    if (db) {
      _daily = db;
    } else {
      _daily = { day: today, fire: 0, judge: 0 };
    }
  }
}

function dailyLimitExceeded(type) {
  _dailyReset();
  if (type === "fire"  && DAILY_FIRE_LIMIT  && _daily.fire  >= DAILY_FIRE_LIMIT)  return true;
  if (type === "judge" && DAILY_JUDGE_LIMIT && _daily.judge >= DAILY_JUDGE_LIMIT) return true;
  return false;
}

function dailyIncrement(type) {
  _dailyReset();
  _daily[type] = (_daily[type] || 0) + 1;
  _saveToDb(_daily.day, _daily.fire, _daily.judge);
}

module.exports = {
  dailyLimitExceeded: dailyLimitExceeded,
  dailyIncrement: dailyIncrement,
  DAILY_FIRE_LIMIT: DAILY_FIRE_LIMIT,
  DAILY_JUDGE_LIMIT: DAILY_JUDGE_LIMIT,
};
