const { runSqlParams, queryJsonParams, runTransaction } = require("../sqlite");

function createPasswordResetRepository() {
  function createToken({ userId, tokenHash, expiresAt }) {
    const now = new Date().toISOString();
    return runTransaction(function() {
      // Invalidate any previous active tokens for this user
      runSqlParams(
        "UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL",
        [now, userId]
      );
      runSqlParams(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
        [userId, tokenHash, expiresAt, now]
      );
      const row = queryJsonParams(
        "SELECT id FROM password_reset_tokens WHERE token_hash = ?",
        [tokenHash]
      );
      return row && row[0] ? row[0].id : null;
    });
  }

  function findValidByHash(hash) {
    const now = new Date().toISOString();
    const rows = queryJsonParams(
      "SELECT * FROM password_reset_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?",
      [hash, now]
    );
    return rows && rows[0] ? rows[0] : null;
  }

  function consumeToken(id) {
    const now = new Date().toISOString();
    runSqlParams("UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?", [now, id]);
  }

  function pruneExpired() {
    const now = new Date().toISOString();
    runSqlParams("DELETE FROM password_reset_tokens WHERE expires_at < ?", [now]);
  }

  return {
    createToken,
    findValidByHash,
    consumeToken,
    pruneExpired,
  };
}

module.exports = { createPasswordResetRepository };
