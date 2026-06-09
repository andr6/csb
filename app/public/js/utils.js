import { state, SYMPTOMS } from "./state.js";

export function modelColor(str) {
  if (state.modelsMeta && state.modelsMeta[str] && state.modelsMeta[str].color) {
    return state.modelsMeta[str].color;
  }
  var palette = [
    "#10a37f","#d97706","#4285f4","#e11d48","#7c3aed",
    "#0668e1","#16a34a","#9333ea","#76b900","#0078d4",
    "#0891b2","#c2410c","#ea580c","#65a30d","#0ea5e9",
    "#f59e0b","#6366f1","#ec4899","#14b8a6","#8b5cf6",
  ];
  var hash = 0;
  for (var i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

export function modelGlyph(str) {
  if (state.modelsMeta && state.modelsMeta[str] && state.modelsMeta[str].glyph) {
    return state.modelsMeta[str].glyph;
  }
  var glyphs = ["⬡","◈","◇","✕","◬","▲","●","◆","■","△","✦","✪","✴","○","◐","◑","▶","►","◄","◅"];
  var hash = 0;
  for (var i = 0; i < str.length; i++) hash = (hash * 17 + str.charCodeAt(i)) & 0xffffffff;
  return glyphs[Math.abs(hash) % glyphs.length];
}

export function modelName(id) {
  if (state.modelsMeta && state.modelsMeta[id] && state.modelsMeta[id].name) {
    return state.modelsMeta[id].name;
  }
  return id
    .replace(/_/g, " ")
    .replace(/\b(\w)/g, function(c){ return c.toUpperCase(); })
    .replace(/Gpt/g, "GPT")
    .replace(/Ai\b/g, "AI")
    .replace(/(\d+)b\b/gi, "$1B");
}

export function modelMaker(modelString) {
  // Try to find metadata by matching the model string to a known ID
  if (state.modelsMeta) {
    for (var id in state.modelsMeta) {
      if (state.modelsMeta[id].provider && modelString && modelString.indexOf(state.modelsMeta[id].provider + "/") === 0) {
        return state.modelsMeta[id].providerName;
      }
    }
  }
  var makers = {
    "openai": "OpenAI", "anthropic": "Anthropic", "google": "Google",
    "x-ai": "xAI", "mistralai": "Mistral", "meta-llama": "Meta",
    "deepseek": "DeepSeek", "qwen": "Alibaba", "nvidia": "NVIDIA",
    "microsoft": "Microsoft", "openrouter": "OpenRouter", "cohere": "Cohere",
    "moonshotai": "Moonshot", "allenai": "AllenAI", "arcee-ai": "Arcee",
    "cognitivecomputations": "Cognitive", "undi95": "Undi95",
    "huggingfaceh4": "HuggingFace", "gryphe": "Gryphe", "thudm": "THUDM",
    "opengvlab": "OpenGVLab",
  };
  var prefix = (modelString || "").split("/")[0].toLowerCase();
  return makers[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export function createBlindMapping(modelIds) {
  var labels = modelIds.map(function(_, i) { return "model_" + String.fromCharCode(97 + i); });
  var shuffled = labels.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
  }
  var mapping = {};
  var reversed = {};
  modelIds.forEach(function(id, idx) {
    mapping[shuffled[idx]] = id;
    reversed[id] = shuffled[idx];
  });
  return { mapping: mapping, reversed: reversed };
}

export function swapKeys(obj, mapping) {
  if (!obj || typeof obj !== "object") return obj;
  var out = {};
  Object.keys(obj).forEach(function(k) {
    out[mapping[k] || k] = obj[k];
  });
  return out;
}

export function getBlindLabel(modelId) {
  if (!state.blindMode || state.blindRevealed) return modelName(modelId);
  var anon = state.blindReversed && state.blindReversed[modelId];
  if (!anon) return modelName(modelId);
  return "Model " + anon.replace("model_", "").toUpperCase();
}

export function getBlindGlyph(modelId) {
  if (!state.blindMode || state.blindRevealed) return modelGlyph(modelId);
  var anon = state.blindReversed && state.blindReversed[modelId];
  if (!anon) return modelGlyph(modelId);
  return "?";
}

export function getBlindMaker() {
  if (!state.blindMode || state.blindRevealed) return undefined;
  return "hidden";
}

export function refreshPageToken() {
  if (state.tokenRefreshPromise) return state.tokenRefreshPromise;
  state.tokenRefreshPromise = fetch("/api/config")
    .then(function(r) { return r.json(); })
    .then(function(cfg) { if (cfg && cfg._token) state.pageToken = cfg._token; })
    .catch(function() {})
    .finally(function() { state.tokenRefreshPromise = null; });
  return state.tokenRefreshPromise;
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

export function shitTier(score) {
  // score is internal penalty (0-100, higher = worse).
  // Display labels describe the *quality* so the user sees higher = better.
  var quality = 100 - score;
  if (quality >= 80) return { label: "GOOD",        color: "#22c55e" };
  if (quality >= 60) return { label: "OK",          color: "#84cc16" };
  if (quality >= 40) return { label: "AVERAGE",     color: "#eab308" };
  if (quality >= 20) return { label: "BAD",         color: "#f97316" };
  return              { label: "TERRIBLE",     color: "#ef4444" };
}

export function detectSymptoms(text) {
  var l = text.toLowerCase();
  return SYMPTOMS.filter(function(s) { return s.test(l, text); });
}

export function calcShitScore(text) {
  var syms = detectSymptoms(text);
  var base = syms.reduce(function(s, x) { return s + x.weight; }, 0);
  var hash = 0;
  for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) & 0xffffffff;
  var fuzz = Math.abs(hash) % 12;
  return Math.min(base + fuzz, 99);
}

export function categorizeClientError(message, upstreamStatus) {
  var text = String(message || "").toLowerCase();
  var status = Number(upstreamStatus || 0);
  if (status === 408 || /timeout|timed out|abort/.test(text)) return "timeout";
  if (status === 429 || /rate limit|too many requests/.test(text)) return "rate_limit";
  if (status >= 500 || /server error|upstream failed|gateway|overloaded/.test(text)) return "upstream_5xx";
  if (status >= 400 || /invalid|bad request|unauthorized|forbidden|not found/.test(text)) return "upstream_4xx";
  if (/network|fetch failed|socket|econn/.test(text)) return "network";
  return "unknown";
}

export function setDisplay(id, value) {
  var el = document.getElementById(id);
  if (el) el.style.display = value;
}

export function showError(msg) {
  var el = document.getElementById("errorBanner");
  el.textContent = "Warning: " + msg;
  el.style.display = "block";
}

export function updateChar() {
  var v = document.getElementById("promptInput").value;
  document.getElementById("charCount").textContent = v.length + "/1500";
  document.getElementById("fireBtn").disabled = !v.trim();
  document.getElementById("errorBanner").style.display = "none";
}

export function typewrite(elId, text, speed) {
  speed = speed || 6;
  var el = document.getElementById(elId);
  if (!el) return;
  el.textContent = "";
  var i = 0;
  var iv = setInterval(function() {
    if (i < text.length) { el.textContent = text.slice(0, ++i); }
    else clearInterval(iv);
  }, speed);
}

// Convenience computed booleans
export const isRunPage = !!state.runPagePath;
export const isModelProfilePage = !!state.modelProfilePath;
