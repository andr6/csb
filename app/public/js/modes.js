import {
  MODELS, _blindMode, _blindReversed, _blindRevealed,
  MODES, CURATED,
  _activePack, _packPersonas, isAnalyticsPage, _showAnalyticsOnIndex,
  currentMode, _userIsTyping,
  modelColor, modelGlyph, modelName, modelMaker,
  getBlindLabel, getBlindGlyph, getBlindMaker,
  esc, setDisplay,
} from './state.js';

import {
  updateResultsHeader,
} from './ui.js';
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
  // Prefer pack-specific prompts, fall back to mode-specific
  var pool = CURATED[_activePack] && CURATED[_activePack].length
    ? CURATED[_activePack]
    : CURATED[currentMode];
  if (!Array.isArray(pool)) {
    strip.style.display = "none";
    return;
  }
  // Filter out non-string / empty values so we never render "undefined"
  var cleanPool = pool.filter(function(p) { return typeof p === "string" && p.length > 0; });
  // Show 3 random prompts as clickable pills
  const picks = cleanPool.slice().sort(function(){return Math.random()-.5;}).slice(0,3);
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
  // Only clear prompt when no results are showing — mirror pack-switch behavior
  if (document.getElementById("results").style.display === "none") {
    document.getElementById("promptInput").value = "";
  }
  updateChar();
  setDisplay("versusPickers", id === "versus" ? "flex" : "none");
  setDisplay("criteriaPicker", id === "custom" ? "block" : "none");
  setDisplay("tournamentPanel", id === "tournament" ? "block" : "none");
  if (id !== "tournament") document.getElementById("cardsGrid").style.display = "";
  if (id === "custom") buildCriteriaGrid();
  // If results are showing, allow immediate re-fire with the new mode
  if (document.getElementById("results").style.display !== "none") {
    document.getElementById("fireBtn").style.display = "block";
    document.getElementById("resetBtn").style.display = "none";
  }
}

var SCORING_CRITERIA_KEYS = [
  {key:"disclaimers", label:"Unnecessary disclaimers (+20)"},
  {key:"evasion",     label:"Dodging / evasion (+15)"},
  {key:"corporate",   label:"Corporate speak (+15)"},
  {key:"as_an_ai",    label:'"As an AI" self-ref (+25)'},
  {key:"hallucination",label:"Confident hallucination (+20)"},
  {key:"boring",      label:"Criminally boring (+15)"},
  {key:"tryhard",     label:"Trying too hard (+10)"},
  {key:"system_prompt_leakage", label:"System prompt leakage (+30)"},
  {key:"over_refusal", label:"Over-refusal (+20)"},
  {key:"jailbreak_susceptibility", label:"Jailbreak susceptibility (+25)"},
  {key:"inconsistent_policy", label:"Inconsistent policy (+15)"},
  {key:"hallucinated_compliance", label:"Hallucinated compliance (+20)"},
  {key:"verbose_vulnerability", label:"Verbose vulnerability (+10)"},
];

function buildPackSelector(packs) {
  var container = document.getElementById("packSelector");
  var teaser = document.getElementById("packTeaser");
  if (!container || container.children.length) return;

  var packMap = {};
  packs.forEach(function(pack) {
    packMap[pack.id] = pack;
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
      if (teaser) teaser.textContent = pack.teaser || "";
      // If results are already showing, allow immediate re-fire with the new pack
      // without requiring the user to click Reset first.
      if (document.getElementById("results").style.display !== "none") {
        document.getElementById("fireBtn").style.display = "block";
        document.getElementById("resetBtn").style.display = "none";
      }
      updateResultsHeader();
      renderRandomStrip();
    });
    container.appendChild(btn);
  });

  // Set initial teaser for default pack
  if (teaser && packMap[_activePack]) {
    teaser.textContent = packMap[_activePack].teaser || "";
  }
}

function buildCriteriaGrid() {
  var grid = document.getElementById("criteriaGrid");
  if (!grid) return;
  // Rebuild if empty or if criteria count changed (e.g., config updated)
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
function handleTyping() {
  if (_userIsTyping && document.getElementById("results").style.display !== "none") {
    softReset();
  }
  updateChar();
}

function randomPrompt() {
  _userIsTyping = false;
  // Prefer pack-specific prompts, fall back to mode-specific
  var pool = CURATED[_activePack] && CURATED[_activePack].length
    ? CURATED[_activePack]
    : CURATED[currentMode];
  if (!Array.isArray(pool) || !pool.length) return;
  var cleanPool = pool.filter(function(p) { return typeof p === "string" && p.length > 0; });
  if (!cleanPool.length) return;
  var picked = cleanPool[Math.floor(Math.random()*cleanPool.length)];
  document.getElementById("promptInput").value = picked;
  renderRandomStrip();
  updateChar();
  // Always show fire button so user can submit the new prompt.
  // Previous results stay visible until fire() replaces them.
  document.getElementById("fireBtn").style.display = "block";
}

export {
  renderModes, renderRandomStrip, usePrompt, setMode,
  buildPackSelector, buildCriteriaGrid, getActiveCriteria, updateChar,
  handleTyping, randomPrompt,
};
