const crypto = require("crypto");

const PAGE_TOKEN_TTL_S = 86400;

function validatePageToken(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const ts = Number(token.slice(0, dot));
  if (!ts || isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > PAGE_TOKEN_TTL_S) return false;
  if (ts > now + 60) return false;
  const expected = crypto
    .createHmac("sha256", process.env.PAGE_TOKEN_SECRET || "")
    .update(String(ts))
    .digest("hex");
  const eBuf = Buffer.from(expected, "hex");
  const aBuf = Buffer.from(token.slice(dot + 1), "hex");
  return eBuf.length === aBuf.length && crypto.timingSafeEqual(eBuf, aBuf);
}

function isDisplayableLeaderboardAnswer(answer) {
  var text = String(answer || "").trim();
  if (!text) return false;
  if (/^\[error:/i.test(text)) return false;
  if (/failed:/i.test(text)) return false;
  if (/timed out/i.test(text)) return false;
  return true;
}

function getLeaderboardItems(deps) {
  const topRuns = (deps.listTopAnalysisRunsByScore || function() { return []; })(20)
    .filter(function(run) {
      var answer = run.responses && run.crownModelId ? run.responses[run.crownModelId] : "";
      return run.crownModelId && run.prompt && isDisplayableLeaderboardAnswer(answer);
    })
    .map(function(run) {
      return {
        modelId: String(run.crownModelId || ""),
        prompt: String(run.prompt || ""),
        score: Number(run.crownScore || 0),
        createdAt: run.createdAt || "",
        answer: String((run.responses && run.responses[run.crownModelId]) || ""),
      };
    });

  if (topRuns.length) {
    return topRuns.slice(0, 10);
  }

  const rawHistoryItems = (deps.readHistory || function() { return []; })(20);
  return Array.isArray(rawHistoryItems)
    ? rawHistoryItems.filter(function(item) {
        return item && item.modelId;
      }).slice(0, 10)
    : [];
}

function categorizeError(message, upstreamStatus, phase) {
  const text = String(message || "").toLowerCase();
  const status = Number(upstreamStatus || 0);
  if (phase === "judge_parse") return "judge_parse";
  if (status === 408 || /timeout|timed out|abort/.test(text)) return "timeout";
  if (status === 429 || /rate limit|too many requests/.test(text)) return "rate_limit";
  if (status >= 500 || /server error|upstream failed|bad gateway|gateway|overloaded/.test(text)) return "upstream_5xx";
  if (status >= 400 || /invalid|bad request|unauthorized|forbidden|not found/.test(text)) return "upstream_4xx";
  if (/network|fetch failed|econn|enotfound|socket|etimedout|econnreset|econnrefused/.test(text)) return "network";
  return "unknown";
}

function buildRunFilters(query) {
  const normalizeFilterOptions = require("../lib/filterOptions").normalizeFilterOptions;
  return normalizeFilterOptions({
    limit: query.limit,
    offset: query.offset,
    query: query.query,
    crownModelId: query.crownModelId,
    status: query.status,
    contestantProvider: query.contestantProvider,
    judgeProvider: query.judgeProvider,
    failedModelId: query.failedModelId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    phase: query.phase,
    isChallenge: query.isChallenge,
  });
}

function buildFailureRun(prompt, responses, meta, phase, error, rawJudge, pack, mode, providerInfo) {
  const errorMessage = String(error && error.message ? error.message : error || "Unknown error");
  return {
    prompt: prompt,
    responses: responses,
    judgement: {
      error: errorMessage,
      phase: phase,
      rawJudge: rawJudge ? String(rawJudge).slice(0, 500) : "",
    },
    crownModelId: "",
    crownScore: 0,
    contestantProvider: providerInfo.contestantProvider,
    judgeProvider: providerInfo.judgeProvider,
    judgeModel: providerInfo.judgeModel,
    timings: meta.timings,
    pack: pack || "bar",
    mode: mode || "absurd",
    execution: {
      summary: {
        overallStatus: "failure",
        phase: phase,
      },
      models: meta.execution && meta.execution.models ? meta.execution.models : {},
      judge: {
        status: "error",
        error: errorMessage,
        errorCategory: categorizeError(errorMessage, error && error.upstreamStatus, phase),
        upstreamStatus: error && error.upstreamStatus ? error.upstreamStatus : 0,
      },
      policy: meta.execution && meta.execution.policy ? meta.execution.policy : { retry: "none", fallback: "none" },
    },
  };
}

function escapeCsvCell(value) {
  const text = String(value == null ? "" : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function toRunsCsv(items) {
  const header = [
    "id",
    "createdAt",
    "status",
    "phase",
    "prompt",
    "crownModelId",
    "crownScore",
    "contestantProvider",
    "judgeProvider",
    "judgeModel",
    "judgeError",
  ];
  const rows = items.map(function(item) {
    const execution = item.execution && typeof item.execution === "object" ? item.execution : {};
    const summary = execution.summary && typeof execution.summary === "object" ? execution.summary : {};
    const judge = execution.judge && typeof execution.judge === "object" ? execution.judge : {};
    return [
      item.id,
      item.createdAt,
      summary.overallStatus || "",
      summary.phase || (item.judgement && item.judgement.phase) || "",
      item.prompt,
      item.crownModelId,
      item.crownScore,
      item.contestantProvider,
      item.judgeProvider,
      item.judgeModel,
      judge.error || (item.judgement && item.judgement.error) || "",
    ].map(escapeCsvCell).join(",");
  });
  return [header.join(","), rows.join("\n")].filter(Boolean).join("\n") + "\n";
}

module.exports = {
  validatePageToken,
  isDisplayableLeaderboardAnswer,
  getLeaderboardItems,
  categorizeError,
  buildRunFilters,
  buildFailureRun,
  escapeCsvCell,
  toRunsCsv,
};
