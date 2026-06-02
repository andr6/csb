const express = require("express");
const crypto = require("crypto");

function createTournamentRouter(deps) {
  const router = express.Router();

  const tournamentServices = deps.tournamentServices || require("../lib/tournament");
  const authMw = deps.authMiddleware;
  const publicLimiter = deps.publicLimiter;
  const runSqlParams = deps.runSqlParams || require("../lib/sqlite").runSqlParams;
  const queryJsonParams = deps.queryJsonParams || require("../lib/sqlite").queryJsonParams;

  // In-memory tournament cache — read-through cache backed by SQLite
  const _tournaments = new Map();

  // Load pending/running tournaments from DB into cache on startup
  try {
    const rows = queryJsonParams(
      "SELECT id, models_json, bracket_json, status, created_at, completed_at FROM tournaments WHERE status IN (?, ?);",
      ["pending", "running"]
    );
    rows.forEach(function(row) {
      const t = {
        id: row.id,
        models: JSON.parse(row.models_json),
        bracketSize: JSON.parse(row.bracket_json).bracketSize || JSON.parse(row.models_json).length,
        rounds: JSON.parse(row.bracket_json).rounds || [],
        status: row.status,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        champion: row.status === "complete" ? JSON.parse(row.bracket_json).champion : undefined,
      };
      _tournaments.set(row.id, t);
    });
    if (rows.length) {
      console.log("[tournament] loaded " + rows.length + " pending/running tournament(s) from DB");
    }
  } catch (e) {
    console.warn("[tournament] failed to load from DB:", e.message);
  }

  function saveTournament(t) {
    try {
      runSqlParams(
        "INSERT OR REPLACE INTO tournaments (id, models_json, bracket_json, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)",
        [t.id, JSON.stringify(t.models), JSON.stringify({ bracketSize: t.bracketSize, rounds: t.rounds, champion: t.champion }), t.status, t.createdAt, t.completedAt || null]
      );
    } catch (e) {
      console.warn("[tournament] save failed:", e.message);
    }
  }

  router.post("/api/tournament", publicLimiter, authMw.requireAuth, function(req, res) {
    const models = Array.isArray(req.body.models) ? req.body.models : [];
    if (models.length < 2 || models.length > 16) {
      return res.status(400).json({ error: "Provide 2–16 model IDs." });
    }
    try {
      const tournament = tournamentServices.createBracket(models);
      _tournaments.set(tournament.id, tournament);
      saveTournament(tournament);
      res.json({ id: tournament.id, bracketSize: tournament.bracketSize, rounds: tournament.rounds.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/api/tournament/:id", publicLimiter, authMw.requireAuth, function(req, res) {
    let tournament = _tournaments.get(req.params.id);
    if (!tournament) {
      // Cache miss — try DB
      try {
        const rows = queryJsonParams(
          "SELECT id, models_json, bracket_json, status, created_at, completed_at FROM tournaments WHERE id = ?;",
          [req.params.id]
        );
        if (rows.length) {
          const row = rows[0];
          tournament = {
            id: row.id,
            models: JSON.parse(row.models_json),
            bracketSize: JSON.parse(row.bracket_json).bracketSize || 0,
            rounds: JSON.parse(row.bracket_json).rounds || [],
            status: row.status,
            createdAt: row.created_at,
            completedAt: row.completed_at,
            champion: row.status === "complete" ? JSON.parse(row.bracket_json).champion : undefined,
          };
          _tournaments.set(row.id, tournament);
        }
      } catch (e) {
        console.warn("[tournament] DB read failed:", e.message);
      }
    }
    if (!tournament) return res.status(404).json({ error: "Tournament not found." });
    res.json(tournament);
  });

  router.post("/api/tournament/:id/advance", publicLimiter, authMw.requireAuth, function(req, res) {
    const tournament = _tournaments.get(req.params.id);
    if (!tournament) return res.status(404).json({ error: "Tournament not found." });
    const roundIdx = Number(req.body.roundIdx);
    const matchIdx = Number(req.body.matchIdx);
    const winnerId = String(req.body.winnerId || "");
    const ok = tournamentServices.advanceWinner(tournament, roundIdx, matchIdx, winnerId);
    if (!ok) return res.status(400).json({ error: "Invalid advance request." });
    if (tournament.status === "running" || tournament.status === "pending") {
      // First advance marks as running
      if (tournament.status === "pending") tournament.status = "running";
    }
    saveTournament(tournament);
    res.json({ ok: true, status: tournament.status, champion: tournament.champion || null });
  });

  return router;
}

module.exports = { createTournamentRouter };
