const fs = require("node:fs");
const path = require("node:path");
const { computeAnalyticsSummary, computeFailureSummary } = require("../analyticsEngine");
const { normalizeFilterOptions } = require("../filterOptions");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const RUNS_FILE = process.env.CSB_RUNS_FILE || path.join(DATA_DIR, "analysis-runs.json");
const MAX_RUNS = 100;

function createJsonAnalysisRunRepository(options) {
  const filePath = options && options.filePath ? options.filePath : RUNS_FILE;

  function ensureDataDir() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function readAll() {
    try {
      ensureDataDir();
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("[analysis-runs-json] read failed:", error.message);
      return [];
    }
  }

  function writeAll(entries) {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2) + "\n", "utf8");
  }

  function normalizeRun(run) {
    return {
      id: String(run.id || (Date.now() + "-" + Math.random().toString(16).slice(2))),
      prompt: String(run.prompt || "").slice(0, 500),
      responses: run.responses && typeof run.responses === "object" ? run.responses : {},
      judgement: run.judgement && typeof run.judgement === "object" ? run.judgement : {},
      crownModelId: String(run.crownModelId || ""),
      crownScore: Math.max(0, Math.min(100, Math.round(Number(run.crownScore || 0)))),
      contestantProvider: String(run.contestantProvider || ""),
      judgeProvider: String(run.judgeProvider || ""),
      judgeModel: String(run.judgeModel || ""),
      timings: run.timings && typeof run.timings === "object" ? run.timings : {},
      execution: run.execution && typeof run.execution === "object" ? run.execution : {},
      createdAt: run.createdAt || new Date().toISOString(),
    };
  }

  function insertRun(run) {
    const current = readAll();
    const item = normalizeRun(run);
    current.unshift(item);
    current.sort(function(a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    writeAll(current.slice(0, MAX_RUNS));
    return item;
  }

  function filterRows(options) {
    const opts = normalizeFilterOptions(options);

    var rows = readAll();
    return rows.filter(function(item) {
      var overallStatus = item.execution && item.execution.summary && item.execution.summary.overallStatus;
      var phase = item.execution && item.execution.summary && item.execution.summary.phase
        ? item.execution.summary.phase
        : (item.judgement && item.judgement.phase) || "";
      var createdDay = String(item.createdAt || "").slice(0, 10);
      var models = item.execution && item.execution.models ? item.execution.models : {};
      var failedModel = opts.failedModelId
        ? models[opts.failedModelId] && models[opts.failedModelId].status && models[opts.failedModelId].status !== "success"
        : true;

      if (opts.crownModelId && item.crownModelId !== opts.crownModelId) return false;
      if (opts.query && !String(item.prompt || "").toLowerCase().includes(opts.query)) return false;
      if (opts.status && overallStatus !== opts.status) return false;
      if (opts.contestantProvider && item.contestantProvider !== opts.contestantProvider) return false;
      if (opts.judgeProvider && item.judgeProvider !== opts.judgeProvider) return false;
      if (!failedModel) return false;
      if (opts.phase && phase !== opts.phase) return false;
      if (opts.dateFrom && createdDay && createdDay < opts.dateFrom) return false;
      if (opts.dateTo && createdDay && createdDay > opts.dateTo) return false;
      return true;
    });
  }

  function listRecent(options) {
    const opts = normalizeFilterOptions(options, 100);
    var rows = filterRows(options);
    return rows.slice(opts.offset, opts.offset + opts.limit);
  }

  function getById(id) {
    return readAll().find(function(item) { return item.id === String(id); }) || null;
  }

  function stats() {
    const rows = readAll();
    return {
      totalRuns: rows.length,
      latestRunAt: rows.length ? rows[0].createdAt : null,
    };
  }

  function countRecent(options) {
    return filterRows(options).length;
  }

  function analyticsSummary(options) {
    const opts = normalizeFilterOptions(options);
    return computeAnalyticsSummary(filterRows(options), opts);
  }

  function failureSummary(options) {
    return computeFailureSummary(filterRows(options));
  }

  function listTopByScore(limit) {
    var safeLimit = Math.max(1, Math.min(50, Number(limit || 10)));
    return readAll()
      .filter(function(item) {
        return item.crownModelId;
      })
      .sort(function(a, b) {
        var diff = Number(b.crownScore || 0) - Number(a.crownScore || 0);
        return diff !== 0 ? diff : String(b.createdAt).localeCompare(String(a.createdAt));
      })
      .slice(0, safeLimit);
  }

  return {
    type: "json",
    insertRun: insertRun,
    listRecent: listRecent,
    countRecent: countRecent,
    analyticsSummary: analyticsSummary,
    getById: getById,
    stats: stats,
    failureSummary: failureSummary,
    listTopByScore: listTopByScore,
    filePath: filePath,
  };
}

module.exports = {
  createJsonAnalysisRunRepository: createJsonAnalysisRunRepository,
};
