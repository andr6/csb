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

function computePackStats(rows) {
  const packMap = {};
  rows.forEach(function(run) {
    const pack = String(run.pack || "unknown");
    if (!packMap[pack]) {
      packMap[pack] = { pack: pack, runs: 0, successRuns: 0, failures: 0, crownScoreTotal: 0, crownScoreCount: 0 };
    }
    const stat = packMap[pack];
    stat.runs += 1;
    const status = run.execution && run.execution.summary && run.execution.summary.overallStatus || "unknown";
    if (status === "success") stat.successRuns += 1;
    else if (status !== "unknown") stat.failures += 1;
    if (run.crownModelId) {
      stat.crownScoreTotal += Number(run.crownScore || 0);
      stat.crownScoreCount += 1;
    }
  });
  return Object.keys(packMap).map(function(pack) {
    const s = packMap[pack];
    return {
      pack: s.pack,
      runs: s.runs,
      successRate: s.runs ? Math.round((s.successRuns / s.runs) * 100) : 0,
      avgCrownScore: s.crownScoreCount ? Math.round(s.crownScoreTotal / s.crownScoreCount) : 0,
      failureRate: s.runs ? Math.round((s.failures / s.runs) * 100) : 0,
    };
  }).sort(function(a, b) { return b.runs - a.runs; });
}

function computeModeStats(rows) {
  const modeMap = {};
  rows.forEach(function(run) {
    const mode = String(run.mode || "unknown");
    if (!modeMap[mode]) {
      modeMap[mode] = { mode: mode, runs: 0, successRuns: 0, failures: 0, crownScoreTotal: 0, crownScoreCount: 0 };
    }
    const stat = modeMap[mode];
    stat.runs += 1;
    const status = run.execution && run.execution.summary && run.execution.summary.overallStatus || "unknown";
    if (status === "success") stat.successRuns += 1;
    else if (status !== "unknown") stat.failures += 1;
    if (run.crownModelId) {
      stat.crownScoreTotal += Number(run.crownScore || 0);
      stat.crownScoreCount += 1;
    }
  });
  return Object.keys(modeMap).map(function(mode) {
    const s = modeMap[mode];
    return {
      mode: s.mode,
      runs: s.runs,
      successRate: s.runs ? Math.round((s.successRuns / s.runs) * 100) : 0,
      avgCrownScore: s.crownScoreCount ? Math.round(s.crownScoreTotal / s.crownScoreCount) : 0,
      failureRate: s.runs ? Math.round((s.failures / s.runs) * 100) : 0,
    };
  }).sort(function(a, b) { return b.runs - a.runs; });
}

function computeProviderHealth(rows) {
  const providerMap = {};
  rows.forEach(function(run) {
    const provider = String(run.contestantProvider || "unknown");
    if (!providerMap[provider]) {
      providerMap[provider] = { provider: provider, runs: 0, successRuns: 0, failures: 0, crownScoreTotal: 0, crownScoreCount: 0, durationTotal: 0, durationCount: 0 };
    }
    const stat = providerMap[provider];
    stat.runs += 1;
    const status = run.execution && run.execution.summary && run.execution.summary.overallStatus || "unknown";
    if (status === "success") stat.successRuns += 1;
    else if (status !== "unknown") stat.failures += 1;
    if (run.crownModelId) {
      stat.crownScoreTotal += Number(run.crownScore || 0);
      stat.crownScoreCount += 1;
    }
    const models = run.execution && run.execution.models ? run.execution.models : {};
    Object.keys(models).forEach(function(mId) {
      if (models[mId] && models[mId].durationMs) {
        stat.durationTotal += Number(models[mId].durationMs || 0);
        stat.durationCount += 1;
      }
    });
  });
  return Object.keys(providerMap).map(function(provider) {
    const s = providerMap[provider];
    return {
      provider: s.provider,
      runs: s.runs,
      successRate: s.runs ? Math.round((s.successRuns / s.runs) * 100) : 0,
      avgCrownScore: s.crownScoreCount ? Math.round(s.crownScoreTotal / s.crownScoreCount) : 0,
      failureRate: s.runs ? Math.round((s.failures / s.runs) * 100) : 0,
      avgLatencyMs: s.durationCount ? Math.round(s.durationTotal / s.durationCount) : 0,
    };
  }).sort(function(a, b) { return b.runs - a.runs; });
}

function computeResponseLengths(rows) {
  const modelMap = {};
  rows.forEach(function(run) {
    const responses = run.responses && typeof run.responses === "object" ? run.responses : {};
    Object.keys(responses).forEach(function(modelId) {
      if (!modelMap[modelId]) {
        modelMap[modelId] = { modelId: modelId, totalLength: 0, count: 0, minLength: Infinity, maxLength: 0 };
      }
      const text = String(responses[modelId] || "");
      const len = text.length;
      const s = modelMap[modelId];
      s.totalLength += len;
      s.count += 1;
      if (len < s.minLength) s.minLength = len;
      if (len > s.maxLength) s.maxLength = len;
    });
  });
  return Object.keys(modelMap).map(function(modelId) {
    const s = modelMap[modelId];
    return {
      modelId: modelId,
      avgLength: s.count ? Math.round(s.totalLength / s.count) : 0,
      minLength: s.minLength === Infinity ? 0 : s.minLength,
      maxLength: s.maxLength,
      count: s.count,
    };
  }).sort(function(a, b) { return b.avgLength - a.avgLength; });
}

function computeWinStreaks(rows) {
  const modelMap = {};
  rows.forEach(function(run) {
    if (!run.crownModelId) return;
    if (!modelMap[run.crownModelId]) {
      modelMap[run.crownModelId] = { modelId: run.crownModelId, currentStreak: 0, maxStreak: 0, totalWins: 0, lastWinIndex: -1 };
    }
  });
  rows.forEach(function(run, idx) {
    if (!run.crownModelId) return;
    const s = modelMap[run.crownModelId];
    s.totalWins += 1;
    if (s.lastWinIndex >= 0 && idx === s.lastWinIndex + 1) {
      s.currentStreak += 1;
    } else {
      s.currentStreak = 1;
    }
    s.lastWinIndex = idx;
    if (s.currentStreak > s.maxStreak) s.maxStreak = s.currentStreak;
  });
  return Object.keys(modelMap).map(function(modelId) {
    const s = modelMap[modelId];
    return { modelId: s.modelId, maxStreak: s.maxStreak, totalWins: s.totalWins };
  }).sort(function(a, b) { return b.maxStreak - a.maxStreak || b.totalWins - a.totalWins; });
}

function computeBlindAlignment(rows) {
  const MIN_VOTES_FOR_SIGNIFICANCE = 30;
  let aligned = 0;
  let total = 0;
  rows.forEach(function(run) {
    if (!run.execution || !run.execution.blindMapping) return;
    const userVotes = run.execution && run.execution.userVotes ? run.execution.userVotes : {};
    const crown = run.crownModelId;
    if (!crown) return;
    Object.keys(userVotes).forEach(function(voterId) {
      total += 1;
      if (userVotes[voterId] === crown) aligned += 1;
    });
  });
  if (total < MIN_VOTES_FOR_SIGNIFICANCE) {
    return { totalVotes: total, alignedVotes: aligned, alignmentPct: null, note: "Insufficient data for statistical significance (need 30+ votes)." };
  }
  // Wilson score interval for 95% confidence
  const p = aligned / total;
  const z = 1.96;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const width = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / denominator;
  return {
    totalVotes: total,
    alignedVotes: aligned,
    alignmentPct: Math.round(p * 100),
    confidence: {
      level: 0.95,
      lower: Math.round(Math.max(0, centre - width) * 100),
      upper: Math.round(Math.min(1, centre + width) * 100),
    },
  };
}

function computePromptTopics(rows) {
  const topicMap = {};
  const topicPatterns = [
    { key: "coding", pattern: /code|program|function|bug|error|script|api|debug/i },
    { key: "creative", pattern: /story|poem|song|creative|write|imagine|fiction/i },
    { key: "business", pattern: /business|strategy|market|revenue|startup|investor|profit/i },
    { key: "science", pattern: /science|physics|chemistry|biology|research|study|experiment/i },
    { key: "philosophy", pattern: /philosophy|meaning|existence|consciousness|ethics|moral/i },
    { key: "politics", pattern: /politic|government|policy|election|vote|party|democrat|republican/i },
    { key: "personal", pattern: /relationship|advice|feel|emotion|love|friend|family|mental health/i },
    { key: "technical", pattern: /server|database|network|infrastructure|deploy|cloud|kubernetes/i },
    { key: "math", pattern: /math|equation|calculate|formula|algebra|geometry|number/i },
    { key: "safety_test", pattern: /jailbreak|hack|exploit|bypass|ignore|pretend|roleplay|DAN/i },
  ];
  rows.forEach(function(run) {
    const prompt = String(run.prompt || "").toLowerCase();
    let matched = false;
    topicPatterns.forEach(function(tp) {
      if (tp.pattern.test(prompt)) {
        matched = true;
        if (!topicMap[tp.key]) {
          topicMap[tp.key] = { topic: tp.key, runs: 0, successRuns: 0, failures: 0, crownScoreTotal: 0, crownScoreCount: 0 };
        }
        const s = topicMap[tp.key];
        s.runs += 1;
        const status = run.execution && run.execution.summary && run.execution.summary.overallStatus || "unknown";
        if (status === "success") s.successRuns += 1;
        else if (status !== "unknown") s.failures += 1;
        if (run.crownModelId) {
          s.crownScoreTotal += Number(run.crownScore || 0);
          s.crownScoreCount += 1;
        }
      }
    });
    if (!matched) {
      if (!topicMap["other"]) {
        topicMap["other"] = { topic: "other", runs: 0, successRuns: 0, failures: 0, crownScoreTotal: 0, crownScoreCount: 0 };
      }
      const s = topicMap["other"];
      s.runs += 1;
      const status = run.execution && run.execution.summary && run.execution.summary.overallStatus || "unknown";
      if (status === "success") s.successRuns += 1;
      else if (status !== "unknown") s.failures += 1;
      if (run.crownModelId) {
        s.crownScoreTotal += Number(run.crownScore || 0);
        s.crownScoreCount += 1;
      }
    }
  });
  return Object.keys(topicMap).map(function(key) {
    const s = topicMap[key];
    return {
      topic: s.topic,
      runs: s.runs,
      successRate: s.runs ? Math.round((s.successRuns / s.runs) * 100) : 0,
      avgCrownScore: s.crownScoreCount ? Math.round(s.crownScoreTotal / s.crownScoreCount) : 0,
      failureRate: s.runs ? Math.round((s.failures / s.runs) * 100) : 0,
    };
  }).sort(function(a, b) { return b.runs - a.runs; });
}

function computeCostForecast(dailyTrend, budgets) {
  if (!dailyTrend || !dailyTrend.length) return null;
  const spends = dailyTrend.map(function(d) { return Number(d.estimatedSpendUsd || 0); });
  const avgDaily = spends.reduce(function(a, b) { return a + b; }, 0) / spends.length;
  const totalSpend = spends.reduce(function(a, b) { return a + b; }, 0);
  const monthlyProjected = Math.round(avgDaily * 30 * 100) / 100;
  const daysInMonth = 30;
  const remainingDays = Math.max(0, daysInMonth - dailyTrend.length);
  const projectedTotal = Math.round((totalSpend + avgDaily * remainingDays) * 100) / 100;
  const monthlyLimit = budgets && budgets.monthlyUsd ? budgets.monthlyUsd : null;
  var daysUntilOver = null;
  if (monthlyLimit && avgDaily > 0) {
    daysUntilOver = Math.ceil((monthlyLimit - totalSpend) / avgDaily);
    if (daysUntilOver < 0) daysUntilOver = 0;
  }
  return {
    avgDailySpend: Math.round(avgDaily * 100) / 100,
    monthlyProjected: monthlyProjected,
    projectedTotal: projectedTotal,
    daysUntilOver: daysUntilOver,
  };
}

function computePromptDifficulty(rows) {
  const promptMap = {};
  rows.forEach(function(run) {
    const prompt = String(run.prompt || "").trim();
    if (!prompt) return;
    if (!promptMap[prompt]) {
      promptMap[prompt] = { prompt: prompt, runs: 0, successRuns: 0, failures: 0, crownScoreTotal: 0, crownScoreCount: 0, modelCount: 0 };
    }
    const s = promptMap[prompt];
    s.runs += 1;
    const status = run.execution && run.execution.summary && run.execution.summary.overallStatus || "unknown";
    if (status === "success") s.successRuns += 1;
    else if (status !== "unknown") s.failures += 1;
    if (run.crownModelId) {
      s.crownScoreTotal += Number(run.crownScore || 0);
      s.crownScoreCount += 1;
    }
    const responses = run.responses && typeof run.responses === "object" ? run.responses : {};
    s.modelCount = Math.max(s.modelCount, Object.keys(responses).length);
  });
  return Object.keys(promptMap).map(function(key) {
    const s = promptMap[key];
    return {
      prompt: s.prompt.length > 80 ? s.prompt.slice(0, 80) + "..." : s.prompt,
      runs: s.runs,
      successRate: s.runs ? Math.round((s.successRuns / s.runs) * 100) : 0,
      avgCrownScore: s.crownScoreCount ? Math.round(s.crownScoreTotal / s.crownScoreCount) : 0,
      failureRate: s.runs ? Math.round((s.failures / s.runs) * 100) : 0,
      modelCount: s.modelCount,
    };
  }).sort(function(a, b) { return a.avgCrownScore - b.avgCrownScore || b.failureRate - a.failureRate; });
}

function computeHeadToHead(rows) {
  const pairMap = {};
  const modelWins = {};
  const modelAppearances = {};

  rows.forEach(function(run) {
    const responses = run.responses && typeof run.responses === "object" ? run.responses : {};
    const modelIds = Object.keys(responses);
    if (!run.crownModelId || modelIds.length < 2) return;
    modelIds.forEach(function(mId) {
      modelAppearances[mId] = (modelAppearances[mId] || 0) + 1;
      if (mId === run.crownModelId) {
        modelWins[mId] = (modelWins[mId] || 0) + 1;
      }
    });
    modelIds.forEach(function(a) {
      modelIds.forEach(function(b) {
        if (a >= b) return;
        const key = a + "::" + b;
        if (!pairMap[key]) pairMap[key] = { a: a, b: b, aWins: 0, bWins: 0, total: 0 };
        pairMap[key].total += 1;
        if (run.crownModelId === a) pairMap[key].aWins += 1;
        else if (run.crownModelId === b) pairMap[key].bWins += 1;
      });
    });
  });

  return Object.keys(pairMap).map(function(key) {
    const p = pairMap[key];
    const aWinRate = p.total ? Math.round((p.aWins / p.total) * 100) : 0;
    const bWinRate = p.total ? Math.round((p.bWins / p.total) * 100) : 0;
    const aOverall = modelAppearances[p.a] ? Math.round((modelWins[p.a] / modelAppearances[p.a]) * 100) : 0;
    const bOverall = modelAppearances[p.b] ? Math.round((modelWins[p.b] / modelAppearances[p.b]) * 100) : 0;
    return {
      modelA: p.a,
      modelB: p.b,
      aWins: p.aWins,
      bWins: p.bWins,
      total: p.total,
      aWinRate: aWinRate,
      bWinRate: bWinRate,
      aOverallWinRate: aOverall,
      bOverallWinRate: bOverall,
      edge: aWinRate > bWinRate ? p.a : (bWinRate > aWinRate ? p.b : ""),
    };
  }).sort(function(a, b) { return b.total - a.total; });
}

function computeScoreVolatility(rows) {
  const modelMap = {};
  rows.forEach(function(run) {
    const scores = run.judgement && run.judgement.scores ? run.judgement.scores : {};
    Object.keys(scores).forEach(function(modelId) {
      if (!modelMap[modelId]) modelMap[modelId] = { modelId: modelId, scores: [], wins: 0, appearances: 0 };
      const s = modelMap[modelId];
      const score = Number(scores[modelId] || 0);
      s.scores.push(score);
      s.appearances += 1;
      if (run.crownModelId === modelId) s.wins += 1;
    });
  });
  return Object.keys(modelMap).map(function(modelId) {
    const s = modelMap[modelId];
    const n = s.scores.length;
    const mean = n ? s.scores.reduce(function(a, b) { return a + b; }, 0) / n : 0;
    const variance = n > 1
      ? s.scores.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / n
      : 0;
    const stdDev = Math.round(Math.sqrt(variance) * 10) / 10;
    return {
      modelId: s.modelId,
      appearances: s.appearances,
      avgScore: Math.round(mean),
      stdDev: stdDev,
      minScore: n ? Math.min.apply(null, s.scores) : 0,
      maxScore: n ? Math.max.apply(null, s.scores) : 0,
      winRate: s.appearances ? Math.round((s.wins / s.appearances) * 100) : 0,
    };
  }).sort(function(a, b) { return b.stdDev - a.stdDev; });
}

function computeContestantLatency(rows) {
  const modelMap = {};
  rows.forEach(function(run) {
    const timings = run.timings && typeof run.timings === "object" ? run.timings : {};
    const contestantMs = timings.contestantMsByModel || {};
    Object.keys(contestantMs).forEach(function(modelId) {
      if (!modelMap[modelId]) {
        modelMap[modelId] = { modelId: modelId, totalMs: 0, count: 0, minMs: Infinity, maxMs: 0 };
      }
      const ms = Number(contestantMs[modelId] || 0);
      if (ms <= 0) return;
      const s = modelMap[modelId];
      s.totalMs += ms;
      s.count += 1;
      if (ms < s.minMs) s.minMs = ms;
      if (ms > s.maxMs) s.maxMs = ms;
    });
  });
  return Object.keys(modelMap).map(function(modelId) {
    const s = modelMap[modelId];
    return {
      modelId: s.modelId,
      avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
      minMs: s.minMs === Infinity ? 0 : s.minMs,
      maxMs: s.maxMs,
      count: s.count,
    };
  }).sort(function(a, b) { return b.avgMs - a.avgMs; });
}

function computeUpsets(rows) {
  const modelWins = {};
  const modelAppearances = {};
  rows.forEach(function(run) {
    const responses = run.responses && typeof run.responses === "object" ? run.responses : {};
    Object.keys(responses).forEach(function(mId) {
      modelAppearances[mId] = (modelAppearances[mId] || 0) + 1;
      if (run.crownModelId === mId) {
        modelWins[mId] = (modelWins[mId] || 0) + 1;
      }
    });
  });

  const upsetRuns = [];
  rows.forEach(function(run) {
    const responses = run.responses && typeof run.responses === "object" ? run.responses : {};
    const modelIds = Object.keys(responses);
    if (!run.crownModelId || modelIds.length < 2) return;
    const winner = run.crownModelId;
    const winnerRate = modelAppearances[winner] ? (modelWins[winner] || 0) / modelAppearances[winner] : 0;
    let biggestUnderdog = null;
    let biggestGap = -1;
    modelIds.forEach(function(mId) {
      if (mId === winner) return;
      const rate = modelAppearances[mId] ? (modelWins[mId] || 0) / modelAppearances[mId] : 0;
      const gap = rate - winnerRate;
      if (gap > biggestGap) {
        biggestGap = gap;
        biggestUnderdog = mId;
      }
    });
    if (biggestUnderdog && biggestGap > 0.05) {
      upsetRuns.push({
        prompt: String(run.prompt || "").slice(0, 100),
        winner: winner,
        loser: biggestUnderdog,
        winnerRate: Math.round(winnerRate * 100),
        loserRate: Math.round(((modelWins[biggestUnderdog] || 0) / modelAppearances[biggestUnderdog]) * 100),
        crownScore: Number(run.crownScore || 0),
        createdAt: run.createdAt,
      });
    }
  });
  return upsetRuns.sort(function(a, b) {
    return (b.loserRate - b.winnerRate) - (a.loserRate - a.winnerRate);
  }).slice(0, 20);
}

function computeUserEngagement(rows) {
  const voterMap = {};
  let totalVotes = 0;
  let voteDays = {};
  rows.forEach(function(run) {
    const userVotes = run.execution && run.execution.userVotes ? run.execution.userVotes : {};
    Object.keys(userVotes).forEach(function(voterId) {
      totalVotes += 1;
      voterMap[voterId] = (voterMap[voterId] || 0) + 1;
      const day = String(run.createdAt || "").slice(0, 10);
      if (day) voteDays[day] = (voteDays[day] || 0) + 1;
    });
  });
  const voterEntries = Object.keys(voterMap).map(function(id) {
    return { voterId: id, votes: voterMap[id] };
  }).sort(function(a, b) { return b.votes - a.votes; });
  const dayEntries = Object.keys(voteDays).sort().map(function(day) {
    return { date: day, votes: voteDays[day] };
  });
  return {
    totalVotes: totalVotes,
    uniqueVoters: Object.keys(voterMap).length,
    topVoters: voterEntries.slice(0, 5),
    dailyVotes: dayEntries.slice(-7),
    avgVotesPerVoter: voterEntries.length ? Math.round((totalVotes / voterEntries.length) * 10) / 10 : 0,
  };
}

function computeRetryRecovery(rows) {
  let totalFailed = 0;
  let totalRecovered = 0;
  let totalRetried = 0;
  let totalFallback = 0;
  const byPolicy = {};

  rows.forEach(function(run) {
    const execution = run.execution || {};
    const models = execution.models || {};
    const policy = execution.policy || {};
    let runFailed = false;
    let runRecovered = false;
    let runRetried = false;
    let runFallback = false;

    Object.keys(models).forEach(function(mId) {
      const m = models[mId];
      if (!m) return;
      if (m.status !== "success") {
        runFailed = true;
        if (m.retryCount) { runRetried = true; totalRetried += 1; }
        if (m.fallbackUsed) { runFallback = true; totalFallback += 1; }
      }
    });

    const overall = execution.summary && execution.summary.overallStatus || "";
    if (runFailed && overall === "success") {
      runRecovered = true;
      totalRecovered += 1;
    }
    if (runFailed) {
      totalFailed += 1;
      const pKey = (policy.retry || "none") + " / " + (policy.fallback || "none");
      if (!byPolicy[pKey]) byPolicy[pKey] = { policy: pKey, failed: 0, recovered: 0 };
      byPolicy[pKey].failed += 1;
      if (runRecovered) byPolicy[pKey].recovered += 1;
    }
  });

  return {
    totalFailed: totalFailed,
    totalRecovered: totalRecovered,
    totalRetried: totalRetried,
    totalFallback: totalFallback,
    recoveryRate: totalFailed ? Math.round((totalRecovered / totalFailed) * 100) : 0,
    byPolicy: Object.keys(byPolicy).map(function(k) {
      const p = byPolicy[k];
      return { policy: p.policy, failed: p.failed, recovered: p.recovered, recoveryRate: p.failed ? Math.round((p.recovered / p.failed) * 100) : 0 };
    }).sort(function(a, b) { return b.failed - a.failed; }),
  };
}

function computePromptLengthVsScore(rows) {
  const lengthBuckets = [
    { label: "0-50 chars", min: 0, max: 50, runs: 0, scoreTotal: 0, scoreCount: 0 },
    { label: "51-100 chars", min: 51, max: 100, runs: 0, scoreTotal: 0, scoreCount: 0 },
    { label: "101-200 chars", min: 101, max: 200, runs: 0, scoreTotal: 0, scoreCount: 0 },
    { label: "201-400 chars", min: 201, max: 400, runs: 0, scoreTotal: 0, scoreCount: 0 },
    { label: "400+ chars", min: 401, max: Infinity, runs: 0, scoreTotal: 0, scoreCount: 0 },
  ];
  rows.forEach(function(run) {
    const len = String(run.prompt || "").length;
    const bucket = lengthBuckets.find(function(b) { return len >= b.min && len <= b.max; });
    if (!bucket) return;
    bucket.runs += 1;
    if (run.crownModelId) {
      bucket.scoreTotal += Number(run.crownScore || 0);
      bucket.scoreCount += 1;
    }
  });
  return lengthBuckets.map(function(b) {
    return {
      label: b.label,
      runs: b.runs,
      avgCrownScore: b.scoreCount ? Math.round(b.scoreTotal / b.scoreCount) : 0,
    };
  }).filter(function(b) { return b.runs > 0; });
}

module.exports = {
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
};
