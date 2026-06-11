const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const {
  CONTESTANT_PROVIDER: _CONTESTANT_PROVIDER,
  MODEL_MAP: _MODEL_MAP,
  ACTIVE_MODEL_IDS: _ACTIVE_MODEL_IDS,
} = require("../lib/config");

const modelServices = require("../lib/models");
const providerServices = require("../lib/providers");
const { getHealthyModelIds } = require("../lib/modelHealth");
const { validatePrompt: _validatePrompt, validateContestantResponse: _validateContestantResponse } = require("../lib/validation");
const { validatePageToken, getLeaderboardItems, categorizeError } = require("../lib/fireHelpers");

// Cache prompt JSON files at module load time — they only change on deploy
const _PACK_PROMPTS = (function() {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "lib", "prompts", "pack-prompts.json"), "utf8");
  } catch (e) {
    console.warn("[fire] pack-prompts.json cache failed:", e.message);
    return null;
  }
})();

const _MODE_PROMPTS = (function() {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "lib", "prompts", "mode-prompts.json"), "utf8");
  } catch (e) {
    console.warn("[fire] mode-prompts.json cache failed:", e.message);
    return null;
  }
})();

function createFireRouter(deps) {
  const router = express.Router();

  // Config / constants with deps override
  const CONTESTANT_PROVIDER = deps.CONTESTANT_PROVIDER !== undefined ? deps.CONTESTANT_PROVIDER : _CONTESTANT_PROVIDER;
  const MODEL_MAP = deps.MODEL_MAP !== undefined ? deps.MODEL_MAP : _MODEL_MAP;
  const ACTIVE_MODEL_IDS = deps.ACTIVE_MODEL_IDS !== undefined ? deps.ACTIVE_MODEL_IDS : _ACTIVE_MODEL_IDS;

  // Services
  const callContestant = deps.callContestant || providerServices.callContestant;
  const validatePrompt = deps.validatePrompt || _validatePrompt;
  const validateContestantResponse = deps.validateContestantResponse || _validateContestantResponse;
  const getVoice = deps.getVoice || modelServices.getVoice;

  // Limiters & middleware
  const fireLimiter = deps.fireLimiter;
  const authMw = deps.authMiddleware;
  const requireKnownOrigin = deps.requireKnownOrigin;

  const dailyTryIncrement = deps.dailyTryIncrement || function() { return { allowed: true }; };

  router.get("/api/history", deps.publicLimiter, function(req, res) {
    res.json({
      items: getLeaderboardItems({
        listTopAnalysisRunsByScore: deps.listTopAnalysisRunsByScore,
        readHistory: deps.readHistory || require("../lib/history").readHistory,
      }),
    });
  });

  router.get("/api/pack-prompts", deps.publicLimiter, function(req, res) {
    if (!_PACK_PROMPTS) {
      return res.status(500).json({ error: "Prompt data unavailable." });
    }
    res.setHeader("Content-Type", "application/json");
    res.send(_PACK_PROMPTS);
  });

  router.get("/api/mode-prompts", deps.publicLimiter, function(req, res) {
    if (!_MODE_PROMPTS) {
      return res.status(500).json({ error: "Prompt data unavailable." });
    }
    res.setHeader("Content-Type", "application/json");
    res.send(_MODE_PROMPTS);
  });

  router.post("/api/fire", fireLimiter, requireKnownOrigin, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    const inc = (deps.dailyTryIncrement || dailyTryIncrement)("fire");
    if (!inc.allowed) {
      return res.status(503).json({ error: "Daily request limit reached. Try again tomorrow." });
    }

    const prompt = req.body.prompt;
    const modelId = req.body.modelId;
    const packId = req.body.pack || "bar";

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    if (!ACTIVE_MODEL_IDS.includes(modelId)) {
      return res.status(400).json({ error: "Invalid model ID." });
    }

    if (!getHealthyModelIds([modelId]).length) {
      return res.status(503).json({ error: "Model temporarily unavailable due to repeated failures.", modelId: modelId });
    }

    try {
      const response = await callContestant(modelId, getVoice(modelId, packId), prompt, req.requestId);
      var checked = validateContestantResponse(response);
      if (!checked.ok) {
        console.error("[fire] " + modelId + " via " + CONTESTANT_PROVIDER + ": invalid response — " + checked.reason);
        res.status(500).json({ error: "Model returned invalid response: " + checked.reason, modelId: modelId });
        return;
      }
      res.json({
        modelId: modelId,
        model: MODEL_MAP[modelId],
        response: response || "...nothing. Which is a response in itself.",
      });
    } catch (e) {
      console.error("[fire] " + modelId + " via " + CONTESTANT_PROVIDER + ":", e.message);
      const category = categorizeError(e.message, e.upstreamStatus, "fire");
      const safe = {
        timeout: "Model timed out.",
        rate_limit: "Model rate limited — try again shortly.",
        upstream_5xx: "Model provider error.",
        network: "Could not reach the model.",
      }[category] || "Model failed.";
      res.status(500).json({ error: safe, modelId: modelId });
    }
  });

  // Blind taste test mapping — generated server-side, tamper-proof
  router.get("/api/blind-mapping", deps.publicLimiter, function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }
    try {
      const shuffled = ACTIVE_MODEL_IDS.slice();
      for (var i = shuffled.length - 1; i > 0; i--) {
        var j = crypto.randomInt(0, i + 1);
        var tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
      const mapping = {};
      shuffled.forEach(function(id, i) {
        mapping[String.fromCharCode(65 + i)] = id; // A, B, C, ...
      });
      res.json({ mapping: mapping });
    } catch (e) {
      res.status(500).json({ error: "Failed to generate blind mapping." });
    }
  });

  return router;
}

module.exports = { createFireRouter };
