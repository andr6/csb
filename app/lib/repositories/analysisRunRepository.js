const { DB_PATH, runSql, queryJson, runSqlParams, queryJsonParams } = require("../sqlite");
const { applyPendingMigrations } = require("../migrations");
const { computeFailureSummary } = require("../analyticsEngine");
const { normalizeFilterOptions } = require("../filterOptions");

function createAnalysisRunRepository() {
  function init() {
    applyPendingMigrations();
  }

  function normalizeRun(run) {
    return {
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
      isChallenge: (run.execution && run.execution.isChallenge) ? 1 : 0,
    };
  }

  function rowToRun(row) {
    return {
      id: String(row.id),
      prompt: row.prompt,
      responses: JSON.parse(row.responses || "{}"),
      judgement: JSON.parse(row.judgement || "{}"),
      crownModelId: row.crownModelId,
      crownScore: row.crownScore,
      contestantProvider: row.contestantProvider,
      judgeProvider: row.judgeProvider,
      judgeModel: row.judgeModel,
      timings: JSON.parse(row.timings || "{}"),
      execution: JSON.parse(row.execution || "{}"),
      createdAt: row.createdAt,
    };
  }

  function buildWhereClause(opts, flags) {
    const conditions = [];
    const params = [];

    if (opts.crownModelId) {
      conditions.push("crown_model_id = ?");
      params.push(opts.crownModelId);
    }
    if (opts.query) {
      const searchParam = "%" + opts.query.replace(/%/g, "\\%").replace(/_/g, "\\_") + "%";
      conditions.push("LOWER(prompt) LIKE ? ESCAPE '\\'");
      params.push(searchParam);
    }
    if (opts.status) {
      conditions.push("JSON_EXTRACT(execution_json, '$.summary.overallStatus') = ?");
      params.push(opts.status);
    }
    if (opts.contestantProvider) {
      conditions.push("contestant_provider = ?");
      params.push(opts.contestantProvider);
    }
    if (opts.judgeProvider) {
      conditions.push("judge_provider = ?");
      params.push(opts.judgeProvider);
    }
    if (opts.failedModelId) {
      // The JSON path is bound as a parameter value — SQLite receives it as a literal
      // string passed to JSON_EXTRACT, never parsed as SQL.
      const failedModelPath = "$.models." + opts.failedModelId + ".status";
      conditions.push("JSON_EXTRACT(execution_json, ?) IS NOT NULL AND JSON_EXTRACT(execution_json, ?) != 'success'");
      params.push(failedModelPath, failedModelPath);
    }
    if (opts.dateFrom) {
      conditions.push("DATE(created_at) >= ?");
      params.push(opts.dateFrom);
    }
    if (opts.dateTo) {
      conditions.push("DATE(created_at) <= ?");
      params.push(opts.dateTo);
    }
    if (opts.phase) {
      conditions.push("(JSON_EXTRACT(execution_json, '$.summary.phase') = ? OR (JSON_EXTRACT(execution_json, '$.summary.phase') IS NULL AND JSON_EXTRACT(judgement_json, '$.phase') = ?))");
      params.push(opts.phase, opts.phase);
    }

    if (opts.isChallenge === 1) {
      conditions.push("is_challenge = 1");
    }

    if (flags && flags.failuresOnly) {
      conditions.push(
        "JSON_EXTRACT(execution_json, '$.summary.overallStatus') IS NOT NULL" +
        " AND JSON_EXTRACT(execution_json, '$.summary.overallStatus') != ''" +
        " AND JSON_EXTRACT(execution_json, '$.summary.overallStatus') != 'success'"
      );
    }

    return {
      sql: conditions.length ? "WHERE " + conditions.join(" AND ") : "",
      params: params,
    };
  }

  function queryFiltered(options) {
    const opts = normalizeFilterOptions(options);
    const { sql: where, params } = buildWhereClause(opts);
    return queryJsonParams([
      "SELECT id, prompt, responses_json AS responses, judgement_json AS judgement,",
      "  crown_model_id AS crownModelId, crown_score AS crownScore,",
      "  contestant_provider AS contestantProvider, judge_provider AS judgeProvider,",
      "  judge_model AS judgeModel, timings_json AS timings, execution_json AS execution,",
      "  created_at AS createdAt",
      "FROM analysis_runs",
      where,
      "ORDER BY created_at DESC, id DESC",
      "LIMIT ?;",
    ].filter(Boolean).join("\n"), params.concat([opts.analyticsLimit])).map(rowToRun);
  }

  function insertRun(run) {
    const item = normalizeRun(run);
    runSqlParams(
      "INSERT INTO analysis_runs (prompt, responses_json, judgement_json, crown_model_id, crown_score, contestant_provider, judge_provider, judge_model, timings_json, execution_json, created_at, is_challenge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        item.prompt,
        JSON.stringify(item.responses),
        JSON.stringify(item.judgement),
        item.crownModelId,
        item.crownScore,
        item.contestantProvider,
        item.judgeProvider,
        item.judgeModel,
        JSON.stringify(item.timings),
        JSON.stringify(item.execution),
        item.createdAt,
        item.isChallenge,
      ]
    );

    const rows = queryJson("SELECT last_insert_rowid() AS id;");
    item.id = String(rows[0].id);
    return item;
  }

  function listRecent(options) {
    const opts = normalizeFilterOptions(options);
    const { sql: where, params } = buildWhereClause(opts);
    return queryJsonParams([
      "SELECT id, prompt, responses_json AS responses, judgement_json AS judgement,",
      "  crown_model_id AS crownModelId, crown_score AS crownScore,",
      "  contestant_provider AS contestantProvider, judge_provider AS judgeProvider,",
      "  judge_model AS judgeModel, timings_json AS timings, execution_json AS execution,",
      "  created_at AS createdAt",
      "FROM analysis_runs",
      where,
      "ORDER BY created_at DESC, id DESC",
      "LIMIT ? OFFSET ?;",
    ].filter(Boolean).join("\n"), params.concat([opts.limit, opts.offset])).map(rowToRun);
  }

  function getById(id) {
    const rows = queryJsonParams(
      "SELECT id, prompt, responses_json AS responses, judgement_json AS judgement, crown_model_id AS crownModelId, crown_score AS crownScore, contestant_provider AS contestantProvider, judge_provider AS judgeProvider, judge_model AS judgeModel, timings_json AS timings, execution_json AS execution, created_at AS createdAt FROM analysis_runs WHERE id = ? LIMIT 1;",
      [Number(id)]
    );
    return rows.length ? rowToRun(rows[0]) : null;
  }

  function listTopByScore(limit) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit || 10)));
    return queryJson([
      "SELECT id, prompt, responses_json AS responses, judgement_json AS judgement,",
      "  crown_model_id AS crownModelId, crown_score AS crownScore,",
      "  contestant_provider AS contestantProvider, judge_provider AS judgeProvider,",
      "  judge_model AS judgeModel, timings_json AS timings, execution_json AS execution,",
      "  created_at AS createdAt",
      "FROM analysis_runs",
      "WHERE crown_model_id != ''",
      "ORDER BY crown_score DESC, created_at DESC",
      "LIMIT " + safeLimit + ";",
    ].join("\n")).map(rowToRun);
  }

  function stats() {
    const rows = queryJson([
      "SELECT",
      "  COUNT(*) AS totalRuns,",
      "  MAX(created_at) AS latestRunAt",
      "FROM analysis_runs;",
    ].join("\n"));
    return rows[0] || { totalRuns: 0, latestRunAt: null };
  }

  function countRecent(options) {
    const opts = normalizeFilterOptions(options);
    const { sql: where, params } = buildWhereClause(opts);
    const rows = queryJsonParams(
      ["SELECT COUNT(*) AS count FROM analysis_runs", where].filter(Boolean).join("\n") + ";",
      params
    );
    return rows[0] ? Number(rows[0].count) : 0;
  }

  function analyticsSummary(options) {
    const opts = normalizeFilterOptions(options);
    const { sql: whereSql, params: whereParams } = buildWhereClause(opts);

    // Q1: overall aggregates
    const q1 = queryJsonParams([
      "SELECT",
      "  COUNT(*) AS totalRuns,",
      "  SUM(CASE WHEN JSON_EXTRACT(execution_json, '$.summary.overallStatus') = 'success' THEN 1 ELSE 0 END) AS successRuns,",
      "  SUM(CASE WHEN JSON_EXTRACT(execution_json, '$.summary.overallStatus') = 'partial_failure' THEN 1 ELSE 0 END) AS partialFailureRuns,",
      "  SUM(CASE WHEN JSON_EXTRACT(execution_json, '$.summary.overallStatus') = 'failure' THEN 1 ELSE 0 END) AS failureRuns,",
      "  AVG(CASE WHEN crown_model_id IS NOT NULL AND crown_model_id != '' THEN CAST(crown_score AS REAL) END) AS avgCrownScore,",
      "  AVG(CASE WHEN JSON_EXTRACT(timings_json, '$.judgeMs') IS NOT NULL THEN CAST(JSON_EXTRACT(timings_json, '$.judgeMs') AS REAL) END) AS avgJudgeMs",
      "FROM analysis_runs",
      whereSql,
    ].filter(Boolean).join("\n"), whereParams);
    const s = q1[0] || {};
    const totalRuns = Number(s.totalRuns || 0);
    const successRuns = Number(s.successRuns || 0);
    const partialFailureRuns = Number(s.partialFailureRuns || 0);
    const failureRuns = Number(s.failureRuns || 0);
    const avgCrownScore = s.avgCrownScore != null ? Math.round(Number(s.avgCrownScore)) : 0;
    const avgJudgeMs = s.avgJudgeMs != null ? Math.round(Number(s.avgJudgeMs)) : 0;
    const successRate = totalRuns ? Math.round((successRuns / totalRuns) * 100) : 0;

    // Q2: daily trend base — all days ascending, sliced later
    const q2rows = queryJsonParams([
      "SELECT DATE(created_at) AS date, COUNT(*) AS runs,",
      "  SUM(CASE WHEN JSON_EXTRACT(execution_json, '$.summary.overallStatus') = 'success' THEN 1 ELSE 0 END) AS successRuns,",
      "  AVG(CASE WHEN crown_model_id IS NOT NULL AND crown_model_id != '' THEN CAST(crown_score AS REAL) END) AS avgCrownScore",
      "FROM analysis_runs",
      whereSql,
      "GROUP BY DATE(created_at) ORDER BY date ASC",
    ].filter(Boolean).join("\n"), whereParams);

    // Q3: wins per model
    const w3 = whereSql
      ? whereSql + " AND crown_model_id IS NOT NULL AND crown_model_id != ''"
      : "WHERE crown_model_id IS NOT NULL AND crown_model_id != ''";
    const q3rows = queryJsonParams(
      ["SELECT crown_model_id AS modelId, COUNT(*) AS wins FROM analysis_runs", w3, "GROUP BY crown_model_id"].join("\n"),
      whereParams
    );

    // Q4: per-model scores from judgement_json.scores
    const q4rows = queryJsonParams([
      "SELECT s.key AS modelId, COUNT(*) AS scoredRuns, SUM(CAST(s.value AS REAL)) AS totalScore",
      "FROM (SELECT judgement_json FROM analysis_runs " + whereSql + ") r",
      ", JSON_EACH(JSON_EXTRACT(r.judgement_json, '$.scores')) s",
      "GROUP BY s.key",
    ].filter(Boolean).join("\n"), whereParams);

    // Q5: per-model execution stats from execution_json.models
    const q5rows = queryJsonParams([
      "SELECT m.key AS modelId, COUNT(*) AS appearances,",
      "  SUM(CASE WHEN JSON_EXTRACT(m.value, '$.status') IS NOT NULL AND JSON_EXTRACT(m.value, '$.status') != 'success' THEN 1 ELSE 0 END) AS failures,",
      "  SUM(CASE WHEN JSON_EXTRACT(m.value, '$.durationMs') IS NOT NULL THEN CAST(JSON_EXTRACT(m.value, '$.durationMs') AS REAL) ELSE 0 END) AS totalDurationMs,",
      "  SUM(CASE WHEN JSON_EXTRACT(m.value, '$.durationMs') IS NOT NULL THEN 1 ELSE 0 END) AS durationCount",
      "FROM (SELECT execution_json FROM analysis_runs " + whereSql + ") r",
      ", JSON_EACH(JSON_EXTRACT(r.execution_json, '$.models')) m",
      "GROUP BY m.key",
    ].filter(Boolean).join("\n"), whereParams);

    // Q6: daily model usage from judgement scores (for spend estimation in enrichAnalyticsSummary)
    const q6rows = queryJsonParams([
      "SELECT DATE(r.created_at) AS date, s.key AS modelId, COUNT(*) AS appearances",
      "FROM (SELECT created_at, judgement_json FROM analysis_runs " + whereSql + ") r",
      ", JSON_EACH(JSON_EXTRACT(r.judgement_json, '$.scores')) s",
      "GROUP BY DATE(r.created_at), s.key ORDER BY date ASC",
    ].filter(Boolean).join("\n"), whereParams);

    // build daily model-usage map: { date -> { modelId -> count } }
    const dailyUsageMap = {};
    q6rows.forEach(function(row) {
      if (!dailyUsageMap[row.date]) dailyUsageMap[row.date] = {};
      dailyUsageMap[row.date][row.modelId] = Number(row.appearances || 0);
    });

    // build final daily trend, limited to last trendDays
    const dailyTrend = q2rows.map(function(row) {
      const runs = Number(row.runs || 0);
      return {
        date: row.date,
        runs: runs,
        successRate: runs ? Math.round((Number(row.successRuns || 0) / runs) * 100) : 0,
        avgCrownScore: row.avgCrownScore != null ? Math.round(Number(row.avgCrownScore)) : 0,
        modelUsage: dailyUsageMap[row.date] || {},
      };
    }).slice(-opts.trendDays);

    // merge Q3/Q4/Q5 into modelStats
    const modelMap = {};
    function ensureM(id) {
      if (!modelMap[id]) modelMap[id] = { modelId: id, appearances: 0, scoredRuns: 0, totalScore: 0, wins: 0, failures: 0, totalDurationMs: 0, durationCount: 0 };
      return modelMap[id];
    }
    q4rows.forEach(function(row) {
      const m = ensureM(row.modelId);
      m.scoredRuns = Number(row.scoredRuns || 0);
      m.totalScore = Number(row.totalScore || 0);
      m.appearances = Math.max(m.appearances, m.scoredRuns);
    });
    q5rows.forEach(function(row) {
      const m = ensureM(row.modelId);
      m.appearances = Math.max(m.appearances, Number(row.appearances || 0));
      m.failures = Number(row.failures || 0);
      m.totalDurationMs = Number(row.totalDurationMs || 0);
      m.durationCount = Number(row.durationCount || 0);
    });
    q3rows.forEach(function(row) { ensureM(row.modelId).wins = Number(row.wins || 0); });

    const modelStats = Object.keys(modelMap).map(function(modelId) {
      const m = modelMap[modelId];
      return {
        modelId: modelId,
        appearances: m.appearances,
        avgScore: m.scoredRuns ? Math.round(m.totalScore / m.scoredRuns) : 0,
        wins: m.wins,
        winRate: m.appearances ? Math.round((m.wins / m.appearances) * 100) : 0,
        reliability: m.appearances ? Math.round(((m.appearances - m.failures) / m.appearances) * 100) : 100,
        avgDurationMs: m.durationCount ? Math.round(m.totalDurationMs / m.durationCount) : 0,
      };
    }).sort(function(a, b) { return b.avgScore - a.avgScore || b.wins - a.wins; });

    const recommendations = { bestOverall: null, mostReliable: null, fastest: null, bestValue: null, rotationCandidates: [] };
    if (modelStats.length) {
      const byReliability = modelStats.slice().sort(function(a, b) { return b.reliability - a.reliability || b.avgScore - a.avgScore; });
      const bySpeed = modelStats.filter(function(m) { return m.avgDurationMs > 0; }).sort(function(a, b) { return a.avgDurationMs - b.avgDurationMs || b.avgScore - a.avgScore; });
      recommendations.bestOverall = modelStats[0];
      recommendations.mostReliable = byReliability[0] || null;
      recommendations.fastest = bySpeed[0] || null;
      recommendations.rotationCandidates = modelStats.filter(function(m) { return m.appearances >= 2 && m.reliability < 90 && m.winRate < 25; }).slice(0, 3);
    }

    return { totalRuns, successRuns, partialFailureRuns, failureRuns, successRate, avgCrownScore, avgJudgeMs, dailyTrend, modelStats, recommendations };
  }

  function failureSummary(options) {
    const opts = normalizeFilterOptions(options);
    const { sql: where, params } = buildWhereClause(opts, { failuresOnly: true });
    const failedRows = queryJsonParams([
      "SELECT id, prompt, responses_json AS responses, judgement_json AS judgement,",
      "  crown_model_id AS crownModelId, crown_score AS crownScore,",
      "  contestant_provider AS contestantProvider, judge_provider AS judgeProvider,",
      "  judge_model AS judgeModel, timings_json AS timings, execution_json AS execution,",
      "  created_at AS createdAt",
      "FROM analysis_runs",
      where,
      "ORDER BY created_at DESC, id DESC",
      "LIMIT ?;",
    ].filter(Boolean).join("\n"), params.concat([opts.analyticsLimit])).map(rowToRun);
    return computeFailureSummary(failedRows);
  }

  init();

  return {
    type: "sqlite",
    insertRun: insertRun,
    listRecent: listRecent,
    listTopByScore: listTopByScore,
    countRecent: countRecent,
    analyticsSummary: analyticsSummary,
    getById: getById,
    stats: stats,
    failureSummary: failureSummary,
    dbPath: DB_PATH,
  };
}

module.exports = {
  createAnalysisRunRepository: createAnalysisRunRepository,
};
