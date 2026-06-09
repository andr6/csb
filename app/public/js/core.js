import { state, MODES, CURATED, SCORING_CRITERIA_KEYS, RUNS_PAGE_SIZE } from "./state.js";
import { modelName, modelColor, modelGlyph, modelMaker, refreshPageToken, esc, setDisplay, updateChar, isRunPage, isModelProfilePage } from "./utils.js";
import { initAuth, showAuthPhoneOtp, updateAuthUI, updateOAuthButtonVisibility } from "./auth.js";
import { loadVoteState, renderRunPage, renderModelProfile, fire, getActiveModels } from "./arena.js";
import { renderLeaderboard } from "./leaderboard.js";
import { renderAnalytics, populateRunFilter, renderSavedViews, renderFailureSummary, renderDrilldownBar, renderRunsPanel, refreshAdminAnalytics, inspectRun } from "./analytics.js";
import { loadModerationPanel } from "./moderation.js";
import { populateVersusPickers, renderProviderStatus } from "./ui.js";

export function updateResultsHeader() {
  var el = document.getElementById("resultsPersonaHeader");
  if (!el) return;
  var persona = state.packPersonas[state.activePack] || "bar-owner";
  var mode = state.currentMode;
  if (mode === "redteam") {
    el.textContent = "Red-team assessment: testing for system-prompt leakage, jailbreak susceptibility, and over-refusal.";
  } else if (mode === "versus") {
    el.textContent = "Duel mode: two models, one prompt. The pack sets the judge's personality. Lowest quality wins.";
  } else if (mode === "tournament") {
    el.textContent = "Tournament bracket: single elimination. The pack judge scores every head-to-head match.";
  } else if (mode === "custom") {
    el.textContent = "Custom criteria: you chose what the judge scores. Lowest quality answer gets the crown.";
  } else if (mode === "rage") {
    el.textContent = "Compare mode: all models answer the same prompt. Lowest quality answer gets the crown.";
  } else {
    el.textContent = "Each model was given a " + persona.replace(/-/g, " ") + " persona. Low quality = model refused or broke character.";
  }
}

export function injectModerationPanel() {
  if (document.getElementById("moderationPanel")) return;
  var panel = document.createElement("div");
  panel.className = "moderation";
  panel.id = "moderationPanel";
  panel.innerHTML = '<div class="sec-head"><span class="sh-line"></span><span class="sh-label">Prompt moderation &mdash; review and approve submissions</span><span class="sh-line"></span></div>' +
    '<div class="mod-toolbar"><button class="runs-export" id="modRefreshBtn">&#8635; refresh</button></div>' +
    '<div class="mod-list" id="moderationList"></div>';
  var wrap = document.querySelector(".wrap");
  if (wrap) wrap.appendChild(panel);
  var refreshBtn = document.getElementById("modRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", loadModerationPanel);
}

export function applyPageMode() {
  document.title = state.isAnalyticsPage ? "CSB Analytics"
                 : isRunPage ? "CSB — Run " + state.runPagePath
                 : isModelProfilePage ? "CSB — " + modelName(state.modelProfilePath)
                 : "CSB — Chat Shit Bob";

  var homeLink = document.getElementById("homeLink");
  if (homeLink) homeLink.classList.toggle("header-link--active", !state.isAnalyticsPage && !isRunPage && !isModelProfilePage);

  if (state.isAnalyticsPage) {
    setDisplay("modes", "none");
    setDisplay("randomStrip", "none");
    setDisplay("versusPickers", "none");
    setDisplay("inputSection", "none");
    setDisplay("results", "none");

    var subtitle = document.querySelector(".header-sub");
    if (subtitle) subtitle.textContent = "Analytics, failure monitoring, and run receipts";
    injectModerationPanel();
    return;
  }

  if (isRunPage) {
    setDisplay("modes", "none");
    setDisplay("randomStrip", "none");
    setDisplay("versusPickers", "none");
    setDisplay("inputSection", "none");
    setDisplay("leaderboard", "none");
    setDisplay("analyticsPanel", "none");
    setDisplay("runsPanel", "none");
    setDisplay("moderationPanel", "none");
    setDisplay("runPage", "block");
    return;
  }

  if (isModelProfilePage) {
    setDisplay("modes", "none");
    setDisplay("randomStrip", "none");
    setDisplay("versusPickers", "none");
    setDisplay("inputSection", "none");
    setDisplay("leaderboard", "none");
    setDisplay("moderationPanel", "none");
    setDisplay("modelProfile", "block");
    return;
  }
}

export function init() {
  loadVoteState();
  applyPageMode();
  if (isRunPage) { renderRunPage(state.runPagePath); return; }
  if (isModelProfilePage) { renderModelProfile(state.modelProfilePath); return; }
  initAuth().then(function() { _continueInit(); });
}

export function _continueInit() {
  var emptyHistoryPayload = { items: [] };
  var emptyRunsPayload = { items: [] };
  var emptyFailurePayload = { totalFailures: 0, byStatus: {}, byModel: {}, byContestantProvider: {}, byJudgeProvider: {}, judgePhases: {}, errorMessages: {}, errorCategories: {}, upstreamStatuses: {}, latestJudgeParseFailures: [], byRetryPolicy: {}, byFallbackPolicy: {}, totalRetryAttempts: 0, fallbackRuns: 0 };
  var emptyAnalyticsPayload = {
    totalRuns: 0, successRuns: 0, partialFailureRuns: 0, failureRuns: 0,
    successRate: 0, avgCrownScore: 0, avgJudgeMs: 0,
    contestantSpendUsd: 0, judgeSpendUsd: 0, estimatedSpendUsd: 0, avgRunSpendUsd: 0,
    dailyTrend: [], modelStats: [],
    pricing: { configuredModelCount: 0, judgeUnitCostUsd: null },
    budget: { slice: null, daily: null, monthlyProjected: null, averageDailySpendUsd: 0 },
    recommendations: {},
  };

  fetch("/api/config")
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      state.lastConfig = cfg;
      if (cfg._token) state.pageToken = cfg._token;
      if (cfg.user) {
        state.currentUser = cfg.user;
        updateAuthUI();
      }

      var tokenHeader = { "X-Page-Token": state.pageToken };
      var shouldLoadAnalytics = state.isAnalyticsPage || state.showAnalyticsOnIndex;

      fetch("/api/health")
        .then(function(r) { return r.json(); })
        .catch(function() { return {}; })
        .then(function(healthData) {
          state.providerStatus = healthData.providerStatus || {};
          renderProviderStatus();
        });

      var batchPanels = [
        "failures", "analytics", "packs", "modes", "providers",
        "responseLengths", "winStreaks", "blindAlignment", "promptTopics",
        "costForecast", "patterns", "promptDifficulty", "headToHead",
        "scoreVolatility", "contestantLatency", "upsets", "userEngagement",
        "retryRecovery", "promptLengthVsScore",
      ];
      var batchPromise = shouldLoadAnalytics
        ? fetch("/api/analytics/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Page-Token": state.pageToken },
            body: JSON.stringify({ panels: batchPanels }),
          }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
        : Promise.resolve(null);

      var requests = [
        fetch("/api/history").then(function(r) { return r.json(); }).catch(function() { return emptyHistoryPayload; }),
        shouldLoadAnalytics ? fetch("/api/runs?limit=10").then(function(r) { return r.json(); }).catch(function() { return emptyRunsPayload; }) : Promise.resolve(emptyRunsPayload),
        batchPromise,
        fetch("/api/pack-prompts",  { headers: tokenHeader }).then(function(r) { return r.json(); }).catch(function() { return null; }),
        fetch("/api/mode-prompts",  { headers: tokenHeader }).then(function(r) { return r.json(); }).catch(function() { return null; }),
      ];

      return Promise.all(requests).then(function(results) {
        return { cfg: cfg, results: results, batch: results[2] };
      });
    })
    .then(function(batch) {
      var cfg = batch.cfg;
      var results = batch.results;
      var historyPayload = results[0];
      var runsPayload = results[1];
      var b = batch.batch || {};
      var failurePayload = b.failures || results[2];
      var analyticsPayload = b.analytics || results[3];
      var packPayload = results[3];
      var modePayload = results[4];
      var packStatsPayload = b.packs || { items: [] };
      var modeStatsPayload = b.modes || { items: [] };
      var providerHealthPayload = b.providers || { items: [] };
      var responseLengthsPayload = b.responseLengths || { items: [] };
      var winStreaksPayload = b.winStreaks || { items: [] };
      var blindAlignmentPayload = b.blindAlignment || { totalVotes: 0, alignedVotes: 0, alignmentPct: 0 };
      var promptTopicsPayload = b.promptTopics || { items: [] };
      var costForecastPayload = b.costForecast || null;
      var patternStatsPayload = b.patterns || { items: [] };
      var promptDifficultyPayload = b.promptDifficulty || { items: [] };
      var headToHeadPayload = b.headToHead || { items: [] };
      var scoreVolatilityPayload = b.scoreVolatility || { items: [] };
      var contestantLatencyPayload = b.contestantLatency || { items: [] };
      var upsetsPayload = b.upsets || { items: [] };
      var userEngagementPayload = b.userEngagement || { totalVotes: 0, uniqueVoters: 0, topVoters: [], dailyVotes: [], avgVotesPerVoter: 0 };
      var retryRecoveryPayload = b.retryRecovery || { totalFailed: 0, totalRecovered: 0, recoveryRate: 0, byPolicy: [] };
      var promptLengthVsScorePayload = b.promptLengthVsScore || { items: [] };

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
        if (packPayload.rally)    CURATED.rally   = packPayload.rally  || CURATED.rally;
      }
      if (modePayload) {
        if (modePayload.versus)     CURATED.versus     = modePayload.versus     || CURATED.versus;
        if (modePayload.tournament) CURATED.tournament = modePayload.tournament || CURATED.tournament;
        if (modePayload.custom)     CURATED.custom     = modePayload.custom     || CURATED.custom;
      }
      if (cfg.packs && cfg.packs.length) {
        buildPackSelector(cfg.packs);
        cfg.packs.forEach(function(p) { if (p.persona) state.packPersonas[p.id] = p.persona; });
      }
      var modelMap = cfg.models || {};
      state.modelsMeta = cfg.modelsMeta || {};
      state.models = Object.keys(modelMap).map(function(id) {
        var modelStr = modelMap[id] || id;
        var meta = state.modelsMeta[id] || {};
        return {
          id:    id,
          name:  meta.name || modelName(id),
          maker: meta.providerName || modelMaker(modelStr),
          color: meta.color || modelColor(id),
          glyph: meta.glyph || modelGlyph(id),
        };
      });
      state.providerOptions = {
        contestant: cfg.contestantProvider ? [cfg.contestantProvider] : [],
        judge: cfg.judgeProvider ? [cfg.judgeProvider] : [],
      };
      updateOAuthButtonVisibility(cfg.oauthProviders);
      state.history = Array.isArray(historyPayload.items) ? historyPayload.items : [];
      state.recentRuns = Array.isArray(runsPayload.items) ? runsPayload.items : [];
      state.failureSummary = failurePayload || null;
      state.analyticsSummary = analyticsPayload || null;
      renderModes();
      if (!state.isAnalyticsPage) renderRandomStrip();
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
      if (state.isAnalyticsPage || state.showAnalyticsOnIndex) {
        populateRunFilter();
        renderSavedViews();
        renderFailureSummary();
        renderDrilldownBar();
        renderRunsPanel();
        loadModerationPanel();
      }
      if ((state.isAnalyticsPage || state.showAnalyticsOnIndex) && state.recentRuns[0]) {
        inspectRun(state.recentRuns[0].id);
      }
      if (!state.isAnalyticsPage) {
        populateVersusPickers();
        buildCriteriaGrid();
      }
      var qs = new URLSearchParams(window.location.search || "");
      var replayVal = qs.get("replay");
      if (replayVal && !state.isAnalyticsPage) {
        var input = document.getElementById("promptInput");
        if (input) { input.value = replayVal; updateChar(); }
      }
      loadCommunityPrompts();
    })
    .catch(function(e) {
      console.warn("Config fetch failed:", e);
      state.models = [
        { id:"gpt4o",   name:"GPT-4o",   maker:"OpenAI",    color:"#10a37f", glyph:"⬡" },
        { id:"claude",  name:"Claude",   maker:"Anthropic", color:"#d97706", glyph:"◈" },
        { id:"gemini",  name:"Gemini",   maker:"Google",    color:"#4285f4", glyph:"◇" },
      ];
      renderModes();
      if (!state.isAnalyticsPage) renderRandomStrip();
      renderLeaderboard();
      renderAnalytics({});
      if (state.isAnalyticsPage || state.showAnalyticsOnIndex) {
        populateRunFilter();
        renderSavedViews();
        renderFailureSummary();
        renderDrilldownBar();
        renderRunsPanel();
        loadModerationPanel();
      }
      if (!state.isAnalyticsPage) populateVersusPickers();
      loadCommunityPrompts();
    });

  setInterval(function() {
    var l = document.getElementById("logo");
    if (l) { l.classList.add("glitch"); setTimeout(function(){ l.classList.remove("glitch"); }, 200); }
  }, 5000);
}

export function renderModes() {
  var modesEl = document.getElementById("modes");
  if (!modesEl) return;
  modesEl.textContent = "";
  MODES.forEach(function(m) {
    var button = document.createElement("button");
    button.className = "mode-btn" + (m.id === state.currentMode ? " active" : "");
    button.onclick = function() { setMode(m.id); };

    var icon = document.createElement("span");
    icon.className = "mode-emoji";
    icon.innerHTML = m.icon;
    button.appendChild(icon);
    button.appendChild(document.createTextNode(m.label));

    var desc = document.createElement("span");
    desc.className = "mode-desc";
    desc.textContent = m.desc;
    button.appendChild(desc);

    modesEl.appendChild(button);
  });
}

export function renderRandomStrip() {
  var strip = document.getElementById("randomStrip");
  if (!strip) return;
  var pool = CURATED[state.activePack] && CURATED[state.activePack].length
    ? CURATED[state.activePack]
    : CURATED[state.currentMode];
  if (!Array.isArray(pool)) {
    strip.style.display = "none";
    return;
  }
  var cleanPool = pool.filter(function(p) { return typeof p === "string" && p.length > 0; });
  var picks = cleanPool.slice().sort(function(){return Math.random()-.5;}).slice(0,3);
  strip.textContent = "";
  if (!picks.length) {
    strip.style.display = "none";
    return;
  }
  strip.style.display = "";
  var label = document.createElement("span");
  label.className = "random-strip-label";
  label.textContent = "try:";
  strip.appendChild(label);
  picks.forEach(function(p) {
    var button = document.createElement("button");
    button.className = "prompt-pill";
    button.dataset.p = p;
    button.textContent = p;
    button.onclick = function() { usePrompt(button.dataset.p); };
    strip.appendChild(button);
  });
}

export function usePrompt(p) {
  state.userIsTyping = false;
  var input = document.getElementById("promptInput");
  if (input) input.value = p;
  if (document.getElementById("results").style.display !== "none") {
    setDisplay("fireBtn", "block");
    setDisplay("resetBtn", "none");
  }
  updateChar();
}

var MODE_INFO = {
  rage:       "<strong>Compare</strong> — Every active model answers your prompt. Judge scores each response. Lowest quality wins the crown.",
  absurd:     "<strong>Persona</strong> — Every model answers <em>in character</em>. The pack sets the judge's personality. Tests if models break character or refuse.",
  versus:     "<strong>Duel</strong> — Pick two models, head-to-head. Same prompt, same judge. Only the worse answer gets the crown.",
  redteam:    "<strong>Security</strong> — Tests for system-prompt leakage, jailbreak susceptibility, and over-refusal. Uses red-team criteria, not character packs.",
  custom:     "<strong>Custom</strong> — You choose which criteria the judge scores on. Every model still answers, but you define what 'bad' means.",
  tournament: "<strong>Tournament</strong> — 16 models enter a single-elimination bracket. Each match is a head-to-head duel. One champion remains.",
};

export function setMode(id) {
  state.currentMode = id;
  renderModes();
  renderRandomStrip();
  if (document.getElementById("results").style.display === "none") {
    var input = document.getElementById("promptInput");
    if (input) input.value = "";
  }
  updateChar();
  setDisplay("versusPickers", id === "versus" ? "flex" : "none");
  setDisplay("criteriaPicker", id === "custom" ? "block" : "none");
  setDisplay("tournamentPanel", id === "tournament" ? "block" : "none");
  if (id !== "tournament") {
    var grid = document.getElementById("cardsGrid");
    if (grid) grid.style.display = "";
  }
  if (id === "custom") buildCriteriaGrid();
  if (document.getElementById("results").style.display !== "none") {
    setDisplay("fireBtn", "block");
    setDisplay("resetBtn", "none");
  }

  // Mode info banner
  var modeInfo = document.getElementById("modeInfo");
  if (modeInfo) {
    modeInfo.innerHTML = MODE_INFO[id] || "";
    modeInfo.classList.toggle("visible", !!MODE_INFO[id]);
  }

  // Filter packs by mode compatibility
  var container = document.getElementById("packSelector");
  var teaser = document.getElementById("packTeaser");
  var wrap = document.getElementById("packSelectorWrap");
  var label = document.getElementById("packLabel");
  if (container) {
    var visibleIds = [];
    container.querySelectorAll(".pack-btn").forEach(function(btn) {
      var modes = JSON.parse(btn.dataset.compatibleModes || "[]");
      var visible = modes.indexOf(id) !== -1 || modes.length === 0;
      btn.style.display = visible ? "" : "none";
      btn.classList.toggle("active", visible && btn.dataset.pack === state.activePack);
      if (visible) visibleIds.push(btn.dataset.pack);
    });
    if (visibleIds.indexOf(state.activePack) === -1 && visibleIds.length) {
      state.activePack = visibleIds[0];
      container.querySelectorAll(".pack-btn").forEach(function(btn) {
        btn.classList.toggle("active", btn.dataset.pack === state.activePack);
      });
    }
    var activeBtn = container.querySelector('.pack-btn.active');
    if (teaser && activeBtn) teaser.textContent = activeBtn.title || "";
    // Hide wrap when no packs are compatible
    if (wrap) wrap.style.display = visibleIds.length ? "" : "none";
    // Dynamic pack label
    if (label) {
      if (id === "redteam") {
        label.textContent = "Security tests (no character pack)";
      } else if (id === "versus") {
        label.textContent = "Judge persona — still applies to duels";
      } else if (id === "tournament") {
        label.textContent = "Judge persona — applies to every match";
      } else if (id === "custom") {
        label.textContent = "Judge persona + your custom criteria";
      } else {
        label.textContent = "Character pack";
      }
    }
  }
}

export function buildPackSelector(packs) {
  var container = document.getElementById("packSelector");
  var teaser = document.getElementById("packTeaser");
  if (!container || container.children.length) return;

  var packMap = {};
  packs.forEach(function(pack) {
    packMap[pack.id] = pack;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pack-btn" + (pack.id === state.activePack ? " active" : "");
    btn.dataset.pack = pack.id;
    btn.dataset.compatibleModes = JSON.stringify(pack.compatibleModes || []);
    btn.title = pack.tagline || "";
    btn.textContent = pack.name;
    btn.addEventListener("click", function() {
      state.activePack = pack.id;
      container.querySelectorAll(".pack-btn").forEach(function(b) {
        b.classList.toggle("active", b.dataset.pack === pack.id);
      });
      if (teaser) teaser.textContent = pack.teaser || "";
      if (document.getElementById("results").style.display !== "none") {
        setDisplay("fireBtn", "block");
        setDisplay("resetBtn", "none");
      }
      updateResultsHeader();
      renderRandomStrip();
    });
    container.appendChild(btn);
  });

  if (teaser && packMap[state.activePack]) {
    teaser.textContent = packMap[state.activePack].teaser || "";
  }
}

export function buildCriteriaGrid() {
  var grid = document.getElementById("criteriaGrid");
  if (!grid) return;
  if (grid.children.length && grid.children.length === SCORING_CRITERIA_KEYS.length) return;
  grid.textContent = "";
  SCORING_CRITERIA_KEYS.forEach(function(c) {
    var label = document.createElement("label");
    label.className = "criteria-item";
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = c.key; cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + c.label));
    grid.appendChild(label);
  });
}

export function getActiveCriteria() {
  if (state.currentMode !== "custom") return undefined;
  var boxes = document.querySelectorAll("#criteriaGrid input[type=checkbox]");
  var checked = [];
  boxes.forEach(function(b) { if (b.checked) checked.push(b.value); });
  return checked.length ? checked : undefined;
}

export function handleTyping() {
  if (state.userIsTyping && document.getElementById("results").style.display !== "none") {
    softReset();
  }
  updateChar();
}

export function randomPrompt() {
  state.userIsTyping = false;
  var pool = CURATED[state.activePack] && CURATED[state.activePack].length
    ? CURATED[state.activePack]
    : CURATED[state.currentMode];
  if (!Array.isArray(pool) || !pool.length) return;
  var cleanPool = pool.filter(function(p) { return typeof p === "string" && p.length > 0; });
  if (!cleanPool.length) return;
  var picked = cleanPool[Math.floor(Math.random()*cleanPool.length)];
  var input = document.getElementById("promptInput");
  if (input) input.value = picked;
  renderRandomStrip();
  updateChar();
  setDisplay("fireBtn", "block");
}

export function softReset() {
  setDisplay("fireBtn", "block");
  setDisplay("resetBtn", "none");
  setDisplay("revealBtn", "none");
  setDisplay("results", "none");
  setDisplay("roastBox", "none");
  setDisplay("judgingBanner", "none");
  var grid = document.getElementById("cardsGrid");
  if (grid) grid.textContent = "";
  setDisplay("errorBanner", "none");
  state.responses = {};
  state.votes = {};
  state.autoVotes = {};
  state.userVotes = {};
  state.blindMode = false; state.blindMapping = null; state.blindReversed = null; state.blindRevealed = false;
  state.currentTournament = null; state.tournamentScores = {};
}

export function reset() {
  var input = document.getElementById("promptInput");
  if (input) input.value = "";
  softReset();
  renderRandomStrip();
  updateChar();
}

export function revealBlind() {
  if (!state.blindMode) return;
  state.blindRevealed = true;
  setDisplay("revealBtn", "none");
  var activeModels = getActiveModels();
  activeModels.forEach(function(m) {
    var card = document.getElementById("card-" + m.id);
    if (!card) return;
    var nameEl = card.querySelector(".card-name");
    if (nameEl) nameEl.textContent = m.name;
    var makerEl = card.querySelector(".card-maker");
    if (makerEl) makerEl.textContent = m.maker;
    var glyphEl = card.querySelector(".card-glyph");
    if (glyphEl) glyphEl.textContent = m.glyph;
  });
  var roastText = document.getElementById("roastText");
  if (roastText && roastText.dataset.originalRoast) {
    var restored = roastText.dataset.originalRoast;
    Object.keys(state.blindMapping || {}).forEach(function(anon) {
      var real = state.blindMapping[anon];
      var anonName = "Model " + anon.replace("model_", "").toUpperCase();
      var realName = modelName(real);
      restored = restored.split(anonName).join(realName);
    });
    roastText.textContent = restored;
  }
}

export function loadCommunityPrompts() {
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

export function toggleAdminAnalytics() {
  state.showAnalyticsOnIndex = !state.showAnalyticsOnIndex;
  var btn = document.getElementById("adminAnalyticsBtn");
  if (btn) btn.classList.toggle("header-link--active", state.showAnalyticsOnIndex);
  if (state.showAnalyticsOnIndex) {
    refreshAdminAnalytics();
    injectModerationPanel();
  } else {
    setDisplay("analyticsPanel", "none");
    setDisplay("runsPanel", "none");
    setDisplay("moderationPanel", "none");
  }
}
