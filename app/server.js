const path = require("node:path");
// System environment variables always take precedence over .env file values.
// Tests that need overrides should set process.env before requiring config.
require("dotenv").config({ path: path.join(__dirname, ".env"), override: false });

const { PORT, HTTP_TIMEOUT_MS, CONTESTANT_TIMEOUT_MS, JUDGE_TIMEOUT_MS, ALLOWED_ORIGINS, CONTESTANT_PROVIDER, JUDGE_PROVIDER, JUDGE_MODEL, MODEL_MAP, WEBHOOK_URL } = require("./lib/config");
const metricsServices = require("./lib/metrics");
const { createApp, seedAdminUser } = require("./app");
const { startWebhookProcessor } = require("./lib/webhookQueue");
const { runBackup } = require("./lib/backup");

metricsServices.loadMetrics(metricsServices.defaultStore);

// Ensure all SQLite tables (including rate_limit_hits) exist before accepting traffic
require("./lib/migrations").applyPendingMigrations();

const app = createApp();

// Side effects that belong outside the factory
seedAdminUser().catch(function(e) { console.error("[auth] Admin user seed failed:", e.message); });

// Daily SQLite backup — run once on startup, then every 24 hours
runBackup();
setInterval(runBackup, 24 * 60 * 60 * 1000);

function startServer() {
  return app.listen(PORT, function() {
    metricsServices.startAutoSave(metricsServices.defaultStore, 5 * 60 * 1000);
    metricsServices.startHourlyRollup(60 * 60 * 1000);
    if (WEBHOOK_URL) {
      startWebhookProcessor(30000);
      console.log("  Webhook processor   : enabled (" + WEBHOOK_URL + ")");
    }
    if (!ALLOWED_ORIGINS.length && process.env.NODE_ENV === "production") {
    console.warn("  [security] ALLOWED_ORIGINS is not set. Mutating endpoints will accept requests from any origin. Set ALLOWED_ORIGINS for production safety.");
  }
  const { isWasm } = require("./lib/sqlite");
  console.log("\n  CSB running on http://localhost:" + PORT);
    console.log("  SQLite driver       : " + (isWasm() ? "wasm (node-sqlite3-wasm)" : "native (better-sqlite3)"));
    console.log("  Contestant provider : " + CONTESTANT_PROVIDER);
    Object.keys(MODEL_MAP).forEach(function(id) {
      console.log("    " + id + " -> " + MODEL_MAP[id]);
    });
    console.log("  Contestant timeout  : " + CONTESTANT_TIMEOUT_MS + "ms");
    console.log("  Judge provider      : " + JUDGE_PROVIDER);
    console.log("  Judge model         : " + JUDGE_MODEL);
    console.log("  Judge timeout       : " + JUDGE_TIMEOUT_MS + "ms");
    console.log("  Allowed origins     : " + (ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(", ") : "all (unset)"));
    console.log("  HTTP timeout        : " + HTTP_TIMEOUT_MS + "ms (base)\n");
  });
}

if (require.main === module) {
  const server = startServer();

  // Graceful shutdown — SIGTERM / SIGINT
  function shutdown(signal) {
    console.log("[" + signal + "] Shutting down gracefully...");

    // Save metrics snapshot
    try {
      metricsServices.saveMetrics(metricsServices.defaultStore);
      console.log("[shutdown] Metrics snapshot saved.");
    } catch (e) {
      console.warn("[shutdown] Metrics save failed:", e.message);
    }

    // Stop webhook processor
    try {
      const { processWebhookQueue } = require("./lib/webhookQueue");
      processWebhookQueue().catch(function() {});
      console.log("[shutdown] Webhook queue flushed.");
    } catch (e) {
      console.warn("[shutdown] Webhook flush failed:", e.message);
    }

    // Close HTTP server
    server.close(function() {
      console.log("[shutdown] HTTP server closed.");

      // Close SQLite
      try {
        const { getDb } = require("./lib/sqlite");
        const db = getDb();
        if (db && db.close) {
          db.close();
          console.log("[shutdown] SQLite closed.");
        }
      } catch (e) {
        console.warn("[shutdown] SQLite close failed:", e.message);
      }

      console.log("[shutdown] Done.");
      process.exit(0);
    });

    // Force exit after 10s if something hangs
    setTimeout(function() {
      console.error("[shutdown] Forced exit after 10s timeout.");
      process.exit(1);
    }, 10000);
  }

  process.on("SIGTERM", function() { shutdown("SIGTERM"); });
  process.on("SIGINT", function() { shutdown("SIGINT"); });
}

module.exports = {
  app: app,
  createApp: createApp,
  startServer: startServer,
};
