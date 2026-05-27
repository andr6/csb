function parseAllowedOrigins(value) {
  var origins = String(value || "")
    .split(",")
    .map(function(origin) { return origin.trim(); })
    .filter(Boolean);
  // Auto-include the www counterpart so https://example.com also allows
  // https://www.example.com and vice versa — avoids silent CORS failures.
  var expanded = [];
  origins.forEach(function(o) {
    expanded.push(o);
    try {
      var u = new URL(o);
      var h = u.hostname;
      var port = u.port ? ":" + u.port : "";
      if (h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return;
      if (h.startsWith("www.")) {
        expanded.push(u.protocol + "//" + h.slice(4) + port);
      } else {
        expanded.push(u.protocol + "//www." + h + port);
      }
    } catch (_) {}
  });
  return expanded.filter(function(o, i) { return expanded.indexOf(o) === i; });
}

function parsePositiveNumber(value) {
  var parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseModelPricing(env) {
  var pricing = {};
  Object.keys(env).forEach(function(key) {
    if (/^MODEL_PRICE_[A-Z0-9_]+(?:_USD)?$/.test(key)) {
      var id = key
        .replace(/^MODEL_PRICE_/, "")
        .replace(/_USD$/, "")
        .toLowerCase();
      var price = parsePositiveNumber(env[key]);
      if (price !== null) {
        pricing[id] = price;
      }
    }
  });
  return pricing;
}

const PORT = Number(process.env.PORT || 3000);
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 60000);
const CONTESTANT_TIMEOUT_MS = Number(process.env.CONTESTANT_TIMEOUT_MS || 60000);
const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS || 45000);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const ANALYTICS_PAGE_PASSWORD = String(process.env.ANALYTICS_PAGE_PASSWORD || "").trim();
const WEBHOOK_URL = String(process.env.WEBHOOK_URL || "").trim();
const DAILY_CHALLENGE_PROMPT = String(process.env.DAILY_CHALLENGE_PROMPT || "").trim();
const JUDGE_RUNS = Math.max(1, Math.min(5, Number(process.env.JUDGE_RUNS || 1)));

const KEYS = {
  openrouter: process.env.OPENROUTER_API_KEY || "",
  anthropic: process.env.ANTHROPIC_API_KEY || "",
  openai: process.env.OPENAI_API_KEY || "",
  gemini: process.env.GEMINI_API_KEY || "",
  litellm: process.env.LITELLM_API_KEY || "",
};

const JUDGE_KEYS = {
  openrouter: process.env.JUDGE_OPENROUTER_API_KEY || KEYS.openrouter,
  anthropic: process.env.JUDGE_ANTHROPIC_API_KEY || KEYS.anthropic,
  openai: process.env.JUDGE_OPENAI_API_KEY || KEYS.openai,
  gemini: process.env.JUDGE_GEMINI_API_KEY || KEYS.gemini,
  litellm: process.env.LITELLM_API_KEY || KEYS.litellm,
};

const JUDGE_PROVIDER = (process.env.JUDGE_PROVIDER || "anthropic").toLowerCase();
const JUDGE_MODEL = process.env.JUDGE_MODEL || "anthropic/claude-sonnet-4-5";
const LITELLM_BASE = process.env.LITELLM_BASE_URL || "http://localhost:4000";
const CONTESTANT_PROVIDER = (process.env.CONTESTANT_PROVIDER || "openrouter").toLowerCase();

const MODEL_CATALOGUE = {};
Object.keys(process.env).forEach(function(key) {
  if (/^MODEL_[A-Z0-9_]+$/.test(key)) {
    var id = key.replace(/^MODEL_/, "").toLowerCase();
    var value = process.env[key];
    if (!value || typeof value !== "string" || value.trim().length === 0) {
      console.warn("[config] Skipping empty model env var:", key);
      return;
    }
    if (value.indexOf("/") === -1) {
      console.warn("[config] Skipping model env var without provider prefix:", key, "=", value);
      return;
    }
    MODEL_CATALOGUE[id] = value.trim();
  }
});

var ACTIVE_MODELS;
if (process.env.ACTIVE_MODELS) {
  ACTIVE_MODELS = process.env.ACTIVE_MODELS
    .split(",")
    .map(function(value) { return value.trim().toLowerCase(); })
    .filter(function(id) { return MODEL_CATALOGUE[id]; });
} else {
  ACTIVE_MODELS = Object.keys(MODEL_CATALOGUE).sort();
}

const MODEL_MAP = {};
ACTIVE_MODELS.forEach(function(id) {
  MODEL_MAP[id] = MODEL_CATALOGUE[id];
});

const VALID_MODELS = Object.keys(MODEL_MAP);
// Per-model contestant timeout overrides — format: MODEL_TIMEOUT_NEMOTRON=30000
const MODEL_TIMEOUTS = {};
Object.keys(process.env).forEach(function(key) {
  var m = key.match(/^MODEL_TIMEOUT_([A-Z0-9_]+)$/);
  if (m) {
    var id = m[1].toLowerCase();
    var ms = Number(process.env[key]);
    if (Number.isFinite(ms) && ms > 0) MODEL_TIMEOUTS[id] = ms;
  }
});

const MODEL_PRICING_USD = parseModelPricing(process.env);
const JUDGE_PRICE_USD = parsePositiveNumber(process.env.JUDGE_PRICE_USD);
const ANALYTICS_BUDGETS = {
  sliceUsd: parsePositiveNumber(process.env.ANALYTICS_SLICE_BUDGET_USD),
  dailyUsd: parsePositiveNumber(process.env.ANALYTICS_DAILY_BUDGET_USD),
  monthlyUsd: parsePositiveNumber(process.env.ANALYTICS_MONTHLY_BUDGET_USD),
};
const ANALYTICS_POLICY = {
  minReliabilityPct: parsePositiveNumber(process.env.ANALYTICS_POLICY_MIN_RELIABILITY_PCT) !== null
    ? parsePositiveNumber(process.env.ANALYTICS_POLICY_MIN_RELIABILITY_PCT)
    : 90,
  maxUnitCostUsd: parsePositiveNumber(process.env.ANALYTICS_POLICY_MAX_UNIT_COST_USD) !== null
    ? parsePositiveNumber(process.env.ANALYTICS_POLICY_MAX_UNIT_COST_USD)
    : 0.5,
  minScorePerDollar: parsePositiveNumber(process.env.ANALYTICS_POLICY_MIN_SCORE_PER_DOLLAR) !== null
    ? parsePositiveNumber(process.env.ANALYTICS_POLICY_MIN_SCORE_PER_DOLLAR)
    : 100,
  minAvgScore: parsePositiveNumber(process.env.ANALYTICS_POLICY_MIN_AVG_SCORE) !== null
    ? parsePositiveNumber(process.env.ANALYTICS_POLICY_MIN_AVG_SCORE)
    : 60,
};

module.exports = {
  PORT: PORT,
  HTTP_TIMEOUT_MS: HTTP_TIMEOUT_MS,
  CONTESTANT_TIMEOUT_MS: CONTESTANT_TIMEOUT_MS,
  JUDGE_TIMEOUT_MS: JUDGE_TIMEOUT_MS,
  ALLOWED_ORIGINS: ALLOWED_ORIGINS,
  ANALYTICS_PAGE_PASSWORD: ANALYTICS_PAGE_PASSWORD,
  KEYS: KEYS,
  JUDGE_KEYS: JUDGE_KEYS,
  JUDGE_PROVIDER: JUDGE_PROVIDER,
  JUDGE_MODEL: JUDGE_MODEL,
  LITELLM_BASE: LITELLM_BASE,
  CONTESTANT_PROVIDER: CONTESTANT_PROVIDER,
  MODEL_CATALOGUE: MODEL_CATALOGUE,
  MODEL_MAP: MODEL_MAP,
  VALID_MODELS: VALID_MODELS,
  MODEL_TIMEOUTS: MODEL_TIMEOUTS,
  MODEL_PRICING_USD: MODEL_PRICING_USD,
  JUDGE_PRICE_USD: JUDGE_PRICE_USD,
  ANALYTICS_BUDGETS: ANALYTICS_BUDGETS,
  ANALYTICS_POLICY: ANALYTICS_POLICY,
  WEBHOOK_URL: WEBHOOK_URL,
  DAILY_CHALLENGE_PROMPT: DAILY_CHALLENGE_PROMPT,
  JUDGE_RUNS: JUDGE_RUNS,
  parseAllowedOrigins: parseAllowedOrigins,
  parsePositiveNumber: parsePositiveNumber,
  parseModelPricing: parseModelPricing,
};
