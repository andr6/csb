const express = require("express");
const { validatePageToken, buildFailureRun } = require("../lib/fireHelpers");
const { validateJudgeInput } = require("../lib/validation");

function createJudgeRouter(deps) {
  const router = express.Router();

  const authMw = deps.authMiddleware;
  const requireKnownOrigin = deps.requireKnownOrigin;
  const judgeLimiter = deps.judgeLimiter;

  const {
    JUDGE_PROVIDER: _JUDGE_PROVIDER,
    JUDGE_MODEL: _JUDGE_MODEL,
    JUDGE_PANEL: _JUDGE_PANEL,
    JUDGE_RUNS: _JUDGE_RUNS,
    WEBHOOK_URL: _WEBHOOK_URL,
  } = require("../lib/config");

  const judgeServices = require("../lib/judge");
  const providerServices = require("../lib/providers");
  const { getPack: _getPack } = require("../lib/packs");
  const { validatePrompt: _validatePrompt } = require("../lib/validation");
  const analysisRunServices = require("../lib/analysisRuns");
  const { notifyWebhook: _notifyWebhook } = require("../lib/webhook");

  const JUDGE_PROVIDER = deps.JUDGE_PROVIDER !== undefined ? deps.JUDGE_PROVIDER : _JUDGE_PROVIDER;
  const JUDGE_MODEL = deps.JUDGE_MODEL !== undefined ? deps.JUDGE_MODEL : _JUDGE_MODEL;
  const JUDGE_PANEL = deps.JUDGE_PANEL !== undefined ? deps.JUDGE_PANEL : (_JUDGE_PANEL && _JUDGE_PANEL.length ? _JUDGE_PANEL : [JUDGE_MODEL]);
  const JUDGE_RUNS = deps.JUDGE_RUNS !== undefined ? deps.JUDGE_RUNS : _JUDGE_RUNS;
  const WEBHOOK_URL = deps.WEBHOOK_URL !== undefined ? deps.WEBHOOK_URL : _WEBHOOK_URL;
  const getPack = deps.getPack || _getPack;
  const VALID_CRITERIA_KEYS = deps.VALID_CRITERIA_KEYS !== undefined ? deps.VALID_CRITERIA_KEYS : judgeServices.VALID_CRITERIA_KEYS;

  const callJudge = deps.callJudge || providerServices.callJudge;
  const buildJudgePrompt = deps.buildJudgePrompt || judgeServices.buildJudgePrompt;
  const computeMedianScores = deps.computeMedianScores || judgeServices.computeMedianScores;
  const computeConsensus = deps.computeConsensus || judgeServices.computeConsensus;
  const parseJudgeResponse = deps.parseJudgeResponse || judgeServices.parseJudgeResponse;
  const normalizeJudgePayload = deps.normalizeJudgePayload || judgeServices.normalizeJudgePayload;
  const validatePrompt = deps.validatePrompt || _validatePrompt;
  const addAnalysisRun = deps.addAnalysisRun || analysisRunServices.addAnalysisRun;
  const listTopAnalysisRunsByScore = deps.listTopAnalysisRunsByScore || analysisRunServices.listTopAnalysisRunsByScore;
  const notifyWebhookFn = deps.notifyWebhook || _notifyWebhook;

  const dailyTryIncrement = deps.dailyTryIncrement || function() { return { allowed: true }; };
  const judgeRunsOverride = deps.judgeRuns;

  function invalidateAnalyticsCaches() {
    if (deps.invalidateAnalyticsCaches) {
      return deps.invalidateAnalyticsCaches();
    }
  }

  const providerInfo = {
    contestantProvider: deps.CONTESTANT_PROVIDER !== undefined ? deps.CONTESTANT_PROVIDER : require("../lib/config").CONTESTANT_PROVIDER,
    judgeProvider: JUDGE_PROVIDER,
    judgeModel: JUDGE_MODEL,
  };

  router.post("/api/judge", judgeLimiter, requireKnownOrigin, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    const inc = (deps.dailyTryIncrement || dailyTryIncrement)("judge");
    if (!inc.allowed) {
      return res.status(503).json({ error: "Daily request limit reached. Try again tomorrow." });
    }

    const prompt = req.body.prompt;
    const responses = req.body.responses;
    const meta = req.body.meta && typeof req.body.meta === "object" ? req.body.meta : {};
    const rawCriteria = req.body.criteria;
    const criteria = Array.isArray(rawCriteria)
      ? rawCriteria.filter(function(k) { return VALID_CRITERIA_KEYS.indexOf(k) !== -1; })
      : null;
    const activePackId = req.body.pack || "bar";
    const activeMode = req.body.mode || "absurd";
    const activePack = getPack(activePackId);
    const activeJudgePrompt = deps.judgeSystemPrompt || activePack.judgeSystemPrompt;

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    if (!responses || typeof responses !== "object") {
      return res.status(400).json({ error: "Responses object required." });
    }

    // Strip error responses — models that failed shouldn't be judged
    const cleanResponses = Object.fromEntries(
      Object.entries(responses).filter(function(entry) {
        var v = entry[1];
        return typeof v === "string" && v.trim().length > 0 && !v.startsWith("[Error:");
      })
    );
    if (Object.keys(cleanResponses).length === 0) {
      return res.status(400).json({ error: "No successful model responses to judge." });
    }

    const sizeCheck = validateJudgeInput(cleanResponses);
    if (!sizeCheck.ok) {
      return res.status(400).json({ error: sizeCheck.reason });
    }

    const judgeRuns = judgeRunsOverride !== undefined ? Number(judgeRunsOverride) : JUDGE_RUNS;

    try {
      const modeCriteria = criteria && criteria.length ? criteria : (deps.getCriteriaForMode || judgeServices.getCriteriaForMode)(activeMode);
      const judgePrompt = buildJudgePrompt(prompt, cleanResponses, modeCriteria);
      const rawResults = await Promise.all(
        Array.from({ length: judgeRuns }, function() {
          return callJudge(activeJudgePrompt, judgePrompt, req.requestId);
        })
      );

      const responseKeys = Object.keys(cleanResponses);
      const parsedResults = rawResults.map(function(raw) {
        return normalizeJudgePayload(parseJudgeResponse(raw), responseKeys);
      });
      const raw = rawResults[0];

      try {
        const payload = judgeRuns > 1 ? computeMedianScores(parsedResults, responseKeys) : parsedResults[0];
        const willNotify = deps.notifyWebhook !== undefined || !!WEBHOOK_URL;
        const prevTopRun = willNotify ? (deps.listTopAnalysisRunsByScore || listTopAnalysisRunsByScore)(1)[0] : null;
        const prevCrownModelId = prevTopRun ? prevTopRun.crownModelId : null;
        const savedRun = addAnalysisRun({
          prompt: prompt,
          responses: responses,
          judgement: payload,
          crownModelId: payload.crown,
          crownScore: payload.scores && payload.scores[payload.crown] !== undefined ? payload.scores[payload.crown] : 0,
          contestantProvider: providerInfo.contestantProvider,
          judgeProvider: providerInfo.judgeProvider,
          judgeModel: providerInfo.judgeModel,
          timings: meta.timings,
          pack: activePackId,
          mode: activeMode,
          execution: (function() {
            var ext = Object.assign({}, meta.execution || {});
            if (criteria && criteria.length) ext.criteria = criteria;
            if (judgeRuns > 1) ext.judgeRuns = judgeRuns;
            if (payload.judgeConfidence) ext.judgeConfidence = payload.judgeConfidence;
            if (meta.blindMapping) ext.blindMapping = meta.blindMapping;
            return ext;
          }()),
        });
        invalidateAnalyticsCaches();
        if (willNotify) {
          const newTopRun = (deps.listTopAnalysisRunsByScore || listTopAnalysisRunsByScore)(1)[0];
          const newCrownModelId = newTopRun ? newTopRun.crownModelId : null;
          if (newCrownModelId && newCrownModelId !== prevCrownModelId) {
            notifyWebhookFn({ type: "crown_change", newCrown: newCrownModelId, prevCrown: prevCrownModelId, prompt: prompt, score: newTopRun.crownScore });
          }
        }
        if (meta.blindMapping) payload.blindMapping = meta.blindMapping;
        payload.runId = savedRun.id;
        res.json(payload);
      } catch (e) {
        const savedRun = addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_parse", e, raw, activePackId, activeMode, providerInfo));
        console.error("[judge] JSON parse failed. Raw:", String(raw || "").slice(0, 300));
        return res.status(500).json({ error: "Judge returned invalid JSON.", runId: savedRun.id });
      }
    } catch (e) {
      const savedRun = addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_call", e, null, activePackId, activeMode, providerInfo));
      console.error("[judge] via " + JUDGE_PROVIDER + " (" + JUDGE_MODEL + "):", e.message);
      res.status(500).json({ error: "Judge failed.", runId: savedRun.id });
    }
  });

  // ── Multi-judge consensus ───────────────────────────────────────────────────
  // Runs the same prompt+responses through multiple judge models (configured via
  // JUDGE_PANEL) and returns a consensus score with inter-rater reliability.
  router.post("/api/judge/consensus", judgeLimiter, requireKnownOrigin, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    const inc = (deps.dailyTryIncrement || dailyTryIncrement)("judge");
    if (!inc.allowed) {
      return res.status(503).json({ error: "Daily request limit reached. Try again tomorrow." });
    }

    const prompt = req.body.prompt;
    const responses = req.body.responses;
    const meta = req.body.meta && typeof req.body.meta === "object" ? req.body.meta : {};
    const rawCriteria = req.body.criteria;
    const criteria = Array.isArray(rawCriteria)
      ? rawCriteria.filter(function(k) { return VALID_CRITERIA_KEYS.indexOf(k) !== -1; })
      : null;
    const activePackId = req.body.pack || "bar";
    const activeMode = req.body.mode || "absurd";
    const activePack = getPack(activePackId);
    const activeJudgePrompt = deps.judgeSystemPrompt || activePack.judgeSystemPrompt;

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    if (!responses || typeof responses !== "object") {
      return res.status(400).json({ error: "Responses object required." });
    }

    const cleanResponses = Object.fromEntries(
      Object.entries(responses).filter(function(entry) {
        var v = entry[1];
        return typeof v === "string" && v.trim().length > 0 && !v.startsWith("[Error:");
      })
    );
    if (Object.keys(cleanResponses).length === 0) {
      return res.status(400).json({ error: "No successful model responses to judge." });
    }

    const sizeCheck = validateJudgeInput(cleanResponses);
    if (!sizeCheck.ok) {
      return res.status(400).json({ error: sizeCheck.reason });
    }

    const panel = JUDGE_PANEL;
    if (panel.length < 2) {
      return res.status(400).json({ error: "JUDGE_PANEL must contain at least 2 models for consensus. Set JUDGE_PANEL in .env." });
    }

    try {
      const modeCriteria = criteria && criteria.length ? criteria : (deps.getCriteriaForMode || judgeServices.getCriteriaForMode)(activeMode);
      const judgePrompt = buildJudgePrompt(prompt, cleanResponses, modeCriteria);

      // Fire all judges in parallel
      const panelResults = await Promise.all(
        panel.map(function(judgeModel) {
          return callJudge(activeJudgePrompt, judgePrompt, req.requestId, judgeModel).catch(function(e) {
            return { _judgeError: e.message, _judgeModel: judgeModel };
          });
        })
      );

      const responseKeys = Object.keys(cleanResponses);
      const parsedJudges = [];
      const failedJudges = [];

      panelResults.forEach(function(result, idx) {
        if (result && result._judgeError) {
          failedJudges.push({ model: panel[idx], error: result._judgeError });
          return;
        }
        try {
          var parsed = normalizeJudgePayload(parseJudgeResponse(result), responseKeys);
          parsed.judgeModel = panel[idx];
          parsedJudges.push(parsed);
        } catch (e) {
          failedJudges.push({ model: panel[idx], error: e.message });
        }
      });

      if (parsedJudges.length === 0) {
        throw new Error("All judges failed: " + failedJudges.map(function(f) { return f.model + " (" + f.error + ")"; }).join(", "));
      }

      const consensus = computeConsensus(parsedJudges, responseKeys);
      consensus.failedJudges = failedJudges;
      consensus.judgeModels = panel;

      const savedRun = addAnalysisRun({
        prompt: prompt,
        responses: responses,
        judgement: consensus,
        crownModelId: consensus.crown,
        crownScore: consensus.scores && consensus.scores[consensus.crown] !== undefined ? consensus.scores[consensus.crown] : 0,
        contestantProvider: providerInfo.contestantProvider,
        judgeProvider: "panel",
        judgeModel: panel.join(","),
        timings: meta.timings,
        pack: activePackId,
        mode: activeMode + ".consensus",
        execution: Object.assign({}, meta.execution || {}, {
          judgePanel: panel,
          parsedJudgesCount: parsedJudges.length,
          failedJudgesCount: failedJudges.length,
        }),
      });
      invalidateAnalyticsCaches();
      consensus.runId = savedRun.id;
      res.json(consensus);
    } catch (e) {
      const savedRun = addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_call", e, null, activePackId, activeMode + ".consensus", providerInfo));
      console.error("[judge/consensus] panel failed:", e.message);
      res.status(500).json({ error: "Consensus judge failed.", runId: savedRun.id });
    }
  });

  return router;
}

module.exports = { createJudgeRouter };
