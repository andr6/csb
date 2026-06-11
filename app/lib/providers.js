const {
  KEYS,
  JUDGE_KEYS,
  JUDGE_PROVIDER,
  JUDGE_MODEL,
  LITELLM_BASE,
  CONTESTANT_PROVIDER,
  MODEL_MAP,
  MODEL_TIMEOUTS,
  CONTESTANT_TIMEOUT_MS,
  JUDGE_TIMEOUT_MS,
} = require("./config");
const { fetchJson, withTimeout } = require("./http");
const { recordOutcome } = require("./modelHealth");

// ═══════════════════════════════════════════════════════════════════════════════
//  Provider plugin registry
// ═══════════════════════════════════════════════════════════════════════════════

const _registry = new Map();

function registerProvider(name, handler) {
  if (!name || typeof name !== "string") {
    throw new Error("registerProvider: name must be a non-empty string");
  }
  if (!handler || typeof handler.call !== "function") {
    throw new Error("registerProvider: handler.call must be a function");
  }
  _registry.set(name, {
    call: handler.call,
    healthProbe: typeof handler.healthProbe === "function" ? handler.healthProbe : null,
  });
}

function getProvider(name) {
  return _registry.get(name);
}

function listProviders() {
  return Array.from(_registry.keys());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Provider implementations
// ═══════════════════════════════════════════════════════════════════════════════

function requireApiKey(provider, key) {
  if (!key) {
    throw new Error("Missing API key for provider: " + provider);
  }
}

function ensureModel(model, provider) {
  if (!model) {
    throw new Error("No model configured for provider: " + provider);
  }
}

async function callOpenRouter(model, system, userPrompt, key, timeoutMs, requestId, jsonMode) {
  ensureModel(model, "openrouter");
  requireApiKey("openrouter", key);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + key,
    "HTTP-Referer": process.env.SITE_URL || "https://chatshitbob.com",
    "X-Title": "Chat Shit Bob",
  };
  if (requestId) headers["X-Request-ID"] = requestId;
  const body = {
    model: model,
    max_tokens: 2048,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const data = await fetchJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
  }, "OpenRouter", timeoutMs);
  return (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : null;
}

async function callAnthropic(model, system, userPrompt, key, timeoutMs, requestId, jsonMode) {
  ensureModel(model, "anthropic");
  requireApiKey("anthropic", key);
  const modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
  if (requestId) headers["X-Request-ID"] = requestId;
  const body = {
    model: modelName,
    max_tokens: 2048,
    system: system,
    messages: [{ role: "user", content: userPrompt }],
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const data = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
  }, "Anthropic", timeoutMs);
  return (data.content && data.content[0]) ? data.content[0].text : null;
}

async function callOpenAI(model, system, userPrompt, key, timeoutMs, requestId, jsonMode) {
  ensureModel(model, "openai");
  requireApiKey("openai", key);
  const modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + key,
  };
  if (requestId) headers["X-Request-ID"] = requestId;
  const body = {
    model: modelName,
    max_tokens: 2048,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const data = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
  }, "OpenAI", timeoutMs);
  return (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : null;
}

async function callGemini(model, system, userPrompt, key, timeoutMs, requestId, jsonMode) {
  requireApiKey("gemini", key);
  var modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  ensureModel(modelName, "gemini");

  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  if (requestId) headers["X-Request-ID"] = requestId;
  const generationConfig = { maxOutputTokens: 2048 };
  if (jsonMode) generationConfig.responseMimeType = "application/json";
  const data = await fetchJson(
    "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent",
    {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: generationConfig,
      }),
    },
    "Gemini",
    timeoutMs
  );

  return (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts)
    ? data.candidates[0].content.parts[0].text
    : null;
}

async function callLiteLLM(model, system, userPrompt, key, timeoutMs, requestId, jsonMode) {
  ensureModel(model, "litellm");
  requireApiKey("litellm", key);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + key,
  };
  if (requestId) headers["X-Request-ID"] = requestId;
  const body = {
    model: model,
    max_tokens: 2048,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const data = await fetchJson(LITELLM_BASE + "/chat/completions", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
  }, "LiteLLM", timeoutMs);
  return (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : null;
}

// Seed default providers at module load
registerProvider("openrouter", {
  call: callOpenRouter,
  healthProbe: async function(key) {
    requireApiKey("openrouter", key);
    const timer = withTimeout(5000);
    try {
      const data = await fetchJson("https://openrouter.ai/api/v1/models", { method: "GET", signal: timer.signal }, "OpenRouter", 5000);
      return data && Array.isArray(data.data) ? "reachable" : "auth_failed";
    } catch (e) {
      if (e.name === "AbortError") return "timeout";
      if (e.upstreamStatus === 401 || e.upstreamStatus === 403) return "auth_failed";
      return "unreachable";
    } finally {
      timer.cleanup();
    }
  },
});

registerProvider("anthropic", {
  call: callAnthropic,
  healthProbe: async function(key) {
    requireApiKey("anthropic", key);
    const timer = withTimeout(5000);
    try {
      // Lightweight POST probe: max_tokens=1
      await fetchJson("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      }, "Anthropic", 5000);
      return "reachable";
    } catch (e) {
      if (e.name === "AbortError") return "timeout";
      if (e.upstreamStatus === 401 || e.upstreamStatus === 403) return "auth_failed";
      return "unreachable";
    } finally {
      timer.cleanup();
    }
  },
});

registerProvider("openai", {
  call: callOpenAI,
  healthProbe: async function(key) {
    requireApiKey("openai", key);
    const timer = withTimeout(5000);
    try {
      // Lightweight POST probe: max_tokens=1
      await fetchJson("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + key,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      }, "OpenAI", 5000);
      return "reachable";
    } catch (e) {
      if (e.name === "AbortError") return "timeout";
      if (e.upstreamStatus === 401 || e.upstreamStatus === 403) return "auth_failed";
      return "unreachable";
    } finally {
      timer.cleanup();
    }
  },
});

registerProvider("gemini", {
  call: callGemini,
  healthProbe: async function(key) {
    requireApiKey("gemini", key);
    const timer = withTimeout(5000);
    try {
      // Gemini doesn't have a lightweight models list endpoint; use HEAD
      await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(key), {
        method: "HEAD",
        signal: timer.signal,
      });
      return "reachable";
    } catch (e) {
      if (e.name === "AbortError") return "timeout";
      if (e.status === 401 || e.status === 403) return "auth_failed";
      return "unreachable";
    } finally {
      timer.cleanup();
    }
  },
});

registerProvider("litellm", {
  call: callLiteLLM,
  healthProbe: async function(key) {
    requireApiKey("litellm", key);
    const timer = withTimeout(5000);
    try {
      await fetch(LITELLM_BASE + "/models", { method: "HEAD", signal: timer.signal });
      return "reachable";
    } catch (e) {
      if (e.name === "AbortError") return "timeout";
      if (e.status === 401 || e.status === 403) return "auth_failed";
      return "unreachable";
    } finally {
      timer.cleanup();
    }
  },
});

function dispatch(provider, model, system, userPrompt, keys, timeoutMs, requestId, jsonMode) {
  const entry = _registry.get(provider);
  if (!entry) throw new Error("Unknown provider: " + provider);
  var key = keys[provider];
  return entry.call(model, system, userPrompt, key, timeoutMs, requestId, jsonMode);
}

async function checkProviderHealth(provider, key) {
  const entry = _registry.get(provider);
  if (!entry) return "unknown";
  if (!key) return "missing_key";
  if (typeof entry.healthProbe === "function") {
    return entry.healthProbe(key);
  }
  // Fallback to HEAD probe for providers without a custom healthProbe
  var urls = {
    openrouter: "https://openrouter.ai/api/v1/models",
    anthropic: "https://api.anthropic.com/v1/models",
    openai: "https://api.openai.com/v1/models",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models",
    litellm: LITELLM_BASE + "/models",
  };
  var url = urls[provider];
  if (!url) return "unknown";
  var timer = withTimeout(5000);
  try {
    await fetch(url, { method: "HEAD", signal: timer.signal });
    return "reachable";
  } catch (e) {
    if (e.name === "AbortError") return "timeout";
    return "unreachable";
  } finally {
    timer.cleanup();
  }
}

async function withRetry(fn, opts) {
  var maxRetries = opts && opts.maxRetries !== undefined ? opts.maxRetries : 2;
  var baseDelayMs = opts && opts.baseDelayMs !== undefined ? opts.baseDelayMs : 500;
  var lastError;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      var status = e && e.upstreamStatus ? e.upstreamStatus : 0;
      // Do not retry on 4xx client errors (except 429 rate-limit and 408 timeout)
      if (status >= 400 && status < 500 && status !== 429 && status !== 408) throw e;
      if (attempt < maxRetries) {
        var delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(function(resolve) { setTimeout(resolve, delay); });
      }
    }
  }
  throw lastError;
}

function callContestant(modelId, system, userPrompt, requestId) {
  const model = MODEL_MAP[modelId];
  const timeoutMs = MODEL_TIMEOUTS[modelId] || CONTESTANT_TIMEOUT_MS;
  if (requestId) console.log("[fire] [req:" + requestId + "] contestant " + modelId + " via " + CONTESTANT_PROVIDER);
  return withRetry(function() {
    return dispatch(CONTESTANT_PROVIDER, model, system, userPrompt, KEYS, timeoutMs, requestId, false);
  }, { maxRetries: 2 }).then(function(result) {
    recordOutcome(modelId, true, null);
    return result;
  }).catch(function(err) {
    recordOutcome(modelId, false, err && err.message ? err.message : String(err));
    throw err;
  });
}

function callJudge(system, userPrompt, requestId, judgeModel) {
  var model = judgeModel || JUDGE_MODEL;
  if (requestId) console.log("[judge] [req:" + requestId + "] judge via " + JUDGE_PROVIDER + " (" + model + ")");
  return withRetry(function() {
    return dispatch(JUDGE_PROVIDER, model, system, userPrompt, JUDGE_KEYS, JUDGE_TIMEOUT_MS, requestId, true);
  }, { maxRetries: 2 });
}

module.exports = {
  registerProvider: registerProvider,
  getProvider: getProvider,
  listProviders: listProviders,
  callContestant: callContestant,
  callJudge: callJudge,
  dispatch: dispatch,
  withRetry: withRetry,
  checkProviderHealth: checkProviderHealth,
  getHealthyModelIds: require("./modelHealth").getHealthyModelIds,
};
