import { state, VOTE_LABELS } from "./state.js";
import { modelName, modelColor, modelGlyph, esc, shitTier, getBlindLabel, getBlindGlyph, getBlindMaker, setDisplay, updateChar } from "./utils.js";
import { getModelVotes, vote } from "./arena.js";

// Forward declarations to avoid circular imports with analytics.js
var _inspectRun = function(){};
export function setInspectRun(fn) { _inspectRun = fn; }

var _applyDrilldown = function(){};
export function setApplyDrilldown(fn) { _applyDrilldown = fn; }

export function setVerdictContent(el, verdict) {
  el.textContent = "";
  var label = document.createElement("span");
  label.className = "verdict-lbl";
  label.textContent = "BOB SAYS: ";
  el.appendChild(label);
  el.appendChild(document.createTextNode(verdict || ""));
}

export function buildCrownBanner() {
  var banner = document.createElement("div");
  banner.className = "crown-banner";
  banner.textContent = "👑 CHAT SHIT BOB CROWN - TODAY'S WORST";
  return banner;
}

export function buildScorePill(score, color) {
  // score is internal penalty (0-100, higher = worse).
  // Display quality score = 100 - penalty so higher = better for users.
  var quality = 100 - Math.round(Number(score || 0));
  var pill = document.createElement("div");
  pill.className = "score-pill";
  pill.style.background = color;
  pill.textContent = quality;
  var suffix = document.createElement("span");
  suffix.style.fontSize = ".6em";
  suffix.textContent = "%";
  pill.appendChild(suffix);
  return pill;
}

export function buildVoteButton(modelId, idx, lbl, pct, selectedClass) {
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

export function renderVoteButtons(el, modelId) {
  var mv = getModelVotes(modelId);
  var tv = Object.values(mv).reduce(function(a,b){return a+b;},0);
  el.textContent = "";

  VOTE_LABELS.forEach(function(lbl, i) {
    var pct = tv > 0 ? Math.round(((mv[i] || 0) / tv) * 100) : null;
    var selectedClass = "";
    if (state.userVotes[modelId] === i) selectedClass = "user-selected";
    else if (state.autoVotes[modelId] === i && state.userVotes[modelId] === undefined) selectedClass = "auto-selected";
    el.appendChild(buildVoteButton(modelId, i, lbl, pct, selectedClass));
  });
}

export function buildLoadingCard(model) {
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

export function buildSymptoms(symptoms) {
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

export function buildLeaderboardRow(entry, rank) {
  var m = state.models.find(function(x){return x.id===entry.modelId;});
  var t = shitTier(entry.score);

  var wrapper = document.createElement("div");
  wrapper.className = "lb-entry";

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

    if (entry.answer.length > 180) {
      var expandBtn = document.createElement("button");
      expandBtn.className = "lb-expand-btn";
      expandBtn.type = "button";
      expandBtn.textContent = "Show more";
      expandBtn.onclick = function() {
        var isExpanded = answerText.classList.contains("expanded");
        if (isExpanded) {
          answerText.classList.remove("expanded");
          answerText.textContent = preview + "...";
          expandBtn.textContent = "Show more";
        } else {
          answerText.classList.add("expanded");
          answerText.textContent = entry.answer;
          expandBtn.textContent = "Show less";
        }
      };
      answerRow.appendChild(expandBtn);
    }

    body.appendChild(answerRow);
  }

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

export function buildRunListItem(run) {
  var button = document.createElement("button");
  button.className = "run-item" + (run.id === state.activeRunId ? " active" : "");
  button.onclick = function() { _inspectRun(run.id); };

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

export function renderRunInspector(run) {
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
      btn.className = "comparebtn" + (state.activeInspectModelId === modelId ? " active" : "");
      btn.textContent = modelName(modelId) + " failure";
      btn.onclick = function() {
        state.activeInspectModelId = modelId;
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
  execTitle.textContent = state.activeInspectModelId ? "Execution Focus: " + modelName(state.activeInspectModelId) : "Execution";
  execBlock.appendChild(execTitle);
  var execValue = document.createElement("pre");
  if (state.activeInspectModelId && executionModels[state.activeInspectModelId]) {
    execValue.textContent = JSON.stringify({
      modelId: state.activeInspectModelId,
      detail: executionModels[state.activeInspectModelId],
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
        state.activeInspectModelId = modelId;
        _applyDrilldown({ failedModelId: modelId, status: (run.execution && run.execution.summary && run.execution.summary.overallStatus) || "failure" });
      };
      actionBlock.appendChild(actionBtn);
    });
    detail.appendChild(actionBlock);
  }

  var replayBtn = document.createElement("button");
  replayBtn.className = "comparebtn";
  replayBtn.textContent = "↺ replay this prompt";
  replayBtn.onclick = function() {
    window._replayBaseScores = run.judgement && run.judgement.scores ? run.judgement.scores : {};
    window._replayBaseRunId = run.id;
    if (state.isAnalyticsPage) {
      window.location.href = "/?replay=" + encodeURIComponent(run.prompt || "");
      return;
    }
    var input = document.getElementById("promptInput");
    if (input) { input.value = run.prompt || ""; updateChar(); }
  };
  detail.appendChild(replayBtn);
}

export function renderProviderStatus() {
  var bar = document.getElementById("providerStatusBar");
  if (!bar) return;
  bar.textContent = "";
  if (!state.models.length) return;
  var statusMap = state.providerStatus || {};
  state.models.forEach(function(m) {
    var item = document.createElement("span");
    item.className = "provider-status-item";
    item.title = "Provider status: " + (statusMap[m.provider] || "unknown");
    var dot = document.createElement("span");
    dot.className = "provider-status-dot";
    var s = String(statusMap[m.provider] || "").toLowerCase();
    if (s === "ok") dot.classList.add("ok");
    else if (s === "degraded" || s === "slow") dot.classList.add("warn");
    else if (s === "error" || s === "down") dot.classList.add("err");
    else dot.classList.add("warn");
    item.appendChild(dot);
    var label = document.createElement("span");
    label.className = "provider-status-label";
    label.textContent = m.provider;
    item.appendChild(label);
    bar.appendChild(item);
  });
}

export function renderReplayDiff(baseScores, newScores) {
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

export function populateVersusPickers() {
  var selA = document.getElementById("versusModelA");
  var selB = document.getElementById("versusModelB");
  if (!selA || !selB) return;
  [selA, selB].forEach(function(sel) {
    sel.textContent = "";
    state.models.forEach(function(m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      sel.appendChild(opt);
    });
  });
  if (state.models.length >= 2) selB.value = state.models[1].id;
}

export function renderShareLink(firedPrompt, judgement) {
  var results = document.getElementById("results");
  if (!results) return;
  var existing = document.getElementById("shareLinkWrap");
  if (existing) existing.remove();
  var prompt = firedPrompt || ((document.getElementById("promptInput") && document.getElementById("promptInput").value.trim()) || "");
  if (!prompt) return;
  var wrap = document.createElement("div");
  wrap.id = "shareLinkWrap";
  wrap.className = "share-bar";

  var link = document.createElement("a");
  link.className = "share-link";
  link.href = "/?replay=" + encodeURIComponent(prompt);
  link.textContent = "↗ share this prompt";
  link.target = "_blank";
  wrap.appendChild(link);

  var runId = judgement && judgement.runId ? judgement.runId : "";
  var crownId = judgement && judgement.crown ? judgement.crown : "";
  var crownScore = (judgement && judgement.scores && judgement.scores[crownId] !== undefined) ? judgement.scores[crownId] : 0;
  var roast = judgement && judgement.roast ? judgement.roast : "";
  var answer = crownId && state.responses && state.responses[crownId] ? state.responses[crownId] : "";

  if (runId) {
    var runUrl = window.location.origin + "/run/" + encodeURIComponent(runId);

    var xBtn = document.createElement("button");
    xBtn.className = "share-btn-x";
    xBtn.textContent = "𝕏 Share on X";
    var tweetText = "CSB run — " + (state.activePack || "bar") + " pack\nPrompt: \"" + prompt.slice(0, 120) + (prompt.length > 120 ? "…" : "") + "\"\nCrowned: " + modelName(crownId) + " (" + crownScore + "/100)\n" + runUrl;
    xBtn.addEventListener("click", function() {
      window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(tweetText), "_blank", "width=600,height=400");
    });
    wrap.appendChild(xBtn);

    var igBtn = document.createElement("button");
    igBtn.className = "share-btn-ig";
    igBtn.textContent = "📸 Download for Instagram";
    igBtn.addEventListener("click", function() {
      generateShareCard({ prompt: prompt, crownId: crownId, crownScore: crownScore, answer: answer, roast: roast, pack: state.activePack || "bar", runUrl: runUrl });
    });
    wrap.appendChild(igBtn);
  }

  var roastBox = document.getElementById("roastBox");
  if (roastBox && roastBox.parentNode) {
    roastBox.parentNode.insertBefore(wrap, roastBox.nextSibling);
  } else {
    results.appendChild(wrap);
  }
}

export function generateShareCard(data) {
  var canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  var ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.strokeStyle = "#c9a84c";
  ctx.lineWidth = 16;
  ctx.strokeRect(24, 24, 1032, 1032);

  function wrapText(text, maxWidth, fontSize, fontWeight) {
    ctx.font = (fontWeight || "400") + " " + fontSize + "px sans-serif";
    var words = String(text || "").split(/\s+/);
    var lines = [];
    var current = "";
    for (var i = 0; i < words.length; i++) {
      var test = current ? current + " " + words[i] : words[i];
      if (ctx.measureText(test).width < maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = words[i];
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawLines(lines, x, y, lineHeight, color, align) {
    ctx.fillStyle = color || "#fff";
    ctx.textAlign = align || "left";
    lines.forEach(function(line, i) {
      ctx.fillText(line, x, y + i * lineHeight);
    });
    return lines.length * lineHeight;
  }

  var margin = 80;
  var maxW = 1080 - margin * 2;
  var cy = 100;

  ctx.font = "700 48px sans-serif";
  ctx.fillStyle = "#c9a84c";
  ctx.textAlign = "center";
  ctx.fillText("🥊 CHAT SHIT BOB", 540, cy);
  cy += 30;

  ctx.strokeStyle = "#c9a84c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, cy);
  ctx.lineTo(1080 - margin, cy);
  ctx.stroke();
  cy += 40;

  ctx.font = "400 24px monospace";
  ctx.fillStyle = "#888";
  ctx.textAlign = "left";
  ctx.fillText((data.pack || "bar").replace(/-/g, " ") + " pack", margin, cy);
  cy += 50;

  var promptLines = wrapText('"' + (data.prompt || "").slice(0, 200) + '"', maxW, 32, "700");
  cy += drawLines(promptLines, margin, cy, 42, "#fff");
  cy += 30;

  var winnerName = modelName(data.crownId || "unknown");
  ctx.font = "700 36px sans-serif";
  ctx.fillStyle = "#c9a84c";
  ctx.textAlign = "left";
  ctx.fillText("👑 " + winnerName + "  —  " + (data.crownScore || 0) + "/100", margin, cy);
  cy += 50;

  var ansLines = wrapText((data.answer || "").slice(0, 280), maxW, 28, "400");
  cy += drawLines(ansLines, margin, cy, 38, "#d4d4d4");
  cy += 30;

  if (data.roast && cy < 940) {
    var roastLines = wrapText("Bob says: " + data.roast.slice(0, 160), maxW, 24, "400");
    cy += drawLines(roastLines, margin, cy, 34, "#c9a84c");
    cy += 20;
  }

  ctx.font = "400 20px monospace";
  ctx.fillStyle = "#666";
  ctx.textAlign = "center";
  ctx.fillText(data.runUrl || "chatshitbob.app", 540, 1020);

  canvas.toBlob(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "csb-share-" + (data.crownId || "run") + ".png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, "image/png");
}

export function emptyAnalytics(msg) {
  var el = document.createElement("div");
  el.className = "analytics-empty";
  el.textContent = msg || "No data.";
  return el;
}
