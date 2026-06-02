const express = require("express");
const rateLimit = require("express-rate-limit");

function createPromptsRouter(deps) {
  const router = express.Router();

  const authMw = deps.authMiddleware;
  const requireAdminAccess = deps.requireAdminAccess;
  const publicLimiter = deps.publicLimiter;
  const validatePrompt = deps.validatePrompt || require("../lib/validation").validatePrompt;
  const pendingPrompts = deps.pendingPrompts || require("../lib/repositories/pendingPromptsRepository");
  const tryCreateStore = deps.tryCreateStore;

  // F10 — prompt submission (public, rate-limited)
  const submitLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    store: tryCreateStore ? tryCreateStore("submit") : undefined,
    message: { error: "Too many submissions." },
  });

  router.post("/api/prompts/submit", submitLimiter, authMw.requireAuth, function(req, res) {
    const prompt = req.body && req.body.prompt;
    const mode = req.body && req.body.mode;
    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });
    try {
      pendingPrompts.submitPrompt(prompt, mode);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Submission failed." });
    }
  });

  router.get("/api/prompts/community", publicLimiter, authMw.requireAuth, function(req, res) {
    try {
      res.json({ items: pendingPrompts.getCommunityPrompts() });
    } catch (e) {
      res.json({ items: [] });
    }
  });

  router.get("/api/prompts/pending", authMw.requireAuth, requireAdminAccess, function(req, res) {
    try {
      res.json({ items: pendingPrompts.listPending() });
    } catch (e) {
      res.status(500).json({ error: "Failed to load pending prompts." });
    }
  });

  router.post("/api/prompts/:id/approve", authMw.requireAuth, requireAdminAccess, function(req, res) {
    try {
      pendingPrompts.approvePrompt(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Approval failed." });
    }
  });

  router.post("/api/prompts/:id/reject", authMw.requireAuth, requireAdminAccess, function(req, res) {
    try {
      pendingPrompts.rejectPrompt(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Rejection failed." });
    }
  });

  return router;
}

module.exports = { createPromptsRouter };
