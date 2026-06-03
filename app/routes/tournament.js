const express = require("express");
const crypto = require("crypto");

function createTournamentRouter(deps) {
  const router = express.Router();

  const tournamentServices = deps.tournamentServices || require("../lib/tournament");
  const authMw = deps.authMiddleware;
  const publicLimiter = deps.publicLimiter;
  const runSqlParams = deps.runSqlParams || require("../lib/sqlite").runSqlParams;
  const queryJsonParams = deps.queryJsonParams || require("../lib/sqlite").queryJsonParams;

  // Services for auto-run match endpoint
  const {
    CONTESTANT_PROVIDER: _CONTESTANT_PROVIDER,
    JUDGE_PROVIDER: _JUDGE_PROVIDER,
    JUDGE_MODEL: _JUDGE_MODEL,
  } = require("../lib/config");

  const modelServices = require("../lib/models");
  const providerServices = require("../lib/providers");
  const judgeServices = require("../lib/judge");
  const { getPack: _getPack } = require("../lib/packs");
  const { validatePrompt: _validatePrompt } = require("../lib/validation");
  const analysisRunServices = require("../lib/analysisRuns");
  const { notifyWebhook: _notifyWebhook } = require("../lib/webhook");
  const { buildFailureRun, categorizeError } = require("../lib/fireHelpers");

  const CONTESTANT_PROVIDER = deps.CONTESTANT_PROVIDER !== undefined ? deps.CONTESTANT_PROVIDER : _CONTESTANT_PROVIDER;
  const JUDGE_PROVIDER = deps.JUDGE_PROVIDER !== undefined ? deps.JUDGE_PROVIDER : _JUDGE_PROVIDER;
  const JUDGE_MODEL = deps.JUDGE_MODEL !== undefined ? deps.JUDGE_MODEL : _JUDGE_MODEL;
  const getPack = deps.getPack || _getPack;

  const callContestant = deps.callContestant || providerServices.callContestant;
  const callJudge = deps.callJudge || providerServices.callJudge;
  const buildJudgePrompt = deps.buildJudgePrompt || judgeServices.buildJudgePrompt;
  const parseJudgeResponse = deps.parseJudgeResponse || judgeServices.parseJudgeResponse;
  const normalizeJudgePayload = deps.normalizeJudgePayload || judgeServices.normalizeJudgePayload;
  const getVoice = deps.getVoice || modelServices.getVoice;
  const validatePrompt = deps.validatePrompt || _validatePrompt;
  const addAnalysisRun = deps.addAnalysisRun || analysisRunServices.addAnalysisRun;
  const notifyWebhookFn = deps.notifyWebhook || _notifyWebhook;

  const providerInfo = {
    contestantProvider: CONTESTANT_PROVIDER,
    judgeProvider: JUDGE_PROVIDER,
    judgeModel: JUDGE_MODEL,
  };

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

  // E5 — auto-run a single tournament match server-side
  router.post("/api/tournament/:id/run-match", publicLimiter, authMw.requireAuth, async function(req, res) {
    const tournament = _tournaments.get(req.params.id);
    if (!tournament) return res.status(404).json({ error: "Tournament not found." });

    const roundIdx = Number(req.body.roundIdx);
    const matchIdx = Number(req.body.matchIdx);
    const prompt = String(req.body.prompt || "");
    const packId = req.body.pack || "bar";

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    const round = tournament.rounds[roundIdx];
    if (!round) return res.status(400).json({ error: "Invalid round index." });
    const match = round.matches[matchIdx];
    if (!match) return res.status(400).json({ error: "Invalid match index." });

    if (match.winner) {
      return res.json({ ok: true, skipped: true, reason: "Match already decided.", winnerId: match.winner });
    }

    const slotA = match.slotA && match.slotA.id;
    const slotB = match.slotB && match.slotB.id;

    // Bye handling
    if (!slotA && !slotB) {
      return res.json({ ok: true, skipped: true, reason: "Both slots are byes." });
    }
    if (!slotA) {
      tournamentServices.advanceWinner(tournament, roundIdx, matchIdx, slotB);
      if (tournament.status === "pending") tournament.status = "running";
      saveTournament(tournament);
      return res.json({ ok: true, winnerId: slotB, bye: true });
    }
    if (!slotB) {
      tournamentServices.advanceWinner(tournament, roundIdx, matchIdx, slotA);
      if (tournament.status === "pending") tournament.status = "running";
      saveTournament(tournament);
      return res.json({ ok: true, winnerId: slotA, bye: true });
    }

    // Mark running on first real match
    if (tournament.status === "pending") tournament.status = "running";

    const startedAt = Date.now();
    const execModels = {};
    const allResponses = {};
    let anySuccess = false;

    // Fire slotA
    const tA = Date.now();
    try {
      const respA = await callContestant(slotA, getVoice(slotA, packId), prompt, req.requestId);
      allResponses[slotA] = respA || "";
      execModels[slotA] = { status: "success", durationMs: Date.now() - tA };
      anySuccess = true;
    } catch (e) {
      allResponses[slotA] = "[Error: " + e.message + "]";
      execModels[slotA] = { status: "error", error: e.message, errorCategory: categorizeError(e.message, e.upstreamStatus, "contestant"), durationMs: Date.now() - tA };
    }

    // Fire slotB
    const tB = Date.now();
    try {
      const respB = await callContestant(slotB, getVoice(slotB, packId), prompt, req.requestId);
      allResponses[slotB] = respB || "";
      execModels[slotB] = { status: "success", durationMs: Date.now() - tB };
      anySuccess = true;
    } catch (e) {
      allResponses[slotB] = "[Error: " + e.message + "]";
      execModels[slotB] = { status: "error", error: e.message, errorCategory: categorizeError(e.message, e.upstreamStatus, "contestant"), durationMs: Date.now() - tB };
    }

    if (!anySuccess) {
      // Both failed — advance A deterministically
      tournamentServices.advanceWinner(tournament, roundIdx, matchIdx, slotA);
      saveTournament(tournament);
      return res.json({ ok: true, winnerId: slotA, bothFailed: true });
    }

    // Judge head-to-head
    let judgement = null;
    let judgeMs = 0;
    try {
      const judgeStart = Date.now();
      const raw = await callJudge(getPack(packId).judgeSystemPrompt, buildJudgePrompt(prompt, allResponses, undefined), req.requestId);
      judgeMs = Date.now() - judgeStart;
      judgement = normalizeJudgePayload(parseJudgeResponse(raw), [slotA, slotB]);
    } catch (e) {
      console.warn("[tournament-run-match] judge failed:", e.message);
    }

    const scoreA = (judgement && judgement.scores && judgement.scores[slotA] !== undefined) ? judgement.scores[slotA] : 0;
    const scoreB = (judgement && judgement.scores && judgement.scores[slotB] !== undefined) ? judgement.scores[slotB] : 0;
    const winnerId = scoreA >= scoreB ? slotA : slotB;

    match.aScore = scoreA;
    match.bScore = scoreB;
    match.verdicts = (judgement && judgement.verdicts) ? judgement.verdicts : null;
    match.roast = (judgement && judgement.roast) ? judgement.roast : null;

    tournamentServices.advanceWinner(tournament, roundIdx, matchIdx, winnerId);
    saveTournament(tournament);

    // Persist as an analysis run for receipts
    addAnalysisRun({
      prompt: prompt,
      responses: allResponses,
      judgement: judgement || { scores: { [slotA]: scoreA, [slotB]: scoreB }, crown: winnerId },
      crownModelId: winnerId,
      crownScore: winnerId === slotA ? scoreA : scoreB,
      contestantProvider: CONTESTANT_PROVIDER,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      timings: { judgeMs: judgeMs, totalMs: Date.now() - startedAt },
      execution: {
        summary: { overallStatus: "success" },
        models: execModels,
        judge: { status: judgement ? "success" : "error" },
        isTournament: true,
        tournamentId: tournament.id,
      },
      pack: packId,
      mode: "tournament",
    });

    res.json({
      ok: true,
      winnerId: winnerId,
      scores: { [slotA]: scoreA, [slotB]: scoreB },
      verdicts: match.verdicts,
      roast: match.roast,
      status: tournament.status,
      champion: tournament.champion || null,
    });
  });

  return router;
}

module.exports = { createTournamentRouter };
