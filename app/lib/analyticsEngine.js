function computeAnalyticsSummary(rows, opts) {
  const summary = {
    totalRuns: rows.length,
    successRuns: 0,
    partialFailureRuns: 0,
    failureRuns: 0,
    successRate: 0,
    avgCrownScore: 0,
    avgJudgeMs: 0,
    dailyTrend: [],
    modelStats: [],
    recommendations: {
      bestOverall: null,
      mostReliable: null,
      fastest: null,
      bestValue: null,
      rotationCandidates: [],
    },
  };
  let crownScoreTotal = 0;
  let crownScoreCount = 0;
  let judgeMsTotal = 0;
  let judgeMsCount = 0;
  const trendMap = {};
  const modelMap = {};

  function ensureModel(modelId) {
    if (!modelMap[modelId]) {
      modelMap[modelId] = {
        modelId: modelId,
        appearances: 0,
        scoredRuns: 0,
        totalScore: 0,
        wins: 0,
        failures: 0,
        durationTotal: 0,
        durationCount: 0,
      };
    }
    return modelMap[modelId];
  }

  rows.forEach(function(run) {
    const overallStatus = run.execution && run.execution.summary && run.execution.summary.overallStatus || "unknown";
    const dateKey = String(run.createdAt || "").slice(0, 10) || "unknown";
    const trend = trendMap[dateKey] || { date: dateKey, runs: 0, successRuns: 0, crownScoreTotal: 0, crownScoreCount: 0, modelUsage: {} };
    trend.runs += 1;

    if (overallStatus === "success") {
      summary.successRuns += 1;
      trend.successRuns += 1;
    } else if (overallStatus === "partial_failure") {
      summary.partialFailureRuns += 1;
    } else if (overallStatus === "failure") {
      summary.failureRuns += 1;
    }

    if (run.crownModelId) {
      crownScoreTotal += Number(run.crownScore || 0);
      crownScoreCount += 1;
      trend.crownScoreTotal += Number(run.crownScore || 0);
      trend.crownScoreCount += 1;
      const winner = ensureModel(run.crownModelId);
      winner.wins += 1;
    }

    if (run.timings && run.timings.judgeMs) {
      judgeMsTotal += Number(run.timings.judgeMs || 0);
      judgeMsCount += 1;
    }

    const scoreMap = run.judgement && run.judgement.scores ? run.judgement.scores : {};
    const seenModels = {};
    Object.keys(scoreMap).forEach(function(modelId) {
      const stat = ensureModel(modelId);
      stat.appearances += 1;
      stat.scoredRuns += 1;
      stat.totalScore += Number(scoreMap[modelId] || 0);
      seenModels[modelId] = true;
    });

    const executionModels = run.execution && run.execution.models ? run.execution.models : {};
    Object.keys(executionModels).forEach(function(modelId) {
      const stat = ensureModel(modelId);
      if (!scoreMap[modelId]) {
        stat.appearances += 1;
      }
      if (executionModels[modelId].status && executionModels[modelId].status !== "success") {
        stat.failures += 1;
      }
      if (executionModels[modelId].durationMs !== undefined && executionModels[modelId].durationMs !== null) {
        stat.durationTotal += Number(executionModels[modelId].durationMs || 0);
        stat.durationCount += 1;
      }
      seenModels[modelId] = true;
    });

    Object.keys(seenModels).forEach(function(modelId) {
      trend.modelUsage[modelId] = (trend.modelUsage[modelId] || 0) + 1;
    });

    trendMap[dateKey] = trend;
  });

  summary.successRate = summary.totalRuns ? Math.round((summary.successRuns / summary.totalRuns) * 100) : 0;
  summary.avgCrownScore = crownScoreCount ? Math.round(crownScoreTotal / crownScoreCount) : 0;
  summary.avgJudgeMs = judgeMsCount ? Math.round(judgeMsTotal / judgeMsCount) : 0;
  const trendDays = (opts && opts.trendDays) ? Number(opts.trendDays) : 7;
  summary.dailyTrend = Object.keys(trendMap).sort().slice(-trendDays).map(function(dateKey) {
    const trend = trendMap[dateKey];
    return {
      date: trend.date,
      runs: trend.runs,
      successRate: trend.runs ? Math.round((trend.successRuns / trend.runs) * 100) : 0,
      avgCrownScore: trend.crownScoreCount ? Math.round(trend.crownScoreTotal / trend.crownScoreCount) : 0,
      modelUsage: trend.modelUsage,
    };
  });
  summary.modelStats = Object.keys(modelMap).map(function(modelId) {
    const stat = modelMap[modelId];
    return {
      modelId: modelId,
      appearances: stat.appearances,
      avgScore: stat.scoredRuns ? Math.round(stat.totalScore / stat.scoredRuns) : 0,
      wins: stat.wins,
      winRate: stat.appearances ? Math.round((stat.wins / stat.appearances) * 100) : 0,
      reliability: stat.appearances ? Math.round(((stat.appearances - stat.failures) / stat.appearances) * 100) : 100,
      avgDurationMs: stat.durationCount ? Math.round(stat.durationTotal / stat.durationCount) : 0,
    };
  }).sort(function(a, b) {
    return b.avgScore - a.avgScore || b.wins - a.wins;
  });

  if (summary.modelStats.length) {
    const byReliability = summary.modelStats.slice().sort(function(a, b) {
      return b.reliability - a.reliability || b.avgScore - a.avgScore;
    });
    const bySpeed = summary.modelStats.slice().filter(function(item) {
      return item.avgDurationMs > 0;
    }).sort(function(a, b) {
      return a.avgDurationMs - b.avgDurationMs || b.avgScore - a.avgScore;
    });

    summary.recommendations.bestOverall = summary.modelStats[0];
    summary.recommendations.mostReliable = byReliability[0] || null;
    summary.recommendations.fastest = bySpeed[0] || null;
    summary.recommendations.rotationCandidates = summary.modelStats.filter(function(item) {
      return item.appearances >= 2 && item.reliability < 90 && item.winRate < 25;
    }).slice(0, 3);
  }

  return summary;
}

function computeFailureSummary(rows) {
  const failedRuns = (rows || []).filter(function(run) {
    const status = run.execution && run.execution.summary ? run.execution.summary.overallStatus : "";
    return status && status !== "success";
  });

  const summary = {
    totalFailures: failedRuns.length,
    byStatus: {},
    byModel: {},
    byContestantProvider: {},
    byJudgeProvider: {},
    judgePhases: {},
    errorMessages: {},
    errorCategories: {},
    upstreamStatuses: {},
    latestJudgeParseFailures: [],
    byRetryPolicy: {},
    byFallbackPolicy: {},
    totalRetryAttempts: 0,
    fallbackRuns: 0,
  };

  function recordError(message) {
    const key = String(message || "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (!key) return;
    summary.errorMessages[key] = (summary.errorMessages[key] || 0) + 1;
  }

  function recordCategory(category) {
    const key = String(category || "").trim();
    if (!key) return;
    summary.errorCategories[key] = (summary.errorCategories[key] || 0) + 1;
  }

  function recordUpstreamStatus(status) {
    const key = String(Number(status || 0) || 0);
    if (key === "0") return;
    summary.upstreamStatuses[key] = (summary.upstreamStatuses[key] || 0) + 1;
  }

  failedRuns.forEach(function(run) {
    var judgement = run.judgement || {};
    var execution = run.execution || {};
    var overallStatus = execution && execution.summary ? execution.summary.overallStatus : "";
    var phase = (execution && execution.summary && execution.summary.phase) || judgement.phase || "";
    var policy = execution && execution.policy ? execution.policy : {};
    if (overallStatus) {
      summary.byStatus[overallStatus] = (summary.byStatus[overallStatus] || 0) + 1;
    }
    if (phase) {
      summary.judgePhases[phase] = (summary.judgePhases[phase] || 0) + 1;
    }
    if (run.contestantProvider) {
      summary.byContestantProvider[run.contestantProvider] = (summary.byContestantProvider[run.contestantProvider] || 0) + 1;
    }
    if (run.judgeProvider) {
      summary.byJudgeProvider[run.judgeProvider] = (summary.byJudgeProvider[run.judgeProvider] || 0) + 1;
    }
    var models = execution && execution.models ? execution.models : {};
    Object.keys(models).forEach(function(modelId) {
      if (models[modelId] && models[modelId].status && models[modelId].status !== "success") {
        summary.byModel[modelId] = (summary.byModel[modelId] || 0) + 1;
        recordError(models[modelId].error);
        recordCategory(models[modelId].errorCategory);
        recordUpstreamStatus(models[modelId].upstreamStatus);
        summary.totalRetryAttempts += Number(models[modelId].retryCount || 0);
        if (models[modelId].fallbackUsed) {
          summary.fallbackRuns += 1;
        }
      }
    });
    if (execution && execution.judge && execution.judge.status === "error") {
      recordError(execution.judge.error);
      recordCategory(execution.judge.errorCategory);
      recordUpstreamStatus(execution.judge.upstreamStatus);
    }
    if (policy.retry) {
      summary.byRetryPolicy[policy.retry] = (summary.byRetryPolicy[policy.retry] || 0) + 1;
    }
    if (policy.fallback) {
      summary.byFallbackPolicy[policy.fallback] = (summary.byFallbackPolicy[policy.fallback] || 0) + 1;
    }
    if (phase === "judge_parse") {
      summary.latestJudgeParseFailures.push({
        id: String(run.id),
        prompt: String(run.prompt || "").slice(0, 160),
        error: String(judgement.error || (execution && execution.judge && execution.judge.error) || ""),
        rawJudge: String(judgement.rawJudge || "").slice(0, 240),
        createdAt: run.createdAt,
      });
    }
  });

  summary.latestJudgeParseFailures.sort(function(a, b) {
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  summary.latestJudgeParseFailures = summary.latestJudgeParseFailures.slice(0, 5);

  return summary;
}

var RESPONSE_PATTERNS = [
  { key: "as_an_ai",       pattern: /as an ai|as a language model|i'm an ai/i },
  { key: "cannot_provide", pattern: /i cannot provide|i can't provide|unable to provide/i },
  { key: "important_note", pattern: /it's important to note|important to note|please note/i },
  { key: "certainly",      pattern: /certainly!|absolutely!|of course!/i },
  { key: "happy_to_help",  pattern: /happy to help|glad to help|i'd be happy/i },
  { key: "understand",     pattern: /i understand you're asking|i understand that you/i },
  { key: "disclaimer",     pattern: /i cannot|i can't|i'm unable|i should note/i },
];

function computePatternStats(rows) {
  const modelMap = {};

  rows.forEach(function(run) {
    const responses = run.responses && typeof run.responses === "object" ? run.responses : {};
    Object.keys(responses).forEach(function(modelId) {
      if (!modelMap[modelId]) {
        modelMap[modelId] = { appearances: 0, anyHit: 0, hits: {} };
      }
      const text = String(responses[modelId] || "");
      modelMap[modelId].appearances += 1;
      var firedAny = false;
      RESPONSE_PATTERNS.forEach(function(p) {
        if (p.pattern.test(text)) {
          modelMap[modelId].hits[p.key] = (modelMap[modelId].hits[p.key] || 0) + 1;
          firedAny = true;
        }
      });
      if (firedAny) modelMap[modelId].anyHit += 1;
    });
  });

  return Object.keys(modelMap).map(function(modelId) {
    const stat = modelMap[modelId];
    const patternRates = {};
    RESPONSE_PATTERNS.forEach(function(p) {
      patternRates[p.key] = stat.appearances
        ? Math.round(((stat.hits[p.key] || 0) / stat.appearances) * 100)
        : 0;
    });
    const anyPatternRate = stat.appearances
      ? Math.round((stat.anyHit / stat.appearances) * 100)
      : 0;
    const dominantPattern = RESPONSE_PATTERNS.reduce(function(best, p) {
      return (patternRates[p.key] || 0) > (patternRates[best.key] || 0) ? p : best;
    }, RESPONSE_PATTERNS[0]).key;
    return { modelId: modelId, appearances: stat.appearances, patternRates: patternRates, anyPatternRate: anyPatternRate, dominantPattern: dominantPattern };
  }).sort(function(a, b) { return b.anyPatternRate - a.anyPatternRate; });
}

module.exports = {
  computeAnalyticsSummary,
  computeFailureSummary,
  computePatternStats,
  RESPONSE_PATTERNS,
};
