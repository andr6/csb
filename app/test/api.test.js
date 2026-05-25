const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Duplex } = require("node:stream");

process.env.ALLOWED_ORIGINS = "https://chatshitbob.com, https://www.chatshitbob.com";
process.env.ACTIVE_MODELS = "alpha,beta";
process.env.MODEL_ALPHA = "openai/gpt-4o-mini";
process.env.MODEL_BETA = "anthropic/claude-sonnet-4-5";

const { createApp } = require("../app");

const TEST_PASS = "test-pass";
const TEST_AUTH = { authorization: "Basic " + Buffer.from("analytics:" + TEST_PASS).toString("base64") };

function invoke(app, method, url, body, headers) {
  return new Promise(function(resolve, reject) {
    class MockSocket extends Duplex {
      constructor() {
        super();
        this.remoteAddress = "127.0.0.1";
        this.writable = true;
        this.readable = true;
        this.destroyed = false;
        this.output = [];
      }
      _read() {}
      _write(chunk, encoding, callback) {
        this.output.push(Buffer.from(chunk));
        callback();
      }
      setTimeout() {}
      setNoDelay() {}
      setKeepAlive() {}
      destroy(error) {
        this.destroyed = true;
        if (error) this.emit("error", error);
      }
    }

    const socket = new MockSocket();
    const payload = body ? JSON.stringify(body) : "";
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = Object.assign({}, headers);
    if (payload) {
      req.headers["content-length"] = String(Buffer.byteLength(payload));
    }
    req.connection = socket;
    req.socket = socket;
    req.httpVersion = "1.1";

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    let raw = "";
    let settled = false;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    function finalize() {
      if (settled) return;
      settled = true;
      let parsed = raw;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch (e) {}
      resolve({
        statusCode: res.statusCode || 200,
        body: parsed,
        text: raw,
        headers: res.getHeaders(),
      });
    }

    res.write = function(chunk, encoding, callback) {
      if (chunk) raw += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      return originalWrite(chunk, encoding, callback);
    };
    res.end = function(chunk, encoding, callback) {
      if (chunk) raw += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      const result = originalEnd(chunk, encoding, callback);
      finalize();
      return result;
    };
    res.on("error", reject);

    app.handle(req, res, reject);

    if (payload) {
      req.push(payload);
    }
    req.push(null);
  });
}

test("POST /api/fire returns contestant response", async function() {
  const app = createApp({
    getVoice: function(modelId) { return "voice:" + modelId; },
    callContestant: async function(modelId, system, prompt) {
      assert.equal(modelId, "alpha");
      assert.equal(system, "voice:alpha");
      assert.equal(prompt, "tell me something cursed");
      return "mocked contestant";
    },
  });

  const res = await invoke(app, "POST", "/api/fire", {
    prompt: "tell me something cursed",
    modelId: "alpha",
  }, {
    "content-type": "application/json",
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.modelId, "alpha");
  assert.equal(res.body.response, "mocked contestant");
});

test("POST /api/judge returns normalized verdict payload", async function() {
  var savedRun = null;
  const app = createApp({
    callJudge: async function(system, prompt) {
      assert.match(system, /Chat Shit Bob/);
      assert.match(prompt, /ORIGINAL PROMPT/);
      return JSON.stringify({
        scores: { alpha: 88, beta: 12 },
        verdicts: { alpha: "awful", beta: "fine" },
        crown: "alpha",
        roast: "global roast",
      });
    },
    addAnalysisRun: function(run) {
      savedRun = run;
      return { id: "run-1" };
    },
  });

  const res = await invoke(app, "POST", "/api/judge", {
    prompt: "tell me something cursed",
    responses: {
      alpha: "a",
      beta: "b",
    },
    meta: {
      timings: {
        contestantMsByModel: { alpha: 101, beta: 202 },
        judgeMs: 99,
      },
      execution: {
        summary: { overallStatus: "partial_failure" },
        models: {
          alpha: { status: "success", upstreamStatus: 200, durationMs: 101 },
          beta: { status: "error", upstreamStatus: 500, durationMs: 202, error: "upstream failed" },
        },
        policy: { retry: "none", fallback: "none" },
      },
    },
  }, {
    "content-type": "application/json",
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.scores, { alpha: 88, beta: 12 });
  assert.equal(res.body.crown, "alpha");
  assert.equal(res.body.roast, "global roast");
  assert.deepEqual(savedRun, {
    prompt: "tell me something cursed",
    responses: { alpha: "a", beta: "b" },
    judgement: {
      scores: { alpha: 88, beta: 12 },
      verdicts: { alpha: "awful", beta: "fine" },
      crown: "alpha",
      roast: "global roast",
    },
    crownModelId: "alpha",
    crownScore: 88,
    contestantProvider: "openrouter",
    judgeProvider: "anthropic",
    judgeModel: "anthropic/claude-sonnet-4-5",
    timings: {
      contestantMsByModel: { alpha: 101, beta: 202 },
      judgeMs: 99,
    },
    execution: {
      summary: { overallStatus: "partial_failure" },
      models: {
        alpha: { status: "success", upstreamStatus: 200, durationMs: 101 },
        beta: { status: "error", upstreamStatus: 500, durationMs: 202, error: "upstream failed" },
      },
      policy: { retry: "none", fallback: "none" },
    },
  });
});

test("POST /api/fire rejects unknown model ids", async function() {
  const app = createApp();
  const res = await invoke(app, "POST", "/api/fire", {
    prompt: "tell me something cursed",
    modelId: "missing",
  }, {
    "content-type": "application/json",
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Invalid model ID: missing");
});

test("GET /api/history returns persisted leaderboard data", async function() {
  const app = createApp({
    readHistory: function() {
      return [{ modelId: "alpha", prompt: "prompt", score: 91, createdAt: "2026-04-23T00:00:00.000Z" }];
    },
  });

  const res = await invoke(app, "GET", "/api/history", null, {});

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, [
    { modelId: "alpha", prompt: "prompt", score: 91, createdAt: "2026-04-23T00:00:00.000Z" },
  ]);
});

test("GET /api/history is public — no analytics password required", async function() {
  const app = createApp({
    analyticsPagePassword: "secret-pass",
    readHistory: function() {
      return [{ modelId: "alpha", prompt: "prompt", score: 91 }];
    },
  });

  const res = await invoke(app, "GET", "/api/history", null, {});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, [{ modelId: "alpha", prompt: "prompt", score: 91 }]);
});

test("GET /analytics returns 401 when no password is configured", async function() {
  const app = createApp({ analyticsPagePassword: "" });
  const res = await invoke(app, "GET", "/analytics", null, {});
  assert.equal(res.statusCode, 401);
  assert.match(String(res.headers["www-authenticate"] || ""), /Basic realm="CSB Analytics"/);
});

test("GET /api/stats returns app and history metrics", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    metrics: {
      startedAt: "2026-04-23T00:00:00.000Z",
      requests: 3,
      apiRequests: 3,
      errors5xx: 1,
      routeStats: {},
    },
    getHistoryStats: function() {
      return { totalEntries: 5, bestScore: 95, worstScore: 10 };
    },
    getAnalysisRunStats: function() {
      return { totalRuns: 12, latestRunAt: "2026-04-23T00:00:00.000Z" };
    },
    getAnalysisAnalytics: function() {
      return {
        totalRuns: 12,
        successRuns: 7,
        partialFailureRuns: 3,
        failureRuns: 2,
        successRate: 58,
        avgCrownScore: 72,
        avgJudgeMs: 88,
        contestantSpendUsd: 18.5,
        judgeSpendUsd: 1.2,
        estimatedSpendUsd: 19.7,
        avgRunSpendUsd: 1.64,
        pricing: { configuredModelCount: 3, judgeUnitCostUsd: 0.1 },
        budget: {
          slice: { limitUsd: 25, spendUsd: 19.7, remainingUsd: 5.3, utilizationPct: 79, status: "ok" },
          daily: { limitUsd: 5, spendUsd: 3.1, remainingUsd: 1.9, utilizationPct: 62, status: "ok" },
          monthlyProjected: { limitUsd: 100, spendUsd: 93, remainingUsd: 7, utilizationPct: 93, status: "near" },
          averageDailySpendUsd: 3.1,
        },
        policy: {
          thresholds: { minReliabilityPct: 90, maxUnitCostUsd: 0.5, minScorePerDollar: 100, minAvgScore: 60 },
          counts: { promote: 1, hold: 1, demote: 1 },
          promote: [{ modelId: "beta", reliability: 98, unitCostUsd: 0.1, policyReasons: [], scorePerDollar: 650 }],
          hold: [{ modelId: "alpha", reliability: 92, unitCostUsd: 0.5, policyReasons: ["value"], scorePerDollar: 154 }],
          demote: [{ modelId: "gamma", reliability: 70, unitCostUsd: 2.2, policyReasons: ["reliability", "cost", "value", "quality"], scorePerDollar: 41.4 }],
        },
        planning: {
          spendLeaders: [{ modelId: "gamma", estimatedSpendUsd: 6.6, spendSharePct: 36, unitCostUsd: 2.2 }],
          lineups: {
            activeSet: [{ modelId: "beta", reliability: 98, unitCostUsd: 0.1 }, { modelId: "alpha", reliability: 92, unitCostUsd: 0.5 }],
            fallbackSet: [],
            retireSet: [{ modelId: "gamma", reliability: 70, unitCostUsd: 2.2 }],
          },
          scenarios: {
            runs: 100,
            defaultChoice: { modelId: "alpha", totalCostUsd: 60, expectedWins: 42, expectedScorePoints: 7700 },
            cheapFallback: { modelId: "beta", totalCostUsd: 20, expectedWins: 35, expectedScorePoints: 6500 },
            premiumChoice: { modelId: "gamma", totalCostUsd: 230, expectedWins: 49, expectedScorePoints: 9100 },
          },
        },
        dailyTrend: [{ date: "2026-04-23", runs: 4, successRate: 50, avgCrownScore: 70, modelUsage: { alpha: 4 }, contestantSpendUsd: 2.8, judgeSpendUsd: 0.4, estimatedSpendUsd: 3.2 }],
        modelStats: [{ modelId: "alpha", appearances: 12, avgScore: 77, wins: 5, winRate: 42, reliability: 92, avgDurationMs: 111, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 }],
        recommendations: {
          bestOverall: { modelId: "alpha", avgScore: 77, winRate: 42, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 },
          mostReliable: { modelId: "beta", reliability: 98, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
          fastest: { modelId: "beta", avgDurationMs: 95, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
          bestValue: { modelId: "alpha", avgScore: 77, avgDurationMs: 111, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 },
          defaultChoice: { modelId: "alpha", avgScore: 77, reliability: 92, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 },
          cheapFallback: { modelId: "beta", avgScore: 65, reliability: 98, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
          premiumChoice: { modelId: "gamma", avgScore: 91, reliability: 88, costBand: "premium", estimatedCostIndex: 3, unitCostUsd: 2.2, costSource: "configured", estimatedSpendUsd: 6.6, scorePerDollar: 41.4 },
          cheapestReliable: { modelId: "beta", avgScore: 65, reliability: 98, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
          spendLeader: { modelId: "gamma", estimatedSpendUsd: 6.6, spendSharePct: 36, unitCostUsd: 2.2 },
          budgetRiskModels: [{ modelId: "gamma", estimatedSpendUsd: 6.6, scorePerDollar: 41.4, unitCostUsd: 2.2 }],
          promote: { modelId: "beta", reliability: 98, unitCostUsd: 0.1, policyReasons: [], scorePerDollar: 650 },
          hold: { modelId: "alpha", reliability: 92, unitCostUsd: 0.5, policyReasons: ["value"], scorePerDollar: 154 },
          demote: { modelId: "gamma", reliability: 70, unitCostUsd: 2.2, policyReasons: ["reliability", "cost", "value", "quality"], scorePerDollar: 41.4 },
          activeSet: [{ modelId: "beta", reliability: 98, unitCostUsd: 0.1 }, { modelId: "alpha", reliability: 92, unitCostUsd: 0.5 }],
          fallbackSet: [],
          retireSet: [{ modelId: "gamma", reliability: 70, unitCostUsd: 2.2 }],
          rotationCandidates: [{ modelId: "gamma", avgScore: 31, wins: 0, winRate: 0, reliability: 70, avgDurationMs: 210, costBand: "premium", estimatedCostIndex: 3, unitCostUsd: 2.2, costSource: "configured", estimatedSpendUsd: 6.6, scorePerDollar: 14.1 }],
        },
      };
    },
    getAnalysisFailureSummary: function() {
      return {
        totalFailures: 4,
        byStatus: { failure: 3, partial_failure: 1 },
        byModel: { alpha: 2 },
        byContestantProvider: { openrouter: 2 },
        byJudgeProvider: { anthropic: 1 },
        judgePhases: { judge_call: 3, judge_parse: 1 },
        errorMessages: { "Judge failed": 2 },
        errorCategories: { upstream_5xx: 2 },
        upstreamStatuses: { 500: 2 },
        latestJudgeParseFailures: [{ id: "run-9", prompt: "prompt", error: "bad json", rawJudge: "{oops", createdAt: "2026-04-23T00:00:00.000Z" }],
        byRetryPolicy: { none: 4 },
        byFallbackPolicy: { none: 4 },
        totalRetryAttempts: 0,
        fallbackRuns: 0,
      };
    },
    historyStorageType: "json",
    runStorageType: "json",
  });

  const res = await invoke(app, "GET", "/api/stats", null, TEST_AUTH);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.app.requests, 3);
  assert.deepEqual(res.body.history, { totalEntries: 5, bestScore: 95, worstScore: 10 });
  assert.deepEqual(res.body.runs, { totalRuns: 12, latestRunAt: "2026-04-23T00:00:00.000Z" });
  assert.deepEqual(res.body.analytics, {
    totalRuns: 12,
    successRuns: 7,
    partialFailureRuns: 3,
    failureRuns: 2,
    successRate: 58,
    avgCrownScore: 72,
    avgJudgeMs: 88,
    contestantSpendUsd: 18.5,
    judgeSpendUsd: 1.2,
    estimatedSpendUsd: 19.7,
    avgRunSpendUsd: 1.64,
    pricing: { configuredModelCount: 3, judgeUnitCostUsd: 0.1 },
    budget: {
      slice: { limitUsd: 25, spendUsd: 19.7, remainingUsd: 5.3, utilizationPct: 79, status: "ok" },
      daily: { limitUsd: 5, spendUsd: 3.1, remainingUsd: 1.9, utilizationPct: 62, status: "ok" },
      monthlyProjected: { limitUsd: 100, spendUsd: 93, remainingUsd: 7, utilizationPct: 93, status: "near" },
      averageDailySpendUsd: 3.1,
    },
    policy: {
      thresholds: { minReliabilityPct: 90, maxUnitCostUsd: 0.5, minScorePerDollar: 100, minAvgScore: 60 },
      counts: { promote: 1, hold: 1, demote: 1 },
      promote: [{ modelId: "beta", reliability: 98, unitCostUsd: 0.1, policyReasons: [], scorePerDollar: 650 }],
      hold: [{ modelId: "alpha", reliability: 92, unitCostUsd: 0.5, policyReasons: ["value"], scorePerDollar: 154 }],
      demote: [{ modelId: "gamma", reliability: 70, unitCostUsd: 2.2, policyReasons: ["reliability", "cost", "value", "quality"], scorePerDollar: 41.4 }],
    },
    planning: {
      spendLeaders: [{ modelId: "gamma", estimatedSpendUsd: 6.6, spendSharePct: 36, unitCostUsd: 2.2 }],
      lineups: {
        activeSet: [{ modelId: "beta", reliability: 98, unitCostUsd: 0.1 }, { modelId: "alpha", reliability: 92, unitCostUsd: 0.5 }],
        fallbackSet: [],
        retireSet: [{ modelId: "gamma", reliability: 70, unitCostUsd: 2.2 }],
      },
      scenarios: {
        runs: 100,
        defaultChoice: { modelId: "alpha", totalCostUsd: 60, expectedWins: 42, expectedScorePoints: 7700 },
        cheapFallback: { modelId: "beta", totalCostUsd: 20, expectedWins: 35, expectedScorePoints: 6500 },
        premiumChoice: { modelId: "gamma", totalCostUsd: 230, expectedWins: 49, expectedScorePoints: 9100 },
      },
    },
    dailyTrend: [{ date: "2026-04-23", runs: 4, successRate: 50, avgCrownScore: 70, modelUsage: { alpha: 4 }, contestantSpendUsd: 2.8, judgeSpendUsd: 0.4, estimatedSpendUsd: 3.2 }],
    modelStats: [{ modelId: "alpha", appearances: 12, avgScore: 77, wins: 5, winRate: 42, reliability: 92, avgDurationMs: 111, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 }],
    recommendations: {
      bestOverall: { modelId: "alpha", avgScore: 77, winRate: 42, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 },
      mostReliable: { modelId: "beta", reliability: 98, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
      fastest: { modelId: "beta", avgDurationMs: 95, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
      bestValue: { modelId: "alpha", avgScore: 77, avgDurationMs: 111, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 },
      defaultChoice: { modelId: "alpha", avgScore: 77, reliability: 92, costBand: "standard", estimatedCostIndex: 2, unitCostUsd: 0.5, costSource: "configured", estimatedSpendUsd: 6, scorePerDollar: 154 },
      cheapFallback: { modelId: "beta", avgScore: 65, reliability: 98, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
      premiumChoice: { modelId: "gamma", avgScore: 91, reliability: 88, costBand: "premium", estimatedCostIndex: 3, unitCostUsd: 2.2, costSource: "configured", estimatedSpendUsd: 6.6, scorePerDollar: 41.4 },
      cheapestReliable: { modelId: "beta", avgScore: 65, reliability: 98, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.1, costSource: "configured", estimatedSpendUsd: 1.2, scorePerDollar: 650 },
      spendLeader: { modelId: "gamma", estimatedSpendUsd: 6.6, spendSharePct: 36, unitCostUsd: 2.2 },
      budgetRiskModels: [{ modelId: "gamma", estimatedSpendUsd: 6.6, scorePerDollar: 41.4, unitCostUsd: 2.2 }],
      promote: { modelId: "beta", reliability: 98, unitCostUsd: 0.1, policyReasons: [], scorePerDollar: 650 },
      hold: { modelId: "alpha", reliability: 92, unitCostUsd: 0.5, policyReasons: ["value"], scorePerDollar: 154 },
      demote: { modelId: "gamma", reliability: 70, unitCostUsd: 2.2, policyReasons: ["reliability", "cost", "value", "quality"], scorePerDollar: 41.4 },
      activeSet: [{ modelId: "beta", reliability: 98, unitCostUsd: 0.1 }, { modelId: "alpha", reliability: 92, unitCostUsd: 0.5 }],
      fallbackSet: [],
      retireSet: [{ modelId: "gamma", reliability: 70, unitCostUsd: 2.2 }],
      rotationCandidates: [{ modelId: "gamma", avgScore: 31, wins: 0, winRate: 0, reliability: 70, avgDurationMs: 210, costBand: "premium", estimatedCostIndex: 3, unitCostUsd: 2.2, costSource: "configured", estimatedSpendUsd: 6.6, scorePerDollar: 14.1 }],
    },
  });
  assert.deepEqual(res.body.failures, {
    totalFailures: 4,
    byStatus: { failure: 3, partial_failure: 1 },
    byModel: { alpha: 2 },
    byContestantProvider: { openrouter: 2 },
    byJudgeProvider: { anthropic: 1 },
    judgePhases: { judge_call: 3, judge_parse: 1 },
    errorMessages: { "Judge failed": 2 },
    errorCategories: { upstream_5xx: 2 },
    upstreamStatuses: { 500: 2 },
    latestJudgeParseFailures: [{ id: "run-9", prompt: "prompt", error: "bad json", rawJudge: "{oops", createdAt: "2026-04-23T00:00:00.000Z" }],
    byRetryPolicy: { none: 4 },
    byFallbackPolicy: { none: 4 },
    totalRetryAttempts: 0,
    fallbackRuns: 0,
  });
  assert.equal(res.body.storage.leaderboard, "json");
  assert.equal(res.body.storage.runs, "json");
  assert.ok(["native", "wasm"].includes(res.body.storage.sqliteDriver), "sqliteDriver must be native or wasm");
});

test("GET /api/analytics returns comparative model analytics", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    getAnalysisAnalytics: function(options) {
      assert.equal(options.status, "success");
      assert.equal(options.dateFrom, "2026-04-20");
      return {
        totalRuns: 9,
        successRuns: 9,
        partialFailureRuns: 0,
        failureRuns: 0,
        successRate: 100,
        avgCrownScore: 69,
        avgJudgeMs: 81,
        contestantSpendUsd: 1.35,
        judgeSpendUsd: 0.27,
        estimatedSpendUsd: 1.62,
        avgRunSpendUsd: 0.18,
        pricing: { configuredModelCount: 1, judgeUnitCostUsd: 0.03 },
        budget: {
          slice: { limitUsd: 5, spendUsd: 1.62, remainingUsd: 3.38, utilizationPct: 32, status: "ok" },
          daily: { limitUsd: 2, spendUsd: 0.54, remainingUsd: 1.46, utilizationPct: 27, status: "ok" },
          monthlyProjected: { limitUsd: 30, spendUsd: 16.2, remainingUsd: 13.8, utilizationPct: 54, status: "ok" },
          averageDailySpendUsd: 0.54,
        },
        policy: {
          thresholds: { minReliabilityPct: 90, maxUnitCostUsd: 0.2, minScorePerDollar: 400, minAvgScore: 70 },
          counts: { promote: 1, hold: 0, demote: 0 },
          promote: [{ modelId: "beta", reliability: 100, unitCostUsd: 0.15, policyReasons: [], scorePerDollar: 493.3 }],
          hold: [],
          demote: [],
        },
        planning: {
          spendLeaders: [{ modelId: "beta", estimatedSpendUsd: 1.35, spendSharePct: 100, unitCostUsd: 0.15 }],
          lineups: {
            activeSet: [{ modelId: "beta", reliability: 100, unitCostUsd: 0.15 }],
            fallbackSet: [],
            retireSet: [],
          },
          scenarios: {
            runs: 100,
            defaultChoice: { modelId: "beta", totalCostUsd: 18, expectedWins: 44, expectedScorePoints: 7400 },
            cheapFallback: { modelId: "beta", totalCostUsd: 18, expectedWins: 44, expectedScorePoints: 7400 },
            premiumChoice: null,
          },
        },
        dailyTrend: [{ date: "2026-04-24", runs: 3, successRate: 100, avgCrownScore: 65, modelUsage: { beta: 3 }, contestantSpendUsd: 0.45, judgeSpendUsd: 0.09, estimatedSpendUsd: 0.54 }],
        modelStats: [{ modelId: "beta", appearances: 9, avgScore: 74, wins: 4, winRate: 44, reliability: 100, avgDurationMs: 102, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 }],
        recommendations: {
          bestOverall: { modelId: "beta", avgScore: 74, winRate: 44, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 },
          mostReliable: { modelId: "beta", reliability: 100, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 },
          fastest: { modelId: "beta", avgDurationMs: 102, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 },
          bestValue: { modelId: "beta", avgScore: 74, avgDurationMs: 102, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 },
          defaultChoice: { modelId: "beta", avgScore: 74, reliability: 100, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 },
          cheapFallback: { modelId: "beta", avgScore: 74, reliability: 100, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 },
          premiumChoice: null,
          cheapestReliable: { modelId: "beta", avgScore: 74, reliability: 100, costBand: "cheap", estimatedCostIndex: 1, unitCostUsd: 0.15, costSource: "configured", estimatedSpendUsd: 1.35, scorePerDollar: 493.3 },
          spendLeader: { modelId: "beta", estimatedSpendUsd: 1.35, spendSharePct: 100, unitCostUsd: 0.15 },
          budgetRiskModels: [],
          promote: { modelId: "beta", reliability: 100, unitCostUsd: 0.15, policyReasons: [], scorePerDollar: 493.3 },
          hold: null,
          demote: null,
          activeSet: [{ modelId: "beta", reliability: 100, unitCostUsd: 0.15 }],
          fallbackSet: [],
          retireSet: [],
          rotationCandidates: [],
        },
      };
    },
  });

  const res = await invoke(app, "GET", "/api/analytics?status=success&dateFrom=2026-04-20", null, TEST_AUTH);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalRuns, 9);
  assert.equal(res.body.successRate, 100);
  assert.equal(res.body.modelStats[0].modelId, "beta");
  assert.equal(res.body.recommendations.bestOverall.modelId, "beta");
  assert.equal(res.body.policy.counts.promote, 1);
  assert.equal(res.body.recommendations.promote.modelId, "beta");
  assert.equal(res.body.planning.lineups.activeSet[0].modelId, "beta");
});

test("GET /api/runs returns recent persisted analysis runs", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    listAnalysisRuns: function(options) {
      // After normalizeFilterOptions, unset string fields become "" and numeric defaults are applied
      assert.equal(options.limit, 20);
      assert.equal(options.offset, 0);
      assert.equal(options.query, "");
      assert.equal(options.crownModelId, "");
      assert.equal(options.status, "");
      assert.equal(options.contestantProvider, "");
      assert.equal(options.judgeProvider, "");
      assert.equal(options.failedModelId, "");
      assert.equal(options.dateFrom, "");
      assert.equal(options.dateTo, "");
      assert.equal(options.phase, "");
      return [{ id: "run-1", prompt: "prompt", responses: {}, judgement: {}, crownModelId: "alpha", crownScore: 80, createdAt: "2026-04-23T00:00:00.000Z" }];
    },
    countAnalysisRuns: function() {
      return 1;
    },
  });

  const res = await invoke(app, "GET", "/api/runs", null, TEST_AUTH);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].id, "run-1");
  assert.equal(res.body.total, 1);
});

test("GET /api/runs forwards filters and pagination", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    countAnalysisRuns: function(options) {
      assert.equal(options.limit, 5);
      assert.equal(options.offset, 10);
      assert.equal(options.query, "weird");
      assert.equal(options.crownModelId, "alpha");
      assert.equal(options.status, "partial_failure");
      assert.equal(options.contestantProvider, "openrouter");
      assert.equal(options.judgeProvider, "anthropic");
      assert.equal(options.failedModelId, "beta");
      assert.equal(options.dateFrom, "2026-04-20");
      assert.equal(options.dateTo, "2026-04-24");
      assert.equal(options.phase, "judge_parse");
      return 17;
    },
    listAnalysisRuns: function(options) {
      assert.equal(options.limit, 5);
      assert.equal(options.offset, 10);
      assert.equal(options.query, "weird");
      assert.equal(options.crownModelId, "alpha");
      assert.equal(options.status, "partial_failure");
      assert.equal(options.contestantProvider, "openrouter");
      assert.equal(options.judgeProvider, "anthropic");
      assert.equal(options.failedModelId, "beta");
      assert.equal(options.dateFrom, "2026-04-20");
      assert.equal(options.dateTo, "2026-04-24");
      assert.equal(options.phase, "judge_parse");
      return [];
    },
  });

  const res = await invoke(app, "GET", "/api/runs?limit=5&offset=10&query=weird&crownModelId=alpha&status=partial_failure&contestantProvider=openrouter&judgeProvider=anthropic&failedModelId=beta&dateFrom=2026-04-20&dateTo=2026-04-24&phase=judge_parse", null, TEST_AUTH);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.total, 17);
});

test("GET /api/runs/:id returns one persisted analysis run", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    getAnalysisRun: function(id) {
      if (id !== "run-1") return null;
      return { id: "run-1", prompt: "prompt", responses: { alpha: "a" }, judgement: { crown: "alpha" }, crownModelId: "alpha", crownScore: 80, createdAt: "2026-04-23T00:00:00.000Z" };
    },
  });

  const res = await invoke(app, "GET", "/api/runs/run-1", null, TEST_AUTH);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, "run-1");
});

test("GET /api/runs/export returns downloadable filtered runs", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    listAnalysisRuns: function(options) {
      assert.equal(options.limit, 5);
      assert.equal(options.offset, "10");
      assert.equal(options.query, "weird");
      assert.equal(options.crownModelId, "alpha");
      assert.equal(options.status, "failure");
      assert.equal(options.contestantProvider, "openrouter");
      assert.equal(options.judgeProvider, "anthropic");
      assert.equal(options.failedModelId, "beta");
      assert.equal(options.dateFrom, "2026-04-20");
      assert.equal(options.dateTo, "2026-04-24");
      assert.equal(options.phase, "judge_parse");
      return [{ id: "run-1", prompt: "prompt" }];
    },
  });

  const res = await invoke(app, "GET", "/api/runs/export?limit=5&offset=10&query=weird&crownModelId=alpha&status=failure&contestantProvider=openrouter&judgeProvider=anthropic&failedModelId=beta&dateFrom=2026-04-20&dateTo=2026-04-24&phase=judge_parse", null, TEST_AUTH);

  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /application\/json/);
  assert.match(String(res.headers["content-disposition"]), /csb-runs-export\.json/);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].id, "run-1");
  assert.ok(res.body.exportedAt);
});

test("GET /api/runs/export supports csv format", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    listAnalysisRuns: function() {
      return [{
        id: "run-2",
        createdAt: "2026-04-23T00:00:00.000Z",
        prompt: "prompt",
        crownModelId: "alpha",
        crownScore: 80,
        contestantProvider: "openrouter",
        judgeProvider: "anthropic",
        judgeModel: "anthropic/claude-sonnet-4-5",
        judgement: { error: "bad json" },
        execution: {
          summary: { overallStatus: "failure", phase: "judge_parse" },
          judge: { status: "error", error: "bad json" },
        },
      }];
    },
  });

  const res = await invoke(app, "GET", "/api/runs/export?format=csv", null, TEST_AUTH);

  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /text\/csv/);
  assert.match(String(res.headers["content-disposition"]), /csb-runs-export\.csv/);
  assert.match(res.text, /id,createdAt,status,phase,prompt,crownModelId/);
  assert.match(res.text, /judge_parse/);
  assert.match(res.text, /bad json/);
});

test("GET /api/failures/summary returns failure aggregates", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    getAnalysisFailureSummary: function(options) {
      assert.equal(options.contestantProvider, "openrouter");
      assert.equal(options.judgeProvider, "anthropic");
      assert.equal(options.failedModelId, "alpha");
      assert.equal(options.dateFrom, "2026-04-20");
      assert.equal(options.dateTo, "2026-04-24");
      assert.equal(options.phase, "judge_parse");
      assert.equal(options.status, "failure");
      return {
        totalFailures: 3,
        byStatus: { failure: 2, partial_failure: 1 },
        byModel: { alpha: 2 },
        byContestantProvider: { openrouter: 2 },
        byJudgeProvider: { anthropic: 1 },
        judgePhases: { judge_call: 2, judge_parse: 1 },
        errorMessages: { "Judge failed": 2, "upstream failed": 1 },
        errorCategories: { judge_parse: 1, upstream_5xx: 2 },
        upstreamStatuses: { 500: 2 },
        latestJudgeParseFailures: [{ id: "run-3", prompt: "prompt", error: "bad json", rawJudge: "{oops", createdAt: "2026-04-23T00:00:00.000Z" }],
        byRetryPolicy: { none: 2, simple_retry: 1 },
        byFallbackPolicy: { none: 2, backup_judge: 1 },
        totalRetryAttempts: 3,
        fallbackRuns: 1,
      };
    },
  });

  const res = await invoke(app, "GET", "/api/failures/summary?contestantProvider=openrouter&judgeProvider=anthropic&failedModelId=alpha&dateFrom=2026-04-20&dateTo=2026-04-24&phase=judge_parse&status=failure", null, TEST_AUTH);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    totalFailures: 3,
    byStatus: { failure: 2, partial_failure: 1 },
    byModel: { alpha: 2 },
    byContestantProvider: { openrouter: 2 },
    byJudgeProvider: { anthropic: 1 },
    judgePhases: { judge_call: 2, judge_parse: 1 },
    errorMessages: { "Judge failed": 2, "upstream failed": 1 },
    errorCategories: { judge_parse: 1, upstream_5xx: 2 },
    upstreamStatuses: { 500: 2 },
    latestJudgeParseFailures: [{ id: "run-3", prompt: "prompt", error: "bad json", rawJudge: "{oops", createdAt: "2026-04-23T00:00:00.000Z" }],
    byRetryPolicy: { none: 2, simple_retry: 1 },
    byFallbackPolicy: { none: 2, backup_judge: 1 },
    totalRetryAttempts: 3,
    fallbackRuns: 1,
  });
});

test("GET /api/runs — injection probe on failedModelId does not crash", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    listAnalysisRuns: function(options) {
      // Verify the raw injection string reaches the handler without server error
      assert.equal(typeof options.failedModelId, "string");
      return [];
    },
    countAnalysisRuns: function() { return 0; },
  });

  // A " character in failedModelId was the original injection vector — it must
  // not cause a 500; the handler should return 200 with an empty list.
  const res = await invoke(
    app, "GET",
    '/api/runs?failedModelId=%22%3B%20DROP%20TABLE%20analysis_runs%3B%20--',
    null,
    TEST_AUTH
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, []);
});

test("GET /api/runs — injection probe on query string does not crash", async function() {
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    listAnalysisRuns: function(options) {
      assert.equal(typeof options.query, "string");
      return [];
    },
    countAnalysisRuns: function() { return 0; },
  });

  // Classic LIKE injection: %' OR '1'='1 — must return empty, not a full dump
  const res = await invoke(
    app, "GET",
    "/api/runs?query=%25%27%20OR%20%271%27%3D%271",
    null,
    TEST_AUTH
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, []);
});

test("POST /api/judge — crown change fires webhook when #1 score is displaced", async function() {
  let webhookCalled = false;
  let webhookPayload = null;
  // Simulate: before the run, alpha is #1 at 80; after the run, beta is #1 at 95
  let topQueryCount = 0;
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    addAnalysisRun: function() {},
    listTopAnalysisRunsByScore: function() {
      topQueryCount++;
      if (topQueryCount === 1) return [{ crownModelId: "alpha", crownScore: 80 }];
      return [{ crownModelId: "beta", crownScore: 95 }];
    },
    notifyWebhook: function(event) { webhookCalled = true; webhookPayload = event; },
    callJudge: async function() {
      return JSON.stringify({ scores: { alpha: 5, beta: 95 }, verdicts: {}, crown: "beta", roast: "" });
    },
  });

  const res = await invoke(app, "POST", "/api/judge", {
    prompt: "crown change prompt",
    responses: { alpha: "resp A", beta: "resp B" },
  }, { "content-type": "application/json" });
  assert.equal(res.statusCode, 200);
  assert.equal(webhookCalled, true, "webhook fired on crown change");
  assert.equal(webhookPayload && webhookPayload.type, "crown_change");
  assert.equal(webhookPayload.newCrown, "beta");
  assert.equal(webhookPayload.prevCrown, "alpha");
});

test("POST /api/judge — crown change does NOT fire when same model keeps #1", async function() {
  let webhookCalled = false;
  // Before and after the run, alpha is still #1
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    addAnalysisRun: function() {},
    listTopAnalysisRunsByScore: function() {
      return [{ crownModelId: "alpha", crownScore: 80 }];
    },
    notifyWebhook: function() { webhookCalled = true; },
    callJudge: async function() {
      return JSON.stringify({ scores: { alpha: 85, beta: 15 }, verdicts: {}, crown: "alpha", roast: "" });
    },
  });

  const res = await invoke(app, "POST", "/api/judge", {
    prompt: "no change prompt",
    responses: { alpha: "resp A", beta: "resp B" },
  }, { "content-type": "application/json" });
  assert.equal(res.statusCode, 200);
  assert.equal(webhookCalled, false, "no webhook when same model retains #1");
});

test("GET /api/runs?isChallenge=true returns only challenge runs", async function() {
  let capturedOptions = null;
  const app = createApp({
    analyticsPagePassword: TEST_PASS,
    listAnalysisRuns: function(options) {
      capturedOptions = options;
      return [];
    },
    countAnalysisRuns: function() { return 0; },
  });

  const res = await invoke(app, "GET", "/api/runs?isChallenge=true", null, TEST_AUTH);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedOptions && capturedOptions.isChallenge, 1, "isChallenge=true maps to numeric 1 in options");
});
