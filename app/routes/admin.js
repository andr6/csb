const express = require("express");

const _packServices = require("../lib/packs");

function createAdminRouter(deps) {
  const router = express.Router();

  const requireAdminAuth = deps.requireAdminAuth;
  const publicLimiter = deps.publicLimiter;

  const getDynamicPacks = deps.getDynamicPacks || _packServices.getDynamicPacks;
  const saveDynamicPacks = deps.saveDynamicPacks || _packServices.saveDynamicPacks;
  const reloadDynamicPacks = deps.reloadDynamicPacks || _packServices.reloadDynamicPacks;
  const PACKS = deps.PACKS || _packServices.PACKS;

  // ── Dynamic pack CRUD ────────────────────────────────────────────────────────

  router.get("/api/admin/packs", publicLimiter, requireAdminAuth, function(req, res) {
    var staticIds = Object.keys(PACKS);
    var dynamic = getDynamicPacks();
    var dynamicIds = Object.keys(dynamic);
    res.json({
      static: staticIds.map(function(id) { return { id: id, name: PACKS[id].name, editable: false }; }),
      dynamic: dynamicIds.map(function(id) { return { id: id, name: dynamic[id].name, editable: true }; }),
    });
  });

  router.post("/api/admin/packs", publicLimiter, requireAdminAuth, function(req, res) {
    var pack = req.body;
    if (!pack || typeof pack !== "object") {
      return res.status(400).json({ error: "Pack object required." });
    }
    if (!pack.id || typeof pack.id !== "string" || !/^[a-z0-9_-]+$/.test(pack.id)) {
      return res.status(400).json({ error: "Pack id must be alphanumeric with hyphens/underscores." });
    }
    if (!pack.name || typeof pack.name !== "string" || pack.name.trim().length === 0) {
      return res.status(400).json({ error: "Pack name is required." });
    }
    if (!pack.judgeSystemPrompt || typeof pack.judgeSystemPrompt !== "string") {
      return res.status(400).json({ error: "judgeSystemPrompt is required." });
    }
    if (!pack.characterBase || typeof pack.characterBase !== "string") {
      return res.status(400).json({ error: "characterBase is required." });
    }
    if (!pack.providerFlavours || typeof pack.providerFlavours !== "object") {
      return res.status(400).json({ error: "providerFlavours object is required." });
    }

    var dynamic = getDynamicPacks();
    if (dynamic[pack.id]) {
      return res.status(409).json({ error: "Pack with this ID already exists." });
    }
    if (PACKS[pack.id]) {
      return res.status(409).json({ error: "Pack ID conflicts with a built-in pack." });
    }

    dynamic[pack.id] = {
      id: pack.id,
      name: pack.name.trim(),
      tagline: String(pack.tagline || "").trim(),
      teaser: String(pack.teaser || "").trim(),
      persona: String(pack.persona || "").trim(),
      compatibleModes: Array.isArray(pack.compatibleModes) ? pack.compatibleModes : ["absurd", "versus", "custom"],
      judgeSystemPrompt: pack.judgeSystemPrompt.trim(),
      characterBase: pack.characterBase.trim(),
      providerFlavours: pack.providerFlavours,
    };
    saveDynamicPacks(dynamic);
    res.json({ ok: true, id: pack.id });
  });

  router.put("/api/admin/packs/:id", publicLimiter, requireAdminAuth, function(req, res) {
    var id = String(req.params.id || "").trim().toLowerCase();
    var updates = req.body;
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "Update object required." });
    }

    var dynamic = getDynamicPacks();
    if (!dynamic[id]) {
      return res.status(404).json({ error: "Dynamic pack not found." });
    }

    var existing = dynamic[id];
    if (updates.name !== undefined) existing.name = String(updates.name).trim();
    if (updates.tagline !== undefined) existing.tagline = String(updates.tagline).trim();
    if (updates.teaser !== undefined) existing.teaser = String(updates.teaser).trim();
    if (updates.persona !== undefined) existing.persona = String(updates.persona).trim();
    if (updates.compatibleModes !== undefined) existing.compatibleModes = Array.isArray(updates.compatibleModes) ? updates.compatibleModes : existing.compatibleModes;
    if (updates.judgeSystemPrompt !== undefined) existing.judgeSystemPrompt = String(updates.judgeSystemPrompt).trim();
    if (updates.characterBase !== undefined) existing.characterBase = String(updates.characterBase).trim();
    if (updates.providerFlavours !== undefined) existing.providerFlavours = updates.providerFlavours;

    saveDynamicPacks(dynamic);
    res.json({ ok: true, id: id });
  });

  router.delete("/api/admin/packs/:id", publicLimiter, requireAdminAuth, function(req, res) {
    var id = String(req.params.id || "").trim().toLowerCase();
    var dynamic = getDynamicPacks();
    if (!dynamic[id]) {
      return res.status(404).json({ error: "Dynamic pack not found." });
    }
    delete dynamic[id];
    saveDynamicPacks(dynamic);
    res.json({ ok: true, id: id });
  });

  return router;
}

module.exports = { createAdminRouter };
