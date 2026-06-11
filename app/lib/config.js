const crypto = require("crypto");

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
const WEBHOOK_URL = String(process.env.WEBHOOK_URL || "").trim();
const DAILY_CHALLENGE_PROMPT = String(process.env.DAILY_CHALLENGE_PROMPT || "").trim();
const JUDGE_RUNS = Math.max(1, Math.min(5, Number(process.env.JUDGE_RUNS || 1)));

// ── Auth configuration ────────────────────────────────────────────────────────
const OTP_PEPPER = String(process.env.OTP_PEPPER || "csb-default-pepper-change-me");
const BCRYPT_ROUNDS = Math.max(10, Math.min(16, Number(process.env.BCRYPT_ROUNDS || 12)));
const OTP_MAX_ATTEMPTS = Math.max(3, Math.min(10, Number(process.env.OTP_MAX_ATTEMPTS || 5)));
const OTP_EXPIRY_MINUTES = Math.max(5, Math.min(30, Number(process.env.OTP_EXPIRY_MINUTES || 10)));
const SESSION_EXPIRY_HOURS = Math.max(1, Math.min(168, Number(process.env.SESSION_EXPIRY_HOURS || 24)));
const ACCOUNT_LOCKOUT_MINUTES = Math.max(15, Math.min(120, Number(process.env.ACCOUNT_LOCKOUT_MINUTES || 30)));

const MAIL_HOST = String(process.env.MAIL_HOST || "").trim();
const MAIL_PORT = Number(process.env.MAIL_PORT || 587);
const MAIL_USER = String(process.env.MAIL_USER || "").trim();
const MAIL_PASS = String(process.env.MAIL_PASS || "").trim();
const MAIL_FROM = String(process.env.MAIL_FROM || "").trim();

const SMS_API_KEY = String(process.env.SMS_API_KEY || "").trim();

// ── OAuth configuration ───────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const FACEBOOK_APP_ID = String(process.env.FACEBOOK_APP_ID || "").trim();
const FACEBOOK_APP_SECRET = String(process.env.FACEBOOK_APP_SECRET || "").trim();
const OAUTH_REDIRECT_BASE = String(process.env.OAUTH_REDIRECT_BASE || "").trim();

const ADMIN_EMAIL = "admin@csb.local";

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
const JUDGE_PANEL = (process.env.JUDGE_PANEL || "").split(",").map(function(s) { return s.trim(); }).filter(Boolean);
const LITELLM_BASE = process.env.LITELLM_BASE_URL || "http://localhost:4000";
const CONTESTANT_PROVIDER = (process.env.CONTESTANT_PROVIDER || "openrouter").toLowerCase();

const MODEL_CATALOGUE = {};
Object.keys(process.env).forEach(function(key) {
  // Fast-path reject: avoid regex on every env var
  if (!key.startsWith("MODEL_")) return;
  if (!/^MODEL_[A-Z0-9_]+$/.test(key)) return;
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

const ACTIVE_MODEL_IDS = Object.keys(MODEL_MAP);
const VALID_MODELS = ACTIVE_MODEL_IDS; // deprecated alias — kept for backward compat

// ── Model metadata (backend-owned, decouples frontend from hardcoded maps) ───
const _DEFAULT_PROVIDER_NAMES = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google",
  "x-ai": "xAI", mistralai: "Mistral", "meta-llama": "Meta",
  deepseek: "DeepSeek", qwen: "Alibaba", nvidia: "NVIDIA",
  cohere: "Cohere", openrouter: "OpenRouter",
};

function _deriveModelMeta(id, fullModel) {
  var parts = fullModel.split("/");
  var provider = parts[0] || "";
  var modelName = parts.slice(1).join("/") || "";
  // Derive a readable name from the model path: gpt-4o → GPT-4o, claude-sonnet-4 → Claude Sonnet 4
  var derivedName = modelName
    .replace(/-/g, " ")
    .replace(/\b\w/g, function(c) { return c.toUpperCase(); })
    .trim();
  if (!derivedName) derivedName = id;
  return {
    id: id,
    name: derivedName,
    provider: provider,
    providerName: _DEFAULT_PROVIDER_NAMES[provider] || provider.charAt(0).toUpperCase() + provider.slice(1),
    color: null,
    glyph: null,
  };
}

const MODEL_METADATA = {};
ACTIVE_MODEL_IDS.forEach(function(id) {
  var fullModel = MODEL_MAP[id];
  var meta = _deriveModelMeta(id, fullModel);
  var envName = process.env["MODEL_" + id.toUpperCase() + "_NAME"];
  var envColor = process.env["MODEL_" + id.toUpperCase() + "_COLOR"];
  var envGlyph = process.env["MODEL_" + id.toUpperCase() + "_GLYPH"];
  if (envName) meta.name = envName.trim();
  if (envColor) meta.color = envColor.trim();
  if (envGlyph) meta.glyph = envGlyph.trim();
  MODEL_METADATA[id] = meta;
});

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

// ── Secret validation ─────────────────────────────────────────────────────────
function validateSecrets() {
  var required = [
    { name: "SESSION_SECRET", minLen: 32 },
    { name: "PAGE_TOKEN_SECRET", minLen: 32 },
    { name: "RESET_SECRET", minLen: 32 },
  ];
  required.forEach(function(item) {
    var value = process.env[item.name];
    if (!value || String(value).length < item.minLen) {
      var generated = crypto.randomBytes(32).toString("hex");
      process.env[item.name] = generated;
      console.warn(
        "[security] " + item.name + " was missing or too short. Auto-generated a secure value. " +
        "Set it in .env for persistence across restarts."
      );
    }
  });
}
validateSecrets();

const SESSION_SECRET = process.env.SESSION_SECRET;
const PAGE_TOKEN_SECRET = process.env.PAGE_TOKEN_SECRET;
const RESET_SECRET = process.env.RESET_SECRET;

module.exports = {
  PORT: PORT,
  HTTP_TIMEOUT_MS: HTTP_TIMEOUT_MS,
  CONTESTANT_TIMEOUT_MS: CONTESTANT_TIMEOUT_MS,
  JUDGE_TIMEOUT_MS: JUDGE_TIMEOUT_MS,
  ALLOWED_ORIGINS: ALLOWED_ORIGINS,
  KEYS: KEYS,
  JUDGE_KEYS: JUDGE_KEYS,
  JUDGE_PROVIDER: JUDGE_PROVIDER,
  JUDGE_MODEL: JUDGE_MODEL,
  JUDGE_PANEL: JUDGE_PANEL,
  LITELLM_BASE: LITELLM_BASE,
  CONTESTANT_PROVIDER: CONTESTANT_PROVIDER,
  MODEL_CATALOGUE: MODEL_CATALOGUE,
  MODEL_MAP: MODEL_MAP,
  ACTIVE_MODEL_IDS: ACTIVE_MODEL_IDS,
  VALID_MODELS: VALID_MODELS,
  MODEL_METADATA: MODEL_METADATA,
  MODEL_TIMEOUTS: MODEL_TIMEOUTS,
  MODEL_PRICING_USD: MODEL_PRICING_USD,
  JUDGE_PRICE_USD: JUDGE_PRICE_USD,
  ANALYTICS_BUDGETS: ANALYTICS_BUDGETS,
  ANALYTICS_POLICY: ANALYTICS_POLICY,
  WEBHOOK_URL: WEBHOOK_URL,
  DAILY_CHALLENGE_PROMPT: DAILY_CHALLENGE_PROMPT,
  JUDGE_RUNS: JUDGE_RUNS,
  ADMIN_EMAIL: ADMIN_EMAIL,
  OTP_PEPPER: OTP_PEPPER,
  BCRYPT_ROUNDS: BCRYPT_ROUNDS,
  OTP_MAX_ATTEMPTS: OTP_MAX_ATTEMPTS,
  OTP_EXPIRY_MINUTES: OTP_EXPIRY_MINUTES,
  SESSION_EXPIRY_HOURS: SESSION_EXPIRY_HOURS,
  ACCOUNT_LOCKOUT_MINUTES: ACCOUNT_LOCKOUT_MINUTES,
  MAIL_HOST: MAIL_HOST,
  MAIL_PORT: MAIL_PORT,
  MAIL_USER: MAIL_USER,
  MAIL_PASS: MAIL_PASS,
  MAIL_FROM: MAIL_FROM,
  SMS_API_KEY: SMS_API_KEY,
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET,
  FACEBOOK_APP_ID: FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET: FACEBOOK_APP_SECRET,
  OAUTH_REDIRECT_BASE: OAUTH_REDIRECT_BASE,
  SESSION_SECRET: SESSION_SECRET,
  PAGE_TOKEN_SECRET: PAGE_TOKEN_SECRET,
  RESET_SECRET: RESET_SECRET,
  parseAllowedOrigins: parseAllowedOrigins,
  parsePositiveNumber: parsePositiveNumber,
  parseModelPricing: parseModelPricing,
  validateSecrets: validateSecrets,
};
