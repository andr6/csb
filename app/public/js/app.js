import {
  MODELS, _blindMode, _blindMapping, _blindReversed, _blindRevealed, _tournamentScores,
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
  updateResultsHeader, injectModerationPanel, applyPageMode,
  showError, setVerdictContent, buildCrownBanner, buildScorePill, buildVoteButton,
  renderVoteButtons, buildLoadingCard, buildSymptoms,
  buildLeaderboardRow, buildRunListItem, renderRunInspector,
  shitTier, detectSymptoms, calcShitScore, categorizeClientError,
  typewrite, renderLeaderboard,
  populateVersusPickers, getActiveModels,
  updateCard, getModelVotes, refreshVotes, autoVote, vote, saveVoteState, loadVoteState,
  reset, revealBlind,
  updateAuthUI, toggleUserMenu, openAccountSettings, closeAccountSettings, setSettingsMsg,
} from './ui.js';

import {
  renderModes, renderRandomStrip, usePrompt, setMode,
  buildPackSelector, buildCriteriaGrid, getActiveCriteria, updateChar,
  handleTyping, randomPrompt,
} from './modes.js';

import {
  refreshPageToken,
  fireModel, judgeResponses,
  moderatePrompt,
  handleUpdateName, handleUpdateEmail, handleUpdatePhone, handleChangePassword,
  refreshAdminAnalytics,
  initAuth, startOAuth, handleOAuthCallback, updateOAuthButtonVisibility,
  logout, handleRegister, handleVerifyEmailOtp, handleResendEmailOtp,
  handleLogin, handleVerifyPhoneOtp, handleForgotPassword, handleResendPhoneOtp,
} from './api.js';

import {
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
} from './analytics.js';

import {
  createTournament, renderTournamentBracket, refreshBracket,
  advanceTournamentWinner, runTournament,
} from './tournament.js';

import {
  showAuthRegister, showAuthLogin, showAuthEmailOtp, showAuthPhoneOtp, showAuthForgotPassword,
  hideAuthOverlay, clearOtpInputs, otpAutoAdvance, otpFinish, collectOtp, setFieldError,
} from './auth.js';
function init() {
  loadVoteState();
  applyPageMode();

  if (isRunPage) { renderRunPage(runPagePath); return; }
  if (isModelProfilePage) { renderModelProfile(modelProfilePath); return; }

  initAuth().then(function(authenticated) {
    if (!authenticated) {
      setDisplay("authOverlay", "flex");
      showAuthLogin();
    }
    _continueInit();
  });
}

function _continueInit() {
  var emptyHistoryPayload = { items: [] };
  var emptyRunsPayload = { items: [] };
  var emptyFailurePayload = { totalFailures: 0, byStatus: {}, byModel: {}, byContestantProvider: {}, byJudgeProvider: {}, judgePhases: {}, errorMessages: {}, errorCategories: {}, upstreamStatuses: {}, latestJudgeParseFailures: [], byRetryPolicy: {}, byFallbackPolicy: {}, totalRetryAttempts: 0, fallbackRuns: 0 };
  var emptyAnalyticsPayload = {
    totalRuns: 0,
    successRuns: 0,
    partialFailureRuns: 0,
    failureRuns: 0,
    successRate: 0,
    avgCrownScore: 0,
    avgJudgeMs: 0,
    contestantSpendUsd: 0,
    judgeSpendUsd: 0,
    estimatedSpendUsd: 0,
    avgRunSpendUsd: 0,
    dailyTrend: [],
    modelStats: [],
    pricing: { configuredModelCount: 0, judgeUnitCostUsd: null },
    budget: { slice: null, daily: null, monthlyProjected: null, averageDailySpendUsd: 0 },
    recommendations: {},
  };
  // Fetch config first to obtain the page token, then fetch everything else
  // in parallel (prompt endpoints require the token in X-Page-Token).
  fetch("/api/config")
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      _lastConfig = cfg;
      if (cfg._token) _pageToken = cfg._token;
      if (cfg.user) {
        _currentUser = cfg.user;
        updateAuthUI();
      }

      var tokenHeader = { "X-Page-Token": _pageToken };
      var shouldLoadAnalytics = isAnalyticsPage || _showAnalyticsOnIndex;
      var requests = [
        fetch("/api/history").then(function(r) { return r.json(); }).catch(function() { return emptyHistoryPayload; }),
        shouldLoadAnalytics ? fetch("/api/runs?limit=10").then(function(r) { return r.json(); }).catch(function() { return emptyRunsPayload; }) : Promise.resolve(emptyRunsPayload),
        shouldLoadAnalytics ? fetch("/api/failures/summary").then(function(r) { return r.json(); }).catch(function() { return emptyFailurePayload; }) : Promise.resolve(emptyFailurePayload),
        shouldLoadAnalytics ? fetch("/api/analytics").then(function(r) { return r.json(); }).catch(function() { return emptyAnalyticsPayload; }) : Promise.resolve(emptyAnalyticsPayload),
        fetch("/api/pack-prompts",  { headers: tokenHeader }).then(function(r) { return r.json(); }).catch(function() { return null; }),
        fetch("/api/mode-prompts",  { headers: tokenHeader }).then(function(r) { return r.json(); }).catch(function() { return null; }),
        shouldLoadAnalytics ? fetch("/api/analytics/packs").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/modes").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/providers").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/response-lengths").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/win-streaks").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/blind-alignment").then(function(r) { return r.json(); }).catch(function() { return { totalVotes: 0, alignedVotes: 0, alignmentPct: 0 }; }) : Promise.resolve({ totalVotes: 0, alignedVotes: 0, alignmentPct: 0 }),
        shouldLoadAnalytics ? fetch("/api/analytics/prompt-topics").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/cost-forecast").then(function(r) { return r.json(); }).catch(function() { return null; }) : Promise.resolve(null),
        shouldLoadAnalytics ? fetch("/api/patterns").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/prompt-difficulty").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/head-to-head").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/score-volatility").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/contestant-latency").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/upsets").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/user-engagement").then(function(r) { return r.json(); }).catch(function() { return { totalVotes: 0, uniqueVoters: 0, topVoters: [], dailyVotes: [], avgVotesPerVoter: 0 }; }) : Promise.resolve({ totalVotes: 0, uniqueVoters: 0, topVoters: [], dailyVotes: [], avgVotesPerVoter: 0 }),
        shouldLoadAnalytics ? fetch("/api/analytics/retry-recovery").then(function(r) { return r.json(); }).catch(function() { return { totalFailed: 0, totalRecovered: 0, recoveryRate: 0, byPolicy: [] }; }) : Promise.resolve({ totalFailed: 0, totalRecovered: 0, recoveryRate: 0, byPolicy: [] }),
        shouldLoadAnalytics ? fetch("/api/analytics/prompt-length-vs-score").then(function(r) { return r.json(); }).catch(function() { return { items: [] }; }) : Promise.resolve({ items: [] }),
      ];

      return Promise.all(requests).then(function(results) {
        return { cfg: cfg, results: results };
      });
    })
    .then(function(batch) {
      var cfg = batch.cfg;
      var results = batch.results;
      var historyPayload = results[0];
      var runsPayload = results[1];
      var failurePayload = results[2];
      var analyticsPayload = results[3];
      var packPayload = results[4];
      var modePayload = results[5];
      var packStatsPayload = results[6];
      var modeStatsPayload = results[7];
      var providerHealthPayload = results[8];
      var responseLengthsPayload = results[9];
      var winStreaksPayload = results[10];
      var blindAlignmentPayload = results[11];
      var promptTopicsPayload = results[12];
      var costForecastPayload = results[13];
      var patternStatsPayload = results[14];
      var promptDifficultyPayload = results[15];
      var headToHeadPayload = results[16];
      var scoreVolatilityPayload = results[17];
      var contestantLatencyPayload = results[18];
      var upsetsPayload = results[19];
      var userEngagementPayload = results[20];
      var retryRecoveryPayload = results[21];
      var promptLengthVsScorePayload = results[22];
      if (packPayload) {
        if (packPayload.rage)     CURATED.rage    = packPayload.rage;
        if (packPayload.absurd)   CURATED.absurd  = packPayload.absurd || CURATED.absurd;
        if (packPayload.truth)    CURATED.truth   = packPayload.truth  || CURATED.truth;
        if (packPayload.bar)      CURATED.bar     = packPayload.bar    || CURATED.bar;
        if (packPayload.lab)      CURATED.lab     = packPayload.lab    || CURATED.lab;
        if (packPayload.midway)   CURATED.midway  = packPayload.midway || CURATED.midway;
        if (packPayload.booth)    CURATED.booth   = packPayload.booth  || CURATED.booth;
        if (packPayload.news)     CURATED.news    = packPayload.news   || CURATED.news;
        if (packPayload.globe)    CURATED.globe   = packPayload.globe  || CURATED.globe;
        if (packPayload.irc)      CURATED.irc     = packPayload.irc    || CURATED.irc;
        if (packPayload.redteam)  CURATED.redteam = packPayload.redteam|| CURATED.redteam;
        if (packPayload.rally)    CURATED.rally   = packPayload.rally  || CURATED.rally;
      }
      if (modePayload) {
        if (modePayload.versus)     CURATED.versus     = modePayload.versus     || CURATED.versus;
        if (modePayload.tournament) CURATED.tournament = modePayload.tournament || CURATED.tournament;
        if (modePayload.custom)     CURATED.custom     = modePayload.custom     || CURATED.custom;
      }
      if (cfg.packs && cfg.packs.length) {
        buildPackSelector(cfg.packs);
        cfg.packs.forEach(function(p) { if (p.persona) _packPersonas[p.id] = p.persona; });
      }
      var modelMap = cfg.models || {};
      // Build MODELS array dynamically — no hardcoded metadata needed
      MODELS = Object.keys(modelMap).map(function(id) {
        var modelStr = modelMap[id] || id;
        return {
          id:    id,
          name:  modelName(id),
          maker: modelMaker(modelStr),
          color: modelColor(id),
          glyph: modelGlyph(id),
        };
      });
      providerOptions = {
        contestant: cfg.contestantProvider ? [cfg.contestantProvider] : [],
        judge: cfg.judgeProvider ? [cfg.judgeProvider] : [],
      };
      updateOAuthButtonVisibility(cfg.oauthProviders);
      history = Array.isArray(historyPayload.items) ? historyPayload.items : [];
      recentRuns = Array.isArray(runsPayload.items) ? runsPayload.items : [];
      failureSummary = failurePayload || null;
      analyticsSummary = analyticsPayload || null;
      renderModes();
      if (!isAnalyticsPage) {
        renderRandomStrip();
      }
      renderLeaderboard();
      renderAnalytics({
        packStats: packStatsPayload,
        modeStats: modeStatsPayload,
        providerHealth: providerHealthPayload,
        responseLengths: responseLengthsPayload,
        winStreaks: winStreaksPayload,
        blindAlignment: blindAlignmentPayload,
        promptTopics: promptTopicsPayload,
        costForecast: costForecastPayload,
        patternStats: patternStatsPayload,
        promptDifficulty: promptDifficultyPayload,
        headToHead: headToHeadPayload,
        scoreVolatility: scoreVolatilityPayload,
        contestantLatency: contestantLatencyPayload,
        upsets: upsetsPayload,
        userEngagement: userEngagementPayload,
        retryRecovery: retryRecoveryPayload,
        promptLengthVsScore: promptLengthVsScorePayload,
      });
      if (isAnalyticsPage || _showAnalyticsOnIndex) {
        populateRunFilter();
        renderSavedViews();
        renderFailureSummary();
        renderDrilldownBar();
        renderRunsPanel();
        loadModerationPanel();
      }
      if ((isAnalyticsPage || _showAnalyticsOnIndex) && recentRuns[0]) {
        inspectRun(recentRuns[0].id);
      }
      // F2 populate versus pickers (only meaningful on main arena page)
      if (!isAnalyticsPage) {
        populateVersusPickers();
        buildCriteriaGrid();
      }
      // F4 honor ?replay= query
      var qs = new URLSearchParams(window.location.search || "");
      var replayVal = qs.get("replay");
      if (replayVal && !isAnalyticsPage) {
        var input = document.getElementById("promptInput");
        if (input) { input.value = replayVal; updateChar(); }
      }
      // F5 community prompts (silent on failure)
      loadCommunityPrompts();
    })
    .catch(function(e) {
      console.warn("Config fetch failed:", e);
      // Fallback — show minimal set so page isn't blank
      MODELS = [
        { id:"gpt4o",   name:"GPT-4o",   maker:"OpenAI",    color:"#10a37f", glyph:"⬡" },
        { id:"claude",  name:"Claude",   maker:"Anthropic", color:"#d97706", glyph:"◈" },
        { id:"gemini",  name:"Gemini",   maker:"Google",    color:"#4285f4", glyph:"◇" },
      ];
      renderModes();
      if (!isAnalyticsPage) {
        renderRandomStrip();
      }
      renderLeaderboard();
      renderAnalytics({});
      if (isAnalyticsPage || _showAnalyticsOnIndex) {
        populateRunFilter();
        renderSavedViews();
        renderFailureSummary();
        renderDrilldownBar();
        renderRunsPanel();
        loadModerationPanel();
      }
      if (!isAnalyticsPage) {
        populateVersusPickers();
      }
      loadCommunityPrompts();
    });

  setInterval(function() {
    var l = document.getElementById("logo");
    if (l) { l.classList.add("glitch"); setTimeout(function(){ l.classList.remove("glitch"); }, 200); }
  }, 5000);
}
async function fire() {
  const prompt = document.getElementById("promptInput").value.trim();
  if (!prompt) return;

  responses = {}; votes = {}; autoVotes = {}; userVotes = {};
  _userIsTyping = false; // prevent softReset during render

  // F2 — restrict to two models in versus mode
  var activeModels = getActiveModels();

  // Blind mode setup
  var blindToggle = document.getElementById("blindToggle");
  _blindMode = blindToggle ? blindToggle.checked : false;
  _blindRevealed = false;
  if (_blindMode) {
    var bm = createBlindMapping(activeModels.map(function(m) { return m.id; }));
    _blindMapping = bm.mapping;
    _blindReversed = bm.reversed;
  } else {
    _blindMapping = null; _blindReversed = null;
  }

  // UI state
  updateResultsHeader();
  document.getElementById("fireBtn").style.display   = "none";
  document.getElementById("resetBtn").style.display  = "block";
  document.getElementById("revealBtn").style.display = _blindMode ? "block" : "none";
  document.getElementById("results").style.display   = "block";
  document.getElementById("roastBox").style.display  = "none";
  document.getElementById("errorBanner").style.display = "none";
  document.getElementById("judgingBanner").style.display = "none";

  // Tournament mode: run bracket instead of normal flow
  if (currentMode === "tournament") {
    document.getElementById("cardsGrid").style.display = "none";
    await runTournament(prompt, activeModels);
    return;
  }
  document.getElementById("cardsGrid").style.display = "";

  // Loading cards
  var cardsGrid = document.getElementById("cardsGrid");
  cardsGrid.textContent = "";
  activeModels.forEach(function(m) {
    cardsGrid.appendChild(buildLoadingCard(m));
  });

  // Fire all models in parallel — each updates independently as it resolves
  let anySuccess = false;
  await Promise.all(activeModels.map(async model => {
    try {
      const result = await fireModel(prompt, model.id);
      responses[model.id] = result.text;
      responses[model.id + "__timing"] = result.timingMs;
      responses[model.id + "__exec"] = {
        status: "success",
        upstreamStatus: result.upstreamStatus,
        durationMs: result.timingMs,
        retryCount: 0,
        fallbackUsed: false,
      };
      anySuccess = true;
    } catch(e) {
      responses[model.id] = "[Error: " + e.message + "]";
      responses[model.id + "__timing"] = null;
      responses[model.id + "__exec"] = {
        status: "error",
        upstreamStatus: e.upstreamStatus || 500,
        durationMs: e.durationMs || null,
        error: e.message,
        errorCategory: categorizeClientError(e.message, e.upstreamStatus || 500),
        retryCount: 0,
        fallbackUsed: false,
      };
      console.warn(model.id, e.message);
    }
    updateCard(model, responses[model.id], null, null);
  }));

  if (!anySuccess) {
    showError("Arr, the ship's gone dark! Every model walked the plank — check yer server be sailin'.");
    return;
  }

  // Judge
  document.getElementById("judgingBanner").style.display = "flex";
  let judgement = null;
  try {
    judgement = await judgeResponses(prompt, responses, activeModels);
  } catch(e) {
    console.warn("Judge failed:", e.message);
  }
  document.getElementById("judgingBanner").style.display = "none";

  // Re-render cards with judge scores first (builds DOM)
  activeModels.forEach(m => updateCard(m, responses[m.id], judgement, judgement ? judgement.crown : null));
  // Then auto-vote based on judge scores (DOM now exists)
  if (judgement && judgement.scores) {
    activeModels.forEach(function(m) {
      if (judgement.scores[m.id] !== undefined) {
        autoVote(m.id, judgement.scores[m.id]);
      }
    });
  }

  if (judgement && judgement.roast) {
    document.getElementById("roastBox").style.display = "block";
    var roastText = document.getElementById("roastText");
    roastText.dataset.originalRoast = judgement.roast;
    typewrite("roastText", judgement.roast);
  }

  // F1 — share link inside results, idempotent
  renderShareLink(prompt);

  // F4 — replay diff if a baseline was stashed
  if (window._replayBaseScores && judgement && judgement.scores) {
    renderReplayDiff(window._replayBaseScores, judgement.scores);
    window._replayBaseScores = null;
    window._replayBaseRunId = null;
  }

  var currentFilters = getCurrentRunFilters();
  await refreshHistory();
  await refreshRuns(currentFilters);
  await refreshFailureSummary(currentFilters);
  await refreshAnalytics(currentFilters);
}

// CARD
// Intercept fetch to inject auth + page-token headers for all /api/* calls
window.fetch = function(url, opts) {
  opts = opts || {};
  if (typeof url === "string" && url.indexOf("/api/") === 0) {
    opts.headers = opts.headers || {};
    if (_authToken && !opts.headers["Authorization"]) {
      opts.headers["Authorization"] = "Bearer " + _authToken;
    }
    if (_pageToken && !opts.headers["X-Page-Token"]) {
      opts.headers["X-Page-Token"] = _pageToken;
    }
  }
  return _originalFetch(url, opts);
};

var _originalSetMode = setMode;
setMode = function(id) {
  if (id === "custom" && _currentUser && !_currentUser.phoneVerified) {
    setDisplay("authOverlay", "flex");
    showAuthPhoneOtp();
    return;
  }
  _originalSetMode(id);
};

init();

// Expose functions referenced by inline HTML event handlers to window
window.fire = fire;
window.reset = reset;
window.revealBlind = revealBlind;
window.randomPrompt = randomPrompt;
window.changeRunsPage = changeRunsPage;
window.exportRuns = exportRuns;
window.handleRunFilter = handleRunFilter;
window.closeAccountSettings = closeAccountSettings;
window.openAccountSettings = openAccountSettings;
window.toggleUserMenu = toggleUserMenu;
window.toggleAdminAnalytics = toggleAdminAnalytics;
window.logout = logout;
window.showAuthRegister = showAuthRegister;
window.showAuthLogin = showAuthLogin;
window.showAuthForgotPassword = showAuthForgotPassword;
window.handleRegister = handleRegister;
window.handleVerifyEmailOtp = handleVerifyEmailOtp;
window.handleResendEmailOtp = handleResendEmailOtp;
window.handleLogin = handleLogin;
window.handleVerifyPhoneOtp = handleVerifyPhoneOtp;
window.handleForgotPassword = handleForgotPassword;
window.handleResendPhoneOtp = handleResendPhoneOtp;
window.handleUpdateName = handleUpdateName;
window.handleUpdateEmail = handleUpdateEmail;
window.handleUpdatePhone = handleUpdatePhone;
window.handleChangePassword = handleChangePassword;
window.startOAuth = startOAuth;
window.loadModerationPanel = loadModerationPanel;

// Boot
init();
