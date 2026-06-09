const express = require("express");

const _analysisRunServices = require("../lib/analysisRuns");
const _historyServices = require("../lib/history");
const _metricsServices = require("../lib/metrics");

function createAnalyticsRouter(deps) {
  const router = express.Router();

  const requireAdminAuth = deps.requireAdminAuth;

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

  router.get("/api/failures/summary", requireAdminAuth, function(req, res) {
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

  router.get("/api/analytics", requireAdminAuth, function(req, res) {
    var filters = buildRunFilters(req.query);
    var cacheKey = JSON.stringify(filters);
    var cached = _analyticsCache.get(cacheKey);
    var analytics = cached !== undefined ? cached : getAnalysisAnalytics(filters);
    if (cached === undefined) _analyticsCache.set(cacheKey, analytics);

    // ?full=true returns the composite payload previously served by /api/stats
    if (req.query.full === "true" || req.query.full === "1") {
      var now = Date.now();
      if (!_statsAnalyticsCache || now - _statsAnalyticsCacheAt > STATS_ANALYTICS_TTL_MS) {
        _statsAnalyticsCache = getAnalysisAnalytics();
        _statsAnalyticsCacheAt = now;
      }
      return res.json({
        analytics: analytics,
        app: metrics,
        history: getHistoryStats(),
        runs: getAnalysisRunStats(),
        failures: getAnalysisFailureSummary(),
        storage: {
          leaderboard: deps.historyStorageType || _historyServices.storageType,
          runs: deps.runStorageType || _analysisRunServices.storageType,
          sqliteDriver: require("../lib/sqlite").isWasm() ? "wasm" : "native",
        },
      });
    }

    res.json(analytics);
  });

  // Batch analytics — fetch multiple panels in one request
  router.post("/api/analytics/batch", requireAdminAuth, function(req, res) {
    var panels = Array.isArray(req.body.panels) ? req.body.panels : [];
    var filters = buildRunFilters(req.query);
    var result = {};

    panels.forEach(function(panel) {
      switch (panel) {
        case "trend":
        case "analytics":
          var cacheKey = JSON.stringify(filters);
          var cached = _analyticsCache.get(cacheKey);
          result.analytics = cached !== undefined ? cached : getAnalysisAnalytics(filters);
          if (cached === undefined) _analyticsCache.set(cacheKey, result.analytics);
          break;
        case "failures":
          var fKey = JSON.stringify(filters);
          var fCached = _failuresCache.get(fKey);
          result.failures = fCached !== undefined ? fCached : getAnalysisFailureSummary(filters);
          if (fCached === undefined) _failuresCache.set(fKey, result.failures);
          break;
        case "packs": result.packs = { items: getPackStats(filters) }; break;
        case "modes": result.modes = { items: getModeStats(filters) }; break;
        case "providers": result.providers = { items: getProviderHealth(filters) }; break;
        case "responseLengths": result.responseLengths = { items: getResponseLengths(filters) }; break;
        case "winStreaks": result.winStreaks = { items: getWinStreaks(filters) }; break;
        case "blindAlignment": result.blindAlignment = getBlindAlignment(filters); break;
        case "promptTopics": result.promptTopics = { items: getPromptTopics(filters) }; break;
        case "costForecast": result.costForecast = getCostForecast(filters); break;
        case "promptDifficulty": result.promptDifficulty = getPromptDifficulty(filters); break;
        case "headToHead": result.headToHead = getHeadToHead(filters); break;
        case "scoreVolatility": result.scoreVolatility = getScoreVolatility(filters); break;
        case "contestantLatency": result.contestantLatency = getContestantLatency(filters); break;
        case "upsets": result.upsets = getUpsets(filters); break;
        case "userEngagement": result.userEngagement = getUserEngagement(filters); break;
        case "retryRecovery": result.retryRecovery = getRetryRecovery(filters); break;
        case "promptLengthVsScore": result.promptLengthVsScore = getPromptLengthVsScore(filters); break;
        case "patterns": result.patterns = { items: getPatternStats(filters) }; break;
        case "stats":
          var now = Date.now();
          if (!_statsAnalyticsCache || now - _statsAnalyticsCacheAt > STATS_ANALYTICS_TTL_MS) {
            _statsAnalyticsCache = getAnalysisAnalytics();
            _statsAnalyticsCacheAt = now;
          }
          result.stats = {
            app: metrics,
            history: getHistoryStats(),
            runs: getAnalysisRunStats(),
            failures: getAnalysisFailureSummary(),
            analytics: _statsAnalyticsCache,
          };
          break;
      }
    });

    res.json(result);
  });

  // F6 — response pattern analytics
  router.get("/api/patterns", requireAdminAuth, function(req, res) {
    res.json({ items: getPatternStats(buildRunFilters(req.query)) });
  });

  // Extended analytics endpoints
  router.get("/api/analytics/packs", requireAdminAuth, function(req, res) {
    res.json({ items: getPackStats(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/modes", requireAdminAuth, function(req, res) {
    res.json({ items: getModeStats(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/providers", requireAdminAuth, function(req, res) {
    res.json({ items: getProviderHealth(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/response-lengths", requireAdminAuth, function(req, res) {
    res.json({ items: getResponseLengths(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/win-streaks", requireAdminAuth, function(req, res) {
    res.json({ items: getWinStreaks(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/blind-alignment", requireAdminAuth, function(req, res) {
    res.json(getBlindAlignment(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/prompt-topics", requireAdminAuth, function(req, res) {
    res.json({ items: getPromptTopics(buildRunFilters(req.query)) });
  });
  router.get("/api/analytics/cost-forecast", requireAdminAuth, function(req, res) {
    res.json(getCostForecast(buildRunFilters(req.query)));
  });

  // Phase 2 analytics endpoints
  router.get("/api/analytics/prompt-difficulty", requireAdminAuth, function(req, res) {
    res.json(getPromptDifficulty(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/head-to-head", requireAdminAuth, function(req, res) {
    res.json(getHeadToHead(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/score-volatility", requireAdminAuth, function(req, res) {
    res.json(getScoreVolatility(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/contestant-latency", requireAdminAuth, function(req, res) {
    res.json(getContestantLatency(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/upsets", requireAdminAuth, function(req, res) {
    res.json(getUpsets(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/user-engagement", requireAdminAuth, function(req, res) {
    res.json(getUserEngagement(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/retry-recovery", requireAdminAuth, function(req, res) {
    res.json(getRetryRecovery(buildRunFilters(req.query)));
  });
  router.get("/api/analytics/prompt-length-vs-score", requireAdminAuth, function(req, res) {
    res.json(getPromptLengthVsScore(buildRunFilters(req.query)));
  });

  router.get("/api/drift", requireAdminAuth, function(req, res) {
    const { getModelDriftStats } = require("../lib/drift");
    const days = Number(req.query.days || 14);
    const threshold = Number(req.query.threshold || 15);
    res.json(getModelDriftStats(days, threshold));
  });

  // Deprecated — use GET /api/analytics?full=true
  router.get("/api/stats", requireAdminAuth, function(req, res) {
    var now = Date.now();
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
