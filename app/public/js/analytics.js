import { state, SAVED_VIEW_KEY, RUNS_PAGE_SIZE } from "./state.js";
import { modelName, esc, setDisplay } from "./utils.js";
import { emptyAnalytics, renderRunInspector, buildRunListItem } from "./ui.js";
import { renderLeaderboard } from "./leaderboard.js";

export function renderAnalytics(extra) {
  extra = extra || {};
  var panel = document.getElementById("analyticsPanel");
  if (!state.isAnalyticsPage && !state.showAnalyticsOnIndex) {
    panel.style.display = "none";
    return;
  }
  var summary = state.analyticsSummary || {
    totalRuns: 0,
    successRate: 0,
    avgCrownScore: 0,
    avgJudgeMs: 0,
    estimatedSpendUsd: 0,
    avgRunSpendUsd: 0,
    dailyTrend: [],
    modelStats: [],
    budget: {},
    recommendations: {},
  };
  panel.style.display = summary.totalRuns ? "block" : "none";
  if (!summary.totalRuns) return;

  function formatMoney(value, source) {
    var digits = (source === "configured") ? 2 : 1;
    return "$" + Number(value || 0).toFixed(digits);
  }

  document.getElementById("analyticsRuns").textContent = String(summary.totalRuns || 0);
  document.getElementById("analyticsSuccess").textContent = String(summary.successRate || 0) + "%";
  document.getElementById("analyticsScore").textContent = String(summary.avgCrownScore || 0);
  document.getElementById("analyticsJudgeMs").textContent = String(summary.avgJudgeMs || 0) + "ms";
  document.getElementById("analyticsSpend").textContent = formatMoney(summary.estimatedSpendUsd || 0);
  document.getElementById("analyticsSpendPerRun").textContent = formatMoney(summary.avgRunSpendUsd || 0);

  function fillRecommendation(prefix, item, meta) {
    document.getElementById(prefix).textContent = item ? modelName(item.modelId) : "none";
    document.getElementById(prefix + "Meta").textContent = item ? meta(item) : "waiting for runs";
  }

  fillRecommendation("analyticsBestOverall", summary.recommendations && summary.recommendations.bestOverall, function(item) {
    return String(item.avgScore) + " avg score • " + String(item.winRate) + "% win • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsMostReliable", summary.recommendations && summary.recommendations.mostReliable, function(item) {
    return String(item.reliability) + "% reliable • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsFastest", summary.recommendations && summary.recommendations.fastest, function(item) {
    return String(item.avgDurationMs) + "ms avg latency • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsBestValue", summary.recommendations && summary.recommendations.bestValue, function(item) {
    return String(item.scorePerDollar || item.scorePerCost || 0) + " score/$ • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsDefaultChoice", summary.recommendations && summary.recommendations.defaultChoice, function(item) {
    return String(item.avgScore) + " avg • " + String(item.reliability) + "% reliable • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsCheapFallback", summary.recommendations && summary.recommendations.cheapFallback, function(item) {
    return String(item.scorePerDollar || item.scorePerCost || 0) + " score/$ • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsPremiumChoice", summary.recommendations && summary.recommendations.premiumChoice, function(item) {
    return String(item.avgScore) + " avg • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsCheapestReliable", summary.recommendations && summary.recommendations.cheapestReliable, function(item) {
    return String(item.reliability) + "% reliable • " + formatMoney(item.unitCostUsd, item.costSource) + "/run";
  });
  fillRecommendation("analyticsSpendLeader", summary.recommendations && summary.recommendations.spendLeader, function(item) {
    return formatMoney(item.estimatedSpendUsd || 0) + " total • " + String(item.spendSharePct || 0) + "% share";
  });
  fillRecommendation("analyticsPolicyPromote", summary.recommendations && summary.recommendations.promote, function(item) {
    return String(item.reliability) + "% reliable • " + String(item.scorePerDollar || 0) + " score/$";
  });
  fillRecommendation("analyticsPolicyDemote", summary.recommendations && summary.recommendations.demote, function(item) {
    return (item.policyReasons || []).join(", ") + " • " + formatMoney(item.unitCostUsd || 0, item.costSource) + "/run";
  });

  var trend = document.getElementById("analyticsTrend");
  trend.textContent = "";
  if (!summary.dailyTrend || !summary.dailyTrend.length) {
    var emptyTrend = document.createElement("div");
    emptyTrend.className = "analytics-empty";
    emptyTrend.textContent = "No trend data yet.";
    trend.appendChild(emptyTrend);
  } else {
    summary.dailyTrend.forEach(function(item) {
      var row = document.createElement("div");
      row.className = "trend-row";
      var date = document.createElement("div");
      date.textContent = item.date;
      row.appendChild(date);
      var runs = document.createElement("div");
      runs.textContent = String(item.runs) + " runs";
      row.appendChild(runs);
      var success = document.createElement("div");
      success.textContent = String(item.successRate) + "% ok / " + String(item.avgCrownScore) + " avg / " + formatMoney(item.estimatedSpendUsd || 0);
      row.appendChild(success);
      trend.appendChild(row);
    });
  }

  var models = document.getElementById("analyticsModels");
  models.textContent = "";
  if (!summary.modelStats || !summary.modelStats.length) {
    var emptyModels = document.createElement("div");
    emptyModels.className = "analytics-empty";
    emptyModels.textContent = "No model analytics yet.";
    models.appendChild(emptyModels);
  } else {
    var header = document.createElement("div");
    header.className = "model-row";
    ["model", "avg", "wins", "win%", "reliable", "latency", "$/run", "spend", "score/$"].forEach(function(label) {
      var cell = document.createElement("div");
      cell.textContent = label;
      header.appendChild(cell);
    });
    models.appendChild(header);
    summary.modelStats.slice(0, 8).forEach(function(item) {
      var row = document.createElement("div");
      row.className = "model-row";
      [modelName(item.modelId), String(item.avgScore), String(item.wins), String(item.winRate) + "%", String(item.reliability) + "%", String(item.avgDurationMs) + "ms", formatMoney(item.unitCostUsd || 0, item.costSource), formatMoney(item.estimatedSpendUsd || 0), String(item.scorePerDollar || item.scorePerCost || 0)].forEach(function(value) {
        var cell = document.createElement("div");
        cell.textContent = value;
        row.appendChild(cell);
      });
      models.appendChild(row);
    });
  }

  var rotation = document.getElementById("analyticsRotation");
  rotation.textContent = "";
  var rotationItems = summary.recommendations && summary.recommendations.rotationCandidates ? summary.recommendations.rotationCandidates : [];
  if (!rotationItems.length) {
    var emptyRotation = document.createElement("div");
    emptyRotation.className = "analytics-empty";
    emptyRotation.textContent = "No obvious rotation candidates in this slice.";
    rotation.appendChild(emptyRotation);
  } else {
    rotationItems.forEach(function(item) {
      var row = document.createElement("div");
      row.className = "model-row";
      [modelName(item.modelId), String(item.avgScore), String(item.wins), String(item.winRate) + "%", String(item.reliability) + "%", String(item.avgDurationMs) + "ms", formatMoney(item.unitCostUsd || 0, item.costSource), formatMoney(item.estimatedSpendUsd || 0), String(item.scorePerDollar || item.scorePerCost || 0)].forEach(function(value) {
        var cell = document.createElement("div");
        cell.textContent = value;
        row.appendChild(cell);
      });
      rotation.appendChild(row);
    });
  }

  var budget = document.getElementById("analyticsBudget");
  budget.textContent = "";
  [
    { label: "slice budget", item: summary.budget && summary.budget.slice },
    { label: "latest day", item: summary.budget && summary.budget.daily },
    { label: "30-day projection", item: summary.budget && summary.budget.monthlyProjected },
  ].forEach(function(entry) {
    if (!entry.item) {
      return;
    }
    var row = document.createElement("div");
    row.className = "budget-row";
    var label = document.createElement("div");
    label.textContent = entry.label + " • " + formatMoney(entry.item.spendUsd) + " / " + formatMoney(entry.item.limitUsd);
    row.appendChild(label);
    var status = document.createElement("div");
    status.className = "budget-status " + entry.item.status;
    status.textContent = entry.item.status + " • " + String(entry.item.utilizationPct) + "%";
    row.appendChild(status);
    budget.appendChild(row);
  });
  if (!budget.childNodes.length) {
    var emptyBudget = document.createElement("div");
    emptyBudget.className = "analytics-empty";
    emptyBudget.textContent = "No budgets configured. Set ANALYTICS_*_BUDGET_USD to enable alerts.";
    budget.appendChild(emptyBudget);
  }

  var scenarios = document.getElementById("analyticsScenarios");
  scenarios.textContent = "";
  var scenarioItems = [
    { label: "default", item: summary.planning && summary.planning.scenarios && summary.planning.scenarios.defaultChoice },
    { label: "cheap fallback", item: summary.planning && summary.planning.scenarios && summary.planning.scenarios.cheapFallback },
    { label: "premium", item: summary.planning && summary.planning.scenarios && summary.planning.scenarios.premiumChoice },
  ].filter(function(entry) { return !!entry.item; });
  if (!scenarioItems.length) {
    var emptyScenario = document.createElement("div");
    emptyScenario.className = "analytics-empty";
    emptyScenario.textContent = "Not enough data for scenario planning yet.";
    scenarios.appendChild(emptyScenario);
  } else {
    scenarioItems.forEach(function(entry) {
      var row = document.createElement("div");
      row.className = "scenario-row";
      [entry.label + " • " + modelName(entry.item.modelId), formatMoney(entry.item.totalCostUsd || 0), String(entry.item.expectedWins || 0) + " est wins", String(entry.item.expectedScorePoints || 0) + " pts"].forEach(function(value) {
        var cell = document.createElement("div");
        cell.textContent = value;
        row.appendChild(cell);
      });
      scenarios.appendChild(row);
    });
  }

  var policyCounts = document.getElementById("analyticsPolicyCounts");
  policyCounts.textContent = "";
  [
    { key: "promote", label: "run more", count: summary.policy && summary.policy.counts ? summary.policy.counts.promote : 0 },
    { key: "hold", label: "monitor", count: summary.policy && summary.policy.counts ? summary.policy.counts.hold : 0 },
    { key: "demote", label: "rotate out", count: summary.policy && summary.policy.counts ? summary.policy.counts.demote : 0 },
  ].forEach(function(item) {
    var chip = document.createElement("div");
    chip.className = "policy-chip " + item.key;
    chip.textContent = item.label + " " + String(item.count || 0);
    policyCounts.appendChild(chip);
  });

  var policyBoard = document.getElementById("analyticsPolicyBoard");
  policyBoard.textContent = "";
  [
    { label: "run more", item: summary.recommendations && summary.recommendations.promote },
    { label: "monitor", item: summary.recommendations && summary.recommendations.hold },
    { label: "rotate out", item: summary.recommendations && summary.recommendations.demote },
  ].forEach(function(entry) {
    if (!entry.item) {
      return;
    }
    var row = document.createElement("div");
    row.className = "scenario-row";
    [
      entry.label + " • " + modelName(entry.item.modelId),
      String(entry.item.reliability || 0) + "% rel",
      formatMoney(entry.item.unitCostUsd || 0, entry.item.costSource) + "/run",
      (entry.item.policyReasons && entry.item.policyReasons.length ? entry.item.policyReasons.join(", ") : "meets policy"),
    ].forEach(function(value) {
      var cell = document.createElement("div");
      cell.textContent = value;
      row.appendChild(cell);
    });
    policyBoard.appendChild(row);
  });
  if (!policyBoard.childNodes.length) {
    var emptyPolicy = document.createElement("div");
    emptyPolicy.className = "analytics-empty";
    emptyPolicy.textContent = "No policy decisions yet.";
    policyBoard.appendChild(emptyPolicy);
  }

  var lineups = document.getElementById("analyticsLineups");
  lineups.textContent = "";
  [
    { label: "suggested active", items: summary.planning && summary.planning.lineups ? summary.planning.lineups.activeSet : [] },
    { label: "cheap fallback", items: summary.planning && summary.planning.lineups ? summary.planning.lineups.fallbackSet : [] },
    { label: "rotation out", items: summary.planning && summary.planning.lineups ? summary.planning.lineups.retireSet : [] },
  ].forEach(function(group) {
    var box = document.createElement("div");
    box.className = "lineup-box";
    var title = document.createElement("div");
    title.className = "lineup-title";
    title.textContent = group.label;
    box.appendChild(title);
    if (!group.items || !group.items.length) {
      var empty = document.createElement("div");
      empty.className = "analytics-empty";
      empty.textContent = "none";
      box.appendChild(empty);
    } else {
      group.items.forEach(function(item) {
        var row = document.createElement("div");
        row.className = "lineup-item";
        row.textContent = modelName(item.modelId) + " • " + String(item.reliability || 0) + "% • " + formatMoney(item.unitCostUsd || 0, item.costSource);
        box.appendChild(row);
      });
    }
    lineups.appendChild(box);
  });

  // Extended analytics panels
  renderPackStats(extra.packStats);
  renderModeStats(extra.modeStats);
  renderProviderHealth(extra.providerHealth);
  renderResponseLengths(extra.responseLengths);
  renderWinStreaks(extra.winStreaks);
  renderBlindAlignment(extra.blindAlignment);
  renderPromptTopics(extra.promptTopics);
  renderCostForecast(extra.costForecast);
  renderPatternStats(extra.patternStats);
  renderPromptDifficulty(extra.promptDifficulty);
  renderHeadToHead(extra.headToHead);
  renderScoreVolatility(extra.scoreVolatility);
  renderContestantLatency(extra.contestantLatency);
  renderUpsets(extra.upsets);
  renderUserEngagement(extra.userEngagement);
  renderRetryRecovery(extra.retryRecovery);
  renderPromptLengthVsScore(extra.promptLengthVsScore);
}

export function renderPackStats(data) {
  var el = document.getElementById("analyticsPacks");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No pack data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["pack", "runs", "success", "avg score", "failure"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [item.pack, String(item.runs), String(item.successRate) + "%", String(item.avgCrownScore), String(item.failureRate) + "%"].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderModeStats(data) {
  var el = document.getElementById("analyticsModes");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No mode data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["mode", "runs", "success", "avg score", "failure"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [item.mode, String(item.runs), String(item.successRate) + "%", String(item.avgCrownScore), String(item.failureRate) + "%"].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderProviderHealth(data) {
  var el = document.getElementById("analyticsProviders");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No provider data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["provider", "runs", "success", "avg score", "failure", "latency"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [item.provider, String(item.runs), String(item.successRate) + "%", String(item.avgCrownScore), String(item.failureRate) + "%", String(item.avgLatencyMs) + "ms"].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderResponseLengths(data) {
  var el = document.getElementById("analyticsResponseLengths");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No response length data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["model", "avg chars", "min", "max", "samples"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [modelName(item.modelId), String(item.avgLength), String(item.minLength), String(item.maxLength), String(item.count)].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderWinStreaks(data) {
  var el = document.getElementById("analyticsWinStreaks");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No streak data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["model", "max streak", "total wins"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [modelName(item.modelId), String(item.maxStreak), String(item.totalWins)].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderBlindAlignment(data) {
  var el = document.getElementById("analyticsBlind");
  if (!el) return;
  el.textContent = "";
  if (!data || !data.totalVotes) { el.appendChild(emptyAnalytics("No blind vote data yet.")); return; }
  var row = document.createElement("div");
  row.className = "budget-row";
  var label = document.createElement("div");
  label.textContent = "Human votes aligning with Bob's crown";
  row.appendChild(label);
  var status = document.createElement("div");
  if (data.alignmentPct === null || data.alignmentPct === undefined) {
    status.className = "budget-status";
    status.textContent = "Insufficient data (" + data.totalVotes + " / 30 votes)";
    status.title = data.note || "Need 30+ votes for statistical significance.";
  } else {
    status.className = "budget-status ok";
    var ci = data.confidence ? " (95% CI: " + data.confidence.lower + "–" + data.confidence.upper + "%)" : "";
    status.textContent = data.alignmentPct + "%" + ci + " (" + data.alignedVotes + " / " + data.totalVotes + ")";
  }
  row.appendChild(status);
  el.appendChild(row);
}

export function renderPromptTopics(data) {
  var el = document.getElementById("analyticsTopics");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No topic data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["topic", "runs", "success", "avg score", "failure"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [item.topic, String(item.runs), String(item.successRate) + "%", String(item.avgCrownScore), String(item.failureRate) + "%"].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderCostForecast(data) {
  var el = document.getElementById("analyticsForecast");
  if (!el) return;
  el.textContent = "";
  if (!data) { el.appendChild(emptyAnalytics("Not enough data for forecasting.")); return; }
  var entries = [
    ["avg daily spend", "$" + String(data.avgDailySpend || 0)],
    ["monthly projected", "$" + String(data.monthlyProjected || 0)],
    ["projected total", "$" + String(data.projectedTotal || 0)],
  ];
  if (data.daysUntilOver !== null) {
    entries.push(["days until budget", String(data.daysUntilOver)]);
  }
  entries.forEach(function(entry) {
    var row = document.createElement("div");
    row.className = "budget-row";
    var label = document.createElement("div");
    label.textContent = entry[0];
    row.appendChild(label);
    var status = document.createElement("div");
    status.className = "budget-status " + (entry[1] === "0" ? "over" : "ok");
    status.textContent = entry[1];
    row.appendChild(status);
    el.appendChild(row);
  });
}

export function renderPatternStats(data) {
  var el = document.getElementById("analyticsPatterns");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No pattern data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["model", "any pattern", "dominant"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [modelName(item.modelId), String(item.anyPatternRate) + "%", String(item.dominantPattern).replace(/_/g, " ")].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderPromptDifficulty(data) {
  var el = document.getElementById("analyticsPromptDifficulty");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No prompt difficulty data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["prompt", "runs", "success", "avg score", "failure"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.slice(0, 10).forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [item.prompt, String(item.runs), String(item.successRate) + "%", String(item.avgCrownScore), String(item.failureRate) + "%"].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderHeadToHead(data) {
  var el = document.getElementById("analyticsHeadToHead");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No head-to-head data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["matchup", "wins A", "wins B", "total"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [modelName(item.modelA) + " vs " + modelName(item.modelB), String(item.aWins), String(item.bWins), String(item.total)].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderScoreVolatility(data) {
  var el = document.getElementById("analyticsVolatility");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No volatility data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["model", "avg", "std dev", "min", "max", "wins"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [modelName(item.modelId), String(item.avgScore), String(item.stdDev), String(item.minScore), String(item.maxScore), String(item.winRate) + "%"].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderContestantLatency(data) {
  var el = document.getElementById("analyticsContestantLatency");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No latency data yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["model", "avg ms", "min", "max", "samples"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [modelName(item.modelId), String(item.avgMs) + "ms", String(item.minMs) + "ms", String(item.maxMs) + "ms", String(item.count)].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderUpsets(data) {
  var el = document.getElementById("analyticsUpsets");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("No upsets recorded yet.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["underdog", "favorite", "score", "prompt"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [modelName(item.winner) + " (" + item.winnerRate + "%)", modelName(item.loser) + " (" + item.loserRate + "%)", String(item.crownScore), item.prompt].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderUserEngagement(data) {
  var el = document.getElementById("analyticsEngagement");
  if (!el) return;
  el.textContent = "";
  if (!data || !data.totalVotes) { el.appendChild(emptyAnalytics("No engagement data yet.")); return; }
  var summary = document.createElement("div");
  summary.className = "budget-row";
  var label = document.createElement("div");
  label.textContent = "Total votes • " + data.totalVotes + " from " + data.uniqueVoters + " voters";
  summary.appendChild(label);
  var status = document.createElement("div");
  status.className = "budget-status ok";
  status.textContent = String(data.avgVotesPerVoter) + " avg/voter";
  summary.appendChild(status);
  el.appendChild(summary);
  if (data.topVoters && data.topVoters.length) {
    var sub = document.createElement("div");
    sub.className = "analytics-empty";
    sub.style.marginTop = ".5rem";
    sub.textContent = "Top voters: " + data.topVoters.map(function(v) { return v.voterId.slice(0, 8) + " (" + v.votes + ")"; }).join(", ");
    el.appendChild(sub);
  }
}

export function renderRetryRecovery(data) {
  var el = document.getElementById("analyticsRetryRecovery");
  if (!el) return;
  el.textContent = "";
  if (!data || !data.totalFailed) { el.appendChild(emptyAnalytics("No retry data yet.")); return; }
  var summary = document.createElement("div");
  summary.className = "budget-row";
  var label = document.createElement("div");
  label.textContent = "Failed runs recovered: " + data.totalRecovered + " / " + data.totalFailed;
  summary.appendChild(label);
  var status = document.createElement("div");
  status.className = "budget-status " + (data.recoveryRate >= 50 ? "ok" : "over");
  status.textContent = data.recoveryRate + "% recovery";
  summary.appendChild(status);
  el.appendChild(summary);
  if (data.byPolicy && data.byPolicy.length) {
    var sub = document.createElement("div");
    sub.className = "analytics-empty";
    sub.style.marginTop = ".5rem";
    sub.textContent = "By policy: " + data.byPolicy.map(function(p) { return p.policy + "=" + p.recoveryRate + "%"; }).join(", ");
    el.appendChild(sub);
  }
}

export function renderPromptLengthVsScore(data) {
  var el = document.getElementById("analyticsPromptLengthScore");
  if (!el) return;
  el.textContent = "";
  var items = data && data.items ? data.items : [];
  if (!items.length) { el.appendChild(emptyAnalytics("Not enough data for length analysis.")); return; }
  var header = document.createElement("div");
  header.className = "model-row";
  ["length bucket", "runs", "avg score"].forEach(function(l) {
    var c = document.createElement("div"); c.textContent = l; header.appendChild(c);
  });
  el.appendChild(header);
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "model-row";
    [item.label, String(item.runs), String(item.avgCrownScore)].forEach(function(v) {
      var c = document.createElement("div"); c.textContent = v; row.appendChild(c);
    });
    el.appendChild(row);
  });
}

export function renderDrift(data) {
  var driftPanel = document.getElementById("analyticsDrift");
  if (!driftPanel) return;
  driftPanel.textContent = "";
  var models = data && Array.isArray(data.models) ? data.models : [];
  if (!models.length) {
    var empty = document.createElement("div");
    empty.className = "analytics-empty";
    empty.textContent = "Not enough history for drift detection. Run more benchmarks.";
    driftPanel.appendChild(empty);
    return;
  }
  models.forEach(function(m) {
    var row = document.createElement("div");
    row.className = "trend-row";
    var directionColor = m.driftDetected ? (m.direction === "up" ? "#98c26f" : "#ff7b68") : "#777";
    var shiftText = m.shift > 0 ? "+" + m.shift : String(m.shift);
    [
      modelName(m.modelId),
      (m.latestWindow ? m.latestWindow.avgScore : "0") + " pts",
      m.driftDetected ? "DRIFT " + shiftText : shiftText,
    ].forEach(function(value, idx) {
      var cell = document.createElement("div");
      cell.textContent = value;
      if (idx === 2) cell.style.color = directionColor;
      row.appendChild(cell);
    });
    driftPanel.appendChild(row);
  });
}

export async function refreshHistory() {
  if (state.isAnalyticsPage) return;
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    state.history = Array.isArray(data.items) ? data.items : [];
    renderLeaderboard();
  } catch (e) {
    console.warn("History refresh failed:", e.message);
  }
}

export async function refreshAnalytics(params) {
  if (!state.isAnalyticsPage && !state.showAnalyticsOnIndex) return;
  try {
    const res = await fetch("/api/analytics?" + new URLSearchParams(params || {}).toString());
    state.analyticsSummary = await res.json();
    renderAnalytics();
  } catch (e) {
    console.warn("Analytics refresh failed:", e.message);
  }
  try {
    const driftRes = await fetch("/api/drift");
    const driftData = await driftRes.json();
    renderDrift(driftData);
  } catch (e) {
    console.warn("Drift refresh failed:", e.message);
  }
}

export function getCurrentRunFilters() {
  return {
    limit: RUNS_PAGE_SIZE,
    offset: state.runsOffset,
    query: document.getElementById("runsSearch").value.trim(),
    crownModelId: document.getElementById("runsCrownFilter").value,
    status: document.getElementById("runsStatusFilter").value,
    contestantProvider: document.getElementById("runsContestantProviderFilter").value,
    judgeProvider: document.getElementById("runsJudgeProviderFilter").value,
    failedModelId: document.getElementById("runsFailModelFilter").value,
    dateFrom: document.getElementById("runsDateFrom").value,
    dateTo: document.getElementById("runsDateTo").value,
    phase: state.drilldownFilters.phase || "",
  };
}

export async function refreshRuns(params) {
  if (!state.isAnalyticsPage) return;
  try {
    var query = new URLSearchParams(params || {});
    const res = await fetch("/api/runs?" + query.toString());
    const data = await res.json();
    state.recentRuns = Array.isArray(data.items) ? data.items : [];
    state.runsTotal = Number(data.total || state.recentRuns.length || 0);
    renderRunsPanel();
    if (!state.activeRunId && state.recentRuns[0]) {
      inspectRun(state.recentRuns[0].id);
    }
  } catch (e) {
    console.warn("Runs refresh failed:", e.message);
  }
}

export function topCounter(map) {
  if (!map || typeof map !== "object") return { key: "none", count: 0 };
  return Object.keys(map).reduce(function(best, key) {
    var count = Number(map[key] || 0);
    if (count > best.count) return { key: key, count: count };
    return best;
  }, { key: "none", count: 0 });
}

export function rankedCounters(map, limit, formatter) {
  return Object.keys(map || {})
    .map(function(key) {
      return {
        key: key,
        label: formatter ? formatter(key) : key,
        count: Number(map[key] || 0),
      };
    })
    .filter(function(item) { return item.count > 0; })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, limit || 5);
}

export function renderFailureRows(targetId, rows, emptyLabel) {
  var target = document.getElementById(targetId);
  target.textContent = "";
  if (!rows.length) {
    var empty = document.createElement("div");
    empty.className = "failable-empty";
    empty.textContent = emptyLabel;
    target.appendChild(empty);
    return;
  }
  rows.forEach(function(row) {
    var item = document.createElement("div");
    item.className = "failrow" + (row.onClick ? " clickable" : "");
    if (row.onClick) {
      item.onclick = row.onClick;
    }
    var name = document.createElement("div");
    name.className = "failname";
    name.textContent = row.label;
    item.appendChild(name);
    var count = document.createElement("div");
    count.className = "failcount";
    count.textContent = String(row.count);
    item.appendChild(count);
    target.appendChild(item);
  });
}

export function renderErrorRollup(items) {
  var target = document.getElementById("failErrorList");
  target.textContent = "";
  if (!items.length) {
    var empty = document.createElement("div");
    empty.className = "failable-empty";
    empty.textContent = "No recorded failure messages yet.";
    target.appendChild(empty);
    return;
  }
  items.forEach(function(item) {
    var row = document.createElement("div");
    row.className = "erroritem";
    if (item.onClick) {
      row.style.cursor = "pointer";
      row.onclick = item.onClick;
    }
    var top = document.createElement("div");
    top.className = "erroritem-top";
    var msg = document.createElement("div");
    msg.className = "erroritem-msg";
    msg.textContent = item.label;
    top.appendChild(msg);
    var count = document.createElement("div");
    count.className = "erroritem-count";
    count.textContent = String(item.count);
    top.appendChild(count);
    row.appendChild(top);
    target.appendChild(row);
  });
}

export function getSavedViews() {
  try {
    var raw = window.localStorage.getItem(SAVED_VIEW_KEY);
    var parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function setSavedViews(views) {
  try {
    window.localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(views.slice(0, 8)));
  } catch (e) {}
}

export function saveCurrentView() {
  var bar = document.getElementById("savedViewsBar");
  if (bar.querySelector(".savedview-input")) return; // already open
  var input = document.createElement("input");
  input.className = "savedview-input";
  input.placeholder = "view name";
  input.value = "incident view";
  var confirmBtn = document.createElement("button");
  confirmBtn.className = "savedview-btn";
  confirmBtn.textContent = "save";
  var cancelBtn = document.createElement("button");
  cancelBtn.className = "savedview-btn";
  cancelBtn.textContent = "×";
  function finish(name) {
    if (input.parentNode) bar.removeChild(input);
    if (confirmBtn.parentNode) bar.removeChild(confirmBtn);
    if (cancelBtn.parentNode) bar.removeChild(cancelBtn);
    if (!name) return;
    var views = getSavedViews();
    views = views.filter(function(item) { return item.name !== name; });
    views.unshift({ name: name, filters: getCurrentRunFilters() });
    setSavedViews(views);
    renderSavedViews();
  }
  confirmBtn.onclick = function() { finish(input.value.trim() || null); };
  cancelBtn.onclick = function() { finish(null); };
  input.onkeydown = function(e) {
    if (e.key === "Enter") finish(input.value.trim() || null);
    if (e.key === "Escape") finish(null);
  };
  bar.appendChild(input);
  bar.appendChild(confirmBtn);
  bar.appendChild(cancelBtn);
  input.focus();
  input.select();
}

export function loadSavedView(view) {
  var filters = view.filters || {};
  document.getElementById("runsSearch").value = filters.query || "";
  document.getElementById("runsCrownFilter").value = filters.crownModelId || "";
  document.getElementById("runsStatusFilter").value = filters.status || "";
  document.getElementById("runsContestantProviderFilter").value = filters.contestantProvider || "";
  document.getElementById("runsJudgeProviderFilter").value = filters.judgeProvider || "";
  document.getElementById("runsFailModelFilter").value = filters.failedModelId || "";
  document.getElementById("runsDateFrom").value = filters.dateFrom || "";
  document.getElementById("runsDateTo").value = filters.dateTo || "";
  state.drilldownFilters.phase = filters.phase || "";
  syncDrilldownWithControls(true);
  var current = getCurrentRunFilters();
  refreshRuns(current);
  refreshFailureSummary(current);
}

export function renderSavedViews() {
  var bar = document.getElementById("savedViewsBar");
  bar.textContent = "";
  var presets = [
    { name: "today parse", filters: { status: "failure", phase: "judge_parse", dateFrom: new Date().toISOString().slice(0, 10), dateTo: new Date().toISOString().slice(0, 10) } },
    { name: "all failures", filters: { status: "failure" } },
    { name: "partial failures", filters: { status: "partial_failure" } },
  ];
  presets.concat(getSavedViews()).forEach(function(view) {
    var btn = document.createElement("button");
    btn.className = "savedview-btn";
    btn.textContent = view.name;
    btn.onclick = function() { loadSavedView(view); };
    bar.appendChild(btn);
  });
  var saveBtn = document.createElement("button");
  saveBtn.className = "savedview-btn";
  saveBtn.textContent = "save current view";
  saveBtn.onclick = saveCurrentView;
  bar.appendChild(saveBtn);
}

export function renderParseSamples(samples) {
  var target = document.getElementById("failParseSamples");
  target.textContent = "";
  if (!samples.length) {
    var empty = document.createElement("div");
    empty.className = "failable-empty";
    empty.textContent = "No judge parse failures captured.";
    target.appendChild(empty);
    return;
  }
  samples.forEach(function(sample) {
    var item = document.createElement("div");
    item.className = "sampleitem";
    item.style.cursor = "pointer";
    item.onclick = function() {
      applyDrilldown({ phase: "judge_parse" });
    };
    var top = document.createElement("div");
    top.className = "sampleitem-top";
    var title = document.createElement("div");
    title.className = "sampleitem-title";
    title.textContent = sample.prompt || "(empty prompt)";
    top.appendChild(title);
    var meta = document.createElement("div");
    meta.className = "samplemeta";
    meta.textContent = sample.createdAt || "";
    top.appendChild(meta);
    item.appendChild(top);
    var err = document.createElement("div");
    err.className = "samplemeta";
    err.textContent = sample.error || "Judge parse failure";
    item.appendChild(err);
    if (sample.rawJudge) {
      var raw = document.createElement("pre");
      raw.className = "failcode";
      raw.textContent = sample.rawJudge;
      item.appendChild(raw);
    }
    target.appendChild(item);
  });
}

export function renderFailureSummary() {
  var total = state.failureSummary && Number(state.failureSummary.totalFailures || 0);
  var topStatus = topCounter(state.failureSummary && state.failureSummary.byStatus);
  var topModel = topCounter(state.failureSummary && state.failureSummary.byModel);
  var contestant = topCounter(state.failureSummary && state.failureSummary.byContestantProvider);
  var judge = topCounter(state.failureSummary && state.failureSummary.byJudgeProvider);
  var topPhase = topCounter(state.failureSummary && state.failureSummary.judgePhases);
  var topProvider = contestant.count >= judge.count ? contestant : judge;
  var providerCounts = {};
  Object.keys(state.failureSummary && state.failureSummary.byContestantProvider || {}).forEach(function(key) {
    providerCounts[key] = (providerCounts[key] || 0) + Number(state.failureSummary.byContestantProvider[key] || 0);
  });
  Object.keys(state.failureSummary && state.failureSummary.byJudgeProvider || {}).forEach(function(key) {
    providerCounts[key] = (providerCounts[key] || 0) + Number(state.failureSummary.byJudgeProvider[key] || 0);
  });

  document.getElementById("failTotal").textContent = String(total || 0);
  document.getElementById("failStatus").textContent = topStatus.key === "none" ? "none" : topStatus.key.replace(/_/g, " ");
  document.getElementById("failStatusMeta").textContent = topStatus.count
    ? String(topStatus.count) + " runs · phase " + (topPhase.key === "none" ? "n/a" : topPhase.key.replace(/_/g, " "))
    : "top failure status";
  document.getElementById("failModel").textContent = topModel.key === "none" ? "none" : modelName(topModel.key);
  document.getElementById("failModelMeta").textContent = topModel.count
    ? String(topModel.count) + " failed runs · retries " + String(state.failureSummary && state.failureSummary.totalRetryAttempts || 0)
    : "most affected model";
  document.getElementById("failProvider").textContent = topProvider.key === "none" ? "none" : topProvider.key;
  document.getElementById("failProviderMeta").textContent = topProvider.count
    ? String(topProvider.count) + " failed runs · fallbacks " + String(state.failureSummary && state.failureSummary.fallbackRuns || 0)
    : "most affected provider";

  renderFailureRows("failModelTable", rankedCounters(state.failureSummary && state.failureSummary.byModel, 6, modelName).map(function(row) {
    row.onClick = function() { applyDrilldown({ failedModelId: row.key }); };
    return row;
  }), "No model failures recorded.");
  renderFailureRows(
    "failProviderTable",
    rankedCounters(
      providerCounts,
      6,
      function(key) {
        var contestantCount = Number(state.failureSummary && state.failureSummary.byContestantProvider && state.failureSummary.byContestantProvider[key] || 0);
        var judgeCount = Number(state.failureSummary && state.failureSummary.byJudgeProvider && state.failureSummary.byJudgeProvider[key] || 0);
        if (contestantCount && judgeCount) return key + " (contestant + judge)";
        if (contestantCount) return key + " (contestant)";
        if (judgeCount) return key + " (judge)";
        return key;
      }
    ).map(function(row) {
      var contestantCount = Number(state.failureSummary && state.failureSummary.byContestantProvider && state.failureSummary.byContestantProvider[row.key] || 0);
      var judgeCount = Number(state.failureSummary && state.failureSummary.byJudgeProvider && state.failureSummary.byJudgeProvider[row.key] || 0);
      row.onClick = function() {
        applyDrilldown(contestantCount >= judgeCount ? { contestantProvider: row.key } : { judgeProvider: row.key });
      };
      return row;
    }),
    "No provider failures recorded."
  );
  renderFailureRows("failPolicyTable", [
    { label: "retry policy: " + ((topCounter(state.failureSummary && state.failureSummary.byRetryPolicy).key || "none").replace(/_/g, " ")), count: topCounter(state.failureSummary && state.failureSummary.byRetryPolicy).count || 0 },
    { label: "fallback policy: " + ((topCounter(state.failureSummary && state.failureSummary.byFallbackPolicy).key || "none").replace(/_/g, " ")), count: topCounter(state.failureSummary && state.failureSummary.byFallbackPolicy).count || 0 },
    { label: "error category: " + ((topCounter(state.failureSummary && state.failureSummary.errorCategories).key || "none").replace(/_/g, " ")), count: topCounter(state.failureSummary && state.failureSummary.errorCategories).count || 0 },
    { label: "upstream status: " + (topCounter(state.failureSummary && state.failureSummary.upstreamStatuses).key || "none"), count: topCounter(state.failureSummary && state.failureSummary.upstreamStatuses).count || 0 },
    { label: "total retry attempts", count: Number(state.failureSummary && state.failureSummary.totalRetryAttempts || 0) },
    { label: "runs using fallback", count: Number(state.failureSummary && state.failureSummary.fallbackRuns || 0) },
  ], "No retry or fallback data recorded.");
  renderErrorRollup(rankedCounters(state.failureSummary && state.failureSummary.errorMessages, 5).map(function(item) {
    var topCategory = topCounter(state.failureSummary && state.failureSummary.errorCategories).key;
    item.label = item.label + " [" + (topCategory === "none" ? "uncategorized" : topCategory.replace(/_/g, " ")) + "]";
    item.onClick = function() {
      if (topCategory !== "none") {
        applyDrilldown({ status: document.getElementById("runsStatusFilter").value || "failure" });
      }
    };
    return item;
  }));
  renderParseSamples(Array.isArray(state.failureSummary && state.failureSummary.latestJudgeParseFailures) ? state.failureSummary.latestJudgeParseFailures : []);
  setProviderOptionsFromSummary();
  renderDrilldownBar();
}

export async function refreshFailureSummary(params) {
  if (!state.isAnalyticsPage) return;
  try {
    const res = await fetch("/api/failures/summary?" + new URLSearchParams(params || {}).toString());
    state.failureSummary = await res.json();
    renderFailureSummary();
  } catch (e) {
    console.warn("Failure summary refresh failed:", e.message);
  }
}

export function renderRunsPanel() {
  var panel = document.getElementById("runsPanel");
  if (!state.isAnalyticsPage) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = state.recentRuns.length ? "block" : "none";
  if (!state.recentRuns.length) return;

  document.getElementById("runsPrevBtn").disabled = state.runsOffset <= 0;
  document.getElementById("runsNextBtn").disabled = state.runsOffset + RUNS_PAGE_SIZE >= state.runsTotal;
  document.getElementById("runsPageInfo").textContent =
    "page " + (Math.floor(state.runsOffset / RUNS_PAGE_SIZE) + 1) + " of " + Math.max(1, Math.ceil(state.runsTotal / RUNS_PAGE_SIZE));

  var list = document.getElementById("runsList");
  list.textContent = "";
  state.recentRuns.forEach(function(run) {
    list.appendChild(buildRunListItem(run));
  });
}

export async function inspectRun(id) {
  if (!state.isAnalyticsPage) return;
  try {
    state.activeRunId = id;
    renderRunsPanel();
    const res = await fetch("/api/runs/" + encodeURIComponent(id));
    const run = await res.json();
    var failedModels = run.execution && run.execution.models ? Object.keys(run.execution.models).filter(function(modelId) {
      return run.execution.models[modelId] && run.execution.models[modelId].status && run.execution.models[modelId].status !== "success";
    }) : [];
    if (state.activeInspectModelId && failedModels.indexOf(state.activeInspectModelId) === -1) {
      state.activeInspectModelId = failedModels[0] || "";
    } else if (!state.activeInspectModelId) {
      state.activeInspectModelId = failedModels[0] || "";
    }
    renderRunInspector(run);
  } catch (e) {
    console.warn("Run inspection failed:", e.message);
  }
}

export function populateRunFilter() {
  if (!state.isAnalyticsPage) return;
  function populateSelect(selectId, values, emptyLabel, formatter) {
    var select = document.getElementById(selectId);
    var current = select.value;
    select.textContent = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = emptyLabel;
    select.appendChild(all);
    values.forEach(function(value) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = formatter ? formatter(value) : value;
      select.appendChild(option);
    });
    select.value = current;
  }

  populateSelect("runsCrownFilter", state.models.map(function(model) { return model.id; }), "all winners", modelName);
  populateSelect("runsFailModelFilter", state.models.map(function(model) { return model.id; }), "all failed models", modelName);
  populateSelect("runsContestantProviderFilter", state.providerOptions.contestant, "all contestant providers");
  populateSelect("runsJudgeProviderFilter", state.providerOptions.judge, "all judge providers");
}

export function setProviderOptionsFromSummary() {
  if (!state.isAnalyticsPage) return;
  var contestant = Object.keys(state.failureSummary && state.failureSummary.byContestantProvider || {});
  var judge = Object.keys(state.failureSummary && state.failureSummary.byJudgeProvider || {});
  state.providerOptions = {
    contestant: Array.from(new Set((state.providerOptions.contestant || []).concat(contestant))).sort(),
    judge: Array.from(new Set((state.providerOptions.judge || []).concat(judge))).sort(),
  };
  populateRunFilter();
}

export function renderDrilldownBar() {
  if (!state.isAnalyticsPage) return;
  var bar = document.getElementById("drilldownBar");
  var entries = Object.keys(state.drilldownFilters).filter(function(key) { return state.drilldownFilters[key]; });
  bar.textContent = "";
  bar.style.display = entries.length ? "flex" : "none";
  entries.forEach(function(key) {
    var pill = document.createElement("div");
    pill.className = "drillpill";
    var label = key + ": " + String(state.drilldownFilters[key]).replace(/_/g, " ");
    if (key === "failedModelId") label = "failed model: " + modelName(state.drilldownFilters[key]);
    if (key === "phase") label = "phase: " + String(state.drilldownFilters[key]).replace(/_/g, " ");
    pill.textContent = label;
    var close = document.createElement("button");
    close.textContent = "×";
    close.onclick = function() {
      state.drilldownFilters[key] = "";
      handleRunFilter();
    };
    pill.appendChild(close);
    bar.appendChild(pill);
  });
}

export function applyDrilldown(filters) {
  if (!state.isAnalyticsPage) return;
  Object.keys(filters || {}).forEach(function(key) {
    state.drilldownFilters[key] = filters[key];
  });
  if (filters.failedModelId) {
    document.getElementById("runsFailModelFilter").value = filters.failedModelId;
  }
  if (filters.contestantProvider) {
    document.getElementById("runsContestantProviderFilter").value = filters.contestantProvider;
  }
  if (filters.judgeProvider) {
    document.getElementById("runsJudgeProviderFilter").value = filters.judgeProvider;
  }
  if (filters.status) {
    document.getElementById("runsStatusFilter").value = filters.status;
  }
  if (filters.dateFrom) {
    document.getElementById("runsDateFrom").value = filters.dateFrom;
  }
  if (filters.dateTo) {
    document.getElementById("runsDateTo").value = filters.dateTo;
  }
  renderDrilldownBar();
  handleRunFilter(true);
}

export function syncDrilldownWithControls(keepPhase) {
  if (!state.isAnalyticsPage) return;
  state.drilldownFilters.failedModelId = document.getElementById("runsFailModelFilter").value;
  state.drilldownFilters.contestantProvider = document.getElementById("runsContestantProviderFilter").value;
  state.drilldownFilters.judgeProvider = document.getElementById("runsJudgeProviderFilter").value;
  state.drilldownFilters.dateFrom = document.getElementById("runsDateFrom").value;
  state.drilldownFilters.dateTo = document.getElementById("runsDateTo").value;
  if (!keepPhase) {
    state.drilldownFilters.phase = "";
  }
  renderDrilldownBar();
}

export function handleRunFilter(keepPhase) {
  if (!state.isAnalyticsPage) return;
  state.runsOffset = 0;
  syncDrilldownWithControls(keepPhase);
  var filters = getCurrentRunFilters();
  refreshRuns(filters);
  refreshFailureSummary(filters);
  refreshAnalytics(filters);
}

export function changeRunsPage(delta) {
  if (!state.isAnalyticsPage) return;
  state.runsOffset = Math.max(0, state.runsOffset + (delta * RUNS_PAGE_SIZE));
  refreshRuns(getCurrentRunFilters());
}

export function exportRuns(format) {
  if (!state.isAnalyticsPage) return;
  var query = new URLSearchParams(getCurrentRunFilters());
  query.set("format", format || "json");
  window.location.href = "/api/runs/export?" + query.toString();
}

// Soft reset — clears results but keeps the typed prompt intact
export async function refreshAdminAnalytics() {
  if (!state.showAnalyticsOnIndex && !state.isAnalyticsPage) return;
  try {
    var runsRes = await fetch("/api/runs?limit=10");
    var runsData = await runsRes.json();
    state.recentRuns = Array.isArray(runsData.items) ? runsData.items : [];
  } catch (e) { state.recentRuns = []; }
  try {
    var failRes = await fetch("/api/failures/summary");
    state.failureSummary = await failRes.json();
  } catch (e) { state.failureSummary = null; }
  try {
    var anRes = await fetch("/api/analytics");
    state.analyticsSummary = await anRes.json();
  } catch (e) { state.analyticsSummary = null; }
  renderAnalytics();
  renderFailureSummary();
  renderDrilldownBar();
  renderRunsPanel();
  if (state.recentRuns[0]) inspectRun(state.recentRuns[0].id);
  try {
    var driftRes = await fetch("/api/drift");
    var driftData = await driftRes.json();
    renderDrift(driftData);
  } catch (e) { console.warn("Drift refresh failed:", e.message); }
}

