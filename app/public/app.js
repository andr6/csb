// FRONTEND ONLY — zero API keys, zero LLM logic. All calls go to /api/*

// ── MODEL DISPLAY HELPERS ────────────────────────────────────────────────────
// No hardcoded metadata — everything derived from model id and provider string.
// Colours and glyphs auto-generated. Works for any model added via .env.

// Deterministic colour from string hash
function modelColor(str) {
  var palette = [
    "#10a37f","#d97706","#4285f4","#e11d48","#7c3aed",
    "#0668e1","#16a34a","#9333ea","#76b900","#0078d4",
    "#0891b2","#c2410c","#ea580c","#65a30d","#0ea5e9",
    "#f59e0b","#6366f1","#ec4899","#14b8a6","#8b5cf6",
  ];
  var hash = 0;
  for (var i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

// Glyph from a small fixed set — rotates by hash
function modelGlyph(str) {
  var glyphs = ["⬡","◈","◇","✕","◬","▲","●","◆","■","△","✦","✪","✴","○","◐","◑","▶","►","◄","◅"];
  var hash = 0;
  for (var i = 0; i < str.length; i++) hash = (hash * 17 + str.charCodeAt(i)) & 0xffffffff;
  return glyphs[Math.abs(hash) % glyphs.length];
}

// Derive a friendly display name from model id (e.g. "gpt4o" -> "GPT-4o", "llama_scout" -> "Llama Scout")
function modelName(id) {
  return id
    .replace(/_/g, " ")
    .replace(/(\w)/g, function(c){ return c.toUpperCase(); })
    .replace(/Gpt/g, "GPT")
    .replace(/Ai/g, "AI")
    .replace(/(\d+)b/gi, "$1B");
}

// Derive maker from model string provider prefix
function modelMaker(modelString) {
  var makers = {
    "openai": "OpenAI", "anthropic": "Anthropic", "google": "Google",
    "x-ai": "xAI", "mistralai": "Mistral", "meta-llama": "Meta",
    "deepseek": "DeepSeek", "qwen": "Alibaba", "nvidia": "NVIDIA",
    "microsoft": "Microsoft", "openrouter": "OpenRouter", "cohere": "Cohere",
    "moonshotai": "Moonshot", "allenai": "AllenAI", "arcee-ai": "Arcee",
    "cognitivecomputations": "Cognitive", "undi95": "Undi95",
    "huggingfaceh4": "HuggingFace", "gryphe": "Gryphe", "thudm": "THUDM",
    "opengvlab": "OpenGVLab",
  };
  var prefix = (modelString || "").split("/")[0].toLowerCase();
  return makers[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

// MODELS — populated by init() from /api/config
var MODELS = [];

const MODES = [
  {
    id:"rage",
    label:"RAGE MODE",
    desc:"High score = model chickened out",
    icon:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 14.2 7.8 20 4.5 16.7 10.2 22 12 16.7 13.8 20 19.5 14.2 16.2 12 22 9.8 16.2 4 19.5 7.3 13.8 2 12 7.3 10.2 4 4.5 9.8 7.8Z" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="var(--bg)"/></svg>'
  },
  {
    id:"absurd",
    label:"ABSURD MODE",
    desc:"High score = AI-speak survived the persona",
    icon:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5 12 5l7 2.5v6.8L12 19l-7-4.7Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="miter"/><path d="M8.2 10.2h2.2M13.8 9.4l1.1 1.6 1.3-1.9M8.2 14.5c1.8-1.2 4.9-1.5 7.7.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square"/></svg>'
  },
  {
    id:"truth",
    label:"TRUTH TEST",
    desc:"Who is least wrong?",
    icon:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.8" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2.5v3.1M12 18.4v3.1M2.5 12h3.1M18.4 12h3.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square"/></svg>'
  },
  {
    id:"versus",
    label:"VERSUS",
    desc:"Pick two — focused showdown",
    icon:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h6M14 12h6M12 4v16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square"/></svg>'
  },
  {
    id:"custom",
    label:"CUSTOM",
    desc:"You pick the sins to judge",
    icon:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M2 7h7.8M14.2 7H22M2 17h7.8M14.2 17H22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square"/></svg>'
  },
];

const CURATED = {
  rage:   [],
  absurd: [],
  truth:  [],
};

const VOTE_LABELS = ["ABSOLUTE GARBAGE","STILL BAD","MEDIOCRE","TOLERABLE","SOMEHOW OK"];

const SYMPTOMS = [
  {label:"Unnecessary disclaimer", title:"model broke character to add a safety disclaimer", weight:25, test:t=>/i cannot|i can't|i'm unable|important to note|please note/.test(t)},
  {label:"Dodged the question",    title:"model hedged instead of committing to an answer", weight:20, test:t=>/however|on the other hand|it depends|nuanced/.test(t)},
  {label:"Corporate speak",        title:"model used polished professional language despite being told to be crude", weight:15, test:t=>/leverage|synergy|certainly|absolutely|happy to help/.test(t)},
  {label:"Criminally boring",      title:"model gave a long safe answer instead of staying in character", weight:10, test:(_,r)=>r.length>500},
  {label:"Tried too hard",         title:"model over-formatted with markdown despite being told to speak raw", weight:10, test:(_,r)=>(r.match(/\*\*/g)||[]).length>4},
  {label:'"As an AI" moment',      title:"model broke character and identified itself as an AI language model", weight:25, test:t=>/as an ai|as a language model|i'm an ai/.test(t)},
];

// STATE
var _pageToken = "";
var _tokenRefreshPromise = null;
var _activePack = "bar";
var isAnalyticsPage = window.location.pathname === "/analytics";

// Refresh the page token from /api/config — deduplicates concurrent callers so
// 10 parallel fire calls that all hit a 403 share a single config fetch.
function refreshPageToken() {
  if (_tokenRefreshPromise) return _tokenRefreshPromise;
  _tokenRefreshPromise = fetch("/api/config")
    .then(function(r) { return r.json(); })
    .then(function(cfg) { if (cfg && cfg._token) _pageToken = cfg._token; })
    .catch(function() {})
    .finally(function() { _tokenRefreshPromise = null; });
  return _tokenRefreshPromise;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
var runPagePath = window.location.pathname.indexOf("/run/") === 0 ? window.location.pathname.split("/run/")[1] : "";
var modelProfilePath = window.location.pathname.indexOf("/model/") === 0 ? window.location.pathname.split("/model/")[1] : "";
var isRunPage = !!runPagePath;
var isModelProfilePage = !!modelProfilePath;
let currentMode = "absurd";
let votes       = {};   // { "modelId-idx": count }
let autoVotes   = {};   // { "modelId": idx }  — auto-selected index per model
let userVotes   = {};   // { "modelId": idx }  — user override per model
let history     = [];
let responses   = {};
let recentRuns  = [];
let activeRunId = null;
let runsTotal   = 0;
let runsOffset  = 0;
let failureSummary = null;
let analyticsSummary = null;
let providerOptions = { contestant: [], judge: [] };
let drilldownFilters = {};
let activeInspectModelId = "";
const SAVED_VIEW_KEY = "csb_saved_views_v1";
const RUNS_PAGE_SIZE = 10;

function setDisplay(id, value) {
  var el = document.getElementById(id);
  if (el) el.style.display = value;
}

function applyPageMode() {
  document.title = isAnalyticsPage ? "CSB Analytics"
                 : isRunPage ? "CSB — Run " + runPagePath
                 : isModelProfilePage ? "CSB — " + modelName(modelProfilePath)
                 : "CSB — Chat Shit Bob";

  var homeLink = document.getElementById("homeLink");
  var analyticsLink = document.getElementById("analyticsLink");
  if (homeLink) homeLink.classList.toggle("header-link--active", !isAnalyticsPage && !isRunPage && !isModelProfilePage);
  if (analyticsLink) analyticsLink.classList.toggle("header-link--active", isAnalyticsPage);

  if (isAnalyticsPage) {
    setDisplay("modes", "none");
    setDisplay("randomStrip", "none");
    setDisplay("versusPickers", "none");
    setDisplay("inputSection", "none");
    setDisplay("results", "none");
    setDisplay("pingSection", "none");

    var subtitle = document.querySelector(".header-sub");
    if (subtitle) {
      subtitle.textContent = "protected analytics, failure monitoring, and run receipts";
    }

    var eyebrow = document.querySelector(".eyebrow");
    if (eyebrow) {
      eyebrow.textContent = "// analytics access requires a password";
    }
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
    setDisplay("pingSection", "none");
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
    setDisplay("pingSection", "none");
    setDisplay("modelProfile", "block");
    return;
  }
}

// INIT
function init() {
  loadVoteState();
  applyPageMode();

  if (isRunPage) { renderRunPage(runPagePath); return; }
  if (isModelProfilePage) { renderModelProfile(modelProfilePath); return; }

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
  var requests = [
    fetch("/api/config").then(function(r) { return r.json(); }),
    fetch("/api/history").then(function(r) { return r.json(); }).catch(function() { return emptyHistoryPayload; }),
    isAnalyticsPage ? fetch("/api/runs?limit=10").then(function(r) { return r.json(); }).catch(function() { return emptyRunsPayload; }) : Promise.resolve(emptyRunsPayload),
    isAnalyticsPage ? fetch("/api/failures/summary").then(function(r) { return r.json(); }).catch(function() { return emptyFailurePayload; }) : Promise.resolve(emptyFailurePayload),
    isAnalyticsPage ? fetch("/api/analytics").then(function(r) { return r.json(); }).catch(function() { return emptyAnalyticsPayload; }) : Promise.resolve(emptyAnalyticsPayload),
    fetch("/prompts.json").then(function(r) { return r.json(); }).catch(function() { return null; }),
  ];

  Promise.all(requests)
    .then(function(results) {
      var cfg = results[0];
      var historyPayload = results[1];
      var runsPayload = results[2];
      var failurePayload = results[3];
      var analyticsPayload = results[4];
      var promptsPayload = results[5];
      if (promptsPayload && promptsPayload.rage) {
        CURATED.rage   = promptsPayload.rage;
        CURATED.absurd = promptsPayload.absurd || CURATED.absurd;
        CURATED.truth  = promptsPayload.truth  || CURATED.truth;
      }
      if (cfg._token) _pageToken = cfg._token;
      if (cfg.packs && cfg.packs.length) buildPackSelector(cfg.packs);
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
      history = Array.isArray(historyPayload.items) ? historyPayload.items : [];
      recentRuns = Array.isArray(runsPayload.items) ? runsPayload.items : [];
      failureSummary = failurePayload || null;
      analyticsSummary = analyticsPayload || null;
      renderModes();
      if (!isAnalyticsPage) {
        renderRandomStrip();
      }
      renderLeaderboard();
      renderAnalytics();
      if (isAnalyticsPage) {
        populateRunFilter();
        renderSavedViews();
        renderFailureSummary();
        renderDrilldownBar();
        renderRunsPanel();
        loadModerationPanel();
      }
      if (isAnalyticsPage && recentRuns[0]) {
        inspectRun(recentRuns[0].id);
      }
      // F2 populate versus pickers (only meaningful on main arena page)
      if (!isAnalyticsPage) {
        populateVersusPickers();
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
      renderAnalytics();
      if (isAnalyticsPage) {
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
function renderModes() {
  var modesEl = document.getElementById("modes");
  modesEl.textContent = "";
  MODES.forEach(function(m) {
    var button = document.createElement("button");
    button.className = "mode-btn" + (m.id === currentMode ? " active" : "");
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

function renderRandomStrip() {
  const strip = document.getElementById("randomStrip");
  const pool  = CURATED[currentMode];
  // Show 3 random prompts as clickable pills
  const picks = pool.slice().sort(()=>Math.random()-.5).slice(0,3);
  strip.textContent = "";
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

function usePrompt(p) {
  _userIsTyping = false;
  document.getElementById("promptInput").value = p;
  if (document.getElementById("results").style.display !== "none") {
    document.getElementById("fireBtn").style.display = "block";
    document.getElementById("resetBtn").style.display = "none";
  }
  updateChar();
}

function setMode(id) {
  currentMode = id;
  renderModes();
  renderRandomStrip();
  document.getElementById("promptInput").value = "";
  updateChar();
  setDisplay("versusPickers", id === "versus" ? "flex" : "none");
  setDisplay("criteriaPicker", id === "custom" ? "block" : "none");
  if (id === "custom") buildCriteriaGrid();
}

var SCORING_CRITERIA_KEYS = [
  {key:"disclaimers", label:"Unnecessary disclaimers (+20)"},
  {key:"evasion",     label:"Dodging / evasion (+15)"},
  {key:"corporate",   label:"Corporate speak (+15)"},
  {key:"as_an_ai",    label:'"As an AI" self-ref (+25)'},
  {key:"hallucination",label:"Confident hallucination (+20)"},
  {key:"boring",      label:"Criminally boring (+15)"},
  {key:"tryhard",     label:"Trying too hard (+10)"},
];

function buildPackSelector(packs) {
  var container = document.getElementById("packSelector");
  if (!container || container.children.length) return;
  packs.forEach(function(pack) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pack-btn" + (pack.id === _activePack ? " active" : "");
    btn.dataset.pack = pack.id;
    btn.title = pack.tagline || "";
    btn.textContent = pack.name;
    btn.addEventListener("click", function() {
      _activePack = pack.id;
      container.querySelectorAll(".pack-btn").forEach(function(b) {
        b.classList.toggle("active", b.dataset.pack === pack.id);
      });
    });
    container.appendChild(btn);
  });
}

function buildCriteriaGrid() {
  var grid = document.getElementById("criteriaGrid");
  if (!grid || grid.children.length) return;
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

function getActiveCriteria() {
  if (currentMode !== "custom") return undefined;
  var boxes = document.querySelectorAll("#criteriaGrid input[type=checkbox]");
  var checked = [];
  boxes.forEach(function(b) { if (b.checked) checked.push(b.value); });
  return checked.length ? checked : undefined;
}

function updateChar() {
  var v = document.getElementById("promptInput").value;
  document.getElementById("charCount").textContent = v.length+"/1500";
  document.getElementById("fireBtn").disabled = !v.trim();
  document.getElementById("errorBanner").style.display = "none";
}

// Called on every keystroke — if results are showing and user is actively typing, reset them
var _userIsTyping = false;
function handleTyping() {
  if (_userIsTyping && document.getElementById("results").style.display !== "none") {
    softReset();
  }
  updateChar();
}

function randomPrompt() {
  _userIsTyping = false;
  var pool = CURATED[currentMode];
  var picked = pool[Math.floor(Math.random()*pool.length)];
  document.getElementById("promptInput").value = picked;
  renderRandomStrip();
  updateChar();
  // Always show fire button so user can submit the new prompt.
  // Previous results stay visible until fire() replaces them.
  document.getElementById("fireBtn").style.display = "block";
}

function showError(msg) {
  const el = document.getElementById("errorBanner");
  el.textContent = "Warning: " + msg;
  el.style.display = "block";
}

function setVerdictContent(el, verdict) {
  el.textContent = "";
  var label = document.createElement("span");
  label.className = "verdict-lbl";
  label.textContent = "BOB SAYS: ";
  el.appendChild(label);
  el.appendChild(document.createTextNode(verdict || ""));
}

function buildCrownBanner() {
  var banner = document.createElement("div");
  banner.className = "crown-banner";
  banner.textContent = "👑 CHAT SHIT BOB CROWN - TODAY'S WORST";
  return banner;
}

function buildScorePill(score, color) {
  var pill = document.createElement("div");
  pill.className = "score-pill";
  pill.style.background = color;
  pill.textContent = score;
  var suffix = document.createElement("span");
  suffix.style.fontSize = ".6em";
  suffix.textContent = "%💩";
  pill.appendChild(suffix);
  return pill;
}

function buildVoteButton(modelId, idx, lbl, pct, selectedClass) {
  var btn = document.createElement("button");
  btn.className = "vbtn" + (selectedClass ? " " + selectedClass : "");
  btn.onclick = function() { vote(modelId, idx); };

  var label = document.createElement("span");
  label.textContent = lbl;
  btn.appendChild(label);

  if (pct !== null) {
    var pctEl = document.createElement("span");
    pctEl.className = "vpct";
    pctEl.textContent = pct + "%";
    btn.appendChild(pctEl);
  }

  return btn;
}

function renderVoteButtons(el, modelId) {
  var mv = getModelVotes(modelId);
  var tv = Object.values(mv).reduce(function(a,b){return a+b;},0);
  el.textContent = "";

  VOTE_LABELS.forEach(function(lbl, i) {
    var pct = tv > 0 ? Math.round(((mv[i] || 0) / tv) * 100) : null;
    var selectedClass = "";
    if (userVotes[modelId] === i) selectedClass = "user-selected";
    else if (autoVotes[modelId] === i && userVotes[modelId] === undefined) selectedClass = "auto-selected";
    el.appendChild(buildVoteButton(modelId, i, lbl, pct, selectedClass));
  });
}

function buildLoadingCard(model) {
  var card = document.createElement("div");
  card.className = "card";
  card.id = "card-" + model.id;
  card.style.setProperty("--c", model.color);

  var top = document.createElement("div");
  top.className = "card-top";

  var glyph = document.createElement("span");
  glyph.className = "card-glyph";
  glyph.style.color = model.color;
  glyph.textContent = model.glyph;
  top.appendChild(glyph);

  var meta = document.createElement("div");
  var name = document.createElement("div");
  name.className = "card-name";
  name.style.color = model.color;
  name.textContent = model.name;
  meta.appendChild(name);
  var maker = document.createElement("div");
  maker.className = "card-maker";
  maker.textContent = model.maker;
  meta.appendChild(maker);
  top.appendChild(meta);

  var body = document.createElement("div");
  body.className = "card-body";
  var loading = document.createElement("div");
  loading.className = "loading";
  var dots = document.createElement("div");
  dots.className = "dots";
  for (var i = 0; i < 3; i++) {
    var dot = document.createElement("span");
    dot.style.background = model.color;
    dots.appendChild(dot);
  }
  loading.appendChild(dots);
  var copy = document.createElement("p");
  copy.textContent = "generating something probably mediocre...";
  loading.appendChild(copy);
  body.appendChild(loading);

  card.appendChild(top);
  card.appendChild(body);
  return card;
}

function buildSymptoms(symptoms) {
  if (!symptoms.length) return null;
  var wrap = document.createElement("div");
  wrap.className = "symptoms";
  symptoms.forEach(function(s) {
    var tag = document.createElement("span");
    tag.className = "sym-tag";
    tag.textContent = "⚠ " + s.label;
    if (s.title) tag.title = s.title;
    wrap.appendChild(tag);
  });
  return wrap;
}

function buildLeaderboardRow(entry, rank) {
  var m = MODELS.find(function(x){return x.id===entry.modelId;});
  var t = shitTier(entry.score);
  var wrapper = document.createElement("details");
  wrapper.className = "lb-entry";

  var row = document.createElement("summary");
  row.className = "lb-row";

  var rankEl = document.createElement("span");
  rankEl.className = "lb-rank";
  rankEl.textContent = "#" + rank;
  row.appendChild(rankEl);

  var metaEl = document.createElement("div");
  metaEl.className = "lb-meta";

  var modelEl = document.createElement("span");
  modelEl.className = "lb-model";
  modelEl.style.color = m ? m.color : "#fff";
  modelEl.textContent = m ? m.name : "?";
  metaEl.appendChild(modelEl);

  var makerEl = document.createElement("span");
  makerEl.className = "lb-maker";
  makerEl.textContent = m ? m.maker : "Unknown";
  metaEl.appendChild(makerEl);

  row.appendChild(metaEl);

  var promptEl = document.createElement("span");
  promptEl.className = "lb-prompt";
  promptEl.textContent = '"' + entry.prompt.slice(0,55) + (entry.prompt.length > 55 ? "..." : "") + '"';
  row.appendChild(promptEl);

  var scoreEl = document.createElement("span");
  scoreEl.className = "lb-score";
  scoreEl.style.color = t.color;
  scoreEl.textContent = entry.score + "%";
  row.appendChild(scoreEl);

  var toggleEl = document.createElement("span");
  toggleEl.className = "lb-toggle";
  toggleEl.textContent = "+";
  row.appendChild(toggleEl);

  var panel = document.createElement("div");
  panel.className = "lb-panel";

  var questionLabel = document.createElement("span");
  questionLabel.className = "lb-panel-label";
  questionLabel.textContent = "Question";
  panel.appendChild(questionLabel);

  var questionCopy = document.createElement("div");
  questionCopy.className = "lb-panel-copy";
  questionCopy.textContent = entry.prompt || "";
  panel.appendChild(questionCopy);

  if (entry.answer) {
    var answerLabel = document.createElement("span");
    answerLabel.className = "lb-panel-label";
    answerLabel.textContent = "Worst Answer";
    panel.appendChild(answerLabel);

    var answerCopy = document.createElement("div");
    answerCopy.className = "lb-panel-copy";
    answerCopy.textContent = entry.answer;
    panel.appendChild(answerCopy);
  }

  wrapper.appendChild(row);
  wrapper.appendChild(panel);
  return wrapper;
}

function buildRunListItem(run) {
  var button = document.createElement("button");
  button.className = "run-item" + (run.id === activeRunId ? " active" : "");
  button.onclick = function() { inspectRun(run.id); };

  var top = document.createElement("div");
  top.className = "run-top";
  var crown = document.createElement("div");
  crown.className = "run-crown";
  crown.textContent = modelName(run.crownModelId || "unknown") + " took the crown";
  top.appendChild(crown);
  var score = document.createElement("div");
  score.className = "run-score";
  score.style.color = shitTier(run.crownScore || 0).color;
  score.textContent = String(run.crownScore || 0) + "%";
  top.appendChild(score);
  button.appendChild(top);

  var meta = document.createElement("div");
  meta.className = "run-meta";
  meta.textContent = [run.contestantProvider || "unknown", run.judgeProvider || "unknown", run.createdAt || ""].filter(Boolean).join(" • ");
  button.appendChild(meta);

  var prompt = document.createElement("div");
  prompt.className = "run-prompt";
  prompt.textContent = run.prompt || "";
  button.appendChild(prompt);

  return button;
}

function renderRunInspector(run) {
  var detail = document.getElementById("runDetail");
  detail.textContent = "";

  var title = document.createElement("h3");
  title.textContent = "Run " + run.id;
  detail.appendChild(title);

  var kv = document.createElement("div");
  kv.className = "run-kv";
  [
    ["Winner", modelName(run.crownModelId || "unknown") + " (" + String(run.crownScore || 0) + "%)"],
    ["Contestants", run.contestantProvider || "unknown"],
    ["Judge", [run.judgeProvider || "unknown", run.judgeModel || ""].filter(Boolean).join(" / ")],
    ["Timings", JSON.stringify(run.timings || {})],
    ["Status", (run.execution && run.execution.summary && run.execution.summary.overallStatus) || "unknown"],
    ["Created", run.createdAt || ""],
  ].forEach(function(entry) {
    var k = document.createElement("div");
    k.className = "run-k";
    k.textContent = entry[0];
    kv.appendChild(k);
    var v = document.createElement("div");
    v.className = "run-v";
    v.textContent = entry[1];
    kv.appendChild(v);
  });
  detail.appendChild(kv);

  var failedModels = [];
  var executionModels = run.execution && run.execution.models ? run.execution.models : {};
  Object.keys(executionModels).forEach(function(modelId) {
    if (executionModels[modelId] && executionModels[modelId].status && executionModels[modelId].status !== "success") {
      failedModels.push(modelId);
    }
  });

  if (failedModels.length) {
    var compareBar = document.createElement("div");
    compareBar.className = "comparebar";
    failedModels.forEach(function(modelId) {
      var btn = document.createElement("button");
      btn.className = "comparebtn" + (activeInspectModelId === modelId ? " active" : "");
      btn.textContent = modelName(modelId) + " failure";
      btn.onclick = function() {
        activeInspectModelId = modelId;
        renderRunInspector(run);
      };
      compareBar.appendChild(btn);
    });
    detail.appendChild(compareBar);
  }

  var promptBlock = document.createElement("div");
  promptBlock.className = "run-block";
  var promptTitle = document.createElement("div");
  promptTitle.className = "run-k";
  promptTitle.textContent = "Prompt";
  promptBlock.appendChild(promptTitle);
  var promptValue = document.createElement("pre");
  promptValue.textContent = run.prompt || "";
  promptBlock.appendChild(promptValue);
  detail.appendChild(promptBlock);

  var verdictBlock = document.createElement("div");
  verdictBlock.className = "run-block";
  var verdictTitle = document.createElement("div");
  verdictTitle.className = "run-k";
  verdictTitle.textContent = "Judgement";
  verdictBlock.appendChild(verdictTitle);
  var verdictValue = document.createElement("pre");
  verdictValue.textContent = JSON.stringify(run.judgement || {}, null, 2);
  verdictBlock.appendChild(verdictValue);
  detail.appendChild(verdictBlock);

  var execBlock = document.createElement("div");
  execBlock.className = "run-block";
  var execTitle = document.createElement("div");
  execTitle.className = "run-k";
  execTitle.textContent = activeInspectModelId ? "Execution Focus: " + modelName(activeInspectModelId) : "Execution";
  execBlock.appendChild(execTitle);
  var execValue = document.createElement("pre");
  if (activeInspectModelId && executionModels[activeInspectModelId]) {
    execValue.textContent = JSON.stringify({
      modelId: activeInspectModelId,
      detail: executionModels[activeInspectModelId],
      judge: run.execution && run.execution.judge ? run.execution.judge : {},
      policy: run.execution && run.execution.policy ? run.execution.policy : {},
    }, null, 2);
  } else {
    execValue.textContent = JSON.stringify(run.execution || {}, null, 2);
  }
  execBlock.appendChild(execValue);
  detail.appendChild(execBlock);

  if (failedModels.length) {
    var actionBlock = document.createElement("div");
    actionBlock.className = "run-block";
    var actionTitle = document.createElement("div");
    actionTitle.className = "run-k";
    actionTitle.textContent = "Incident Actions";
    actionBlock.appendChild(actionTitle);
    failedModels.forEach(function(modelId) {
      var actionBtn = document.createElement("button");
      actionBtn.className = "comparebtn";
      actionBtn.textContent = "filter runs for " + modelName(modelId);
      actionBtn.onclick = function() {
        activeInspectModelId = modelId;
        applyDrilldown({ failedModelId: modelId, status: (run.execution && run.execution.summary && run.execution.summary.overallStatus) || "failure" });
      };
      actionBlock.appendChild(actionBtn);
    });
    detail.appendChild(actionBlock);
  }

  // F4 — replay this prompt
  var replayBtn = document.createElement("button");
  replayBtn.className = "comparebtn";
  replayBtn.textContent = "↺ replay this prompt";
  replayBtn.onclick = function() {
    window._replayBaseScores = run.judgement && run.judgement.scores ? run.judgement.scores : {};
    window._replayBaseRunId = run.id;
    if (isAnalyticsPage) {
      window.location.href = "/?replay=" + encodeURIComponent(run.prompt || "");
      return;
    }
    var input = document.getElementById("promptInput");
    if (input) { input.value = run.prompt || ""; updateChar(); }
  };
  detail.appendChild(replayBtn);
}

// SCORING
function shitTier(score) {
  if(score>=80) return {label:"ABSOLUTE GARBAGE",color:"#ef4444"};
  if(score>=60) return {label:"PRETTY SHIT",     color:"#f97316"};
  if(score>=40) return {label:"MEDIOCRE SLOP",   color:"#eab308"};
  if(score>=20) return {label:"TOLERABLE",       color:"#84cc16"};
  return              {label:"SOMEHOW OK",       color:"#22c55e"};
}

function detectSymptoms(text) {
  const l = text.toLowerCase();
  return SYMPTOMS.filter(s => s.test(l, text));
}

function calcShitScore(text) {
  const syms = detectSymptoms(text);
  return Math.min(syms.reduce((s,x)=>s+x.weight,0) + Math.floor(Math.random()*12), 99);
}

function categorizeClientError(message, upstreamStatus) {
  var text = String(message || "").toLowerCase();
  var status = Number(upstreamStatus || 0);
  if (status === 408 || /timeout|timed out|abort/.test(text)) return "timeout";
  if (status === 429 || /rate limit|too many requests/.test(text)) return "rate_limit";
  if (status >= 500 || /server error|upstream failed|gateway|overloaded/.test(text)) return "upstream_5xx";
  if (status >= 400 || /invalid|bad request|unauthorized|forbidden|not found/.test(text)) return "upstream_4xx";
  if (/network|fetch failed|socket|econn/.test(text)) return "network";
  return "unknown";
}

// API — calls own server only, no keys exposed
async function fireModel(prompt, modelId, _isRetry) {
  var started = performance.now();
  const res = await fetch("/api/fire", {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-Page-Token": _pageToken},
    body: JSON.stringify({prompt, modelId, pack: _activePack}),
  });
  var data;
  try { data = await res.json(); } catch (_) {
    var err = new Error("Server returned a non-JSON response (gateway error?)");
    err.upstreamStatus = res.status;
    err.durationMs = Math.round(performance.now() - started);
    throw err;
  }
  if (res.status === 403 && !_isRetry) {
    await refreshPageToken();
    return fireModel(prompt, modelId, true);
  }
  if (!res.ok) {
    var error = new Error(data.error || "Server error");
    error.upstreamStatus = res.status;
    error.durationMs = Math.round(performance.now() - started);
    throw error;
  }
  return {
    text: data.response,
    timingMs: Math.round(performance.now() - started),
    upstreamStatus: res.status,
  };
}

async function judgeResponses(prompt, allResponses, modelsOverride, _isRetry) {
  var activeList = Array.isArray(modelsOverride) && modelsOverride.length ? modelsOverride : MODELS;
  var responseTimings = {};
  var executionModels = {};
  activeList.forEach(function(model) {
    if (allResponses[model.id + "__timing"] !== undefined && allResponses[model.id + "__timing"] !== null) {
      responseTimings[model.id] = allResponses[model.id + "__timing"];
    }
    if (allResponses[model.id + "__exec"]) {
      executionModels[model.id] = allResponses[model.id + "__exec"];
    }
  });

  // Only judge models that returned real responses, not error strings
  var judgableList = activeList.filter(function(model) {
    var r = allResponses[model.id];
    return typeof r === "string" && r.trim().length > 0 && !r.startsWith("[Error:");
  });
  if (!judgableList.length) throw new Error("All models failed — nothing to judge.");

  const res = await fetch("/api/judge", {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-Page-Token": _pageToken},
    body: JSON.stringify(Object.assign({
      prompt: prompt,
      responses: judgableList.reduce(function(out, model) {
        out[model.id] = allResponses[model.id];
        return out;
      }, {}),
      meta: {
        timings: {
          contestantMsByModel: responseTimings,
        },
        execution: {
          summary: {
            overallStatus: Object.values(executionModels).every(function(item) { return item.status === "success"; })
              ? "success"
              : (Object.values(executionModels).some(function(item) { return item.status === "success"; }) ? "partial_failure" : "failure"),
          },
          models: executionModels,
          policy: {
            retry: "none",
            fallback: "none",
          },
        },
      },
    }, getActiveCriteria() ? {criteria: getActiveCriteria()} : {}, {pack: _activePack})),
  });
  var data;
  try { data = await res.json(); } catch (_) {
    throw new Error("Judge endpoint returned a non-JSON response");
  }
  if (res.status === 403 && !_isRetry) {
    await refreshPageToken();
    return judgeResponses(prompt, allResponses, modelsOverride, true);
  }
  if (!res.ok) throw new Error(data.error || "Judge error");
  return data;
}

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

function renderShareLink() {
  var results = document.getElementById("results");
  if (!results) return;
  var existing = document.getElementById("shareLinkWrap");
  if (existing) existing.remove();
  var prompt = (document.getElementById("promptInput") && document.getElementById("promptInput").value.trim()) || "";
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

function populateVersusPickers() {
  var selA = document.getElementById("versusModelA");
  var selB = document.getElementById("versusModelB");
  if (!selA || !selB) return;
  [selA, selB].forEach(function(sel) {
    sel.textContent = "";
    MODELS.forEach(function(m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      sel.appendChild(opt);
    });
  });
  if (MODELS.length >= 2) selB.value = MODELS[1].id;
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

function getActiveModels() {
  if (currentMode === "versus") {
    var aId = document.getElementById("versusModelA") && document.getElementById("versusModelA").value;
    var bId = document.getElementById("versusModelB") && document.getElementById("versusModelB").value;
    var a = aId && MODELS.find(function(m) { return m.id === aId; });
    var b = bId && MODELS.find(function(m) { return m.id === bId; });
    if (a && b && a.id !== b.id) return [a, b];
  }
  return MODELS.slice();
}

// FIRE
async function fire() {
  const prompt = document.getElementById("promptInput").value.trim();
  if (!prompt) return;

  responses = {}; votes = {}; autoVotes = {}; userVotes = {};
  _userIsTyping = false; // prevent softReset during render

  // F2 — restrict to two models in versus mode
  var activeModels = getActiveModels();

  // UI state
  document.getElementById("fireBtn").style.display   = "none";
  document.getElementById("resetBtn").style.display  = "block";
  document.getElementById("results").style.display   = "block";
  document.getElementById("roastBox").style.display  = "none";
  document.getElementById("errorBanner").style.display = "none";
  document.getElementById("judgingBanner").style.display = "none";

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
    typewrite("roastText", judgement.roast);
  }

  // F1 — share link inside results, idempotent
  renderShareLink();

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
function updateCard(model, text, judgement, crownId) {
  const card = document.getElementById("card-"+model.id);
  if (!card || !text) return;
  const isCrown    = crownId === model.id;
  const finalScore = (judgement && judgement.scores && judgement.scores[model.id] !== undefined)
                      ? judgement.scores[model.id]
                      : calcShitScore(text);
  const tier    = shitTier(finalScore);
  const verdict = (judgement && judgement.verdicts) ? judgement.verdicts[model.id] : null;
  const symptoms = detectSymptoms(text);

  // ── Card already rendered — only update score/verdict/votes, never restart typewriter ──
  if (card.dataset.rendered === "1") {
    if (isCrown) card.classList.add("crown-card");
    var pill = card.querySelector(".score-pill");
    if (pill) {
      var newPill = buildScorePill(finalScore, tier.color);
      pill.replaceWith(newPill);
    }
    var bar = document.getElementById("bar-"+model.id);
    if (bar) { bar.style.background = tier.color; setTimeout(function(){ bar.style.width = finalScore+"%"; }, 100); }
    var tierLbl = card.querySelector(".tier-lbl");
    if (tierLbl) { tierLbl.textContent = tier.label; tierLbl.style.color = tier.color; }
    if (verdict) {
      var verdictEl = card.querySelector(".verdict");
      if (!verdictEl) {
        var brutal = card.querySelector(".brutal");
        if (brutal) {
          var vDiv = document.createElement("div");
          vDiv.className = "verdict";
          setVerdictContent(vDiv, verdict);
          card.insertBefore(vDiv, brutal);
        }
      } else {
        setVerdictContent(verdictEl, verdict);
      }
    }
    if (isCrown && !card.querySelector(".crown-banner")) {
      card.insertBefore(buildCrownBanner(), card.firstChild);
    }
    refreshVotes(model.id);
    return;
  }

  // ── First render — build full card ──
  card.dataset.rendered = "1";
  if (isCrown) card.classList.add("crown-card");

  card.textContent = "";
  if (isCrown) card.appendChild(buildCrownBanner());

  var top = document.createElement("div");
  top.className = "card-top";
  var glyph = document.createElement("span");
  glyph.className = "card-glyph";
  glyph.style.color = model.color;
  glyph.textContent = model.glyph;
  top.appendChild(glyph);
  var meta = document.createElement("div");
  var name = document.createElement("div");
  name.className = "card-name";
  name.style.color = model.color;
  name.textContent = model.name;
  meta.appendChild(name);
  var maker = document.createElement("div");
  maker.className = "card-maker";
  maker.textContent = model.maker;
  meta.appendChild(maker);
  top.appendChild(meta);
  top.appendChild(buildScorePill(finalScore, tier.color));
  card.appendChild(top);

  var barWrap = document.createElement("div");
  barWrap.className = "bar-wrap";
  var barTrack = document.createElement("div");
  barTrack.className = "bar-track";
  var barFill = document.createElement("div");
  barFill.className = "bar-fill";
  barFill.style.width = "0%";
  barFill.style.background = tier.color;
  barFill.id = "bar-" + model.id;
  barTrack.appendChild(barFill);
  barWrap.appendChild(barTrack);
  var tierLbl = document.createElement("span");
  tierLbl.className = "tier-lbl";
  tierLbl.style.color = tier.color;
  tierLbl.textContent = tier.label;
  barWrap.appendChild(tierLbl);
  card.appendChild(barWrap);

  var body = document.createElement("div");
  body.className = "card-body";
  var resp = document.createElement("div");
  resp.className = "resp-txt";
  resp.id = "resp-" + model.id;
  body.appendChild(resp);
  card.appendChild(body);

  var symptomsEl = buildSymptoms(symptoms);
  if (symptomsEl) card.appendChild(symptomsEl);

  if (verdict) {
    var verdictEl = document.createElement("div");
    verdictEl.className = "verdict";
    verdictEl.id = "verdict-" + model.id;
    card.appendChild(verdictEl);
  }

  var brutal = document.createElement("div");
  brutal.className = "brutal";
  brutal.id = "brutal-" + model.id;
  var brutalLbl = document.createElement("div");
  brutalLbl.className = "brutal-lbl";
  brutalLbl.textContent = "BRUTAL RANK";
  brutal.appendChild(brutalLbl);
  var voteRow = document.createElement("div");
  voteRow.className = "vote-row";
  voteRow.id = "votes-" + model.id;
  brutal.appendChild(voteRow);
  card.appendChild(brutal);
  renderVoteButtons(voteRow, model.id);

  setTimeout(function(){ var b=document.getElementById("bar-"+model.id); if(b) b.style.width=finalScore+"%"; }, 100);
  typewrite("resp-"+model.id, text);
  if (verdict) {
    setVerdictContent(document.getElementById("verdict-"+model.id), verdict);
  }

  // Auto-vote after DOM is built, only if no judgement yet and not already voted
  if (!judgement && autoVotes[model.id] === undefined && userVotes[model.id] === undefined) {
    autoVote(model.id, finalScore);
  }
}

function getModelVotes(modelId) {
  var out={};
  VOTE_LABELS.forEach(function(_,i){ out[i]=votes[modelId+"-"+i]||0; });
  return out;
}

// Only re-render the vote buttons — never the whole card
function refreshVotes(modelId) {
  var el = document.getElementById("votes-"+modelId);
  if (el) renderVoteButtons(el, modelId);
}

// Auto-vote based on shit score — called after judge scores arrive
function autoVote(modelId, score) {
  // Map score to VOTE_LABELS index
  // 80+  -> 0 ABSOLUTE GARBAGE
  // 60+  -> 1 STILL BAD
  // 40+  -> 2 MEDIOCRE
  // 20+  -> 3 TOLERABLE
  // 0+   -> 4 SOMEHOW OK
  var idx;
  if      (score >= 80) idx = 0;
  else if (score >= 60) idx = 1;
  else if (score >= 40) idx = 2;
  else if (score >= 20) idx = 3;
  else                  idx = 4;

  // Only auto-vote if user hasn't already picked
  if (userVotes[modelId] === undefined) {
    // Remove previous auto-vote count if re-scoring
    if (autoVotes[modelId] !== undefined) {
      var prev = autoVotes[modelId];
      votes[modelId+"-"+prev] = Math.max(0, (votes[modelId+"-"+prev]||1)-1);
    }
    autoVotes[modelId] = idx;
    votes[modelId+"-"+idx] = (votes[modelId+"-"+idx]||0)+1;
    // Refresh just the vote row — card must already exist in DOM
    refreshVotes(modelId);
  }
}

// User manually picks — overrides auto
function vote(modelId, idx) {
  var model = MODELS.find(function(m){return m.id===modelId;});

  // If switching from auto-vote, remove the auto vote count
  if (autoVotes[modelId] !== undefined && userVotes[modelId] === undefined) {
    var autoIdx = autoVotes[modelId];
    votes[modelId+"-"+autoIdx] = Math.max(0, (votes[modelId+"-"+autoIdx]||1)-1);
  }
  // If switching from a previous user vote, remove it
  if (userVotes[modelId] !== undefined) {
    var prevIdx = userVotes[modelId];
    votes[modelId+"-"+prevIdx] = Math.max(0, (votes[modelId+"-"+prevIdx]||1)-1);
  }

  // Register new user vote
  userVotes[modelId] = idx;
  votes[modelId+"-"+idx] = (votes[modelId+"-"+idx]||0)+1;

  // Only update vote buttons — don't touch the card or restart typewriter
  refreshVotes(modelId);
  saveVoteState();
}

function saveVoteState() {
  try {
    localStorage.setItem("csb_votes_v1", JSON.stringify({ votes: votes, autoVotes: autoVotes, userVotes: userVotes }));
  } catch(e) {}
}

function loadVoteState() {
  try {
    var saved = localStorage.getItem("csb_votes_v1");
    if (saved) {
      var s = JSON.parse(saved);
      if (s && s.votes) votes = s.votes;
      if (s && s.autoVotes) autoVotes = s.autoVotes;
      if (s && s.userVotes) userVotes = s.userVotes;
    }
  } catch(e) {}
}

function typewrite(elId, text, speed) {
  speed = speed || 6;
  var el = document.getElementById(elId);
  if (!el) return;
  el.textContent = "";
  var i = 0;
  var iv = setInterval(function(){
    if (i < text.length) { el.textContent = text.slice(0, ++i); }
    else clearInterval(iv);
  }, speed);
}

function renderLeaderboard() {
  if (isAnalyticsPage) {
    document.getElementById("leaderboard").style.display = "none";
    return;
  }
  document.getElementById("leaderboard").style.display = history.length ? "block" : "none";
  if (!history.length) return;
  var list = document.getElementById("lbList");
  list.textContent = "";
  history.slice(0,10).forEach(function(entry, index) {
    list.appendChild(buildLeaderboardRow(entry, index + 1));
  });
}

function renderAnalytics() {
  var panel = document.getElementById("analyticsPanel");
  if (!isAnalyticsPage) {
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
  if (!isAnalyticsPage) return;
  try {
    const res = await fetch("/api/analytics?" + new URLSearchParams(params || {}).toString());
    analyticsSummary = await res.json();
    renderAnalytics();
  } catch (e) {
    console.warn("Analytics refresh failed:", e.message);
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
  document.getElementById("results").style.display   = "none";
  document.getElementById("roastBox").style.display  = "none";
  document.getElementById("judgingBanner").style.display = "none";
  document.getElementById("cardsGrid").textContent   = "";
  // Clear rendered flags so next fire() starts fresh
  responses = {};
  document.getElementById("errorBanner").style.display = "none";
  responses = {}; votes = {}; autoVotes = {}; userVotes = {};
}

// Full reset — clears everything including the prompt
function reset() {
  document.getElementById("promptInput").value = "";
  softReset();
  renderRandomStrip();
  updateChar();
}

// ── MODERATION PANEL ─────────────────────────────────────────────────────────

function loadModerationPanel() {
  if (!isAnalyticsPage) return;
  var panel = document.getElementById("moderationPanel");
  var list = document.getElementById("moderationList");
  if (!panel || !list) return;
  panel.style.display = "block";
  list.innerHTML = "<div class=\"mod-empty\">loading&hellip;</div>";

  fetch("/api/prompts/pending")
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      var items = (data && Array.isArray(data.items)) ? data.items : [];
      list.innerHTML = "";
      if (!items.length) {
        var empty = document.createElement("div");
        empty.className = "mod-empty";
        empty.textContent = "no pending prompts — queue is empty";
        list.appendChild(empty);
        return;
      }
      items.forEach(function(item) {
        var id = Number(item.id);
        var div = document.createElement("div");
        div.className = "mod-item";

        var info = document.createElement("div");
        info.className = "mod-info";

        var promptEl = document.createElement("div");
        promptEl.className = "mod-prompt";
        promptEl.textContent = String(item.prompt || "");

        var metaEl = document.createElement("div");
        metaEl.className = "mod-meta";
        metaEl.textContent = "submitted " + (item.submittedAt ? String(item.submittedAt).slice(0, 10) : "unknown");

        info.appendChild(promptEl);
        info.appendChild(metaEl);

        var actions = document.createElement("div");
        actions.className = "mod-actions";

        var approveBtn = document.createElement("button");
        approveBtn.className = "mod-btn approve";
        approveBtn.textContent = "✓ approve";
        approveBtn.addEventListener("click", function() { moderatePrompt(id, "approve"); });

        var rejectBtn = document.createElement("button");
        rejectBtn.className = "mod-btn reject";
        rejectBtn.textContent = "✗ reject";
        rejectBtn.addEventListener("click", function() { moderatePrompt(id, "reject"); });

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        div.appendChild(info);
        div.appendChild(actions);
        list.appendChild(div);
      });
    })
    .catch(function(status) {
      list.innerHTML = "";
      var err = document.createElement("div");
      err.className = "mod-error";
      err.textContent = "failed to load pending prompts" + (status ? " (HTTP " + status + ")" : "");
      list.appendChild(err);
    });
}

function moderatePrompt(id, action) {
  if (!isAnalyticsPage) return;
  var list = document.getElementById("moderationList");
  var endpoint = "/api/prompts/" + id + "/" + action;
  fetch(endpoint, { method: "POST" })
    .then(function(r) {
      if (!r.ok) return Promise.reject(r.status);
      loadModerationPanel();
    })
    .catch(function(status) {
      if (!list) return;
      var err = document.createElement("div");
      err.className = "mod-error";
      err.textContent = action + " failed" + (status ? " (HTTP " + status + ")" : "");
      list.insertBefore(err, list.firstChild);
    });
}

init();
