const express = require("express");

const _analysisRunServices = require("../lib/analysisRuns");
const _historyServices = require("../lib/history");
const _metricsServices = require("../lib/metrics");

function createAnalyticsRouter(deps) {
  const router = express.Router();

  const authMw = deps.authMiddleware;
  const analyticsAuth = deps.analyticsAuth;

  const buildRunFilters = deps.buildRunFilters || function(query) {
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
  };

  const getAnalysisFailureSummary = deps.getAnalysisFailureSummary || _analysisRunServices.getAnalysisFailureSummary;
  const getAnalysisAnalytics = deps.getAnalysisAnalytics || _analysisRunServices.getAnalysisAnalytics;
  const getAnalysisRunStats = deps.getAnalysisRunStats || _analysisRunServices.getAnalysisRunStats;
  const getHistoryStats = deps.getHistoryStats || _historyServices.getHistoryStats;
  const metrics = deps.metrics || _metricsServices.defaultStore;

  const getPatternStats = deps.getPatternStats || _analysisRunServices.getPatternStats;
  const getPackStats = deps.getPackStats || _analysisRunServices.getPackStats;
  const getModeStats = deps.getModeStats || _analysisRunServices.getModeStats;
  const getProviderHealth = deps.getProviderHealth || _analysisRunServices.getProviderHealth;
  const getResponseLengths = deps.getResponseLengths || _analysisRunServices.getResponseLengths;
  const getWinStreaks = deps.getWinStreaks || _analysisRunServices.getWinStreaks;
  const getBlindAlignment = deps.getBlindAlignment || _analysisRunServices.getBlindAlignment;
  const getPromptTopics = deps.getPromptTopics || _analysisRunServices.getPromptTopics;
  const getCostForecast = deps.getCostForecast || _analysisRunServices.getCostForecast;
  const getPromptDifficulty = deps.getPromptDifficulty || _analysisRunServices.getPromptDifficulty;
  const getHeadToHead = deps.getHeadToHead || _analysisRunServices.getHeadToHead;
  const getScoreVolatility = deps.getScoreVolatility || _analysisRunServices.getScoreVolatility;
  const getContestantLatency = deps.getContestantLatency || _analysisRunServices.getContestantLatency;
  const getUpsets = deps.getUpsets || _analysisRunServices.getUpsets;
  const getUserEngagement = deps.getUserEngagement || _analysisRunServices.getUserEngagement;
  const getRetryRecovery = deps.getRetryRecovery || _analysisRunServices.getRetryRecovery;
  const getPromptLengthVsScore = deps.getPromptLengthVsScore || _analysisRunServices.getPromptLengthVsScore;

  const _analyticsCache = deps._analyticsCache;
  const _failuresCache = deps._failuresCache;
  let _statsAnalyticsCache = deps._statsAnalyticsCache !== undefined ? deps._statsAnalyticsCache : null;
  let _statsAnalyticsCacheAt = deps._statsAnalyticsCacheAt !== undefined ? deps._statsAnalyticsCacheAt : 0;
  const STATS_ANALYTICS_TTL_MS = 30000;

  router.get("/api/failures/summary", authMw.requireAuth, analyticsAuth, function(req, res) {
    var filters = buildRunFilters(req.query);
    var cacheKey = JSON.stringify(filters);
    var cached = _failuresCache.get(cacheKey);
    if (cached !== undefined) {
      return res.json(cached);
    }
    var result = getAnalysisFailureSummary(filters);
    _failuresCache.set(cacheKey, result);
    res.json(result);
  });

  router.get("/api/analytics", authMw.requireAuth, analyticsAuth, function(req, res) {
    var filters = buildRunFilters(req.query);
    var cacheKey = JSON.stringify(filters);
    var cached = _analyticsCache.get(cacheKey);
    if (cached !== undefined) {
      return res.json(cached);
    }
    var result = getAnalysisAnalytics(filters);
    _analyticsCache.set(cacheKey, result);
    res.json(result);
  });

  // F6 — response pattern analytics
  router.get("/api/patterns", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: getPatternStats(buildRunFilters(req.query)) });
  });

  // Extended analytics endpoints
  router.get("/api/analytics/packs", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: getPackStats(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/modes", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: getModeStats(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/providers", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: getProviderHealth(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/response-lengths", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: getResponseLengths(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/win-streaks", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: getWinStreaks(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/blind-alignment", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getBlindAlignment(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/prompt-topics", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: getPromptTopics(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/cost-forecast", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getCostForecast(buildRunFilters(req.query)));
  });

  // Phase 2 analytics endpoints
  router.get("/api/analytics/prompt-difficulty", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getPromptDifficulty(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/head-to-head", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getHeadToHead(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/score-volatility", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getScoreVolatility(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/contestant-latency", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getContestantLatency(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/upsets", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getUpsets(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/user-engagement", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getUserEngagement(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/retry-recovery", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getRetryRecovery(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/prompt-length-vs-score", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json(getPromptLengthVsScore(buildRunFilters(req.query)));
  });

  router.get("/api/drift", authMw.requireAuth, analyticsAuth, function(req, res) {
    const { getModelDriftStats } = require("../lib/drift");
    const days = Number(req.query.days || 14);
    const threshold = Number(req.query.threshold || 15);
    res.json(getModelDriftStats(days, threshold));
  });

  router.get("/api/stats", authMw.requireAuth, analyticsAuth, function(req, res) {
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
        leaderboard: deps.historyStorageType || _historyServices.storageType,
        runs: deps.runStorageType || _analysisRunServices.storageType,
        sqliteDriver: require("../lib/sqlite").isWasm() ? "wasm" : "native",
      },
    });
  });

  return router;
}

module.exports = { createAnalyticsRouter };
