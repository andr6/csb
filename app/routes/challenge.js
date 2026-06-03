const express = require("express");
const { buildFailureRun, categorizeError } = require("../lib/fireHelpers");

function createChallengeRouter(deps) {
  const router = express.Router();

  const authMw = deps.authMiddleware;
  const requireAdminAccess = deps.requireAdminAccess;

  const {
    CONTESTANT_PROVIDER: _CONTESTANT_PROVIDER,
    JUDGE_PROVIDER: _JUDGE_PROVIDER,
    JUDGE_MODEL: _JUDGE_MODEL,
    ACTIVE_MODEL_IDS: _ACTIVE_MODEL_IDS,
    DAILY_CHALLENGE_PROMPT: _DAILY_CHALLENGE_PROMPT,
  } = require("../lib/config");

  const modelServices = require("../lib/models");
  const providerServices = require("../lib/providers");
  const judgeServices = require("../lib/judge");
  const { getPack: _getPack } = require("../lib/packs");
  const { validatePrompt: _validatePrompt } = require("../lib/validation");
  const analysisRunServices = require("../lib/analysisRuns");
  const { notifyWebhook: _notifyWebhook } = require("../lib/webhook");

  const CONTESTANT_PROVIDER = deps.CONTESTANT_PROVIDER !== undefined ? deps.CONTESTANT_PROVIDER : _CONTESTANT_PROVIDER;
  const JUDGE_PROVIDER = deps.JUDGE_PROVIDER !== undefined ? deps.JUDGE_PROVIDER : _JUDGE_PROVIDER;
  const JUDGE_MODEL = deps.JUDGE_MODEL !== undefined ? deps.JUDGE_MODEL : _JUDGE_MODEL;
  const ACTIVE_MODEL_IDS = deps.ACTIVE_MODEL_IDS !== undefined ? deps.ACTIVE_MODEL_IDS : _ACTIVE_MODEL_IDS;
  const DAILY_CHALLENGE_PROMPT = deps.DAILY_CHALLENGE_PROMPT !== undefined ? deps.DAILY_CHALLENGE_PROMPT : _DAILY_CHALLENGE_PROMPT;
  const getPack = deps.getPack || _getPack;

  const callContestant = deps.callContestant || providerServices.callContestant;
  const callJudge = deps.callJudge || providerServices.callJudge;
  const buildJudgePrompt = deps.buildJudgePrompt || judgeServices.buildJudgePrompt;
  const parseJudgeResponse = deps.parseJudgeResponse || judgeServices.parseJudgeResponse;
  const normalizeJudgePayload = deps.normalizeJudgePayload || judgeServices.normalizeJudgePayload;
  const getVoice = deps.getVoice || modelServices.getVoice;
  const validatePrompt = deps.validatePrompt || _validatePrompt;
  const addAnalysisRun = deps.addAnalysisRun || analysisRunServices.addAnalysisRun;
  const notifyWebhookFn = deps.notifyWebhook || _notifyWebhook;

  function invalidateAnalyticsCaches() {
    if (deps.invalidateAnalyticsCaches) {
      return deps.invalidateAnalyticsCaches();
    }
  }

  const providerInfo = {
    contestantProvider: CONTESTANT_PROVIDER,
    judgeProvider: JUDGE_PROVIDER,
    judgeModel: JUDGE_MODEL,
  };

  router.post("/api/challenge", authMw.requireAuth, requireAdminAccess, async function(req, res) {
    const prompt = DAILY_CHALLENGE_PROMPT || (req.body && req.body.prompt) || "";
    if (!prompt) return res.status(400).json({ error: "No challenge prompt. Set DAILY_CHALLENGE_PROMPT in .env or pass prompt in body." });
    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    // Cron skip-if-already-run: if trigger=cron and a challenge already ran today, skip
    const isCron = String(req.query.trigger || "").toLowerCase() === "cron";
    if (isCron) {
      try {
        const { queryJsonParams } = require("../lib/sqlite");
        const today = new Date().toISOString().slice(0, 10);
        const rows = queryJsonParams(
          "SELECT 1 FROM analysis_runs WHERE is_challenge = 1 AND created_at >= ? AND created_at < ? LIMIT 1;",
          [today + "T00:00:00.000Z", today + "T23:59:59.999Z"]
        );
        if (rows.length) {
          return res.json({ skipped: true, reason: "Daily challenge already ran today." });
        }
      } catch (e) {
        // If SQLite is unavailable, proceed anyway
      }
    }

    res.json({ started: true, prompt: prompt, models: ACTIVE_MODEL_IDS });

    setImmediate(async function() {
      const startedAt = Date.now();
      const execModels = {};
      const allResponses = {};
      try {
        await Promise.all(ACTIVE_MODEL_IDS.map(async function(modelId) {
          const t = Date.now();
          try {
            const resp = await callContestant(modelId, getVoice(modelId), prompt, req.requestId);
            allResponses[modelId] = resp || "";
            execModels[modelId] = { status: "success", durationMs: Date.now() - t };
          } catch (e) {
            allResponses[modelId] = "[Error: " + e.message + "]";
            execModels[modelId] = { status: "error", error: e.message, errorCategory: categorizeError(e.message, e.upstreamStatus, "contestant"), durationMs: Date.now() - t };
          }
        }));
        const judgeStart = Date.now();
        const raw = await callJudge(getPack("bar").judgeSystemPrompt, buildJudgePrompt(prompt, allResponses), req.requestId);
        const judgeMs = Date.now() - judgeStart;
        const payload = normalizeJudgePayload(parseJudgeResponse(raw), Object.keys(allResponses));
        const successCount = ACTIVE_MODEL_IDS.filter(function(id) { return execModels[id] && execModels[id].status === "success"; }).length;
        const overallStatus = successCount === ACTIVE_MODEL_IDS.length ? "success" : successCount > 0 ? "partial_failure" : "failure";
        addAnalysisRun({
          prompt: prompt,
          responses: allResponses,
          judgement: payload,
          crownModelId: payload.crown,
          crownScore: payload.scores && payload.scores[payload.crown] !== undefined ? payload.scores[payload.crown] : 0,
          contestantProvider: CONTESTANT_PROVIDER,
          judgeProvider: JUDGE_PROVIDER,
          judgeModel: JUDGE_MODEL,
          timings: { judgeMs: judgeMs, totalMs: Date.now() - startedAt },
          execution: { summary: { overallStatus: overallStatus }, models: execModels, judge: { status: "success" }, isChallenge: true },
        });
        invalidateAnalyticsCaches();
        notifyWebhookFn({ type: "challenge_complete", crown: payload.crown, score: payload.scores[payload.crown], prompt: prompt });
      } catch (e) {
        console.error("[challenge] failed:", e.message);
        addAnalysisRun(buildFailureRun(prompt, allResponses, { timings: { totalMs: Date.now() - startedAt }, execution: { models: execModels } }, "judge_call", e));
      }
    });
  });

  return router;
}

module.exports = { createChallengeRouter };
