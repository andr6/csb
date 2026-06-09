import { state } from "./state.js";
import { modelName } from "./utils.js";

export async function createTournament() {
  if (!state.models.length) return;
  var models = state.models.map(function(m) { return m.id; }).slice(0, 16);
  try {
    var res = await fetch("/api/tournament", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models: models }),
    });
    var data = await res.json();
    if (data.id) {
      state.currentTournament = data;
      renderTournamentBracket(data.id);
    }
  } catch (e) {
    console.warn("Tournament creation failed:", e.message);
  }
}

export async function renderTournamentBracket(id) {
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
        var scores = state.tournamentScores[round.round + "-" + idx];
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

export async function refreshBracket(bracketId) {
  try {
    var res = await fetch("/api/tournament/" + bracketId);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("Bracket refresh failed:", e.message);
    return null;
  }
}

export async function advanceTournamentWinner(bracketId, roundIdx, matchIdx, winnerId) {
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

export async function runTournament(prompt, models) {
  if (!models.length) return;
  state.tournamentScores = {};
  var bracketEl = document.getElementById("tournamentBracket");
  if (bracketEl) bracketEl.textContent = "Creating bracket...";

  var bracketData;
  try {
    var res = await fetch("/api/tournament", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models: models.map(function(m) { return m.id; }) }),
    });
    bracketData = await res.json();
    if (!bracketData.id) throw new Error("No bracket ID returned");
    state.currentTournament = bracketData;
  } catch (e) {
    if (bracketEl) bracketEl.textContent = "Failed to create bracket.";
    var errorBanner = document.getElementById("errorBanner");
    if (errorBanner) {
      errorBanner.textContent = "Warning: Tournament creation failed: " + e.message;
      errorBanner.style.display = "block";
    }
    return;
  }

  var bracket;
  try {
    var bres = await fetch("/api/tournament/" + bracketData.id);
    bracket = await bres.json();
  } catch (e) {
    if (bracketEl) bracketEl.textContent = "Failed to load bracket.";
    return;
  }

  // Run each pending match server-side via /api/tournament/:id/run-match
  for (var roundIdx = 0; roundIdx < bracket.rounds.length; roundIdx++) {
    var round = bracket.rounds[roundIdx];
    for (var matchIdx = 0; matchIdx < round.matches.length; matchIdx++) {
      var match = round.matches[matchIdx];
      if (match.winner) {
        await renderTournamentBracket(bracket.id);
        continue;
      }

      try {
        var mres = await fetch("/api/tournament/" + bracket.id + "/run-match", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Page-Token": state.pageToken },
          body: JSON.stringify({ roundIdx: roundIdx, matchIdx: matchIdx, prompt: prompt, pack: state.activePack }),
        });
        var mdata = await mres.json();
        if (mdata.ok) {
          state.tournamentScores[(roundIdx + 1) + "-" + matchIdx] = {
            aScore: mdata.scores ? mdata.scores[match.slotA && match.slotA.id] : 0,
            bScore: mdata.scores ? mdata.scores[match.slotB && match.slotB.id] : 0,
            winnerId: mdata.winnerId,
            verdicts: mdata.verdicts,
            roast: mdata.roast,
          };
        }
      } catch (e) {
        console.warn("run-match failed:", e.message);
      }

      var refreshed = await refreshBracket(bracket.id);
      if (refreshed && refreshed.rounds) bracket = refreshed;
      await renderTournamentBracket(bracket.id);
    }
  }

  var finalBracket = await refreshBracket(bracket.id);
  if (finalBracket && finalBracket.rounds) bracket = finalBracket;
  await renderTournamentBracket(bracket.id);
}
