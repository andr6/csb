import { state } from "./state.js";
import { swapKeys, refreshPageToken } from "./utils.js";

// ═══════════════════════════════════════════════════════════════════════════════
//  Fetch interceptor — injects auth + page-token headers for all /api/* calls
//  MUST be imported before any module that calls fetch.
// ═══════════════════════════════════════════════════════════════════════════════
const _originalFetch = window.fetch;
window.fetch = function(url, opts) {
  opts = opts || {};
  if (typeof url === "string" && url.indexOf("/api/") === 0) {
    opts.headers = opts.headers || {};
    if (state.authToken && !opts.headers["Authorization"]) {
      opts.headers["Authorization"] = "Bearer " + state.authToken;
    }
    if (state.pageToken && !opts.headers["X-Page-Token"]) {
      opts.headers["X-Page-Token"] = state.pageToken;
    }
  }
  return _originalFetch(url, opts);
};

export async function fireModel(prompt, modelId, _isRetry) {
  var started = performance.now();
  const res = await fetch("/api/fire", {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-Page-Token": state.pageToken},
    body: JSON.stringify({prompt, modelId, pack: state.activePack}),
  });
  var data;
  try { data = await res.json(); } catch (_) {
    var err = new Error("Server returned a non-JSON response (gateway error?)");
    err.upstreamStatus = res.status;
    err.durationMs = Math.round(performance.now() - started);
    throw err;
  }
  if (res.status === 403 && !_isRetry) {
    await refreshPageToken();
    return fireModel(prompt, modelId, true);
  }
  if (!res.ok) {
    var error = new Error(data.error || "Server error");
    error.upstreamStatus = res.status;
    error.durationMs = Math.round(performance.now() - started);
    throw error;
  }
  return {
    text: data.response,
    timingMs: Math.round(performance.now() - started),
    upstreamStatus: res.status,
  };
}

export async function judgeResponses(prompt, allResponses, modelsOverride, _isRetry) {
  var activeList = Array.isArray(modelsOverride) && modelsOverride.length ? modelsOverride : state.models;
  var responseTimings = {};
  var executionModels = {};
  activeList.forEach(function(model) {
    if (allResponses[model.id + "__timing"] !== undefined && allResponses[model.id + "__timing"] !== null) {
      responseTimings[model.id] = allResponses[model.id + "__timing"];
    }
    if (allResponses[model.id + "__exec"]) {
      executionModels[model.id] = allResponses[model.id + "__exec"];
    }
  });

  var judgableList = activeList.filter(function(model) {
    var r = allResponses[model.id];
    return typeof r === "string" && r.trim().length > 0 && !r.startsWith("[Error:");
  });
  if (!judgableList.length) throw new Error("All models failed — nothing to judge.");

  var anonResponses = judgableList.reduce(function(out, model) {
    var key = (state.blindMode && state.blindReversed) ? state.blindReversed[model.id] : model.id;
    out[key || model.id] = allResponses[model.id];
    return out;
  }, {});
  var anonTimings = {};
  var anonExec = {};
  if (state.blindMode && state.blindReversed) {
    judgableList.forEach(function(model) {
      var key = state.blindReversed[model.id];
      if (key) {
        if (responseTimings[model.id] !== undefined) anonTimings[key] = responseTimings[model.id];
        if (executionModels[model.id]) anonExec[key] = executionModels[model.id];
      }
    });
  } else {
    anonTimings = responseTimings;
    anonExec = executionModels;
  }

  var metaBase = {
    timings: { contestantMsByModel: anonTimings },
    execution: {
      summary: {
        overallStatus: Object.values(executionModels).every(function(item) { return item.status === "success"; })
          ? "success"
          : (Object.values(executionModels).some(function(item) { return item.status === "success"; }) ? "partial_failure" : "failure"),
      },
      models: anonExec,
      policy: { retry: "none", fallback: "none" },
    },
  };
  if (state.blindMode && state.blindMapping) metaBase.blindMapping = state.blindMapping;

  const res = await fetch("/api/judge", {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-Page-Token": state.pageToken},
    body: JSON.stringify(Object.assign({
      prompt: prompt,
      responses: anonResponses,
      meta: metaBase,
    }, getActiveCriteria() ? {criteria: getActiveCriteria()} : {}, {pack: state.activePack, mode: state.currentMode})),
  });
  var data;
  try { data = await res.json(); } catch (_) {
    throw new Error("Judge endpoint returned a non-JSON response");
  }
  if (res.status === 403 && !_isRetry) {
    await refreshPageToken();
    return judgeResponses(prompt, allResponses, modelsOverride, true);
  }
  if (!res.ok) throw new Error(data.error || "Judge error");

  if (state.blindMode && state.blindMapping && data) {
    if (data.scores) data.scores = swapKeys(data.scores, state.blindMapping);
    if (data.verdicts) data.verdicts = swapKeys(data.verdicts, state.blindMapping);
    if (data.crown) data.crown = state.blindMapping[data.crown] || data.crown;
    if (data.judgeConfidence) data.judgeConfidence = swapKeys(data.judgeConfidence, state.blindMapping);
  }
  return data;
}

// Forward declaration — will be wired by whichever module owns criteria
var _getActiveCriteria = function() { return undefined; };
export function setGetActiveCriteria(fn) { _getActiveCriteria = fn; }
function getActiveCriteria() { return _getActiveCriteria(); }
