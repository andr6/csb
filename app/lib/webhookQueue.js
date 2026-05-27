const { runSqlParams, queryJsonParams } = require("./sqlite");
const { withTimeout } = require("./http");

const WEBHOOK_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 5;

function getWebhookUrl() {
  return String(process.env.WEBHOOK_URL || "").trim();
}

function enqueueWebhook(event) {
  if (!getWebhookUrl()) return;
  const now = new Date().toISOString();
  runSqlParams(
    "INSERT INTO webhook_queue (event_json, attempts, next_attempt_at, created_at) VALUES (?, 0, ?, ?)",
    [JSON.stringify(event), now, now]
  );
}

async function processWebhookQueue() {
  const WEBHOOK_URL = getWebhookUrl();
  if (!WEBHOOK_URL) return;

  const now = new Date().toISOString();
  const rows = queryJsonParams(
    "SELECT id, event_json, attempts FROM webhook_queue WHERE succeeded_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC LIMIT 10;",
    [now]
  );

  for (const row of rows) {
    const id = row.id;
    const attempts = Number(row.attempts) + 1;
    const event = JSON.parse(row.event_json);

    const timer = withTimeout(WEBHOOK_TIMEOUT_MS);
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({}, event, { sentAt: new Date().toISOString() })),
        signal: timer.signal,
      });
      runSqlParams(
        "UPDATE webhook_queue SET attempts = ?, succeeded_at = ? WHERE id = ?",
        [attempts, new Date().toISOString(), id]
      );
    } catch (e) {
      const nextAttempt = attempts >= MAX_ATTEMPTS
        ? null
        : new Date(Date.now() + Math.pow(2, attempts) * 1000).toISOString();
      runSqlParams(
        "UPDATE webhook_queue SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?",
        [attempts, e.message, nextAttempt, id]
      );
      console.warn("[webhook] delivery failed (attempt " + attempts + "):", e.message);
    } finally {
      timer.cleanup();
    }
  }
}

function startWebhookProcessor(intervalMs) {
  const ms = Number(intervalMs || 30000);
  const timer = setInterval(processWebhookQueue, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  enqueueWebhook: enqueueWebhook,
  processWebhookQueue: processWebhookQueue,
  startWebhookProcessor: startWebhookProcessor,
};
