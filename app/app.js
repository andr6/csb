const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const {
  CONTESTANT_PROVIDER,
  JUDGE_PROVIDER,
  JUDGE_MODEL,
  MODEL_MAP,
  VALID_MODELS,
  ANALYTICS_PAGE_PASSWORD,
  KEYS,
  DAILY_CHALLENGE_PROMPT,
  JUDGE_RUNS,
  WEBHOOK_URL,
} = require("./lib/config");
const { buildCorsOptions } = require("./lib/cors");
const modelServices = require("./lib/models");
const providerServices = require("./lib/providers");
const { validatePrompt } = require("./lib/validation");
const { normalizeFilterOptions } = require("./lib/filterOptions");
const judgeServices = require("./lib/judge");
const JUDGE_SYSTEM_PROMPT = judgeServices.JUDGE_SYSTEM_PROMPT;
const VALID_CRITERIA_KEYS = judgeServices.VALID_CRITERIA_KEYS;
const historyServices = require("./lib/history");
const analysisRunServices = require("./lib/analysisRuns");
const listTopAnalysisRunsByScore = analysisRunServices.listTopAnalysisRunsByScore;
const metricsServices = require("./lib/metrics");
const { createRateLimitStore } = require("./lib/rateLimitStore");
const { notifyWebhook } = require("./lib/webhook");
const pendingPrompts = require("./lib/repositories/pendingPromptsRepository");

// ── Page token — gates /api/fire and /api/judge to visitors who loaded the page ──
const PAGE_TOKEN_SECRET = process.env.PAGE_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const PAGE_TOKEN_TTL_S = 86400; // 24 hours

function generatePageToken() {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", PAGE_TOKEN_SECRET).update(String(ts)).digest("hex");
  return ts + "." + sig;
}

function validatePageToken(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const ts = Number(token.slice(0, dot));
  if (!ts || isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > PAGE_TOKEN_TTL_S) return false;
  if (ts > now + 60) return false;
  const expected = crypto.createHmac("sha256", PAGE_TOKEN_SECRET).update(String(ts)).digest("hex");
  const eBuf = Buffer.from(expected, "hex");
  const aBuf = Buffer.from(token.slice(dot + 1), "hex");
  return eBuf.length === aBuf.length && crypto.timingSafeEqual(eBuf, aBuf);
}

function createApp(overrides) {
  const deps = overrides || {};
  const app = express();
  app.disable("x-powered-by");
  const getVoice = deps.getVoice || modelServices.getVoice;
  const callContestant = deps.callContestant || providerServices.callContestant;
  const callJudge = deps.callJudge || providerServices.callJudge;
  const judgeRunsOverride = deps.judgeRuns;
  const buildJudgePrompt = deps.buildJudgePrompt || judgeServices.buildJudgePrompt;
  const computeMedianScores = deps.computeMedianScores || judgeServices.computeMedianScores;
  const parseJudgeResponse = deps.parseJudgeResponse || judgeServices.parseJudgeResponse;
  const normalizeJudgePayload = deps.normalizeJudgePayload || judgeServices.normalizeJudgePayload;
  const readHistory = deps.readHistory || historyServices.readHistory;
  const getHistoryStats = deps.getHistoryStats || historyServices.getHistoryStats;
  const listAnalysisRuns = deps.listAnalysisRuns || analysisRunServices.listAnalysisRuns;
  const countAnalysisRuns = deps.countAnalysisRuns || analysisRunServices.countAnalysisRuns;
  const getAnalysisRun = deps.getAnalysisRun || analysisRunServices.getAnalysisRun;
  const addAnalysisRun = deps.addAnalysisRun || analysisRunServices.addAnalysisRun;
  const getAnalysisRunStats = deps.getAnalysisRunStats || analysisRunServices.getAnalysisRunStats;
  const getAnalysisFailureSummary = deps.getAnalysisFailureSummary || analysisRunServices.getAnalysisFailureSummary;
  const getAnalysisAnalytics = deps.getAnalysisAnalytics || analysisRunServices.getAnalysisAnalytics;
  const historyStorageType = deps.historyStorageType || historyServices.storageType;
  const runStorageType = deps.runStorageType || analysisRunServices.storageType;
  const metrics = deps.metrics || metricsServices.defaultStore;
  const notifyWebhookFn = deps.notifyWebhook || notifyWebhook;
  const analyticsPagePassword = deps.analyticsPagePassword !== undefined
    ? String(deps.analyticsPagePassword || "")
    : ANALYTICS_PAGE_PASSWORD;

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

  function sendIndex(req, res) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }

  function analyticsAuth(req, res, next) {
    if (!analyticsPagePassword) {
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Analytics password required. Set ANALYTICS_PAGE_PASSWORD in .env.");
    }

    const authHeader = String(req.headers.authorization || "");
    if (!authHeader.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Analytics password required.");
    }

    let decoded = "";
    try {
      decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    } catch (error) {
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Invalid analytics credentials.");
    }

    const separatorIndex = decoded.indexOf(":");
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";
    const bufA = Buffer.from(password);
    const bufB = Buffer.from(analyticsPagePassword);
    const valid = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    if (!valid) {
      // Always compare to prevent length-based timing leak
      if (bufA.length !== bufB.length) crypto.timingSafeEqual(bufB, bufB);
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Invalid analytics credentials.");
    }

    next();
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

  function buildFailureRun(prompt, responses, meta, phase, error, rawJudge) {
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

  function tryCreateStore(name) {
    if (process.env.NODE_ENV === "test") return undefined;
    try { return createRateLimitStore(name); } catch (e) { return undefined; }
  }

  const fireLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    store: tryCreateStore("fire"),
    validate: { singleCount: false },
    message: { error: "Too many requests. Slow down." },
  });

  const judgeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 6,
    store: tryCreateStore("judge"),
    validate: { singleCount: false },
    message: { error: "Too many judge requests. Slow down." },
  });

  app.use(express.json({ limit: "10kb" }));
  app.set("trust proxy", 1);
  app.use(function(req, res, next) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
    next();
  });
  app.use(function(req, res, next) {
    const started = Date.now();
    res.on("finish", function() {
      const durationMs = Date.now() - started;
      metricsServices.recordRequest(metrics, req, res, durationMs);
      console.log(JSON.stringify({
        type: "request",
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: durationMs,
      }));
    });
    next();
  });
  app.use(cors(buildCorsOptions()));
  app.use("/api/", rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    store: tryCreateStore("api"),
    message: { error: "Too many requests. Calm down." },
  }));
  app.get("/", sendIndex);
  app.get("/analytics", analyticsAuth, sendIndex);
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/config", function(req, res) {
    res.json({
      contestantProvider: CONTESTANT_PROVIDER,
      models: MODEL_MAP,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      _token: deps.generatePageToken ? deps.generatePageToken() : generatePageToken(),
    });
  });

  app.get("/api/history", function(req, res) {
    res.json({
      items: getLeaderboardItems(),
    });
  });

  app.get("/api/runs", analyticsAuth, function(req, res) {
    const filters = buildRunFilters(req.query);
    res.json({
      items: listAnalysisRuns(filters),
      total: countAnalysisRuns(filters),
    });
  });

  app.get("/api/runs/export", analyticsAuth, function(req, res) {
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

  app.get("/api/runs/:id", analyticsAuth, function(req, res) {
    const item = getAnalysisRun(req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Run not found." });
    }
    res.json(item);
  });

  app.get("/api/failures/summary", analyticsAuth, function(req, res) {
    res.json(getAnalysisFailureSummary(buildRunFilters(req.query)));
  });

  app.get("/api/analytics", analyticsAuth, function(req, res) {
    res.json(getAnalysisAnalytics(buildRunFilters(req.query)));
  });

  app.post("/api/fire", fireLimiter, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    const prompt = req.body.prompt;
    const modelId = req.body.modelId;

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    if (!VALID_MODELS.includes(modelId)) {
      return res.status(400).json({ error: "Invalid model ID." });
    }

    try {
      const response = await callContestant(modelId, getVoice(modelId), prompt);
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

  app.post("/api/judge", judgeLimiter, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    const prompt = req.body.prompt;
    const responses = req.body.responses;
    const meta = req.body.meta && typeof req.body.meta === "object" ? req.body.meta : {};
    const rawCriteria = req.body.criteria;
    const criteria = Array.isArray(rawCriteria)
      ? rawCriteria.filter(function(k) { return VALID_CRITERIA_KEYS.indexOf(k) !== -1; })
      : null;

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
          return callJudge(JUDGE_SYSTEM_PROMPT, judgePrompt);
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
          execution: (function() {
            var ext = Object.assign({}, meta.execution || {});
            if (criteria && criteria.length) ext.criteria = criteria;
            if (judgeRuns > 1) ext.judgeRuns = judgeRuns;
            if (payload.judgeConfidence) ext.judgeConfidence = payload.judgeConfidence;
            return ext;
          }()),
        });
        if (willNotify) {
          const newTopRun = (deps.listTopAnalysisRunsByScore || listTopAnalysisRunsByScore)(1)[0];
          const newCrownModelId = newTopRun ? newTopRun.crownModelId : null;
          if (newCrownModelId && newCrownModelId !== prevCrownModelId) {
            notifyWebhookFn({ type: "crown_change", newCrown: newCrownModelId, prevCrown: prevCrownModelId, prompt: prompt, score: newTopRun.crownScore });
          }
        }
        res.json(payload);
      } catch (e) {
        addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_parse", e, raw));
        console.error("[judge] JSON parse failed. Raw:", String(raw || "").slice(0, 300));
        return res.status(500).json({ error: "Judge returned invalid JSON." });
      }
    } catch (e) {
      addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_call", e));
      console.error("[judge] via " + JUDGE_PROVIDER + " (" + JUDGE_MODEL + "):", e.message);
      res.status(500).json({ error: "Judge failed." });
    }
  });

  // F1 — public shareable run endpoint (no auth)
  app.get("/api/runs/:id/public", function(req, res) {
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
    });
  });

  // F6 — response pattern analytics
  app.get("/api/patterns", analyticsAuth, function(req, res) {
    res.json({ items: analysisRunServices.getPatternStats(buildRunFilters(req.query)) });
  });

  // F8 — daily challenge trigger
  app.post("/api/challenge", analyticsAuth, async function(req, res) {
    const prompt = DAILY_CHALLENGE_PROMPT || (req.body && req.body.prompt) || "";
    if (!prompt) return res.status(400).json({ error: "No challenge prompt. Set DAILY_CHALLENGE_PROMPT in .env or pass prompt in body." });
    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    res.json({ started: true, prompt: prompt, models: VALID_MODELS });

    // Fire all models + judge in background (non-blocking)
    setImmediate(async function() {
      const startedAt = Date.now();
      const execModels = {};
      const allResponses = {};
      try {
        await Promise.all(VALID_MODELS.map(async function(modelId) {
          const t = Date.now();
          try {
            const resp = await callContestant(modelId, getVoice(modelId), prompt);
            allResponses[modelId] = resp || "";
            execModels[modelId] = { status: "success", durationMs: Date.now() - t };
          } catch (e) {
            allResponses[modelId] = "[Error: " + e.message + "]";
            execModels[modelId] = { status: "error", error: e.message, errorCategory: categorizeError(e.message, e.upstreamStatus, "contestant"), durationMs: Date.now() - t };
          }
        }));
        const judgeStart = Date.now();
        const raw = await callJudge(JUDGE_SYSTEM_PROMPT, buildJudgePrompt(prompt, allResponses));
        const judgeMs = Date.now() - judgeStart;
        const payload = normalizeJudgePayload(parseJudgeResponse(raw), Object.keys(allResponses));
        const successCount = VALID_MODELS.filter(function(id) { return execModels[id] && execModels[id].status === "success"; }).length;
        const overallStatus = successCount === VALID_MODELS.length ? "success" : successCount > 0 ? "partial_failure" : "failure";
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
        notifyWebhookFn({ type: "challenge_complete", crown: payload.crown, score: payload.scores[payload.crown], prompt: prompt });
      } catch (e) {
        console.error("[challenge] failed:", e.message);
        addAnalysisRun(buildFailureRun(prompt, allResponses, { timings: { totalMs: Date.now() - startedAt }, execution: { models: execModels } }, "judge_call", e));
      }
    });
  });

  // F10 — prompt submission (public, rate-limited)
  const submitLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, store: tryCreateStore("submit"), message: { error: "Too many submissions." } });
  app.post("/api/prompts/submit", submitLimiter, function(req, res) {
    const prompt = req.body && req.body.prompt;
    const mode = req.body && req.body.mode;
    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });
    try {
      pendingPrompts.submitPrompt(prompt, mode);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Submission failed." });
    }
  });

  app.get("/api/prompts/community", function(req, res) {
    try {
      res.json({ items: pendingPrompts.getCommunityPrompts() });
    } catch (e) {
      res.json({ items: [] });
    }
  });

  app.get("/api/prompts/pending", analyticsAuth, function(req, res) {
    try {
      res.json({ items: pendingPrompts.listPending() });
    } catch (e) {
      res.status(500).json({ error: "Failed to load pending prompts." });
    }
  });

  app.post("/api/prompts/:id/approve", analyticsAuth, function(req, res) {
    try {
      pendingPrompts.approvePrompt(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Approval failed." });
    }
  });

  app.post("/api/prompts/:id/reject", analyticsAuth, function(req, res) {
    try {
      pendingPrompts.rejectPrompt(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Rejection failed." });
    }
  });

  app.get("/api/health", function(req, res) {
    const keyStatus = {};
    ["openrouter", "anthropic", "openai", "gemini", "litellm"].forEach(function(p) {
      keyStatus[p] = KEYS[p] ? "configured" : "missing";
    });
    res.json({
      status: "ok",
      contestantProvider: CONTESTANT_PROVIDER,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      modelCount: Object.keys(MODEL_MAP).length,
      sqliteDriver: require("./lib/sqlite").isWasm() ? "wasm" : "native",
      keys: keyStatus,
    });
  });

  let _statsAnalyticsCache = null;
  let _statsAnalyticsCacheAt = 0;
  const STATS_ANALYTICS_TTL_MS = 30000;

  app.get("/api/stats", analyticsAuth, function(req, res) {
    const now = Date.now();
    if (!_statsAnalyticsCache || now - _statsAnalyticsCacheAt > STATS_ANALYTICS_TTL_MS) {
      _statsAnalyticsCache = getAnalysisAnalytics();
      _statsAnalyticsCacheAt = now;
    }
    res.json({
      app: metrics,
      history: getHistoryStats(),
      runs: getAnalysisRunStats(),
      failures: getAnalysisFailureSummary(),
      analytics: _statsAnalyticsCache,
      storage: {
        leaderboard: historyStorageType,
        runs: runStorageType,
        sqliteDriver: require("./lib/sqlite").isWasm() ? "wasm" : "native",
      },
    });
  });

  app.all("/api/*", function(req, res) {
    res.status(404).json({ error: "Not found." });
  });

  app.get("*", function(req, res) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

module.exports = {
  createApp: createApp,
};
