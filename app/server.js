const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: process.env.NODE_ENV !== "test" });

const { PORT, HTTP_TIMEOUT_MS, CONTESTANT_TIMEOUT_MS, JUDGE_TIMEOUT_MS, ALLOWED_ORIGINS, CONTESTANT_PROVIDER, JUDGE_PROVIDER, JUDGE_MODEL, MODEL_MAP } = require("./lib/config");
const metricsServices = require("./lib/metrics");
const { createApp } = require("./app");

metricsServices.loadMetrics(metricsServices.defaultStore);

const app = createApp();

function startServer() {
  return app.listen(PORT, function() {
    metricsServices.startAutoSave(metricsServices.defaultStore, 5 * 60 * 1000);
    console.log("\n  CSB running on http://localhost:" + PORT);
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
  startServer();
}

module.exports = {
  app: app,
  createApp: createApp,
  startServer: startServer,
};
