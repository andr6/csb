const { runSqlParams, queryJsonParams } = require("../sqlite");

function createOtpRepository() {
  function createOtp({ userId, type, hash, expiresAt }) {
    const now = new Date().toISOString();
    // Invalidate any previous active OTP for this user+type
    runSqlParams(
      "UPDATE otps SET consumed_at = ? WHERE user_id = ? AND otp_type = ? AND consumed_at IS NULL",
      [now, userId, type]
    );
    runSqlParams(
      "INSERT INTO otps (user_id, otp_type, otp_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      [userId, type, hash, expiresAt, now]
    );
    const row = queryJsonParams(
      "SELECT id FROM otps WHERE user_id = ? AND otp_type = ? ORDER BY created_at DESC LIMIT 1",
      [userId, type]
    );
    return row && row[0] ? row[0].id : null;
  }

  function findValidOtp(userId, type) {
    const now = new Date().toISOString();
    const rows = queryJsonParams(
      "SELECT * FROM otps WHERE user_id = ? AND otp_type = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      [userId, type, now]
    );
    return rows && rows[0] ? rows[0] : null;
  }

  function consumeOtp(id) {
    const now = new Date().toISOString();
    runSqlParams("UPDATE otps SET consumed_at = ? WHERE id = ?", [now, id]);
  }

  function incrementAttempts(id) {
    runSqlParams("UPDATE otps SET attempts_count = attempts_count + 1 WHERE id = ?", [id]);
  }

  function pruneExpired() {
    const now = new Date().toISOString();
    runSqlParams("DELETE FROM otps WHERE expires_at < ?", [now]);
  }

  return {
    createOtp,
    findValidOtp,
    consumeOtp,
    incrementAttempts,
    pruneExpired,
  };
}

module.exports = { createOtpRepository };
