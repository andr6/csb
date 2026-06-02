import {
  MODELS, _blindMode, _blindReversed, _blindRevealed, _tournamentScores,
  MODES, CURATED, VOTE_LABELS, SYMPTOMS,
  _pageToken, _tokenRefreshPromise, _activePack, _packPersonas, isAnalyticsPage, _showAnalyticsOnIndex,
  runPagePath, modelProfilePath, isRunPage, isModelProfilePage,
  currentMode, votes, autoVotes, userVotes, history, responses, recentRuns, activeRunId, runsTotal, runsOffset,
  failureSummary, analyticsSummary, providerOptions, drilldownFilters, activeInspectModelId,
  SCORING_CRITERIA_KEYS, _userIsTyping, currentTournament,
  _authToken, _currentUser, _pendingEmail, _lastConfig, _originalFetch, _oauthPopup,
  modelColor, modelGlyph, modelName, modelMaker, createBlindMapping, swapKeys,
  getBlindLabel, getBlindGlyph, getBlindMaker,
  esc, setDisplay,
} from './state.js';

import {
  renderLeaderboard, renderRunInspector, buildRunListItem,
  buildLoadingCard, updateCard, buildScorePill, buildCrownBanner, setVerdictContent,
  showError, typewrite, buildSymptoms, shitTier, detectSymptoms, calcShitScore, categorizeClientError,
  renderVoteButtons, saveVoteState, loadVoteState, autoVote, vote, getModelVotes, refreshVotes,
  buildLeaderboardRow, populateVersusPickers, getActiveModels,
  updateResultsHeader,
} from './ui.js';

import {
  usePrompt,
} from './modes.js';
function loadCommunityPrompts() {
  fetch("/api/prompts/community")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !Array.isArray(data.items) || !data.items.length) return;
      var strip = document.getElementById("randomStrip");
      if (!strip) return;
      data.items.slice(0, 3).forEach(function(item) {
        var btn = document.createElement("button");
        btn.className = "prompt-pill";
        btn.dataset.p = item.prompt;
        btn.textContent = item.prompt;
        btn.title = "Community prompt";
        btn.onclick = function() { usePrompt(btn.dataset.p); };
        strip.appendChild(btn);
      });
    })
    .catch(function() {});
}

function renderShareLink(firedPrompt) {
  var results = document.getElementById("results");
  if (!results) return;
  var existing = document.getElementById("shareLinkWrap");
  if (existing) existing.remove();
  var prompt = firedPrompt || ((document.getElementById("promptInput") && document.getElementById("promptInput").value.trim()) || "");
  if (!prompt) return;
  var wrap = document.createElement("div");
  wrap.id = "shareLinkWrap";
  wrap.style.cssText = "margin:.75rem 0 0;font-size:.7rem";
  var link = document.createElement("a");
  link.className = "share-link";
  link.href = "/?replay=" + encodeURIComponent(prompt);
  link.textContent = "↗ share this prompt";
  link.target = "_blank";
  wrap.appendChild(link);
  var roastBox = document.getElementById("roastBox");
  if (roastBox && roastBox.parentNode) {
    roastBox.parentNode.insertBefore(wrap, roastBox.nextSibling);
  } else {
    results.appendChild(wrap);
  }
}

function renderReplayDiff(baseScores, newScores) {
  var existing = document.getElementById("replayDiffWrap");
  if (existing) existing.remove();
  var models = Object.keys(newScores || {});
  if (!models.length) return;
  var wrap = document.createElement("div");
  wrap.id = "replayDiffWrap";
  wrap.className = "replay-diff";
  var title = document.createElement("div");
  title.className = "replay-diff-title";
  title.textContent = "Replay comparison";
  wrap.appendChild(title);
  var header = document.createElement("div");
  header.className = "replay-diff-row";
  header.innerHTML = "<span>Model</span><span>Before</span><span>After</span><span>Delta</span>";
  wrap.appendChild(header);
  models.forEach(function(id) {
    var before = Number(baseScores && baseScores[id] != null ? baseScores[id] : "—");
    var after  = Number(newScores[id]);
    var row = document.createElement("div");
    row.className = "replay-diff-row";
    var delta = isNaN(before) ? "—" : (after - before > 0 ? "+" : "") + (after - before);
    row.innerHTML = "<span>" + esc(id) + "</span><span>" + (isNaN(before) ? "—" : esc(before) + "%") + "</span><span>" + esc(after) + "%</span><span>" + esc(delta) + "</span>";
    wrap.appendChild(row);
  });
  var roastBox = document.getElementById("roastBox");
  if (roastBox && roastBox.parentNode) {
    roastBox.parentNode.insertBefore(wrap, roastBox.nextSibling);
  } else {
    var results = document.getElementById("results");
    if (results) results.appendChild(wrap);
  }
}
function renderRunPage(runId) {
  if (!runId) return;
  fetch("/api/runs/" + encodeURIComponent(runId) + "/public")
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(run) { inspectRun(run.id, run); })
    .catch(function(e) { console.warn("[run-page]", e); });
}

function renderModelProfile(modelId) {
  if (!modelId) return;
  var el = document.getElementById("modelProfile");
  if (!el) return;
  el.style.display = "block";
  el.textContent = "";
  var loadDiv = document.createElement("div");
  loadDiv.style.cssText = "padding:2rem;color:#888;font-size:.85rem";
  loadDiv.textContent = "Loading " + modelId + " profile...";
  el.appendChild(loadDiv);
  fetch("/api/analytics?crownModelId=" + encodeURIComponent(modelId))
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      var stats = data && data.modelStats ? data.modelStats.find(function(s) { return s.modelId === modelId; }) : null;
      el.textContent = "";
      if (stats) {
        var wrap = document.createElement("div"); wrap.style.padding = "1rem";
        var h2 = document.createElement("h2"); h2.style.fontFamily = "Oswald,sans-serif"; h2.textContent = modelId;
        var pre = document.createElement("pre"); pre.style.cssText = "font-size:.72rem;color:#cfc9bc"; pre.textContent = JSON.stringify(stats, null, 2);
        wrap.appendChild(h2); wrap.appendChild(pre); el.appendChild(wrap);
      } else {
        var nd = document.createElement("div"); nd.style.cssText = "padding:2rem;color:#888;font-size:.85rem";
        nd.textContent = "No data for " + modelId + " yet."; el.appendChild(nd);
      }
    })
    .catch(function() {
      el.textContent = "";
      var ed = document.createElement("div"); ed.style.cssText = "padding:2rem;color:#888";
      ed.textContent = "Could not load profile."; el.appendChild(ed);
    });
}
function renderAnalytics(extra) {
  extra = extra || {};
  var panel = document.getElementById("analyticsPanel");
  if (!isAnalyticsPage && !_showAnalyticsOnIndex) {
    panel.style.display = "none";
    return;
  }
  var summary = analyticsSummary || {
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

  function formatMoney(value) {
    return "$" + Number(value || 0).toFixed(2);
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
    return String(item.avgScore) + " avg score • " + String(item.winRate) + "% win • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsMostReliable", summary.recommendations && summary.recommendations.mostReliable, function(item) {
    return String(item.reliability) + "% reliable • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsFastest", summary.recommendations && summary.recommendations.fastest, function(item) {
    return String(item.avgDurationMs) + "ms avg latency • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsBestValue", summary.recommendations && summary.recommendations.bestValue, function(item) {
    return String(item.scorePerDollar || item.scorePerCost || 0) + " score/$ • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsDefaultChoice", summary.recommendations && summary.recommendations.defaultChoice, function(item) {
    return String(item.avgScore) + " avg • " + String(item.reliability) + "% reliable • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsCheapFallback", summary.recommendations && summary.recommendations.cheapFallback, function(item) {
    return String(item.scorePerDollar || item.scorePerCost || 0) + " score/$ • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsPremiumChoice", summary.recommendations && summary.recommendations.premiumChoice, function(item) {
    return String(item.avgScore) + " avg • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsCheapestReliable", summary.recommendations && summary.recommendations.cheapestReliable, function(item) {
    return String(item.reliability) + "% reliable • " + formatMoney(item.unitCostUsd) + "/run";
  });
  fillRecommendation("analyticsSpendLeader", summary.recommendations && summary.recommendations.spendLeader, function(item) {
    return formatMoney(item.estimatedSpendUsd || 0) + " total • " + String(item.spendSharePct || 0) + "% share";
  });
  fillRecommendation("analyticsPolicyPromote", summary.recommendations && summary.recommendations.promote, function(item) {
    return String(item.reliability) + "% reliable • " + String(item.scorePerDollar || 0) + " score/$";
  });
  fillRecommendation("analyticsPolicyDemote", summary.recommendations && summary.recommendations.demote, function(item) {
    return (item.policyReasons || []).join(", ") + " • " + formatMoney(item.unitCostUsd || 0) + "/run";
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
      [modelName(item.modelId), String(item.avgScore), String(item.wins), String(item.winRate) + "%", String(item.reliability) + "%", String(item.avgDurationMs) + "ms", formatMoney(item.unitCostUsd || 0), formatMoney(item.estimatedSpendUsd || 0), String(item.scorePerDollar || item.scorePerCost || 0)].forEach(function(value) {
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
      [modelName(item.modelId), String(item.avgScore), String(item.wins), String(item.winRate) + "%", String(item.reliability) + "%", String(item.avgDurationMs) + "ms", formatMoney(item.unitCostUsd || 0), formatMoney(item.estimatedSpendUsd || 0), String(item.scorePerDollar || item.scorePerCost || 0)].forEach(function(value) {
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
      formatMoney(entry.item.unitCostUsd || 0) + "/run",
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
        row.textContent = modelName(item.modelId) + " • " + String(item.reliability || 0) + "% • " + formatMoney(item.unitCostUsd || 0);
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

function renderPackStats(data) {
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

function renderModeStats(data) {
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

function renderProviderHealth(data) {
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

function renderResponseLengths(data) {
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

function renderWinStreaks(data) {
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

function renderBlindAlignment(data) {
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
  status.className = "budget-status ok";
  status.textContent = data.alignmentPct + "% (" + data.alignedVotes + " / " + data.totalVotes + ")";
  row.appendChild(status);
  el.appendChild(row);
}

function renderPromptTopics(data) {
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

function renderCostForecast(data) {
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

function renderPatternStats(data) {
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

function emptyAnalytics(msg) {
  var el = document.createElement("div");
  el.className = "analytics-empty";
  el.textContent = msg || "No data.";
  return el;
}

function renderPromptDifficulty(data) {
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

function renderHeadToHead(data) {
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

function renderScoreVolatility(data) {
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

function renderContestantLatency(data) {
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

function renderUpsets(data) {
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

function renderUserEngagement(data) {
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

function renderRetryRecovery(data) {
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

function renderPromptLengthVsScore(data) {
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

function renderDrift(data) {
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

async function refreshHistory() {
  if (isAnalyticsPage) return;
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    history = Array.isArray(data.items) ? data.items : [];
    renderLeaderboard();
  } catch (e) {
    console.warn("History refresh failed:", e.message);
  }
}

async function refreshAnalytics(params) {
  if (!isAnalyticsPage && !_showAnalyticsOnIndex) return;
  try {
    const res = await fetch("/api/analytics?" + new URLSearchParams(params || {}).toString());
    analyticsSummary = await res.json();
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

function getCurrentRunFilters() {
  return {
    limit: RUNS_PAGE_SIZE,
    offset: runsOffset,
    query: document.getElementById("runsSearch").value.trim(),
    crownModelId: document.getElementById("runsCrownFilter").value,
    status: document.getElementById("runsStatusFilter").value,
    contestantProvider: document.getElementById("runsContestantProviderFilter").value,
    judgeProvider: document.getElementById("runsJudgeProviderFilter").value,
    failedModelId: document.getElementById("runsFailModelFilter").value,
    dateFrom: document.getElementById("runsDateFrom").value,
    dateTo: document.getElementById("runsDateTo").value,
    phase: drilldownFilters.phase || "",
  };
}

async function refreshRuns(params) {
  if (!isAnalyticsPage) return;
  try {
    var query = new URLSearchParams(params || {});
    const res = await fetch("/api/runs?" + query.toString());
    const data = await res.json();
    recentRuns = Array.isArray(data.items) ? data.items : [];
    runsTotal = Number(data.total || recentRuns.length || 0);
    renderRunsPanel();
    if (!activeRunId && recentRuns[0]) {
      inspectRun(recentRuns[0].id);
    }
  } catch (e) {
    console.warn("Runs refresh failed:", e.message);
  }
}

function topCounter(map) {
  if (!map || typeof map !== "object") return { key: "none", count: 0 };
  return Object.keys(map).reduce(function(best, key) {
    var count = Number(map[key] || 0);
    if (count > best.count) return { key: key, count: count };
    return best;
  }, { key: "none", count: 0 });
}

function rankedCounters(map, limit, formatter) {
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

function renderFailureRows(targetId, rows, emptyLabel) {
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

function renderErrorRollup(items) {
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

function getSavedViews() {
  try {
    var raw = window.localStorage.getItem(SAVED_VIEW_KEY);
    var parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function setSavedViews(views) {
  try {
    window.localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(views.slice(0, 8)));
  } catch (e) {}
}

function saveCurrentView() {
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

function loadSavedView(view) {
  var filters = view.filters || {};
  document.getElementById("runsSearch").value = filters.query || "";
  document.getElementById("runsCrownFilter").value = filters.crownModelId || "";
  document.getElementById("runsStatusFilter").value = filters.status || "";
  document.getElementById("runsContestantProviderFilter").value = filters.contestantProvider || "";
  document.getElementById("runsJudgeProviderFilter").value = filters.judgeProvider || "";
  document.getElementById("runsFailModelFilter").value = filters.failedModelId || "";
  document.getElementById("runsDateFrom").value = filters.dateFrom || "";
  document.getElementById("runsDateTo").value = filters.dateTo || "";
  drilldownFilters.phase = filters.phase || "";
  syncDrilldownWithControls(true);
  var current = getCurrentRunFilters();
  refreshRuns(current);
  refreshFailureSummary(current);
}

function renderSavedViews() {
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

function renderParseSamples(samples) {
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

function renderFailureSummary() {
  var total = failureSummary && Number(failureSummary.totalFailures || 0);
  var topStatus = topCounter(failureSummary && failureSummary.byStatus);
  var topModel = topCounter(failureSummary && failureSummary.byModel);
  var contestant = topCounter(failureSummary && failureSummary.byContestantProvider);
  var judge = topCounter(failureSummary && failureSummary.byJudgeProvider);
  var topPhase = topCounter(failureSummary && failureSummary.judgePhases);
  var topProvider = contestant.count >= judge.count ? contestant : judge;
  var providerCounts = {};
  Object.keys(failureSummary && failureSummary.byContestantProvider || {}).forEach(function(key) {
    providerCounts[key] = (providerCounts[key] || 0) + Number(failureSummary.byContestantProvider[key] || 0);
  });
  Object.keys(failureSummary && failureSummary.byJudgeProvider || {}).forEach(function(key) {
    providerCounts[key] = (providerCounts[key] || 0) + Number(failureSummary.byJudgeProvider[key] || 0);
  });

  document.getElementById("failTotal").textContent = String(total || 0);
  document.getElementById("failStatus").textContent = topStatus.key === "none" ? "none" : topStatus.key.replace(/_/g, " ");
  document.getElementById("failStatusMeta").textContent = topStatus.count
    ? String(topStatus.count) + " runs · phase " + (topPhase.key === "none" ? "n/a" : topPhase.key.replace(/_/g, " "))
    : "top failure status";
  document.getElementById("failModel").textContent = topModel.key === "none" ? "none" : modelName(topModel.key);
  document.getElementById("failModelMeta").textContent = topModel.count
    ? String(topModel.count) + " failed runs · retries " + String(failureSummary && failureSummary.totalRetryAttempts || 0)
    : "most affected model";
  document.getElementById("failProvider").textContent = topProvider.key === "none" ? "none" : topProvider.key;
  document.getElementById("failProviderMeta").textContent = topProvider.count
    ? String(topProvider.count) + " failed runs · fallbacks " + String(failureSummary && failureSummary.fallbackRuns || 0)
    : "most affected provider";

  renderFailureRows("failModelTable", rankedCounters(failureSummary && failureSummary.byModel, 6, modelName).map(function(row) {
    row.onClick = function() { applyDrilldown({ failedModelId: row.key }); };
    return row;
  }), "No model failures recorded.");
  renderFailureRows(
    "failProviderTable",
    rankedCounters(
      providerCounts,
      6,
      function(key) {
        var contestantCount = Number(failureSummary && failureSummary.byContestantProvider && failureSummary.byContestantProvider[key] || 0);
        var judgeCount = Number(failureSummary && failureSummary.byJudgeProvider && failureSummary.byJudgeProvider[key] || 0);
        if (contestantCount && judgeCount) return key + " (contestant + judge)";
        if (contestantCount) return key + " (contestant)";
        if (judgeCount) return key + " (judge)";
        return key;
      }
    ).map(function(row) {
      var contestantCount = Number(failureSummary && failureSummary.byContestantProvider && failureSummary.byContestantProvider[row.key] || 0);
      var judgeCount = Number(failureSummary && failureSummary.byJudgeProvider && failureSummary.byJudgeProvider[row.key] || 0);
      row.onClick = function() {
        applyDrilldown(contestantCount >= judgeCount ? { contestantProvider: row.key } : { judgeProvider: row.key });
      };
      return row;
    }),
    "No provider failures recorded."
  );
  renderFailureRows("failPolicyTable", [
    { label: "retry policy: " + ((topCounter(failureSummary && failureSummary.byRetryPolicy).key || "none").replace(/_/g, " ")), count: topCounter(failureSummary && failureSummary.byRetryPolicy).count || 0 },
    { label: "fallback policy: " + ((topCounter(failureSummary && failureSummary.byFallbackPolicy).key || "none").replace(/_/g, " ")), count: topCounter(failureSummary && failureSummary.byFallbackPolicy).count || 0 },
    { label: "error category: " + ((topCounter(failureSummary && failureSummary.errorCategories).key || "none").replace(/_/g, " ")), count: topCounter(failureSummary && failureSummary.errorCategories).count || 0 },
    { label: "upstream status: " + (topCounter(failureSummary && failureSummary.upstreamStatuses).key || "none"), count: topCounter(failureSummary && failureSummary.upstreamStatuses).count || 0 },
    { label: "total retry attempts", count: Number(failureSummary && failureSummary.totalRetryAttempts || 0) },
    { label: "runs using fallback", count: Number(failureSummary && failureSummary.fallbackRuns || 0) },
  ], "No retry or fallback data recorded.");
  renderErrorRollup(rankedCounters(failureSummary && failureSummary.errorMessages, 5).map(function(item) {
    var topCategory = topCounter(failureSummary && failureSummary.errorCategories).key;
    item.label = item.label + " [" + (topCategory === "none" ? "uncategorized" : topCategory.replace(/_/g, " ")) + "]";
    item.onClick = function() {
      if (topCategory !== "none") {
        applyDrilldown({ status: document.getElementById("runsStatusFilter").value || "failure" });
      }
    };
    return item;
  }));
  renderParseSamples(Array.isArray(failureSummary && failureSummary.latestJudgeParseFailures) ? failureSummary.latestJudgeParseFailures : []);
  setProviderOptionsFromSummary();
  renderDrilldownBar();
}

async function refreshFailureSummary(params) {
  if (!isAnalyticsPage) return;
  try {
    const res = await fetch("/api/failures/summary?" + new URLSearchParams(params || {}).toString());
    failureSummary = await res.json();
    renderFailureSummary();
  } catch (e) {
    console.warn("Failure summary refresh failed:", e.message);
  }
}

function renderRunsPanel() {
  var panel = document.getElementById("runsPanel");
  if (!isAnalyticsPage) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = recentRuns.length ? "block" : "none";
  if (!recentRuns.length) return;

  document.getElementById("runsPrevBtn").disabled = runsOffset <= 0;
  document.getElementById("runsNextBtn").disabled = runsOffset + RUNS_PAGE_SIZE >= runsTotal;
  document.getElementById("runsPageInfo").textContent =
    "page " + (Math.floor(runsOffset / RUNS_PAGE_SIZE) + 1) + " of " + Math.max(1, Math.ceil(runsTotal / RUNS_PAGE_SIZE));

  var list = document.getElementById("runsList");
  list.textContent = "";
  recentRuns.forEach(function(run) {
    list.appendChild(buildRunListItem(run));
  });
}

async function inspectRun(id) {
  if (!isAnalyticsPage) return;
  try {
    activeRunId = id;
    renderRunsPanel();
    const res = await fetch("/api/runs/" + encodeURIComponent(id));
    const run = await res.json();
    var failedModels = run.execution && run.execution.models ? Object.keys(run.execution.models).filter(function(modelId) {
      return run.execution.models[modelId] && run.execution.models[modelId].status && run.execution.models[modelId].status !== "success";
    }) : [];
    if (activeInspectModelId && failedModels.indexOf(activeInspectModelId) === -1) {
      activeInspectModelId = failedModels[0] || "";
    } else if (!activeInspectModelId) {
      activeInspectModelId = failedModels[0] || "";
    }
    renderRunInspector(run);
  } catch (e) {
    console.warn("Run inspection failed:", e.message);
  }
}

function populateRunFilter() {
  if (!isAnalyticsPage) return;
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

  populateSelect("runsCrownFilter", MODELS.map(function(model) { return model.id; }), "all winners", modelName);
  populateSelect("runsFailModelFilter", MODELS.map(function(model) { return model.id; }), "all failed models", modelName);
  populateSelect("runsContestantProviderFilter", providerOptions.contestant, "all contestant providers");
  populateSelect("runsJudgeProviderFilter", providerOptions.judge, "all judge providers");
}

function setProviderOptionsFromSummary() {
  if (!isAnalyticsPage) return;
  var contestant = Object.keys(failureSummary && failureSummary.byContestantProvider || {});
  var judge = Object.keys(failureSummary && failureSummary.byJudgeProvider || {});
  providerOptions = {
    contestant: Array.from(new Set((providerOptions.contestant || []).concat(contestant))).sort(),
    judge: Array.from(new Set((providerOptions.judge || []).concat(judge))).sort(),
  };
  populateRunFilter();
}

function renderDrilldownBar() {
  if (!isAnalyticsPage) return;
  var bar = document.getElementById("drilldownBar");
  var entries = Object.keys(drilldownFilters).filter(function(key) { return drilldownFilters[key]; });
  bar.textContent = "";
  bar.style.display = entries.length ? "flex" : "none";
  entries.forEach(function(key) {
    var pill = document.createElement("div");
    pill.className = "drillpill";
    var label = key + ": " + String(drilldownFilters[key]).replace(/_/g, " ");
    if (key === "failedModelId") label = "failed model: " + modelName(drilldownFilters[key]);
    if (key === "phase") label = "phase: " + String(drilldownFilters[key]).replace(/_/g, " ");
    pill.textContent = label;
    var close = document.createElement("button");
    close.textContent = "×";
    close.onclick = function() {
      drilldownFilters[key] = "";
      handleRunFilter();
    };
    pill.appendChild(close);
    bar.appendChild(pill);
  });
}

function applyDrilldown(filters) {
  if (!isAnalyticsPage) return;
  Object.keys(filters || {}).forEach(function(key) {
    drilldownFilters[key] = filters[key];
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

function syncDrilldownWithControls(keepPhase) {
  if (!isAnalyticsPage) return;
  drilldownFilters.failedModelId = document.getElementById("runsFailModelFilter").value;
  drilldownFilters.contestantProvider = document.getElementById("runsContestantProviderFilter").value;
  drilldownFilters.judgeProvider = document.getElementById("runsJudgeProviderFilter").value;
  drilldownFilters.dateFrom = document.getElementById("runsDateFrom").value;
  drilldownFilters.dateTo = document.getElementById("runsDateTo").value;
  if (!keepPhase) {
    drilldownFilters.phase = "";
  }
  renderDrilldownBar();
}

function handleRunFilter(keepPhase) {
  if (!isAnalyticsPage) return;
  runsOffset = 0;
  syncDrilldownWithControls(keepPhase);
  var filters = getCurrentRunFilters();
  refreshRuns(filters);
  refreshFailureSummary(filters);
  refreshAnalytics(filters);
}

function changeRunsPage(delta) {
  if (!isAnalyticsPage) return;
  runsOffset = Math.max(0, runsOffset + (delta * RUNS_PAGE_SIZE));
  refreshRuns(getCurrentRunFilters());
}

function exportRuns(format) {
  if (!isAnalyticsPage) return;
  var query = new URLSearchParams(getCurrentRunFilters());
  query.set("format", format || "json");
  window.location.href = "/api/runs/export?" + query.toString();
}

// Soft reset — clears results but keeps the typed prompt intact
function softReset() {
  document.getElementById("fireBtn").style.display   = "block";
  document.getElementById("resetBtn").style.display  = "none";
  document.getElementById("revealBtn").style.display = "none";
  document.getElementById("results").style.display   = "none";
  document.getElementById("roastBox").style.display  = "none";
  document.getElementById("judgingBanner").style.display = "none";
  document.getElementById("cardsGrid").textContent   = "";
  // Clear rendered flags so next fire() starts fresh
  responses = {};
  document.getElementById("errorBanner").style.display = "none";
  responses = {}; votes = {}; autoVotes = {}; userVotes = {};
  _blindMode = false; _blindMapping = null; _blindReversed = null; _blindRevealed = false;
  currentTournament = null; _tournamentScores = {};
}

// ── TOURNAMENT ────────────────────────────────────────────────────────────────


export {
  loadCommunityPrompts, renderShareLink, renderReplayDiff,
  renderRunPage, renderModelProfile,
  renderAnalytics, renderPackStats, renderModeStats, renderProviderHealth,
  renderResponseLengths, renderWinStreaks, renderBlindAlignment, renderPromptTopics,
  renderCostForecast, renderPatternStats, emptyAnalytics, renderPromptDifficulty,
  renderHeadToHead, renderScoreVolatility, renderContestantLatency, renderUpsets,
  renderUserEngagement, renderRetryRecovery, renderPromptLengthVsScore, renderDrift,
  getCurrentRunFilters, topCounter, rankedCounters, renderFailureRows, renderErrorRollup,
  getSavedViews, setSavedViews, saveCurrentView, loadSavedView, renderSavedViews, renderParseSamples,
  renderFailureSummary, renderRunsPanel, populateRunFilter, setProviderOptionsFromSummary,
  renderDrilldownBar, applyDrilldown, syncDrilldownWithControls, handleRunFilter,
  changeRunsPage, exportRuns, softReset,
  refreshHistory, refreshAnalytics, refreshRuns, refreshFailureSummary, inspectRun,
};
