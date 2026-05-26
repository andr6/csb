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
const { fetchJson } = require("./http");

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

async function callOpenRouter(model, system, userPrompt, key, timeoutMs) {
  ensureModel(model, "openrouter");
  requireApiKey("openrouter", key);
  const data = await fetchJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key,
      "HTTP-Referer": process.env.SITE_URL || "https://chatshitbob.com",
      "X-Title": "Chat Shit Bob",
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    }),
  }, "OpenRouter", timeoutMs);
  return (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : null;
}

async function callAnthropic(model, system, userPrompt, key, timeoutMs) {
  ensureModel(model, "anthropic");
  requireApiKey("anthropic", key);
  const modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const data = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 2048,
      system: system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  }, "Anthropic", timeoutMs);
  return (data.content && data.content[0]) ? data.content[0].text : null;
}

async function callOpenAI(model, system, userPrompt, key, timeoutMs) {
  ensureModel(model, "openai");
  requireApiKey("openai", key);
  const modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const data = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key,
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    }),
  }, "OpenAI", timeoutMs);
  return (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : null;
}

async function callGemini(model, system, userPrompt, key, timeoutMs) {
  requireApiKey("gemini", key);
  var modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  ensureModel(modelName, "gemini");

  const data = await fetchJson(
    "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    },
    "Gemini",
    timeoutMs
  );

  return (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts)
    ? data.candidates[0].content.parts[0].text
    : null;
}

async function callLiteLLM(model, system, userPrompt, key, timeoutMs) {
  ensureModel(model, "litellm");
  requireApiKey("litellm", key);
  const data = await fetchJson(LITELLM_BASE + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key,
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    }),
  }, "LiteLLM", timeoutMs);
  return (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : null;
}

function dispatch(provider, model, system, userPrompt, keys, timeoutMs) {
  switch (provider) {
    case "openrouter": return callOpenRouter(model, system, userPrompt, keys.openrouter, timeoutMs);
    case "anthropic": return callAnthropic(model, system, userPrompt, keys.anthropic, timeoutMs);
    case "openai": return callOpenAI(model, system, userPrompt, keys.openai, timeoutMs);
    case "gemini": return callGemini(model, system, userPrompt, keys.gemini, timeoutMs);
    case "litellm": return callLiteLLM(model, system, userPrompt, keys.litellm, timeoutMs);
    default: throw new Error("Unknown provider: " + provider);
  }
}

function callContestant(modelId, system, userPrompt) {
  const model = MODEL_MAP[modelId];
  const timeoutMs = MODEL_TIMEOUTS[modelId] || CONTESTANT_TIMEOUT_MS;
  return dispatch(CONTESTANT_PROVIDER, model, system, userPrompt, KEYS, timeoutMs);
}

function callJudge(system, userPrompt) {
  return dispatch(JUDGE_PROVIDER, JUDGE_MODEL, system, userPrompt, JUDGE_KEYS, JUDGE_TIMEOUT_MS);
}

module.exports = {
  callContestant: callContestant,
  callJudge: callJudge,
  dispatch: dispatch,
};
