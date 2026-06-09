const express = require("express");
const { buildRunFilters, toRunsCsv } = require("../lib/fireHelpers");

function createRunsRouter(deps) {
  const router = express.Router();

  const requireAdminAuth = deps.requireAdminAuth;
  const publicLimiter = deps.publicLimiter;

  const listAnalysisRuns = deps.listAnalysisRuns || require("../lib/analysisRuns").listAnalysisRuns;
  const countAnalysisRuns = deps.countAnalysisRuns || require("../lib/analysisRuns").countAnalysisRuns;
  const getAnalysisRun = deps.getAnalysisRun || require("../lib/analysisRuns").getAnalysisRun;

  router.get("/api/runs", requireAdminAuth, function(req, res) {
    const filters = buildRunFilters(req.query);
    res.json({
      items: listAnalysisRuns(filters),
      total: countAnalysisRuns(filters),
    });
  });

  router.get("/api/runs/export", requireAdminAuth, function(req, res) {
    const filters = buildRunFilters(req.query);
    const format = String(req.query.format || "json").toLowerCase();
    const items = listAnalysisRuns({
      ...filters,
      limit: Math.min(500, Number(req.query.limit || 100)),
      offset: req.query.offset || 0,
    });
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"csb-runs-export.csv\"");
      return res.send(toRunsCsv(items));
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"csb-runs-export.json\"");
    res.send(JSON.stringify({ items: items, total: items.length, exportedAt: new Date().toISOString() }, null, 2));
  });

  router.get("/api/runs/:id", requireAdminAuth, function(req, res) {
    const item = getAnalysisRun(req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Run not found." });
    }
    res.json(item);
  });

  // F1 — public shareable run endpoint (no auth)
  router.get("/api/runs/:id/public", publicLimiter, function(req, res) {
    const item = getAnalysisRun(req.params.id);
    if (!item) return res.status(404).json({ error: "Run not found." });
    res.json({
      id: item.id,
      prompt: item.prompt,
      responses: item.responses,
      judgement: {
        scores: item.judgement && item.judgement.scores,
        verdicts: item.judgement && item.judgement.verdicts,
        crown: item.judgement && item.judgement.crown,
        roast: item.judgement && item.judgement.roast,
      },
      crownModelId: item.crownModelId,
      crownScore: item.crownScore,
      createdAt: item.createdAt,
      blindMapping: item.execution && item.execution.blindMapping ? item.execution.blindMapping : undefined,
      judgeConfidence: item.execution && item.execution.judgeConfidence ? item.execution.judgeConfidence : undefined,
    });
  });

  return router;
}

module.exports = { createRunsRouter };
