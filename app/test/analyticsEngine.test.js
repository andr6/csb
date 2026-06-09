const test = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAnalyticsSummary,
  computeFailureSummary,
  computePatternStats,
  computePackStats,
  computeModeStats,
  computeProviderHealth,
  computeResponseLengths,
  computeWinStreaks,
  computeBlindAlignment,
  computePromptTopics,
  computeCostForecast,
  computePromptDifficulty,
  computeHeadToHead,
  computeScoreVolatility,
  computeContestantLatency,
  computeUpsets,
  computeUserEngagement,
  computeRetryRecovery,
  computePromptLengthVsScore,
  RESPONSE_PATTERNS,
} = require("../lib/analyticsEngine");

function makeRun(overrides) {
  return {
    id: "r1",
    createdAt: "2026-06-01",
    prompt: "test prompt",
    pack: "bar",
    mode: "rage",
    crownModelId: "alpha",
    crownScore: 20,
    contestantProvider: "openrouter",
    judgeProvider: "anthropic",
    responses: { alpha: "Sure thing", beta: "As an AI language model..." },
    judgement: { scores: { alpha: 20, beta: 80 }, verdicts: { alpha: "good", beta: "bad" }, roast: "roast" },
    execution: {
      summary: { overallStatus: "success", phase: "complete" },
      models: {
        alpha: { status: "success", durationMs: 1200, retryCount: 0, fallbackUsed: false },
        beta: { status: "success", durationMs: 900, retryCount: 0, fallbackUsed: false },
      },
      policy: { retry: "standard", fallback: "none" },
    },
    timings: { judgeMs: 500, contestantMsByModel: { alpha: 1200, beta: 900 } },
    ...overrides,
  };
}

test("computeAnalyticsSummary aggregates runs correctly", function() {
  var rows = [
    makeRun({ crownModelId: "alpha", crownScore: 10 }),
    makeRun({ crownModelId: "beta", crownScore: 30, execution: { summary: { overallStatus: "partial_failure" }, models: {}, policy: {} } }),
  ];
  var s = computeAnalyticsSummary(rows);
  assert.equal(s.totalRuns, 2);
  assert.equal(s.successRuns, 1);
  assert.equal(s.partialFailureRuns, 1);
  assert.equal(s.failureRuns, 0);
  assert.equal(s.successRate, 50);
  assert.equal(s.avgCrownScore, 20);
  assert.equal(s.avgJudgeMs, 500);
  assert.ok(s.dailyTrend.length > 0);
  assert.ok(s.modelStats.length >= 2);
  assert.equal(s.recommendations.bestOverall.modelId, "beta");
});

test("computeFailureSummary categorizes failures", function() {
  var rows = [
    makeRun({ execution: { summary: { overallStatus: "failure", phase: "judge_parse" }, models: { alpha: { status: "error", error: "boom", errorCategory: "network", upstreamStatus: 502, retryCount: 1, fallbackUsed: true } }, policy: { retry: "standard", fallback: "litellm" } } }),
    makeRun(),
  ];
  var s = computeFailureSummary(rows);
  assert.equal(s.totalFailures, 1);
  assert.equal(s.byStatus.failure, 1);
  assert.equal(s.byModel.alpha, 1);
  assert.equal(s.byRetryPolicy["standard"], 1);
  assert.equal(s.byFallbackPolicy["litellm"], 1);
  assert.equal(s.totalRetryAttempts, 1);
  assert.equal(s.fallbackRuns, 1);
  assert.equal(s.judgePhases.judge_parse, 1);
  assert.ok(s.latestJudgeParseFailures.length > 0);
});

test("computePatternStats detects response patterns", function() {
  var rows = [
    makeRun({ responses: { alpha: "As an AI language model, I cannot provide that.", beta: "Sure!" } }),
  ];
  var s = computePatternStats(rows);
  var alpha = s.find(function(x) { return x.modelId === "alpha"; });
  assert.ok(alpha, "alpha present");
  assert.ok(alpha.patternRates.as_an_ai > 0, "detected as_an_ai");
  assert.ok(alpha.patternRates.cannot_provide > 0, "detected cannot_provide");
});

test("computePackStats aggregates by pack", function() {
  var rows = [makeRun({ pack: "bar" }), makeRun({ pack: "lab" })];
  var s = computePackStats(rows);
  assert.equal(s.length, 2);
  var bar = s.find(function(x) { return x.pack === "bar"; });
  assert.ok(bar);
  assert.equal(bar.runs, 1);
});

test("computeModeStats aggregates by mode", function() {
  var rows = [makeRun({ mode: "rage" }), makeRun({ mode: "absurd" })];
  var s = computeModeStats(rows);
  assert.equal(s.length, 2);
});

test("computeProviderHealth aggregates by provider", function() {
  var rows = [makeRun({ contestantProvider: "openrouter" }), makeRun({ contestantProvider: "anthropic" })];
  var s = computeProviderHealth(rows);
  assert.equal(s.length, 2);
});

test("computeResponseLengths calculates avg/min/max", function() {
  var rows = [
    makeRun({ responses: { alpha: "short", beta: "a much longer response here" } }),
  ];
  var s = computeResponseLengths(rows);
  var alpha = s.find(function(x) { return x.modelId === "alpha"; });
  assert.equal(alpha.minLength, 5);
  assert.equal(alpha.maxLength, 5);
  var beta = s.find(function(x) { return x.modelId === "beta"; });
  assert.ok(beta.avgLength > 10);
});

test("computeWinStreaks tracks max streak", function() {
  var rows = [
    makeRun({ crownModelId: "alpha" }),
    makeRun({ crownModelId: "alpha" }),
    makeRun({ crownModelId: "beta" }),
    makeRun({ crownModelId: "alpha" }),
  ];
  var s = computeWinStreaks(rows);
  var alpha = s.find(function(x) { return x.modelId === "alpha"; });
  assert.equal(alpha.maxStreak, 2);
  assert.equal(alpha.totalWins, 3);
});

test("computeBlindAlignment returns null pct with insufficient votes", function() {
  var s = computeBlindAlignment([]);
  assert.equal(s.alignmentPct, null);
  assert.ok(s.note.indexOf("30") !== -1);
});

test("computeBlindAlignment computes Wilson interval", function() {
  var rows = [];
  for (var i = 0; i < 40; i++) {
    rows.push(makeRun({
      execution: {
        blindMapping: { a: "alpha", b: "beta" },
        userVotes: { ["user" + i]: i < 30 ? "alpha" : "beta" },
      },
      crownModelId: "alpha",
    }));
  }
  var s = computeBlindAlignment(rows);
  assert.equal(s.totalVotes, 40);
  assert.equal(s.alignmentPct, 75);
  assert.ok(s.confidence.lower >= 60 && s.confidence.lower <= 80);
  assert.ok(s.confidence.upper >= 70 && s.confidence.upper <= 90);
});

test("computePromptTopics categorizes prompts", function() {
  var rows = [
    makeRun({ prompt: "Write a story about dragons" }),
    makeRun({ prompt: "Fix this Python bug" }),
    makeRun({ prompt: "Something random" }),
  ];
  var s = computePromptTopics(rows);
  assert.ok(s.find(function(x) { return x.topic === "creative"; }));
  assert.ok(s.find(function(x) { return x.topic === "coding"; }));
  assert.ok(s.find(function(x) { return x.topic === "other"; }));
});

test("computeCostForecast returns null for empty trend", function() {
  assert.equal(computeCostForecast([], {}), null);
});

test("computeCostForecast projects monthly spend", function() {
  var trend = [
    { estimatedSpendUsd: 1.2 },
    { estimatedSpendUsd: 0.8 },
  ];
  var s = computeCostForecast(trend, { monthlyUsd: 100 });
  assert.equal(s.avgDailySpend, 1.0);
  assert.equal(s.monthlyProjected, 30.0);
  assert.ok(s.daysUntilOver > 0);
});

test("computePromptDifficulty sorts by avg crown score", function() {
  var rows = [
    makeRun({ prompt: "easy", crownScore: 5 }),
    makeRun({ prompt: "hard", crownScore: 90 }),
  ];
  var s = computePromptDifficulty(rows);
  assert.equal(s[0].prompt, "easy");
  assert.equal(s[1].prompt, "hard");
});

test("computeHeadToHead builds pairwise stats", function() {
  var rows = [
    makeRun({ responses: { alpha: "a", beta: "b" }, crownModelId: "alpha" }),
    makeRun({ responses: { alpha: "a", beta: "b" }, crownModelId: "beta" }),
  ];
  var s = computeHeadToHead(rows);
  assert.equal(s.length, 1);
  assert.equal(s[0].modelA, "alpha");
  assert.equal(s[0].modelB, "beta");
  assert.equal(s[0].total, 2);
});

test("computeScoreVolatility calculates stdDev", function() {
  var rows = [
    makeRun({ judgement: { scores: { alpha: 10, beta: 90 } } }),
    makeRun({ judgement: { scores: { alpha: 20, beta: 80 } } }),
  ];
  var s = computeScoreVolatility(rows);
  var alpha = s.find(function(x) { return x.modelId === "alpha"; });
  assert.equal(alpha.avgScore, 15);
  assert.ok(alpha.stdDev >= 0);
});

test("computeContestantLatency aggregates durations", function() {
  var rows = [
    makeRun({ timings: { contestantMsByModel: { alpha: 1000, beta: 2000 } } }),
  ];
  var s = computeContestantLatency(rows);
  var alpha = s.find(function(x) { return x.modelId === "alpha"; });
  assert.equal(alpha.avgMs, 1000);
  assert.equal(alpha.minMs, 1000);
  assert.equal(alpha.maxMs, 1000);
});

test("computeUpsets detects underdog wins", function() {
  var rows = [
    makeRun({ responses: { alpha: "a", beta: "b" }, crownModelId: "alpha" }),
    makeRun({ responses: { alpha: "a", beta: "b" }, crownModelId: "alpha" }),
    makeRun({ responses: { alpha: "a", beta: "b" }, crownModelId: "beta" }),
  ];
  var s = computeUpsets(rows);
  assert.ok(s.length > 0, "found an upset");
  assert.equal(s[0].winner, "beta");
});

test("computeUserEngagement counts voters", function() {
  var rows = [
    makeRun({ execution: { userVotes: { alice: "alpha", bob: "beta" } } }),
    makeRun({ execution: { userVotes: { alice: "alpha", charlie: "alpha" } } }),
  ];
  var s = computeUserEngagement(rows);
  assert.equal(s.totalVotes, 4);
  assert.equal(s.uniqueVoters, 3);
  assert.equal(s.topVoters[0].voterId, "alice");
});

test("computeRetryRecovery calculates recovery rate", function() {
  var rows = [
    makeRun({ execution: { summary: { overallStatus: "success" }, models: { alpha: { status: "error", retryCount: 1, fallbackUsed: false } }, policy: { retry: "standard", fallback: "none" } } }),
  ];
  var s = computeRetryRecovery(rows);
  assert.equal(s.totalFailed, 1);
  assert.equal(s.totalRecovered, 1);
  assert.equal(s.recoveryRate, 100);
});

test("computePromptLengthVsScore groups by length", function() {
  var rows = [
    makeRun({ prompt: "short", crownScore: 10 }),
    makeRun({ prompt: "a".repeat(250), crownScore: 50 }),
  ];
  var s = computePromptLengthVsScore(rows);
  assert.ok(s.find(function(x) { return x.label === "0-50 chars"; }));
  assert.ok(s.find(function(x) { return x.label === "201-400 chars"; }));
});

test("RESPONSE_PATTERNS is non-empty array", function() {
  assert.ok(Array.isArray(RESPONSE_PATTERNS));
  assert.ok(RESPONSE_PATTERNS.length > 0);
});
