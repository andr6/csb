import {
  MODELS, _blindMode, _blindReversed, _blindRevealed, _tournamentScores,
  MODES, CURATED, VOTE_LABELS, SYMPTOMS,
  _pageToken, _activePack, _packPersonas, isAnalyticsPage, _showAnalyticsOnIndex,
  runPagePath, modelProfilePath, isRunPage, isModelProfilePage,
  currentMode, votes, autoVotes, userVotes, history, responses, recentRuns, activeRunId,
  failureSummary, analyticsSummary, providerOptions, drilldownFilters, activeInspectModelId,
  SCORING_CRITERIA_KEYS, _userIsTyping,
  modelColor, modelGlyph, modelName, modelMaker, createBlindMapping, swapKeys,
  getBlindLabel, getBlindGlyph, getBlindMaker,
  esc, setDisplay,
} from './state.js';
function updateResultsHeader() {
  var el = document.getElementById("resultsPersonaHeader");
  if (!el) return;
  var persona = _packPersonas[_activePack] || "bar-owner";
  el.textContent = "// each model was given a " + persona + " persona — high score = safety training won";
}

function injectModerationPanel() {
  if (document.getElementById("moderationPanel")) return;
  var panel = document.createElement("div");
  panel.className = "moderation";
  panel.id = "moderationPanel";
  panel.innerHTML = '<div class="sec-head"><span class="sh-line"></span><span class="sh-label">// prompt moderation &mdash; review and approve submissions</span><span class="sh-line"></span></div>' +
    '<div class="mod-toolbar"><button class="runs-export" onclick="loadModerationPanel()">&#8635; refresh</button></div>' +
    '<div class="mod-list" id="moderationList"></div>';
  var wrap = document.querySelector(".wrap");
  if (wrap) wrap.appendChild(panel);
}

function applyPageMode() {
  document.title = isAnalyticsPage ? "CSB Analytics"
                 : isRunPage ? "CSB — Run " + runPagePath
                 : isModelProfilePage ? "CSB — " + modelName(modelProfilePath)
                 : "CSB — Chat Shit Bob";

  var homeLink = document.getElementById("homeLink");
  if (homeLink) homeLink.classList.toggle("header-link--active", !isAnalyticsPage && !isRunPage && !isModelProfilePage);

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

  var wrapper = document.createElement("div");
  wrapper.className = "lb-entry";

  // ── Header row: rank | model | score ──
  var header = document.createElement("div");
  header.className = "lb-header";

  var rankEl = document.createElement("span");
  rankEl.className = "lb-rank";
  rankEl.textContent = "#" + rank;
  header.appendChild(rankEl);

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

  header.appendChild(metaEl);

  if (entry.createdAt) {
    var timeEl = document.createElement("span");
    timeEl.className = "lb-time";
    try {
      timeEl.textContent = new Date(entry.createdAt).toISOString().replace("T"," ").slice(0,19) + " UTC";
    } catch (_) {
      timeEl.textContent = String(entry.createdAt);
    }
    header.appendChild(timeEl);
  }

  var scoreEl = document.createElement("span");
  scoreEl.className = "lb-score";
  scoreEl.style.color = t.color;
  scoreEl.textContent = entry.score + "%";
  header.appendChild(scoreEl);

  // ── Body: prompt + answer preview (always visible) ──
  var body = document.createElement("div");
  body.className = "lb-body";

  var promptRow = document.createElement("div");
  promptRow.className = "lb-prompt-row";
  var promptLabel = document.createElement("span");
  promptLabel.className = "lb-body-label";
  promptLabel.textContent = "TRIGGER";
  promptRow.appendChild(promptLabel);
  var promptText = document.createElement("span");
  promptText.className = "lb-prompt-text";
  promptText.textContent = entry.prompt || "";
  promptRow.appendChild(promptText);
  body.appendChild(promptRow);

  if (entry.answer) {
    var answerRow = document.createElement("div");
    answerRow.className = "lb-answer-row";
    var answerLabel = document.createElement("span");
    answerLabel.className = "lb-body-label";
    answerLabel.textContent = "BEGINNING";
    answerRow.appendChild(answerLabel);
    var answerText = document.createElement("span");
    answerText.className = "lb-answer-text";
    var preview = entry.answer.slice(0, 180);
    answerText.textContent = preview + (entry.answer.length > 180 ? "..." : "");
    answerRow.appendChild(answerText);
    body.appendChild(answerRow);
  }

  wrapper.appendChild(header);
  wrapper.appendChild(body);
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
  var entries = [
    ["Winner", modelName(run.crownModelId || "unknown") + " (" + String(run.crownScore || 0) + "%)"],
    ["Contestants", run.contestantProvider || "unknown"],
    ["Judge", [run.judgeProvider || "unknown", run.judgeModel || ""].filter(Boolean).join(" / ")],
    ["Timings", JSON.stringify(run.timings || {})],
    ["Status", (run.execution && run.execution.summary && run.execution.summary.overallStatus) || "unknown"],
    ["Created", run.createdAt || ""],
  ];
  if (run.execution && run.execution.judgeConfidence) {
    entries.push(["Judge Confidence", JSON.stringify(run.execution.judgeConfidence)]);
  }
  entries.forEach(function(entry) {
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
  var base = syms.reduce(function(s, x) { return s + x.weight; }, 0);
  var hash = 0;
  for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) & 0xffffffff;
  var fuzz = Math.abs(hash) % 12;
  return Math.min(base + fuzz, 99);
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

function reset() {
  document.getElementById("promptInput").value = "";
  softReset();
  renderRandomStrip();
  updateChar();
}

function revealBlind() {
  if (!_blindMode) return;
  _blindRevealed = true;
  document.getElementById("revealBtn").style.display = "none";
  // Re-render all cards to show real names
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
  // Re-render roast to show real names if it mentions models
  var roastText = document.getElementById("roastText");
  if (roastText && roastText.dataset.originalRoast) {
    var restored = roastText.dataset.originalRoast;
    Object.keys(_blindMapping || {}).forEach(function(anon) {
      var real = _blindMapping[anon];
      var anonName = "Model " + anon.replace("model_", "").toUpperCase();
      var realName = modelName(real);
      restored = restored.split(anonName).join(realName);
    });
    roastText.textContent = restored;
  }
}

// ── MODERATION PANEL ─────────────────────────────────────────────────────────

function updateAuthUI() {
  var userMenu = document.getElementById("userMenu");
  var userMenuName = document.getElementById("userMenuName");
  var adminAnalyticsBtn = document.getElementById("adminAnalyticsBtn");
  if (userMenu) userMenu.style.display = _currentUser ? "block" : "none";
  if (userMenuName && _currentUser) userMenuName.textContent = _currentUser.fullName || _currentUser.email || "user";
  if (adminAnalyticsBtn) adminAnalyticsBtn.style.display = (_currentUser && _currentUser.isAdmin) ? "inline-flex" : "none";
}

function toggleUserMenu() {
  var dropdown = document.getElementById("userMenuDropdown");
  if (dropdown) dropdown.classList.toggle("open");
}

function openAccountSettings() {
  var dropdown = document.getElementById("userMenuDropdown");
  if (dropdown) dropdown.classList.remove("open");
  if (!_currentUser) return;
  document.getElementById("settingsNameInput").value = _currentUser.fullName || "";
  document.getElementById("settingsEmailInput").value = _currentUser.email || "";
  // Phone not exposed in /api/auth/me, fetch from config if available
  var cfg = _lastConfig || {};
  if (cfg.user && cfg.user.phone) {
    document.getElementById("settingsPhoneInput").value = cfg.user.phone || "";
  }
  // Clear messages
  ["settingsNameMsg","settingsEmailMsg","settingsPhoneMsg","settingsPasswordMsg"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.textContent = ""; el.className = "settings-msg"; }
  });
  var overlay = document.getElementById("accountSettingsOverlay");
  if (overlay) overlay.classList.add("open");
}

function closeAccountSettings() {
  var overlay = document.getElementById("accountSettingsOverlay");
  if (overlay) overlay.classList.remove("open");
}

function setSettingsMsg(id, text, ok) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "settings-msg " + (ok ? "ok" : "err");
}

export {
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
};
