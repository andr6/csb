const { runSqlParams, queryJsonParams } = require("./sqlite");

// In-memory fallback when SQLite is unavailable (keyed by "limiterName:key")
const _mem = new Map();

function pruneExpired() {
  const { runSqlParams } = require("./sqlite");
  runSqlParams("DELETE FROM rate_limit_hits WHERE reset_at < ?", [Date.now() - 86400000]);
}

function createRateLimitStore(limiterName) {
  const name = String(limiterName || "default");
  let windowMs = 60 * 1000;

  function init(options) {
    windowMs = (options && options.windowMs) ? Number(options.windowMs) : windowMs;
    pruneExpired();
  }

  async function increment(key) {
    const now = Date.now();

    try {
      const rows = queryJsonParams(
        "SELECT total_hits, reset_at FROM rate_limit_hits WHERE key = ? AND limiter = ?;",
        [key, name]
      );

      let totalHits;
      let resetAt;

      if (!rows.length || rows[0].reset_at <= now) {
        resetAt = now + windowMs;
        totalHits = 1;
        runSqlParams(
          "INSERT OR REPLACE INTO rate_limit_hits (key, limiter, total_hits, reset_at) VALUES (?, ?, 1, ?)",
          [key, name, resetAt]
        );
      } else {
        totalHits = Number(rows[0].total_hits) + 1;
        resetAt = Number(rows[0].reset_at);
        runSqlParams(
          "UPDATE rate_limit_hits SET total_hits = ? WHERE key = ? AND limiter = ?",
          [totalHits, key, name]
        );
      }

      return { totalHits: totalHits, resetTime: new Date(resetAt) };
    } catch (e) {
      console.warn("[rate-limit] sqlite failed, using memory fallback:", e.message);
      const memKey = name + "\x00" + key;
      const entry = _mem.get(memKey);
      let totalHits;
      let resetAt;

      if (!entry || entry.resetAt <= now) {
        resetAt = now + windowMs;
        totalHits = 1;
      } else {
        totalHits = entry.hits + 1;
        resetAt = entry.resetAt;
      }

      _mem.set(memKey, { hits: totalHits, resetAt: resetAt });
      return { totalHits: totalHits, resetTime: new Date(resetAt) };
    }
  }

  async function decrement(key) {
    try {
      runSqlParams(
        "UPDATE rate_limit_hits SET total_hits = MAX(0, total_hits - 1) WHERE key = ? AND limiter = ?",
        [key, name]
      );
    } catch (e) {
      const memKey = name + "\x00" + key;
      const entry = _mem.get(memKey);
      if (entry && entry.hits > 0) {
        _mem.set(memKey, { hits: entry.hits - 1, resetAt: entry.resetAt });
      }
    }
  }

  async function resetKey(key) {
    try {
      runSqlParams(
        "DELETE FROM rate_limit_hits WHERE key = ? AND limiter = ?",
        [key, name]
      );
    } catch (e) {
      _mem.delete(name + "\x00" + key);
    }
  }

  return { init: init, increment: increment, decrement: decrement, resetKey: resetKey };
}

module.exports = { createRateLimitStore: createRateLimitStore };
