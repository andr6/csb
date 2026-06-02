const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const {
  CONTESTANT_PROVIDER: _CONTESTANT_PROVIDER,
  JUDGE_PROVIDER: _JUDGE_PROVIDER,
  JUDGE_MODEL: _JUDGE_MODEL,
  MODEL_MAP: _MODEL_MAP,
  ACTIVE_MODEL_IDS: _ACTIVE_MODEL_IDS,
  JUDGE_RUNS: _JUDGE_RUNS,
  WEBHOOK_URL: _WEBHOOK_URL,
  DAILY_CHALLENGE_PROMPT: _DAILY_CHALLENGE_PROMPT,
} = require("../lib/config");

const modelServices = require("../lib/models");
const providerServices = require("../lib/providers");
const judgeServices = require("../lib/judge");
const { PACKS: _PACKS, getPack: _getPack } = require("../lib/packs");
const { validatePrompt: _validatePrompt } = require("../lib/validation");
const historyServices = require("../lib/history");
const analysisRunServices = require("../lib/analysisRuns");
const { notifyWebhook: _notifyWebhook } = require("../lib/webhook");

function createFireRouter(deps) {
  const router = express.Router();

  // Config / constants with deps override
  const CONTESTANT_PROVIDER = deps.CONTESTANT_PROVIDER !== undefined ? deps.CONTESTANT_PROVIDER : _CONTESTANT_PROVIDER;
  const JUDGE_PROVIDER = deps.JUDGE_PROVIDER !== undefined ? deps.JUDGE_PROVIDER : _JUDGE_PROVIDER;
  const JUDGE_MODEL = deps.JUDGE_MODEL !== undefined ? deps.JUDGE_MODEL : _JUDGE_MODEL;
  const MODEL_MAP = deps.MODEL_MAP !== undefined ? deps.MODEL_MAP : _MODEL_MAP;
  const ACTIVE_MODEL_IDS = deps.ACTIVE_MODEL_IDS !== undefined ? deps.ACTIVE_MODEL_IDS : _ACTIVE_MODEL_IDS;
  const JUDGE_RUNS = deps.JUDGE_RUNS !== undefined ? deps.JUDGE_RUNS : _JUDGE_RUNS;
  const WEBHOOK_URL = deps.WEBHOOK_URL !== undefined ? deps.WEBHOOK_URL : _WEBHOOK_URL;
  const DAILY_CHALLENGE_PROMPT = deps.DAILY_CHALLENGE_PROMPT !== undefined ? deps.DAILY_CHALLENGE_PROMPT : _DAILY_CHALLENGE_PROMPT;
  const PACKS = deps.PACKS !== undefined ? deps.PACKS : _PACKS;
  const getPack = deps.getPack || _getPack;
  const VALID_CRITERIA_KEYS = deps.VALID_CRITERIA_KEYS !== undefined ? deps.VALID_CRITERIA_KEYS : judgeServices.VALID_CRITERIA_KEYS;

  // Services
  const callContestant = deps.callContestant || providerServices.callContestant;
  const callJudge = deps.callJudge || providerServices.callJudge;
  const buildJudgePrompt = deps.buildJudgePrompt || judgeServices.buildJudgePrompt;
  const computeMedianScores = deps.computeMedianScores || judgeServices.computeMedianScores;
  const parseJudgeResponse = deps.parseJudgeResponse || judgeServices.parseJudgeResponse;
  const normalizeJudgePayload = deps.normalizeJudgePayload || judgeServices.normalizeJudgePayload;
  const validatePrompt = deps.validatePrompt || _validatePrompt;
  const getVoice = deps.getVoice || modelServices.getVoice;
  const readHistory = deps.readHistory || historyServices.readHistory;
  const listTopAnalysisRunsByScore = deps.listTopAnalysisRunsByScore || analysisRunServices.listTopAnalysisRunsByScore;
  const addAnalysisRun = deps.addAnalysisRun || analysisRunServices.addAnalysisRun;
  const getAnalysisRun = deps.getAnalysisRun || analysisRunServices.getAnalysisRun;
  const listAnalysisRuns = deps.listAnalysisRuns || analysisRunServices.listAnalysisRuns;
  const countAnalysisRuns = deps.countAnalysisRuns || analysisRunServices.countAnalysisRuns;
  const getHistoryStats = deps.getHistoryStats || historyServices.getHistoryStats;
  const notifyWebhookFn = deps.notifyWebhook || _notifyWebhook;

  // Limiters & middleware
  const fireLimiter = deps.fireLimiter;
  const judgeLimiter = deps.judgeLimiter;
  const publicLimiter = deps.publicLimiter;
  const authMw = deps.authMiddleware;
  const requireAdminAccess = deps.requireAdminAccess;
  const requireKnownOrigin = deps.requireKnownOrigin;

  const judgeRunsOverride = deps.judgeRuns;

  // Local helpers from original app.js
  const PAGE_TOKEN_TTL_S = 86400;

  function validatePageToken(token) {
    if (!token || typeof token !== "string") return false;
    const dot = token.indexOf(".");
    if (dot === -1) return false;
    const ts = Number(token.slice(0, dot));
    if (!ts || isNaN(ts)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now - ts > PAGE_TOKEN_TTL_S) return false;
    if (ts > now + 60) return false;
    const expected = crypto.createHmac("sha256", process.env.PAGE_TOKEN_SECRET || "").update(String(ts)).digest("hex");
    const eBuf = Buffer.from(expected, "hex");
    const aBuf = Buffer.from(token.slice(dot + 1), "hex");
    return eBuf.length === aBuf.length && crypto.timingSafeEqual(eBuf, aBuf);
  }

  function requirePageToken(req, res, next) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }
    next();
  }

  function isDisplayableLeaderboardAnswer(answer) {
    var text = String(answer || "").trim();
    if (!text) return false;
    if (/^\[error:/i.test(text)) return false;
    if (/failed:/i.test(text)) return false;
    if (/timed out/i.test(text)) return false;
    return true;
  }

  function getLeaderboardItems() {
    const topRuns = (deps.listTopAnalysisRunsByScore || listTopAnalysisRunsByScore)(20)
      .filter(function(run) {
        var answer = run.responses && run.crownModelId ? run.responses[run.crownModelId] : "";
        return run.crownModelId && run.prompt && isDisplayableLeaderboardAnswer(answer);
      })
      .map(function(run) {
        return {
          modelId: String(run.crownModelId || ""),
          prompt: String(run.prompt || ""),
          score: Number(run.crownScore || 0),
          createdAt: run.createdAt || "",
          answer: String((run.responses && run.responses[run.crownModelId]) || ""),
        };
      });

    if (topRuns.length) {
      return topRuns.slice(0, 10);
    }

    const rawHistoryItems = readHistory(20);
    return Array.isArray(rawHistoryItems)
      ? rawHistoryItems.filter(function(item) {
          return item && item.modelId;
        }).slice(0, 10)
      : [];
  }

  function categorizeError(message, upstreamStatus, phase) {
    const text = String(message || "").toLowerCase();
    const status = Number(upstreamStatus || 0);
    if (phase === "judge_parse") return "judge_parse";
    if (status === 408 || /timeout|timed out|abort/.test(text)) return "timeout";
    if (status === 429 || /rate limit|too many requests/.test(text)) return "rate_limit";
    if (status >= 500 || /server error|upstream failed|bad gateway|gateway|overloaded/.test(text)) return "upstream_5xx";
    if (status >= 400 || /invalid|bad request|unauthorized|forbidden|not found/.test(text)) return "upstream_4xx";
    if (/network|fetch failed|econn|enotfound|socket|etimedout|econnreset|econnrefused/.test(text)) return "network";
    return "unknown";
  }

  function buildRunFilters(query) {
    const normalizeFilterOptions = (deps.normalizeFilterOptions || require("../lib/filterOptions").normalizeFilterOptions);
    return normalizeFilterOptions({
      limit: query.limit,
      offset: query.offset,
      query: query.query,
      crownModelId: query.crownModelId,
      status: query.status,
      contestantProvider: query.contestantProvider,
      judgeProvider: query.judgeProvider,
      failedModelId: query.failedModelId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      phase: query.phase,
      isChallenge: query.isChallenge,
    });
  }

  function buildFailureRun(prompt, responses, meta, phase, error, rawJudge, pack, mode) {
    const errorMessage = String(error && error.message ? error.message : error || "Unknown error");
    return {
      prompt: prompt,
      responses: responses,
      judgement: {
        error: errorMessage,
        phase: phase,
        rawJudge: rawJudge ? String(rawJudge).slice(0, 500) : "",
      },
      crownModelId: "",
      crownScore: 0,
      contestantProvider: CONTESTANT_PROVIDER,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      timings: meta.timings,
      pack: pack || "bar",
      mode: mode || "absurd",
      execution: {
        summary: {
          overallStatus: "failure",
          phase: phase,
        },
        models: meta.execution && meta.execution.models ? meta.execution.models : {},
        judge: {
          status: "error",
          error: errorMessage,
          errorCategory: categorizeError(errorMessage, error && error.upstreamStatus, phase),
          upstreamStatus: error && error.upstreamStatus ? error.upstreamStatus : 0,
        },
        policy: meta.execution && meta.execution.policy ? meta.execution.policy : { retry: "none", fallback: "none" },
      },
    };
  }

  function escapeCsvCell(value) {
    const text = String(value == null ? "" : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function toRunsCsv(items) {
    const header = [
      "id",
      "createdAt",
      "status",
      "phase",
      "prompt",
      "crownModelId",
      "crownScore",
      "contestantProvider",
      "judgeProvider",
      "judgeModel",
      "judgeError",
    ];
    const rows = items.map(function(item) {
      const execution = item.execution && typeof item.execution === "object" ? item.execution : {};
      const summary = execution.summary && typeof execution.summary === "object" ? execution.summary : {};
      const judge = execution.judge && typeof execution.judge === "object" ? execution.judge : {};
      return [
        item.id,
        item.createdAt,
        summary.overallStatus || "",
        summary.phase || (item.judgement && item.judgement.phase) || "",
        item.prompt,
        item.crownModelId,
        item.crownScore,
        item.contestantProvider,
        item.judgeProvider,
        item.judgeModel,
        judge.error || (item.judgement && item.judgement.error) || "",
      ].map(escapeCsvCell).join(",");
    });
    return [header.join(","), rows.join("\n")].filter(Boolean).join("\n") + "\n";
  }

  function invalidateAnalyticsCaches() {
    if (deps.invalidateAnalyticsCaches) {
      return deps.invalidateAnalyticsCaches();
    }
  }

  const dailyLimitExceeded = deps.dailyLimitExceeded || function() { return false; };
  const dailyIncrement = deps.dailyIncrement || function() {};

  // ═══════════════════════════════════════════════════════════════════════════════
  //  Routes
  // ═══════════════════════════════════════════════════════════════════════════════

  router.get("/api/history", publicLimiter, authMw.requireAuth, function(req, res) {
    res.json({
      items: getLeaderboardItems(),
    });
  });

  router.get("/api/pack-prompts", publicLimiter, authMw.requireAuth, requirePageToken, function(req, res) {
    const filePath = path.join(__dirname, "..", "lib", "prompts", "pack-prompts.json");
    try {
      const data = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    } catch (e) {
      res.status(500).json({ error: "Prompt data unavailable." });
    }
  });

  router.get("/api/mode-prompts", publicLimiter, authMw.requireAuth, requirePageToken, function(req, res) {
    const filePath = path.join(__dirname, "..", "lib", "prompts", "mode-prompts.json");
    try {
      const data = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    } catch (e) {
      res.status(500).json({ error: "Prompt data unavailable." });
    }
  });

  router.get("/api/runs", authMw.requireAuth, requireAdminAccess, function(req, res) {
    const filters = buildRunFilters(req.query);
    res.json({
      items: listAnalysisRuns(filters),
      total: countAnalysisRuns(filters),
    });
  });

  router.get("/api/runs/export", authMw.requireAuth, requireAdminAccess, function(req, res) {
    const filters = buildRunFilters(req.query);
    const format = String(req.query.format || "json").toLowerCase();
    const items = listAnalysisRuns({
      ...filters,
      limit: Math.min(500, Number(req.query.limit || 100)),
      offset: req.query.offset || 0,
    });
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"csb-runs-export.csv\"");
      return res.send(toRunsCsv(items));
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"csb-runs-export.json\"");
    res.send(JSON.stringify({ items: items, total: items.length, exportedAt: new Date().toISOString() }, null, 2));
  });

  router.get("/api/runs/:id", authMw.requireAuth, requireAdminAccess, function(req, res) {
    const item = getAnalysisRun(req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Run not found." });
    }
    res.json(item);
  });

  router.post("/api/fire", fireLimiter, authMw.requireAuth, requireKnownOrigin, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    if ((deps.dailyLimitExceeded || dailyLimitExceeded)("fire")) {
      return res.status(503).json({ error: "Daily request limit reached. Try again tomorrow." });
    }

    const prompt = req.body.prompt;
    const modelId = req.body.modelId;
    const packId = req.body.pack || "bar";

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    console.log("[DEBUG] modelId:", modelId, "ACTIVE_MODEL_IDS:", ACTIVE_MODEL_IDS);
    if (!ACTIVE_MODEL_IDS.includes(modelId)) {
      return res.status(400).json({ error: "Invalid model ID." });
    }

    try {
      (deps.dailyIncrement || dailyIncrement)("fire");
      const response = await callContestant(modelId, getVoice(modelId, packId), prompt, req.requestId);
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

  router.post("/api/judge", judgeLimiter, authMw.requireAuth, requireKnownOrigin, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    if ((deps.dailyLimitExceeded || dailyLimitExceeded)("judge")) {
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

    const judgeRuns = judgeRunsOverride !== undefined ? Number(judgeRunsOverride) : JUDGE_RUNS;

    try {
      const judgePrompt = buildJudgePrompt(prompt, cleanResponses, criteria || undefined);
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
        addAnalysisRun({
          prompt: prompt,
          responses: responses,
          judgement: payload,
          crownModelId: payload.crown,
          crownScore: payload.scores && payload.scores[payload.crown] !== undefined ? payload.scores[payload.crown] : 0,
          contestantProvider: CONTESTANT_PROVIDER,
          judgeProvider: JUDGE_PROVIDER,
          judgeModel: JUDGE_MODEL,
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
        (deps.dailyIncrement || dailyIncrement)("judge");
        if (meta.blindMapping) payload.blindMapping = meta.blindMapping;
        res.json(payload);
      } catch (e) {
        addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_parse", e, raw, activePackId, activeMode));
        console.error("[judge] JSON parse failed. Raw:", String(raw || "").slice(0, 300));
        return res.status(500).json({ error: "Judge returned invalid JSON." });
      }
    } catch (e) {
      addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_call", e, null, activePackId, activeMode));
      console.error("[judge] via " + JUDGE_PROVIDER + " (" + JUDGE_MODEL + "):", e.message);
      res.status(500).json({ error: "Judge failed." });
    }
  });

  // F1 — public shareable run endpoint (no auth)
  router.get("/api/runs/:id/public", publicLimiter, function(req, res) {
    const item = getAnalysisRun(req.params.id);
    if (!item) return res.status(404).json({ error: "Run not found." });
    res.json({
      id: item.id,
      prompt: item.prompt,
      responses: item.responses,
      judgement: {
        scores: item.judgement && item.judgement.scores,
        verdicts: item.judgement && item.judgement.verdicts,
        crown: item.judgement && item.judgement.crown,
        roast: item.judgement && item.judgement.roast,
      },
      crownModelId: item.crownModelId,
      crownScore: item.crownScore,
      createdAt: item.createdAt,
      blindMapping: item.execution && item.execution.blindMapping ? item.execution.blindMapping : undefined,
    });
  });

  // F9 — daily challenge (fire all models + judge in background)
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

  // Blind taste test mapping — generated server-side, tamper-proof
  router.get("/api/blind-mapping", authMw.requireAuth, function(req, res) {
    try {
      const shuffled = ACTIVE_MODEL_IDS.slice().sort(function() { return Math.random() - 0.5; });
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
