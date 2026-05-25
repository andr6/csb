const { WEBHOOK_URL } = require("./config");
const { withTimeout } = require("./http");

const WEBHOOK_TIMEOUT_MS = 30000;

async function notifyWebhook(event) {
  if (!WEBHOOK_URL) return;
  const timer = withTimeout(WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({}, event, { sentAt: new Date().toISOString() })),
      signal: timer.signal,
    });
  } catch (e) {
    console.warn("[webhook] delivery failed:", e.message);
  } finally {
    timer.cleanup();
  }
}

module.exports = { notifyWebhook: notifyWebhook };
