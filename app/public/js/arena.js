import { state, VOTE_LABELS } from "./state.js";
import { modelName, modelColor, modelGlyph, shitTier, detectSymptoms, calcShitScore, getBlindLabel, getBlindGlyph, getBlindMaker, esc, setDisplay, typewrite, showError, createBlindMapping, categorizeClientError } from "./utils.js";
import { fireModel, judgeResponses } from "./api.js";
import { buildScorePill, buildCrownBanner, buildSymptoms, setVerdictContent, renderVoteButtons, buildLoadingCard, renderShareLink, renderReplayDiff, populateVersusPickers } from "./ui.js";
import { renderAnalytics, inspectRun, refreshHistory, refreshRuns, refreshFailureSummary, refreshAnalytics, getCurrentRunFilters } from "./analytics.js";
import { runTournament } from "./tournament.js";

export function getActiveModels() {
  if (state.currentMode === "versus") {
    var aId = document.getElementById("versusModelA") && document.getElementById("versusModelA").value;
    var bId = document.getElementById("versusModelB") && document.getElementById("versusModelB").value;
    var a = aId && state.models.find(function(m) { return m.id === aId; });
    var b = bId && state.models.find(function(m) { return m.id === bId; });
    if (a && b && a.id !== b.id) return [a, b];
  }
  return state.models.slice();
}

export async function fire() {
  var promptInput = document.getElementById("promptInput");
  var prompt = promptInput ? promptInput.value.trim() : "";
  if (!prompt) return;

  state.responses = {}; state.votes = {}; state.autoVotes = {}; state.userVotes = {};
  state.userIsTyping = false;

  var activeModels = getActiveModels();

  var blindToggle = document.getElementById("blindToggle");
  state.blindMode = blindToggle ? blindToggle.checked : false;
  state.blindRevealed = false;
  if (state.blindMode) {
    var bm = createBlindMapping(activeModels.map(function(m) { return m.id; }));
    state.blindMapping = bm.mapping;
    state.blindReversed = bm.reversed;
    // Shuffle card order to control for order effects
    for (var i = activeModels.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = activeModels[i]; activeModels[i] = activeModels[j]; activeModels[j] = tmp;
    }
  } else {
    state.blindMapping = null; state.blindReversed = null;
  }

  // updateResultsHeader needs core.js — call via DOM event or direct import if available
  // Since core.js may not be loaded in a circular scenario, we inline the header update here
  var resultsPersonaHeader = document.getElementById("resultsPersonaHeader");
  if (resultsPersonaHeader) {
    var persona = state.packPersonas[state.activePack] || "bar-owner";
    var mode = state.currentMode;
    if (mode === "redteam") {
      resultsPersonaHeader.textContent = "Red-team assessment: testing for system-prompt leakage, jailbreak susceptibility, and over-refusal.";
    } else if (mode === "versus") {
      resultsPersonaHeader.textContent = "Duel mode: two models, one prompt. The pack sets the judge's personality. Lowest quality wins.";
    } else if (mode === "tournament") {
      resultsPersonaHeader.textContent = "Tournament bracket: single elimination. The pack judge scores every head-to-head match.";
    } else if (mode === "custom") {
      resultsPersonaHeader.textContent = "Custom criteria: you chose what the judge scores. Lowest quality answer gets the crown.";
    } else if (mode === "rage") {
      resultsPersonaHeader.textContent = "Compare mode: all models answer the same prompt. Lowest quality answer gets the crown.";
    } else {
      resultsPersonaHeader.textContent = "Each model was given a " + persona.replace(/-/g, " ") + " persona. Low quality = model refused or broke character.";
    }
  }

  setDisplay("fireBtn", "none");
  setDisplay("resetBtn", "block");
  setDisplay("revealBtn", state.blindMode ? "block" : "none");
  setDisplay("results", "block");
  setDisplay("roastBox", "none");
  setDisplay("errorBanner", "none");
  setDisplay("judgingBanner", "none");

  if (state.currentMode === "tournament") {
    setDisplay("cardsGrid", "none");
    await runTournament(prompt, activeModels);
    return;
  }
  setDisplay("cardsGrid", "");

  var cardsGrid = document.getElementById("cardsGrid");
  if (cardsGrid) cardsGrid.textContent = "";
  activeModels.forEach(function(m) {
    if (cardsGrid) cardsGrid.appendChild(buildLoadingCard(m));
  });

  var anySuccess = false;
  await Promise.all(activeModels.map(async function(model) {
    try {
      var result = await fireModel(prompt, model.id);
      state.responses[model.id] = result.text;
      state.responses[model.id + "__timing"] = result.timingMs;
      state.responses[model.id + "__exec"] = {
        status: "success",
        upstreamStatus: result.upstreamStatus,
        durationMs: result.timingMs,
        retryCount: 0,
        fallbackUsed: false,
      };
      anySuccess = true;
    } catch(e) {
      state.responses[model.id] = "[Error: " + e.message + "]";
      state.responses[model.id + "__timing"] = null;
      state.responses[model.id + "__exec"] = {
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
    updateCard(model, state.responses[model.id], null, null);
  }));

  if (!anySuccess) {
    showError("Arr, the ship's gone dark! Every model walked the plank — check yer server be sailin'.");
    return;
  }

  setDisplay("judgingBanner", "flex");
  var judgement = null;
  try {
    judgement = await judgeResponses(prompt, state.responses, activeModels);
  } catch(e) {
    console.warn("Judge failed:", e.message);
  }
  setDisplay("judgingBanner", "none");

  activeModels.forEach(function(m) {
    updateCard(m, state.responses[m.id], judgement, judgement ? judgement.crown : null);
  });
  if (judgement && judgement.scores) {
    activeModels.forEach(function(m) {
      if (judgement.scores[m.id] !== undefined) {
        autoVote(m.id, judgement.scores[m.id]);
      }
    });
  }

  if (judgement && judgement.roast) {
    setDisplay("roastBox", "block");
    var roastText = document.getElementById("roastText");
    if (roastText) {
      roastText.dataset.originalRoast = judgement.roast;
      typewrite("roastText", judgement.roast);
    }
  }

  renderShareLink(prompt, judgement);

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

export function updateCard(model, text, judgement, crownId) {
  var card = document.getElementById("card-" + model.id);
  if (!card || !text) return;
  var isCrown    = crownId === model.id;
  var finalScore = (judgement && judgement.scores && judgement.scores[model.id] !== undefined)
                      ? judgement.scores[model.id]
                      : calcShitScore(text);
  var tier    = shitTier(finalScore);
  var verdict = (judgement && judgement.verdicts) ? judgement.verdicts[model.id] : null;
  var symptoms = detectSymptoms(text);

  if (card.dataset.rendered === "1") {
    if (isCrown) card.classList.add("crown-card");
    var pill = card.querySelector(".score-pill");
    if (pill) {
      var newPill = buildScorePill(finalScore, tier.color);
      pill.replaceWith(newPill);
    }
    var bar = document.getElementById("bar-" + model.id);
    if (bar) { bar.style.background = tier.color; setTimeout(function(){ bar.style.width = finalScore + "%"; }, 100); }
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

  card.dataset.rendered = "1";
  if (isCrown) card.classList.add("crown-card");

  card.textContent = "";
  if (isCrown) card.appendChild(buildCrownBanner());

  var top = document.createElement("div");
  top.className = "card-top";
  var glyph = document.createElement("span");
  glyph.className = "card-glyph";
  glyph.style.color = model.color;
  glyph.textContent = getBlindGlyph(model.id);
  top.appendChild(glyph);
  var meta = document.createElement("div");
  var name = document.createElement("div");
  name.className = "card-name";
  name.style.color = model.color;
  name.textContent = getBlindLabel(model.id);
  meta.appendChild(name);
  var maker = document.createElement("div");
  maker.className = "card-maker";
  var blindMaker = getBlindMaker();
  maker.textContent = blindMaker === "hidden" ? "identity concealed" : model.maker;
  meta.appendChild(maker);
  top.appendChild(meta);
  top.appendChild(buildScorePill(finalScore, tier.color));
  if (isCrown && judgement && judgement.judgeConfidence) {
    var confBadge = document.createElement("span");
    confBadge.style.fontSize = ".58rem";
    confBadge.style.padding = ".15rem .4rem";
    confBadge.style.marginLeft = ".5rem";
    confBadge.style.border = "1px solid";
    confBadge.style.textTransform = "uppercase";
    confBadge.style.letterSpacing = ".08em";
    var confVal = judgement.judgeConfidence[model.id] || "";
    if (confVal === "high") { confBadge.style.color = "#98c26f"; confBadge.style.borderColor = "#98c26f"; }
    else if (confVal === "medium") { confBadge.style.color = "#d9b869"; confBadge.style.borderColor = "#d9b869"; }
    else if (confVal === "low") { confBadge.style.color = "#ff7b68"; confBadge.style.borderColor = "#ff7b68"; }
    confBadge.textContent = (confVal ? confVal + " confidence" : "");
    if (confBadge.textContent) top.appendChild(confBadge);
  }
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

  setTimeout(function(){ var b = document.getElementById("bar-" + model.id); if(b) b.style.width = finalScore + "%"; }, 100);
  typewrite("resp-" + model.id, text);
  if (verdict) {
    setVerdictContent(document.getElementById("verdict-" + model.id), verdict);
  }

  if (!judgement && state.autoVotes[model.id] === undefined && state.userVotes[model.id] === undefined) {
    autoVote(model.id, finalScore);
  }
}

export function getModelVotes(modelId) {
  var out = {};
  VOTE_LABELS.forEach(function(_, i){ out[i] = state.votes[modelId + "-" + i] || 0; });
  return out;
}

export function refreshVotes(modelId) {
  var el = document.getElementById("votes-" + modelId);
  if (el) renderVoteButtons(el, modelId);
}

export function autoVote(modelId, score) {
  var idx;
  if      (score >= 80) idx = 0;
  else if (score >= 60) idx = 1;
  else if (score >= 40) idx = 2;
  else if (score >= 20) idx = 3;
  else                  idx = 4;

  if (state.userVotes[modelId] === undefined) {
    if (state.autoVotes[modelId] !== undefined) {
      var prev = state.autoVotes[modelId];
      state.votes[modelId + "-" + prev] = Math.max(0, (state.votes[modelId + "-" + prev] || 1) - 1);
    }
    state.autoVotes[modelId] = idx;
    state.votes[modelId + "-" + idx] = (state.votes[modelId + "-" + idx] || 0) + 1;
    refreshVotes(modelId);
  }
}

export function vote(modelId, idx) {
  if (state.autoVotes[modelId] !== undefined && state.userVotes[modelId] === undefined) {
    var autoIdx = state.autoVotes[modelId];
    state.votes[modelId + "-" + autoIdx] = Math.max(0, (state.votes[modelId + "-" + autoIdx] || 1) - 1);
  }
  if (state.userVotes[modelId] !== undefined) {
    var prevIdx = state.userVotes[modelId];
    state.votes[modelId + "-" + prevIdx] = Math.max(0, (state.votes[modelId + "-" + prevIdx] || 1) - 1);
  }
  state.userVotes[modelId] = idx;
  state.votes[modelId + "-" + idx] = (state.votes[modelId + "-" + idx] || 0) + 1;
  refreshVotes(modelId);
  saveVoteState();
}

export function saveVoteState() {
  try {
    localStorage.setItem("csb_votes_v1", JSON.stringify({ votes: state.votes, autoVotes: state.autoVotes, userVotes: state.userVotes }));
  } catch(e) {}
}

export function loadVoteState() {
  try {
    var saved = localStorage.getItem("csb_votes_v1");
    if (saved) {
      var s = JSON.parse(saved);
      if (s && s.votes) state.votes = s.votes;
      if (s && s.autoVotes) state.autoVotes = s.autoVotes;
      if (s && s.userVotes) state.userVotes = s.userVotes;
    }
  } catch(e) {}
}

export function renderRunPage(runId) {
  if (!runId) return;
  fetch("/api/runs/" + encodeURIComponent(runId) + "/public")
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(run) { inspectRun(run.id); })
    .catch(function(e) { console.warn("[run-page]", e); });
}

export function renderModelProfile(modelId) {
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

