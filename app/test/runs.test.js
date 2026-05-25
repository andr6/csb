const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tempDir = fs.mkdtempSync("/tmp/csb-runs-test-");
const { createJsonAnalysisRunRepository } = require("../lib/repositories/jsonAnalysisRunRepository");
const { enrichAnalyticsSummary } = require("../lib/analysisRuns");

test("json analysis run repository writes and lists recent runs", function() {
  const repo = createJsonAnalysisRunRepository({
    filePath: path.join(tempDir, "analysis-runs.json"),
  });

  const first = repo.insertRun({
    prompt: "first prompt",
    responses: { alpha: "a" },
    judgement: { crown: "alpha" },
    crownModelId: "alpha",
    crownScore: 77,
    contestantProvider: "openrouter",
    judgeProvider: "anthropic",
    judgeModel: "claude-sonnet-4-5",
    timings: { contestantMsByModel: { alpha: 111 }, judgeMs: 90 },
    execution: { summary: { overallStatus: "partial_failure" }, models: { alpha: { status: "success" } }, policy: { retry: "none", fallback: "none" } },
    createdAt: "2026-04-23T00:00:00.000Z",
  });

  repo.insertRun({
    prompt: "second prompt",
    responses: { beta: "b" },
    judgement: { crown: "beta" },
    crownModelId: "beta",
    crownScore: 88,
    contestantProvider: "openrouter",
    judgeProvider: "anthropic",
    judgeModel: "claude-sonnet-4-5",
    timings: { contestantMsByModel: { beta: 222 }, judgeMs: 80 },
    execution: { summary: { overallStatus: "success" }, models: { beta: { status: "success" } }, policy: { retry: "none", fallback: "none" } },
    createdAt: "2026-04-23T00:00:01.000Z",
  });

  const rows = repo.listRecent();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].prompt, "second prompt");
  assert.equal(rows[1].prompt, "first prompt");
  assert.deepEqual(repo.getById(first.id), first);
  assert.equal(repo.listRecent({ query: "second" }).length, 1);
  assert.equal(repo.listRecent({ crownModelId: "alpha" }).length, 1);
  assert.equal(repo.listRecent({ status: "success" }).length, 1);
  assert.equal(repo.countRecent({ status: "partial_failure" }), 1);
  assert.equal(repo.countRecent({ contestantProvider: "openrouter" }), 2);
  assert.equal(repo.countRecent({ judgeProvider: "anthropic", dateFrom: "2026-04-23", dateTo: "2026-04-23" }), 2);
});

test("json analysis run repository reports aggregate stats", function() {
  const repo = createJsonAnalysisRunRepository({
    filePath: path.join(tempDir, "analysis-runs.json"),
  });
  const stats = repo.stats();

  assert.equal(stats.totalRuns, 2);
  assert.equal(stats.latestRunAt, "2026-04-23T00:00:01.000Z");
});

test("json analysis run repository produces analytics summary", function() {
  const analyticsFile = path.join(tempDir, "analysis-runs-analytics.json");
  const repo = createJsonAnalysisRunRepository({ filePath: analyticsFile });

  repo.insertRun({
    prompt: "analytics one",
    responses: { alpha: "a", beta: "b" },
    judgement: { scores: { alpha: 81, beta: 30 }, crown: "alpha" },
    crownModelId: "alpha",
    crownScore: 81,
    contestantProvider: "openrouter",
    judgeProvider: "anthropic",
    judgeModel: "claude-sonnet-4-5",
    timings: { judgeMs: 90 },
    execution: {
      summary: { overallStatus: "success" },
      models: {
        alpha: { status: "success", durationMs: 110 },
        beta: { status: "success", durationMs: 95 },
      },
    },
    createdAt: "2026-04-22T00:00:00.000Z",
  });

  repo.insertRun({
    prompt: "analytics two",
    responses: { alpha: "a", beta: "b" },
    judgement: { scores: { alpha: 55, beta: 88 }, crown: "beta" },
    crownModelId: "beta",
    crownScore: 88,
    contestantProvider: "openrouter",
    judgeProvider: "anthropic",
    judgeModel: "claude-sonnet-4-5",
    timings: { judgeMs: 120 },
    execution: {
      summary: { overallStatus: "partial_failure" },
      models: {
        alpha: { status: "success", durationMs: 115 },
        beta: { status: "error", durationMs: 140 },
      },
    },
    createdAt: "2026-04-23T00:00:00.000Z",
  });

  const summary = repo.analyticsSummary();
  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.successRuns, 1);
  assert.equal(summary.partialFailureRuns, 1);
  assert.equal(summary.avgCrownScore, 85);
  assert.equal(summary.avgJudgeMs, 105);
  assert.equal(summary.dailyTrend.length, 2);
  assert.equal(summary.modelStats[0].modelId, "alpha");
  assert.equal(summary.modelStats[1].modelId, "beta");
  assert.equal(summary.modelStats[1].wins, 1);
  assert.equal(summary.recommendations.bestOverall.modelId, "alpha");
  assert.equal(summary.recommendations.fastest.modelId, "alpha");
  assert.equal(summary.recommendations.bestValue, null); // set by enrichment layer, not raw summary
  assert.equal(summary.recommendations.rotationCandidates.length, 0);
});

test("analysis analytics enrichment adds spend and budget guidance", function() {
  const enriched = enrichAnalyticsSummary({
    totalRuns: 2,
    successRuns: 2,
    partialFailureRuns: 0,
    failureRuns: 0,
    successRate: 100,
    avgCrownScore: 84,
    avgJudgeMs: 105,
    dailyTrend: [
      { date: "2026-04-22", runs: 1, successRate: 100, avgCrownScore: 81, modelUsage: { alpha: 1, beta: 1 } },
      { date: "2026-04-23", runs: 1, successRate: 100, avgCrownScore: 88, modelUsage: { alpha: 1 } },
    ],
    modelStats: [
      { modelId: "alpha", appearances: 2, avgScore: 80, wins: 1, winRate: 50, reliability: 100, avgDurationMs: 112 },
      { modelId: "beta", appearances: 1, avgScore: 40, wins: 0, winRate: 0, reliability: 100, avgDurationMs: 95 },
    ],
    recommendations: {
      bestOverall: { modelId: "alpha", appearances: 2, avgScore: 80, wins: 1, winRate: 50, reliability: 100, avgDurationMs: 112 },
      mostReliable: { modelId: "alpha", appearances: 2, avgScore: 80, wins: 1, winRate: 50, reliability: 100, avgDurationMs: 112 },
      fastest: { modelId: "beta", appearances: 1, avgScore: 40, wins: 0, winRate: 0, reliability: 100, avgDurationMs: 95 },
      bestValue: { modelId: "beta", appearances: 1, avgScore: 40, wins: 0, winRate: 0, reliability: 100, avgDurationMs: 95 },
      rotationCandidates: [],
    },
  }, {
    modelPricing: { alpha: 0.25, beta: 0.05 },
    judgePriceUsd: 0.1,
    budgets: { sliceUsd: 1, dailyUsd: 0.5, monthlyUsd: 10 },
    policy: { minReliabilityPct: 90, maxUnitCostUsd: 0.1, minScorePerDollar: 100, minAvgScore: 60 },
    modelMap: { alpha: "alpha", beta: "beta" },
  });

  assert.equal(enriched.contestantSpendUsd, 0.55);
  assert.equal(enriched.judgeSpendUsd, 0.2);
  assert.equal(enriched.estimatedSpendUsd, 0.75);
  assert.equal(enriched.avgRunSpendUsd, 0.38);
  assert.equal(enriched.modelStats[0].unitCostUsd, 0.25);
  assert.equal(enriched.modelStats[0].estimatedSpendUsd, 0.5);
  assert.equal(enriched.modelStats[0].scorePerDollar, 320);
  assert.equal(enriched.dailyTrend[0].estimatedSpendUsd, 0.4);
  assert.equal(enriched.dailyTrend[1].estimatedSpendUsd, 0.35);
  assert.equal(enriched.budget.slice.status, "ok");
  assert.equal(enriched.budget.monthlyProjected.status, "over");
  assert.equal(enriched.policy.thresholds.minReliabilityPct, 90);
  assert.equal(enriched.policy.thresholds.maxUnitCostUsd, 0.1);
  assert.equal(enriched.policy.counts.promote, 0);
  assert.equal(enriched.policy.counts.hold, 1);
  assert.equal(enriched.policy.counts.demote, 1);
  assert.equal(enriched.policy.hold[0].modelId, "alpha");
  assert.equal(enriched.policy.demote[0].modelId, "beta");
  assert.deepEqual(enriched.policy.hold[0].policyReasons, ["cost"]);
  assert.deepEqual(enriched.policy.demote[0].policyReasons, ["quality"]);
  assert.equal(enriched.planning.spendLeaders[0].modelId, "alpha");
  assert.equal(enriched.planning.lineups.activeSet[0].modelId, "alpha");
  assert.equal(enriched.planning.lineups.activeSet[1].modelId, "beta");
  assert.equal(enriched.planning.lineups.fallbackSet.length, 1);
  assert.equal(enriched.planning.lineups.retireSet[0].modelId, "beta");
  assert.equal(enriched.planning.scenarios.defaultChoice.totalCostUsd, 15);
  assert.equal(enriched.planning.scenarios.cheapFallback.totalCostUsd, 15);
  assert.equal(enriched.recommendations.defaultChoice.modelId, "beta");
  assert.equal(enriched.recommendations.cheapFallback.modelId, "beta");
  assert.equal(enriched.recommendations.cheapestReliable.modelId, "beta");
  assert.equal(enriched.recommendations.spendLeader.modelId, "alpha");
  assert.equal(enriched.recommendations.promote, null);
  assert.equal(enriched.recommendations.hold.modelId, "alpha");
  assert.equal(enriched.recommendations.demote.modelId, "beta");
  assert.equal(enriched.recommendations.activeSet.length, 2);
  assert.equal(enriched.recommendations.retireSet[0].modelId, "beta");
  assert.equal(enriched.recommendations.premiumChoice, null);
});

test("json analysis run repository aggregates failure details", function() {
  const failureFile = path.join(tempDir, "analysis-runs-failure.json");
  const repo = createJsonAnalysisRunRepository({ filePath: failureFile });

  repo.insertRun({
    prompt: "broken judge output",
    responses: { alpha: "a" },
    judgement: { error: "bad json", phase: "judge_parse", rawJudge: "{oops" },
    contestantProvider: "openrouter",
    judgeProvider: "anthropic",
    judgeModel: "claude-sonnet-4-5",
    execution: {
      summary: { overallStatus: "failure", phase: "judge_parse" },
      models: { alpha: { status: "error", error: "timeout", errorCategory: "timeout", upstreamStatus: 408, retryCount: 2, fallbackUsed: true } },
      judge: { status: "error", error: "bad json", errorCategory: "judge_parse", upstreamStatus: 500 },
      policy: { retry: "simple_retry", fallback: "backup_judge" },
    },
    createdAt: "2026-04-23T00:00:02.000Z",
  });

  const summary = repo.failureSummary();
  assert.equal(summary.totalFailures, 1);
  assert.deepEqual(summary.byStatus, { failure: 1 });
  assert.deepEqual(summary.byModel, { alpha: 1 });
  assert.deepEqual(summary.byContestantProvider, { openrouter: 1 });
  assert.deepEqual(summary.byJudgeProvider, { anthropic: 1 });
  assert.deepEqual(summary.judgePhases, { judge_parse: 1 });
  assert.deepEqual(summary.errorMessages, { timeout: 1, "bad json": 1 });
  assert.deepEqual(summary.errorCategories, { timeout: 1, judge_parse: 1 });
  assert.deepEqual(summary.upstreamStatuses, { 408: 1, 500: 1 });
  assert.deepEqual(summary.byRetryPolicy, { simple_retry: 1 });
  assert.deepEqual(summary.byFallbackPolicy, { backup_judge: 1 });
  assert.equal(summary.totalRetryAttempts, 2);
  assert.equal(summary.fallbackRuns, 1);
  assert.equal(summary.latestJudgeParseFailures.length, 1);
  assert.equal(summary.latestJudgeParseFailures[0].rawJudge, "{oops");
  assert.equal(repo.failureSummary({ failedModelId: "alpha", phase: "judge_parse", dateFrom: "2026-04-23", dateTo: "2026-04-23" }).totalFailures, 1);
  assert.equal(repo.failureSummary({ failedModelId: "beta" }).totalFailures, 0);
});
