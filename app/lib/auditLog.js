const { runSqlParams } = require("./sqlite");

function insert(eventType, userId, details) {
  try {
    runSqlParams(
      "INSERT INTO security_events (event_type, user_id, details_json, created_at) VALUES (?, ?, ?, ?)",
      [eventType, userId || null, details ? JSON.stringify(details) : null, new Date().toISOString()]
    );
  } catch (e) {
    console.warn("[auditLog] insert failed:", e.message);
  }
}

module.exports = { insert };
