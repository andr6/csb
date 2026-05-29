const { runSqlParams, queryJsonParams } = require("../sqlite");

function createSessionRepository() {
  function createSession({ userId, tokenHash, expiresAt }) {
    const now = new Date().toISOString();
    runSqlParams(
      "INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
      [userId, tokenHash, expiresAt, now]
    );
    const row = queryJsonParams(
      "SELECT id FROM sessions WHERE token_hash = ?",
      [tokenHash]
    );
    return row && row[0] ? row[0].id : null;
  }

  function findByTokenHash(hash) {
    const now = new Date().toISOString();
    const rows = queryJsonParams(
      "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?",
      [hash, now]
    );
    return rows && rows[0] ? rows[0] : null;
  }

  function deleteByTokenHash(hash) {
    runSqlParams("DELETE FROM sessions WHERE token_hash = ?", [hash]);
  }

  function deleteExpired() {
    const now = new Date().toISOString();
    runSqlParams("DELETE FROM sessions WHERE expires_at < ?", [now]);
  }

  function deleteByUser(userId) {
    runSqlParams("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }

  return {
    createSession,
    findByTokenHash,
    deleteByTokenHash,
    deleteExpired,
    deleteByUser,
  };
}

module.exports = { createSessionRepository };
