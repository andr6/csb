const { runSqlParams, queryJsonParams } = require("../sqlite");

function createUserRepository() {
  function createUser({ fullName, email, phone, passwordHash }) {
    const now = new Date().toISOString();
    runSqlParams(
      "INSERT INTO users (full_name, email, phone_number, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [fullName, email, phone, passwordHash, now, now]
    );
    const row = queryJsonParams("SELECT id FROM users WHERE email = ?", [email]);
    return row && row[0] ? row[0].id : null;
  }

  function findByEmail(email) {
    const rows = queryJsonParams("SELECT * FROM users WHERE email = ?", [email]);
    return rows && rows[0] ? rows[0] : null;
  }

  function findById(id) {
    const rows = queryJsonParams("SELECT * FROM users WHERE id = ?", [id]);
    return rows && rows[0] ? rows[0] : null;
  }

  function markEmailVerified(id) {
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?",
      [now, id]
    );
  }

  function markPhoneVerified(id) {
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET phone_verified = 1, updated_at = ? WHERE id = ?",
      [now, id]
    );
  }

  function updateLastLogin(id) {
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET last_login_at = ?, failed_login_attempts = 0, account_locked_until = NULL, updated_at = ? WHERE id = ?",
      [now, now, id]
    );
  }

  function incrementFailedLogin(id) {
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = ? WHERE id = ?",
      [now, id]
    );
  }

  function lockAccount(id, until) {
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET account_locked_until = ?, updated_at = ? WHERE id = ?",
      [until, now, id]
    );
  }

  function isAccountLocked(id) {
    const rows = queryJsonParams("SELECT account_locked_until FROM users WHERE id = ?", [id]);
    if (!rows || !rows[0] || !rows[0].account_locked_until) return false;
    return new Date(rows[0].account_locked_until) > new Date();
  }

  function updateFirstLogin(id) {
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET first_login_completed = 1, updated_at = ? WHERE id = ?",
      [now, id]
    );
  }

  function enableCustomMode(id) {
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET custom_mode_access_enabled = 1, updated_at = ? WHERE id = ?",
      [now, id]
    );
  }

  return {
    createUser,
    findByEmail,
    findById,
    markEmailVerified,
    markPhoneVerified,
    updateLastLogin,
    incrementFailedLogin,
    lockAccount,
    isAccountLocked,
    updateFirstLogin,
    enableCustomMode,
  };
}

module.exports = { createUserRepository };
