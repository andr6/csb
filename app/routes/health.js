const express = require("express");

const {
  CONTESTANT_PROVIDER,
  JUDGE_PROVIDER,
  JUDGE_MODEL,
  MODEL_MAP,
  KEYS,
} = require("../lib/config");

function createHealthRouter(deps) {
  const router = express.Router();

  const authMw = deps.authMiddleware;
  const analyticsAuth = deps.analyticsAuth;
  const checkProviderHealth = deps.checkProviderHealth || require("../lib/providers").checkProviderHealth;

  router.get("/api/health", authMw.requireAuth, analyticsAuth, async function(req, res) {
    const keyStatus = {};
    ["openrouter", "anthropic", "openai", "gemini", "litellm"].forEach(function(p) {
      keyStatus[p] = KEYS[p] ? "configured" : "missing";
    });
    const providerStatus = {};
    await Promise.all(
      ["openrouter", "anthropic", "openai", "gemini", "litellm"].map(async function(p) {
        try {
          providerStatus[p] = await checkProviderHealth(p, KEYS[p] || "");
        } catch (e) {
          providerStatus[p] = "error";
        }
      })
    );
    res.json({
      status: "ok",
      contestantProvider: CONTESTANT_PROVIDER,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      modelCount: Object.keys(MODEL_MAP).length,
      sqliteDriver: require("../lib/sqlite").isWasm() ? "wasm" : "native",
      keys: keyStatus,
      providerStatus: providerStatus,
    });
  });

  return router;
}

module.exports = { createHealthRouter };
