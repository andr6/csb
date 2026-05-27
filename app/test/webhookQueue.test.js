const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.WEBHOOK_URL = "https://hooks.example.com/csb";

// Ensure the webhook_queue table exists before running tests
require("../lib/migrations").applyPendingMigrations();

const { runSql, queryJson } = require("../lib/sqlite");
const { enqueueWebhook, processWebhookQueue } = require("../lib/webhookQueue");

function clearQueue() {
  runSql("DELETE FROM webhook_queue;");
}

function getQueueRows() {
  return queryJson("SELECT * FROM webhook_queue ORDER BY id ASC;");
}

test("enqueueWebhook inserts a row when WEBHOOK_URL is set", function() {
  clearQueue();
  enqueueWebhook({ type: "crown_change", newCrown: "alpha" });
  const rows = getQueueRows();
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].event_json).type, "crown_change");
  assert.equal(rows[0].attempts, 0);
  assert.equal(rows[0].succeeded_at, null);
});

test("enqueueWebhook is a no-op when WEBHOOK_URL is empty", function() {
  clearQueue();
  const originalUrl = process.env.WEBHOOK_URL;
  process.env.WEBHOOK_URL = "";
  enqueueWebhook({ type: "test" });
  const rows = getQueueRows();
  assert.equal(rows.length, 0);
  process.env.WEBHOOK_URL = originalUrl;
});

test("processWebhookQueue delivers and marks succeeded", async function() {
  clearQueue();
  const originalFetch = global.fetch;
  global.fetch = async function() {
    return { ok: true, status: 200 };
  };

  enqueueWebhook({ type: "test", data: 1 });
  await processWebhookQueue();

  const rows = getQueueRows();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].succeeded_at, "succeeded_at should be set");
  assert.equal(rows[0].attempts, 1);

  global.fetch = originalFetch;
});

test("processWebhookQueue retries on failure with exponential backoff", async function() {
  clearQueue();
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async function() {
    callCount++;
    throw new Error("network error");
  };

  enqueueWebhook({ type: "retry_test" });
  await processWebhookQueue();

  const rows = getQueueRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].succeeded_at, null);
  assert.equal(rows[0].attempts, 1);
  assert.ok(rows[0].next_attempt_at, "next_attempt_at should be set after first failure");
  assert.ok(rows[0].last_error.indexOf("network error") !== -1, "last_error should contain error message");

  // Simulate time passing to second attempt
  runSql("UPDATE webhook_queue SET next_attempt_at = datetime('now') WHERE id = " + rows[0].id);
  await processWebhookQueue();

  const rows2 = getQueueRows();
  assert.equal(rows2[0].attempts, 2);
  assert.equal(rows2[0].succeeded_at, null);
  assert.ok(rows2[0].next_attempt_at);

  global.fetch = originalFetch;
});

test("processWebhookQueue stops retrying after MAX_ATTEMPTS", async function() {
  clearQueue();
  const originalFetch = global.fetch;
  global.fetch = async function() {
    throw new Error("persistent failure");
  };

  enqueueWebhook({ type: "give_up" });
  // Simulate 5 failed deliveries
  for (var i = 0; i < 5; i++) {
    runSql("UPDATE webhook_queue SET next_attempt_at = datetime('now') WHERE event_json LIKE '%give_up%'");
    await processWebhookQueue();
  }

  const rows = getQueueRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempts, 5);
  assert.equal(rows[0].succeeded_at, null);
  assert.equal(rows[0].next_attempt_at, null, "next_attempt_at should be null after max attempts");
  assert.ok(rows[0].last_error.indexOf("persistent failure") !== -1);

  global.fetch = originalFetch;
});
