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
  showError, buildLoadingCard, updateCard,
} from './ui.js';

import {
  fireModel, judgeResponses,
} from './api.js';

import {
  renderRandomStrip, updateChar,
} from './modes.js';
async function createTournament() {
  if (!MODELS.length) return;
  var models = MODELS.map(function(m) { return m.id; }).slice(0, 16);
  try {
    var res = await fetch("/api/tournament", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models: models }),
    });
    var data = await res.json();
    if (data.id) {
      currentTournament = data;
      renderTournamentBracket(data.id);
    }
  } catch (e) {
    console.warn("Tournament creation failed:", e.message);
  }
}

async function renderTournamentBracket(id) {
  var bracket = document.getElementById("tournamentBracket");
  if (!bracket) return;
  bracket.textContent = "Loading bracket...";
  try {
    var res = await fetch("/api/tournament/" + id);
    var data = await res.json();
    bracket.textContent = "";
    if (!data.rounds) {
      bracket.textContent = "No bracket data.";
      return;
    }
    data.rounds.forEach(function(round) {
      var roundDiv = document.createElement("div");
      roundDiv.style.marginBottom = "1.5rem";
      var roundTitle = document.createElement("div");
      roundTitle.className = "criteria-picker-label";
      roundTitle.textContent = "Round " + round.round;
      roundDiv.appendChild(roundTitle);
      round.matches.forEach(function(match, idx) {
        var matchWrap = document.createElement("div");
        matchWrap.style.border = "1px solid var(--border2)";
        matchWrap.style.padding = ".5rem .75rem";
        matchWrap.style.marginBottom = ".4rem";

        var matchDiv = document.createElement("div");
        matchDiv.style.display = "flex";
        matchDiv.style.justifyContent = "space-between";
        matchDiv.style.alignItems = "center";
        var aName = match.slotA && match.slotA.id ? modelName(match.slotA.id) : "BYE";
        var bName = match.slotB && match.slotB.id ? modelName(match.slotB.id) : "BYE";
        var scores = _tournamentScores[round.round + "-" + idx];
        var labelText = aName + " vs " + bName;
        if (scores) {
          labelText += "  (" + (scores.aScore || 0) + " — " + (scores.bScore || 0) + ")";
        }
        var label = document.createElement("span");
        label.textContent = labelText;
        matchDiv.appendChild(label);
        if (match.winner) {
          var winner = document.createElement("span");
          winner.style.color = "var(--gold)";
          winner.textContent = "→ " + modelName(match.winner);
          matchDiv.appendChild(winner);
        }
        matchWrap.appendChild(matchDiv);

        // Judge commentary for completed matches
        if (scores && (scores.verdicts || scores.roast)) {
          var commentDiv = document.createElement("div");
          commentDiv.style.marginTop = ".5rem";
          commentDiv.style.padding = ".5rem .6rem";
          commentDiv.style.background = "rgba(152,194,111,0.08)";
          commentDiv.style.borderLeft = "3px solid var(--gold)";
          commentDiv.style.borderRadius = "0 4px 4px 0";
          commentDiv.style.fontSize = ".8rem";
          commentDiv.style.color = "var(--fg)";
          commentDiv.style.lineHeight = "1.5";

          var header = document.createElement("div");
          header.style.fontWeight = "700";
          header.style.fontSize = ".7rem";
          header.style.textTransform = "uppercase";
          header.style.letterSpacing = ".04em";
          header.style.color = "var(--gold)";
          header.style.marginBottom = ".25rem";
          header.textContent = "🎙️ JUDGE SAYS";
          commentDiv.appendChild(header);

          if (scores.roast) {
            var roastLine = document.createElement("div");
            roastLine.style.marginBottom = ".35rem";
            roastLine.style.fontStyle = "italic";
            roastLine.textContent = scores.roast;
            commentDiv.appendChild(roastLine);
          }

          if (scores.verdicts) {
            var aVerdict = scores.verdicts[match.slotA && match.slotA.id] || "";
            var bVerdict = scores.verdicts[match.slotB && match.slotB.id] || "";
            if (aVerdict || bVerdict) {
              var vLine = document.createElement("div");
              vLine.style.display = "flex";
              vLine.style.flexWrap = "wrap";
              vLine.style.gap = ".4rem";
              if (aVerdict) {
                var aWrap = document.createElement("span");
                aWrap.innerHTML = "<strong>" + aName + ":</strong> " + aVerdict;
                vLine.appendChild(aWrap);
              }
              if (bVerdict) {
                var bWrap = document.createElement("span");
                bWrap.innerHTML = "<strong>" + bName + ":</strong> " + bVerdict;
                vLine.appendChild(bWrap);
              }
              commentDiv.appendChild(vLine);
            }
          }

          matchWrap.appendChild(commentDiv);
        }

        roundDiv.appendChild(matchWrap);
      });
      bracket.appendChild(roundDiv);
    });
    if (data.champion) {
      var champ = document.createElement("div");
      champ.style.marginTop = "1rem";
      champ.style.color = "var(--gold)";
      champ.style.fontFamily = "'Anton',sans-serif";
      champ.style.fontSize = "1.2rem";
      champ.textContent = "🏆 CHAMPION: " + modelName(data.champion);
      bracket.appendChild(champ);
    }
  } catch (e) {
    bracket.textContent = "Failed to load bracket.";
  }
}

async function refreshBracket(bracketId) {
  try {
    var res = await fetch("/api/tournament/" + bracketId);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("Bracket refresh failed:", e.message);
    return null;
  }
}

async function advanceTournamentWinner(bracketId, roundIdx, matchIdx, winnerId) {
  try {
    var res = await fetch("/api/tournament/" + bracketId + "/advance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roundIdx: roundIdx, matchIdx: matchIdx, winnerId: winnerId }),
    });
    return res.ok;
  } catch (e) {
    console.warn("Tournament advance failed:", e.message);
    return false;
  }
}

async function runTournament(prompt, models) {
  if (!models.length) return;
  _tournamentScores = {};
  var bracketEl = document.getElementById("tournamentBracket");
  if (bracketEl) bracketEl.textContent = "Creating bracket...";

  // Create bracket
  var bracketData;
  try {
    var res = await fetch("/api/tournament", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models: models.map(function(m) { return m.id; }) }),
    });
    bracketData = await res.json();
    if (!bracketData.id) throw new Error("No bracket ID returned");
    currentTournament = bracketData;
  } catch (e) {
    if (bracketEl) bracketEl.textContent = "Failed to create bracket.";
    showError("Tournament creation failed: " + e.message);
    return;
  }

  // Fetch full bracket
  var bracket;
  try {
    var bres = await fetch("/api/tournament/" + bracketData.id);
    bracket = await bres.json();
  } catch (e) {
    if (bracketEl) bracketEl.textContent = "Failed to load bracket.";
    return;
  }

  // Run each round
  for (var roundIdx = 0; roundIdx < bracket.rounds.length; roundIdx++) {
    // Refresh bracket from server so propagated winners are visible
    var refreshed = await refreshBracket(bracket.id);
    if (refreshed && refreshed.rounds) bracket = refreshed;

    var round = bracket.rounds[roundIdx];
    for (var matchIdx = 0; matchIdx < round.matches.length; matchIdx++) {
      var match = round.matches[matchIdx];

      // Already decided (e.g., bye propagated from backend)
      if (match.winner) {
        await renderTournamentBracket(bracket.id);
        continue;
      }

      // Bye handling
      var aReal = match.slotA && match.slotA.id !== null;
      var bReal = match.slotB && match.slotB.id !== null;
      if (!aReal && !bReal) {
        // Both byes — nothing to do
        await renderTournamentBracket(bracket.id);
        continue;
      }
      if (!aReal) {
        await advanceTournamentWinner(bracket.id, roundIdx, matchIdx, match.slotB.id);
        var r1 = await refreshBracket(bracket.id);
        if (r1 && r1.rounds) bracket = r1;
        await renderTournamentBracket(bracket.id);
        continue;
      }
      if (!bReal) {
        await advanceTournamentWinner(bracket.id, roundIdx, matchIdx, match.slotA.id);
        var r2 = await refreshBracket(bracket.id);
        if (r2 && r2.rounds) bracket = r2;
        await renderTournamentBracket(bracket.id);
        continue;
      }

      // Real match: run both models
      var matchResponses = {};
      var anySuccess = false;
      var aResult, bResult;
      try {
        aResult = await fireModel(prompt, match.slotA.id);
        matchResponses[match.slotA.id] = aResult.text;
        matchResponses[match.slotA.id + "__timing"] = aResult.timingMs;
        matchResponses[match.slotA.id + "__exec"] = { status: "success", upstreamStatus: aResult.upstreamStatus, durationMs: aResult.timingMs, retryCount: 0, fallbackUsed: false };
        anySuccess = true;
      } catch (e) {
        matchResponses[match.slotA.id] = "[Error: " + e.message + "]";
        matchResponses[match.slotA.id + "__timing"] = null;
        matchResponses[match.slotA.id + "__exec"] = { status: "error", upstreamStatus: e.upstreamStatus || 500, durationMs: e.durationMs || null, error: e.message, retryCount: 0, fallbackUsed: false };
      }
      try {
        bResult = await fireModel(prompt, match.slotB.id);
        matchResponses[match.slotB.id] = bResult.text;
        matchResponses[match.slotB.id + "__timing"] = bResult.timingMs;
        matchResponses[match.slotB.id + "__exec"] = { status: "success", upstreamStatus: bResult.upstreamStatus, durationMs: bResult.timingMs, retryCount: 0, fallbackUsed: false };
        anySuccess = true;
      } catch (e) {
        matchResponses[match.slotB.id] = "[Error: " + e.message + "]";
        matchResponses[match.slotB.id + "__timing"] = null;
        matchResponses[match.slotB.id + "__exec"] = { status: "error", upstreamStatus: e.upstreamStatus || 500, durationMs: e.durationMs || null, error: e.message, retryCount: 0, fallbackUsed: false };
      }

      if (!anySuccess) {
        // Both failed — advance A deterministically
        await advanceTournamentWinner(bracket.id, roundIdx, matchIdx, match.slotA.id);
        var r0 = await refreshBracket(bracket.id);
        if (r0 && r0.rounds) bracket = r0;
        _tournamentScores[(roundIdx + 1) + "-" + matchIdx] = { aScore: 0, bScore: 0, winnerId: match.slotA.id };
        await renderTournamentBracket(bracket.id);
        continue;
      }

      // Judge head-to-head
      var judgement = null;
      try {
        var matchModels = models.filter(function(m) { return m.id === match.slotA.id || m.id === match.slotB.id; });
        judgement = await judgeResponses(prompt, matchResponses, matchModels);
      } catch (e) {
        console.warn("Tournament judge failed:", e.message);
      }

      var scoreA = (judgement && judgement.scores && judgement.scores[match.slotA.id] !== undefined) ? judgement.scores[match.slotA.id] : 0;
      var scoreB = (judgement && judgement.scores && judgement.scores[match.slotB.id] !== undefined) ? judgement.scores[match.slotB.id] : 0;
      _tournamentScores[(roundIdx + 1) + "-" + matchIdx] = {
        aScore: scoreA,
        bScore: scoreB,
        winnerId: null,
        verdicts: (judgement && judgement.verdicts) ? judgement.verdicts : null,
        roast: (judgement && judgement.roast) ? judgement.roast : null,
      };

      // Determine winner: higher score wins; tie goes to slotA deterministically
      var winnerId = scoreA >= scoreB ? match.slotA.id : match.slotB.id;
      _tournamentScores[(roundIdx + 1) + "-" + matchIdx].winnerId = winnerId;

      await advanceTournamentWinner(bracket.id, roundIdx, matchIdx, winnerId);
      var r3 = await refreshBracket(bracket.id);
      if (r3 && r3.rounds) bracket = r3;
      await renderTournamentBracket(bracket.id);
    }
  }

  // Final refresh and render to show champion
  var finalBracket = await refreshBracket(bracket.id);
  if (finalBracket && finalBracket.rounds) bracket = finalBracket;
  await renderTournamentBracket(bracket.id);
}

// Full reset — clears everything including the prompt

export {
  createTournament, renderTournamentBracket, refreshBracket,
  advanceTournamentWinner, runTournament,
};
