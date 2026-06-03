const crypto = require("crypto");

function shuffleArray(arr) {
  const result = arr.slice();
  for (var i = result.length - 1; i > 0; i--) {
    var j = crypto.randomInt(0, i + 1);
    var tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function createBracket(models) {
  if (!Array.isArray(models) || models.length < 2) {
    throw new Error("Need at least 2 models for a tournament");
  }
  if (models.length > 16) {
    throw new Error("Max 16 models supported");
  }
  // Pad to power of 2 with byes
  var count = models.length;
  var bracketSize = 2;
  while (bracketSize < count) bracketSize *= 2;
  var seeds = shuffleArray(models);
  while (seeds.length < bracketSize) seeds.push(null);

  var rounds = [];
  var current = seeds.map(function(id, idx) {
    return {
      id: id,
      seed: idx + 1,
      winner: id === null, // bye auto-advances
      score: null,
    };
  });

  rounds.push({ round: 1, matches: pairUp(current) });
  while (current.length > 1) {
    var next = [];
    for (var i = 0; i < current.length; i += 2) {
      var a = current[i];
      var b = current[i + 1];
      // Real model vs bye: real model advances
      if (a && a.id !== null && (!b || b.id === null)) { next.push(a); continue; }
      if (b && b.id !== null && (!a || a.id === null)) { next.push(b); continue; }
      // Both byes: bye advances
      if (a && a.winner) { next.push(a); continue; }
      if (b && b.winner) { next.push(b); continue; }
      next.push({ id: null, seed: null, winner: false, score: null });
    }
    current = next;
    if (current.length > 1) {
      rounds.push({ round: rounds.length + 1, matches: pairUp(current) });
    }
  }

  return {
    id: "tourney-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex"),
    models: models,
    bracketSize: bracketSize,
    rounds: rounds,
    status: "pending", // pending, running, complete
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

function pairUp(contestants) {
  var matches = [];
  for (var i = 0; i < contestants.length; i += 2) {
    matches.push({
      slotA: contestants[i],
      slotB: contestants[i + 1],
      winner: null,
      aScore: null,
      bScore: null,
    });
  }
  return matches;
}

function advanceWinner(tournament, roundIdx, matchIdx, winnerId) {
  var round = tournament.rounds[roundIdx];
  if (!round) return false;
  var match = round.matches[matchIdx];
  if (!match) return false;

  var isA = match.slotA && match.slotA.id === winnerId;
  var isB = match.slotB && match.slotB.id === winnerId;
  if (!isA && !isB) return false;

  match.winner = winnerId;
  match.slotA.winner = isA;
  match.slotB.winner = isB;

  // Propagate to next round
  var nextRound = tournament.rounds[roundIdx + 1];
  if (nextRound) {
    var nextMatchIdx = Math.floor(matchIdx / 2);
    var nextSlot = matchIdx % 2 === 0 ? "slotA" : "slotB";
    var winnerSlot = isA ? match.slotA : match.slotB;
    nextRound.matches[nextMatchIdx][nextSlot] = winnerSlot;
  }

  // Check if tournament is complete
  var finalRound = tournament.rounds[tournament.rounds.length - 1];
  var finalMatch = finalRound.matches[0];
  if (finalMatch.winner) {
    tournament.status = "complete";
    tournament.completedAt = new Date().toISOString();
    tournament.champion = finalMatch.winner;
  }

  return true;
}

function getTournamentStatus(tournament) {
  var completedMatches = 0;
  var totalMatches = 0;
  tournament.rounds.forEach(function(r) {
    r.matches.forEach(function(m) {
      totalMatches++;
      if (m.winner) completedMatches++;
    });
  });
  return {
    completed: completedMatches,
    total: totalMatches,
    percent: totalMatches ? Math.round((completedMatches / totalMatches) * 100) : 0,
  };
}

module.exports = {
  createBracket: createBracket,
  advanceWinner: advanceWinner,
  getTournamentStatus: getTournamentStatus,
};
