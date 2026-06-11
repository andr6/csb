const { createAnalysisRunRepository } = require("./repositories/analysisRunRepository");
const { markFailure, markSuccess } = require("./repositoryHealth");
const {
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
} = require("./analyticsEngine");
const {
  MODEL_MAP,
  MODEL_PRICING_USD,
  JUDGE_PRICE_USD,
  ANALYTICS_BUDGETS,
  ANALYTICS_POLICY,
} = require("./config");

const runRepository = createAnalysisRunRepository();

function roundNumber(value, digits) {
  const factor = Math.pow(10, digits || 0);
  return Math.round(Number(value || 0) * factor) / factor;
}

function detectCostBand(unitCostUsd) {
  if (unitCostUsd <= 0.2) return "cheap";
  if (unitCostUsd >= 1) return "premium";
  return "standard";
}

function buildCostFromHeuristics(modelId, modelMap) {
  const model = String((modelMap && modelMap[modelId]) || modelId || "").toLowerCase();
  const premiumSignals = [/opus/, /gpt-5/, /gpt-4\.5/, /gpt-4\.1/, /sonnet-4/, /ultra/, /pro\b/, /gemini-2\.0-pro/, /gemini-1\.5-pro/];
  const cheapSignals = [/mini/, /haiku/, /flash/, /nano/, /small/, /lite/, /gemma/, /gemini-flash/];

  if (premiumSignals.some(function(pattern) { return pattern.test(model); })) {
    return { band: "premium", index: 3, unitCostUsd: roundNumber(1.5, 1), source: "heuristic" };
  }
  if (cheapSignals.some(function(pattern) { return pattern.test(model); })) {
    return { band: "cheap", index: 1, unitCostUsd: roundNumber(0.1, 1), source: "heuristic" };
  }
  return { band: "standard", index: 2, unitCostUsd: roundNumber(0.5, 1), source: "heuristic" };
}

function estimateCostProfile(modelId, options) {
  const modelPricing = options && options.modelPricing ? options.modelPricing : MODEL_PRICING_USD;
  const modelMap = options && options.modelMap ? options.modelMap : MODEL_MAP;
  const configuredCost = modelPricing && modelPricing[modelId];
  if (configuredCost !== undefined && configuredCost !== null) {
    return {
      band: detectCostBand(configuredCost),
      index: configuredCost <= 0.2 ? 1 : configuredCost >= 1 ? 3 : 2,
      unitCostUsd: roundNumber(configuredCost, 2),
      source: "configured",
    };
  }
  return buildCostFromHeuristics(modelId, modelMap);
}

function calculateSpendFromUsage(modelUsage, options) {
  const usage = modelUsage || {};
  return roundNumber(Object.keys(usage).reduce(function(total, modelId) {
    const cost = estimateCostProfile(modelId, options);
    return total + (Number(usage[modelId] || 0) * cost.unitCostUsd);
  }, 0), 2);
}

function buildBudgetStatus(limitUsd, spendUsd) {
  if (limitUsd === null || limitUsd === undefined) {
    return null;
  }
  const remainingUsd = roundNumber(limitUsd - spendUsd, 2);
  const utilizationPct = limitUsd ? Math.round((spendUsd / limitUsd) * 100) : 0;
  return {
    limitUsd: roundNumber(limitUsd, 2),
    spendUsd: roundNumber(spendUsd, 2),
    remainingUsd: remainingUsd,
    utilizationPct: utilizationPct,
    status: utilizationPct >= 100 ? "over" : utilizationPct >= 85 ? "near" : "ok",
  };
}

function enrichModelStat(stat, options) {
  const cost = estimateCostProfile(stat.modelId, options);
  const estimatedSpendUsd = roundNumber(Number(stat.appearances || 0) * cost.unitCostUsd, 2);
  return {
    ...stat,
    costBand: cost.band,
    estimatedCostIndex: cost.index,
    unitCostUsd: cost.unitCostUsd,
    costSource: cost.source,
    estimatedSpendUsd: estimatedSpendUsd,
    scorePerDollar: cost.unitCostUsd ? roundNumber(Number(stat.avgScore || 0) / cost.unitCostUsd, 1) : 0,
  };
}

function buildScenario(choice, runs, judgeUnitCostUsd) {
  if (!choice) return null;
  const contestantCostUsd = roundNumber(Number(choice.unitCostUsd || 0) * runs, 2);
  const judgeCost = judgeUnitCostUsd ? roundNumber(judgeUnitCostUsd * runs, 2) : 0;
  return {
    modelId: choice.modelId,
    runs: runs,
    contestantCostUsd: contestantCostUsd,
    judgeCostUsd: judgeCost,
    totalCostUsd: roundNumber(contestantCostUsd + judgeCost, 2),
    expectedScorePoints: roundNumber(Number(choice.avgScore || 0) * runs, 1),
    expectedWins: roundNumber((Number(choice.winRate || 0) / 100) * runs, 1),
  };
}

function uniqueByModel(items) {
  const seen = {};
  return (items || []).filter(function(item) {
    if (!item || !item.modelId || seen[item.modelId]) {
      return false;
    }
    seen[item.modelId] = true;
    return true;
  });
}

function classifyModelPolicy(stat, policy) {
  const reasons = [];
  if (Number(stat.reliability || 0) < Number(policy.minReliabilityPct || 0)) {
    reasons.push("reliability");
  }
  if (Number(stat.unitCostUsd || 0) > Number(policy.maxUnitCostUsd || 0)) {
    reasons.push("cost");
  }
  if (Number(stat.scorePerDollar || 0) < Number(policy.minScorePerDollar || 0)) {
    reasons.push("value");
  }
  if (Number(stat.avgScore || 0) < Number(policy.minAvgScore || 0)) {
    reasons.push("quality");
  }
  return {
    ...stat,
    policyAction: reasons.length ? (reasons.indexOf("reliability") >= 0 || reasons.indexOf("quality") >= 0 ? "demote" : "hold") : "promote",
    policyReasons: reasons,
  };
}

function enrichAnalyticsSummary(summary, options) {
  const opts = options || {};
  const judgeUnitCostUsd = opts.judgePriceUsd !== undefined ? opts.judgePriceUsd : JUDGE_PRICE_USD;
  const budgets = opts.budgets || ANALYTICS_BUDGETS;
  const policy = opts.policy || ANALYTICS_POLICY;
  const modelStats = Array.isArray(summary.modelStats)
    ? summary.modelStats.map(function(item) { return enrichModelStat(item, opts); })
    : [];
  const policyEvaluations = modelStats.map(function(item) {
    return classifyModelPolicy(item, policy);
  });
  const cheapModels = modelStats.filter(function(item) { return item.costBand === "cheap"; });
  const premiumModels = modelStats.filter(function(item) { return item.costBand === "premium"; });
  const standardOrBetter = modelStats.filter(function(item) { return item.reliability >= 85; });
  const reliableModels = modelStats.filter(function(item) { return item.reliability >= 90; });
  const contestantSpendUsd = roundNumber(modelStats.reduce(function(total, item) {
    return total + Number(item.estimatedSpendUsd || 0);
  }, 0), 2);
  const judgeSpendUsd = judgeUnitCostUsd ? roundNumber(Number(summary.totalRuns || 0) * judgeUnitCostUsd, 2) : 0;
  const estimatedSpendUsd = roundNumber(contestantSpendUsd + judgeSpendUsd, 2);
  const avgRunSpendUsd = summary.totalRuns ? roundNumber(estimatedSpendUsd / summary.totalRuns, 2) : 0;
  const dailyTrend = Array.isArray(summary.dailyTrend) ? summary.dailyTrend.map(function(item) {
    const contestantDaySpendUsd = calculateSpendFromUsage(item.modelUsage, opts);
    const judgeDaySpendUsd = judgeUnitCostUsd ? roundNumber(Number(item.runs || 0) * judgeUnitCostUsd, 2) : 0;
    return {
      ...item,
      contestantSpendUsd: contestantDaySpendUsd,
      judgeSpendUsd: judgeDaySpendUsd,
      estimatedSpendUsd: roundNumber(contestantDaySpendUsd + judgeDaySpendUsd, 2),
    };
  }) : [];
  const averageDailySpendUsd = dailyTrend.length
    ? roundNumber(dailyTrend.reduce(function(total, item) { return total + Number(item.estimatedSpendUsd || 0); }, 0) / dailyTrend.length, 2)
    : 0;
  const latestTrend = dailyTrend.length ? dailyTrend[dailyTrend.length - 1] : null;

  function byValue(items) {
    return items.slice().sort(function(a, b) {
      return b.scorePerDollar - a.scorePerDollar || b.reliability - a.reliability || b.avgScore - a.avgScore;
    });
  }

  const defaultChoice = byValue(standardOrBetter.length ? standardOrBetter : modelStats)[0] || null;
  const cheapFallback = byValue(cheapModels)[0] || defaultChoice;
  const premiumChoice = premiumModels.slice().sort(function(a, b) {
    return b.avgScore - a.avgScore || b.reliability - a.reliability;
  })[0] || null;
  const spendLeaders = modelStats.slice().sort(function(a, b) {
    return Number(b.estimatedSpendUsd || 0) - Number(a.estimatedSpendUsd || 0) || b.avgScore - a.avgScore;
  }).slice(0, 3).map(function(item) {
    return {
      ...item,
      spendSharePct: contestantSpendUsd ? Math.round((Number(item.estimatedSpendUsd || 0) / contestantSpendUsd) * 100) : 0,
    };
  });
  const cheapestReliable = reliableModels.slice().sort(function(a, b) {
    return Number(a.unitCostUsd || 0) - Number(b.unitCostUsd || 0) || b.avgScore - a.avgScore;
  })[0] || defaultChoice;
  const budgetRiskModels = modelStats.filter(function(item) {
    return Number(item.estimatedSpendUsd || 0) >= 1 && item.scorePerDollar < 100;
  }).sort(function(a, b) {
    return Number(b.estimatedSpendUsd || 0) - Number(a.estimatedSpendUsd || 0) || a.scorePerDollar - b.scorePerDollar;
  }).slice(0, 3);
  const promoteModels = policyEvaluations.filter(function(item) { return item.policyAction === "promote"; });
  const holdModels = policyEvaluations.filter(function(item) { return item.policyAction === "hold"; });
  const demoteModels = policyEvaluations.filter(function(item) { return item.policyAction === "demote"; });
  const policySummary = {
    thresholds: {
      minReliabilityPct: Number(policy.minReliabilityPct || 0),
      maxUnitCostUsd: Number(policy.maxUnitCostUsd || 0),
      minScorePerDollar: Number(policy.minScorePerDollar || 0),
      minAvgScore: Number(policy.minAvgScore || 0),
    },
    counts: {
      promote: promoteModels.length,
      hold: holdModels.length,
      demote: demoteModels.length,
    },
    promote: promoteModels.slice().sort(function(a, b) {
      return b.scorePerDollar - a.scorePerDollar || b.reliability - a.reliability || b.avgScore - a.avgScore;
    }).slice(0, 3),
    hold: holdModels.slice().sort(function(a, b) {
      return Number(a.unitCostUsd || 0) - Number(b.unitCostUsd || 0) || b.avgScore - a.avgScore;
    }).slice(0, 3),
    demote: demoteModels.slice().sort(function(a, b) {
      return Number(b.estimatedSpendUsd || 0) - Number(a.estimatedSpendUsd || 0) || Number(a.reliability || 0) - Number(b.reliability || 0);
    }).slice(0, 3),
  };
  const scenarioRuns = (opts.scenarioRuns != null) ? Math.max(1, Math.min(10000, Number(opts.scenarioRuns))) : 100;
  const activeSet = uniqueByModel(
    policySummary.promote
      .concat(policySummary.hold)
      .concat([defaultChoice, cheapestReliable, premiumChoice])
  ).slice(0, 3);
  const fallbackSet = uniqueByModel(
    cheapModels
      .slice()
      .sort(function(a, b) {
        return b.scorePerDollar - a.scorePerDollar || b.reliability - a.reliability || b.avgScore - a.avgScore;
      })
      .filter(function(item) {
        return !activeSet.some(function(active) { return active.modelId === item.modelId; });
      })
      .concat([cheapFallback])
  ).slice(0, 2);
  const retireSet = uniqueByModel(
    policySummary.demote
      .concat(summary.recommendations && Array.isArray(summary.recommendations.rotationCandidates)
        ? summary.recommendations.rotationCandidates.map(function(item) { return enrichModelStat(item, opts); })
        : [])
  ).slice(0, 3);

  return {
    ...summary,
    dailyTrend: dailyTrend,
    modelStats: policyEvaluations,
    contestantSpendUsd: contestantSpendUsd,
    judgeSpendUsd: judgeSpendUsd,
    estimatedSpendUsd: estimatedSpendUsd,
    avgRunSpendUsd: avgRunSpendUsd,
    pricing: {
      configuredModelCount: Object.keys(opts.modelPricing || MODEL_PRICING_USD).length,
      judgeUnitCostUsd: judgeUnitCostUsd,
    },
    budget: {
      slice: buildBudgetStatus(budgets.sliceUsd, estimatedSpendUsd),
      daily: buildBudgetStatus(budgets.dailyUsd, latestTrend ? latestTrend.estimatedSpendUsd : 0),
      monthlyProjected: buildBudgetStatus(budgets.monthlyUsd, roundNumber(averageDailySpendUsd * 30, 2)),
      averageDailySpendUsd: averageDailySpendUsd,
    },
    policy: policySummary,
    planning: {
      spendLeaders: spendLeaders,
      lineups: {
        activeSet: activeSet,
        fallbackSet: fallbackSet,
        retireSet: retireSet,
      },
      scenarios: {
        runs: scenarioRuns,
        defaultChoice: buildScenario(defaultChoice, scenarioRuns, judgeUnitCostUsd),
        cheapFallback: buildScenario(cheapFallback, scenarioRuns, judgeUnitCostUsd),
        premiumChoice: buildScenario(premiumChoice, scenarioRuns, judgeUnitCostUsd),
      },
    },
    recommendations: {
      bestOverall: summary.recommendations && summary.recommendations.bestOverall ? enrichModelStat(summary.recommendations.bestOverall, opts) : null,
      mostReliable: summary.recommendations && summary.recommendations.mostReliable ? enrichModelStat(summary.recommendations.mostReliable, opts) : null,
      fastest: summary.recommendations && summary.recommendations.fastest ? enrichModelStat(summary.recommendations.fastest, opts) : null,
      bestValue: summary.recommendations && summary.recommendations.bestValue ? enrichModelStat(summary.recommendations.bestValue, opts) : null,
      defaultChoice: defaultChoice,
      cheapFallback: cheapFallback,
      premiumChoice: premiumChoice,
      cheapestReliable: cheapestReliable,
      spendLeader: spendLeaders[0] || null,
      budgetRiskModels: budgetRiskModels,
      promote: policySummary.promote[0] || null,
      hold: policySummary.hold[0] || null,
      demote: policySummary.demote[0] || null,
      activeSet: activeSet,
      fallbackSet: fallbackSet,
      retireSet: retireSet,
      rotationCandidates: summary.recommendations && Array.isArray(summary.recommendations.rotationCandidates)
        ? summary.recommendations.rotationCandidates.map(function(item) { return enrichModelStat(item, opts); })
        : [],
    },
  };
}

function withHealthFallback(fnName, fn) {
  return function(...args) {
    try {
      const result = fn.apply(runRepository, args);
      markSuccess();
      return result;
    } catch (e) {
      markFailure();
      console.warn("[analysis-runs] " + fnName + " failed:", e.message);
      // Return safe defaults based on operation
      if (fnName === "insertRun") throw e;
      if (fnName === "listTopByScore") return [];
      if (fnName === "listRecent") return { items: [], total: 0 };
      if (fnName === "countRecent") return 0;
      if (fnName === "getById") return null;
      if (fnName === "stats") return { totalRuns: 0, latestRunAt: null };
      if (fnName === "failureSummary") return {
        totalFailures: 0, byStatus: {}, byModel: {}, byContestantProvider: {},
        byJudgeProvider: {}, judgePhases: {}, errorMessages: {}, errorCategories: {},
        upstreamStatuses: {}, latestJudgeParseFailures: [], byRetryPolicy: {},
        byFallbackPolicy: {}, totalRetryAttempts: 0, fallbackRuns: 0,
      };
      throw e;
    }
  };
}

const addAnalysisRun = withHealthFallback("insertRun", function(run) {
  return runRepository.insertRun(run);
});

const listTopAnalysisRunsByScore = withHealthFallback("listTopByScore", function(limit) {
  return runRepository.listTopByScore ? runRepository.listTopByScore(limit) : [];
});

const listBottomAnalysisRunsByScore = withHealthFallback("listBottomByScore", function(limit) {
  return runRepository.listBottomByScore ? runRepository.listBottomByScore(limit) : [];
});

const listAnalysisRuns = withHealthFallback("listRecent", function(options) {
  return runRepository.listRecent(options);
});

const countAnalysisRuns = withHealthFallback("countRecent", function(options) {
  return runRepository.countRecent ? runRepository.countRecent(options) : runRepository.listRecent(options).length;
});

const getAnalysisRun = withHealthFallback("getById", function(id) {
  return runRepository.getById(id);
});

const getAnalysisRunStats = withHealthFallback("stats", function() {
  return runRepository.stats();
});

const getAnalysisFailureSummary = withHealthFallback("failureSummary", function(options) {
  return runRepository.failureSummary ? runRepository.failureSummary(options) : {
    totalFailures: 0,
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
});

function getAnalysisAnalytics(options) {
  const summary = runRepository.analyticsSummary ? runRepository.analyticsSummary(options) : {
    totalRuns: 0,
    successRuns: 0,
    partialFailureRuns: 0,
    failureRuns: 0,
    successRate: 0,
    avgCrownScore: 0,
    avgJudgeMs: 0,
    dailyTrend: [],
    modelStats: [],
    contestantSpendUsd: 0,
    judgeSpendUsd: 0,
    estimatedSpendUsd: 0,
    avgRunSpendUsd: 0,
    pricing: {
      configuredModelCount: 0,
      judgeUnitCostUsd: JUDGE_PRICE_USD,
    },
    budget: {
      slice: null,
      daily: null,
      monthlyProjected: null,
      averageDailySpendUsd: 0,
    },
    policy: {
      thresholds: {
        minReliabilityPct: Number(ANALYTICS_POLICY.minReliabilityPct || 0),
        maxUnitCostUsd: Number(ANALYTICS_POLICY.maxUnitCostUsd || 0),
        minScorePerDollar: Number(ANALYTICS_POLICY.minScorePerDollar || 0),
        minAvgScore: Number(ANALYTICS_POLICY.minAvgScore || 0),
      },
      counts: { promote: 0, hold: 0, demote: 0 },
      promote: [],
      hold: [],
      demote: [],
    },
    planning: {
      spendLeaders: [],
      lineups: {
        activeSet: [],
        fallbackSet: [],
        retireSet: [],
      },
      scenarios: {
        runs: 100,
        defaultChoice: null,
        cheapFallback: null,
        premiumChoice: null,
      },
    },
    recommendations: {
      bestOverall: null,
      mostReliable: null,
      fastest: null,
      bestValue: null,
      defaultChoice: null,
      cheapFallback: null,
      premiumChoice: null,
      cheapestReliable: null,
      spendLeader: null,
      budgetRiskModels: [],
      promote: null,
      hold: null,
      demote: null,
      activeSet: [],
      fallbackSet: [],
      retireSet: [],
      rotationCandidates: [],
    },
  };
  return enrichAnalyticsSummary(summary, options);
}

function getPatternStats(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computePatternStats(rows);
}

function getPackStats(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computePackStats(rows);
}

function getModeStats(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computeModeStats(rows);
}

function getProviderHealth(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computeProviderHealth(rows);
}

function getResponseLengths(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computeResponseLengths(rows);
}

function getWinStreaks(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computeWinStreaks(rows);
}

function getBlindAlignment(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computeBlindAlignment(rows);
}

function getPromptTopics(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computePromptTopics(rows);
}

function getCostForecast(options) {
  const summary = runRepository.analyticsSummary ? runRepository.analyticsSummary(options) : { dailyTrend: [] };
  const enriched = enrichAnalyticsSummary(summary, options);
  return computeCostForecast(enriched.dailyTrend, enriched.budget);
}

function getPromptDifficulty(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return { items: computePromptDifficulty(rows) };
}

function getHeadToHead(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return { items: computeHeadToHead(rows) };
}

function getScoreVolatility(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return { items: computeScoreVolatility(rows) };
}

function getContestantLatency(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return { items: computeContestantLatency(rows) };
}

function getUpsets(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return { items: computeUpsets(rows) };
}

function getUserEngagement(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computeUserEngagement(rows);
}

function getRetryRecovery(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return computeRetryRecovery(rows);
}

function getPromptLengthVsScore(options) {
  const rows = runRepository.listRecent ? runRepository.listRecent(Object.assign({}, options, { limit: 500 })) : [];
  return { items: computePromptLengthVsScore(rows) };
}

module.exports = {
  addAnalysisRun: addAnalysisRun,
  listTopAnalysisRunsByScore: listTopAnalysisRunsByScore,
  listBottomAnalysisRunsByScore: listBottomAnalysisRunsByScore,
  getPatternStats: getPatternStats,
  getPackStats: getPackStats,
  getModeStats: getModeStats,
  getProviderHealth: getProviderHealth,
  getResponseLengths: getResponseLengths,
  getWinStreaks: getWinStreaks,
  getBlindAlignment: getBlindAlignment,
  getPromptTopics: getPromptTopics,
  getCostForecast: getCostForecast,
  getPromptDifficulty: getPromptDifficulty,
  getHeadToHead: getHeadToHead,
  getScoreVolatility: getScoreVolatility,
  getContestantLatency: getContestantLatency,
  getUpsets: getUpsets,
  getUserEngagement: getUserEngagement,
  getRetryRecovery: getRetryRecovery,
  getPromptLengthVsScore: getPromptLengthVsScore,
  listAnalysisRuns: listAnalysisRuns,
  countAnalysisRuns: countAnalysisRuns,
  getAnalysisRun: getAnalysisRun,
  getAnalysisRunStats: getAnalysisRunStats,
  getAnalysisFailureSummary: getAnalysisFailureSummary,
  getAnalysisAnalytics: getAnalysisAnalytics,
  enrichAnalyticsSummary: enrichAnalyticsSummary,
  estimateCostProfile: estimateCostProfile,
  storageType: runRepository.type,
};
