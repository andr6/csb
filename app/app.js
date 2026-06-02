const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");

const {
  CONTESTANT_PROVIDER,
  JUDGE_PROVIDER,
  JUDGE_MODEL,
  MODEL_MAP,
  ANALYTICS_PAGE_PASSWORD,
  ALLOWED_ORIGINS,
  MAIL_HOST,
  MAIL_PORT,
  MAIL_USER,
  MAIL_PASS,
  MAIL_FROM,
  SMS_API_KEY,
  ADMIN_EMAIL,
} = require("./lib/config");
const { buildCorsOptions, isAllowedOrigin } = require("./lib/cors");
const modelServices = require("./lib/models");
const providerServices = require("./lib/providers");
const judgeServices = require("./lib/judge");
const { PACKS } = require("./lib/packs");
const historyServices = require("./lib/history");
const analysisRunServices = require("./lib/analysisRuns");
const metricsServices = require("./lib/metrics");
const { notifyWebhook } = require("./lib/webhook");
const { createTtlCache } = require("./lib/cache");
const { runSqlParams } = require("./lib/sqlite");
const { createUserRepository } = require("./lib/repositories/userRepository");
const { createOtpRepository } = require("./lib/repositories/otpRepository");
const { createSessionRepository } = require("./lib/repositories/sessionRepository");
const { createPasswordResetRepository } = require("./lib/repositories/passwordResetRepository");
const authService = require("./lib/authService");
const { createAuthMiddleware } = require("./lib/middleware/authMiddleware");
const { createRequireAdminAccess } = require("./lib/middleware/requireAdminAccess");
const { createLeaderboardService } = require("./lib/leaderboard");
const { createRateLimiters, tryCreateStore } = require("./lib/rateLimiters");
const nodemailer = require("nodemailer");

const { createAuthRouter } = require("./routes/auth");
const { createFireRouter } = require("./routes/fire");
const { createAnalyticsRouter } = require("./routes/analytics");
const { createPromptsRouter } = require("./routes/prompts");
const { createTournamentRouter } = require("./routes/tournament");
const { createHealthRouter } = require("./routes/health");
const { createConfigRouter } = require("./routes/config");
const { createRunRouter } = require("./routes/run");

// ── Daily call circuit breaker ────────────────────────────────────────────────
const DAILY_FIRE_LIMIT  = process.env.MAX_DAILY_FIRE_CALLS  ? Number(process.env.MAX_DAILY_FIRE_CALLS)  : 0;
const DAILY_JUDGE_LIMIT = process.env.MAX_DAILY_JUDGE_CALLS ? Number(process.env.MAX_DAILY_JUDGE_CALLS) : 0;
let _daily = { day: "", fire: 0, judge: 0 };

function _dailyReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (_daily.day !== today) _daily = { day: today, fire: 0, judge: 0 };
}
function dailyLimitExceeded(type) {
  _dailyReset();
  if (type === "fire"  && DAILY_FIRE_LIMIT  && _daily.fire  >= DAILY_FIRE_LIMIT)  return true;
  if (type === "judge" && DAILY_JUDGE_LIMIT && _daily.judge >= DAILY_JUDGE_LIMIT) return true;
  return false;
}
function dailyIncrement(type) { _dailyReset(); _daily[type] = (_daily[type] || 0) + 1; }

// ── Page token ─ gates /api/fire and /api/judge to visitors who loaded the page ──
const PAGE_TOKEN_SECRET = process.env.PAGE_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const PAGE_TOKEN_TTL_S = 86400;

function generatePageToken() {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", PAGE_TOKEN_SECRET).update(String(ts)).digest("hex");
  return ts + "." + sig;
}

function validatePageToken(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const ts = Number(token.slice(0, dot));
  if (!ts || isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > PAGE_TOKEN_TTL_S) return false;
  if (ts > now + 60) return false;
  const expected = crypto.createHmac("sha256", PAGE_TOKEN_SECRET).update(String(ts)).digest("hex");
  const eBuf = Buffer.from(expected, "hex");
  const aBuf = Buffer.from(token.slice(dot + 1), "hex");
  return eBuf.length === aBuf.length && crypto.timingSafeEqual(eBuf, aBuf);
}

// Rejects requests to mutating endpoints whose Origin/Referer doesn't match
function requireKnownOrigin(req, res, next) {
  if (!ALLOWED_ORIGINS.length) return next();
  const origin = req.headers["origin"];
  if (origin !== undefined) {
    if (!isAllowedOrigin(origin)) return res.status(403).json({ error: "Forbidden." });
    return next();
  }
  const referer = req.headers["referer"] || "";
  if (referer && !ALLOWED_ORIGINS.some(function(o) { return referer.startsWith(o); })) {
    return res.status(403).json({ error: "Forbidden." });
  }
  next();
}

function createApp(overrides) {
  const deps = overrides || {};
  const app = express();
  app.disable("x-powered-by");
  const getVoice = deps.getVoice || modelServices.getVoice;
  const readHistory = deps.readHistory || historyServices.readHistory;
  const listAnalysisRuns = deps.listAnalysisRuns || analysisRunServices.listAnalysisRuns;
  const countAnalysisRuns = deps.countAnalysisRuns || analysisRunServices.countAnalysisRuns;
  const addAnalysisRun = deps.addAnalysisRun || analysisRunServices.addAnalysisRun;
  const getAnalysisRun = deps.getAnalysisRun || analysisRunServices.getAnalysisRun;
  const metrics = deps.metrics || metricsServices.defaultStore;
  const notifyWebhookFn = deps.notifyWebhook || notifyWebhook;
  const analyticsPagePassword = deps.analyticsPagePassword !== undefined
    ? String(deps.analyticsPagePassword || "")
    : ANALYTICS_PAGE_PASSWORD;

  // Auth wiring
  const userRepo = deps.userRepository || createUserRepository();
  const otpRepo = deps.otpRepository || createOtpRepository();
  const sessionRepo = deps.sessionRepository || createSessionRepository();
  const resetRepo = deps.passwordResetRepository || createPasswordResetRepository();
  const authMw = deps.authMiddleware || (process.env.NODE_ENV === "test"
    ? { requireAuth: function(req, res, next) { next(); }, requirePhoneVerified: function(req, res, next) { next(); }, requireCustomModeAccess: function(req, res, next) { next(); } }
    : createAuthMiddleware({ userRepository: userRepo, sessionRepository: sessionRepo }));

  // Admin user seed — one-time setup with signed URL (no raw password in stdout)
  async function seedAdminUser() {
    if (process.env.NODE_ENV === "test") return;
    const existing = userRepo.findByEmail(ADMIN_EMAIL);
    if (existing) return;

    // Check if setup was already completed
    try {
      const { queryJsonParams } = require("./lib/sqlite");
      const setupRows = queryJsonParams("SELECT value FROM app_settings WHERE key = ?", ["admin_setup_complete"]);
      if (setupRows.length && setupRows[0].value === "1") return;
    } catch (e) {
      // app_settings may not exist yet — migration will create it
    }

    const generatedPassword = crypto.randomBytes(8).toString("hex");
    const passwordHash = await authService.hashPassword(generatedPassword);
    const userId = userRepo.createUser({
      fullName: "admin",
      email: ADMIN_EMAIL,
      phone: "+10000000000",
      passwordHash: passwordHash,
    });
    if (!userId) { console.error("[auth] Failed to seed admin user"); return; }
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET email_verified = 1, phone_verified = 1, first_login_completed = 1, custom_mode_access_enabled = 1, updated_at = ? WHERE id = ?",
      [now, userId]
    );

    // Store hash in app_settings so password can be rotated without re-printing
    runSqlParams(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      ["admin_password_hash", passwordHash]
    );

    // Generate one-time setup token with HMAC signature
    const setupToken = crypto.randomBytes(16).toString("hex");
    const setupSig = crypto.createHmac("sha256", process.env.SETUP_SECRET || PAGE_TOKEN_SECRET).update(setupToken).digest("hex");
    const setupUrl = "/admin-setup?t=" + setupToken + "&s=" + setupSig;

    console.log("=".repeat(60));
    console.log("ADMIN USER CREATED");
    console.log("Email:    " + ADMIN_EMAIL);
    console.log("One-time setup URL: " + setupUrl);
    console.log("=".repeat(60));
    console.log(JSON.stringify({ type: "security", event: "admin_user_seeded", userId: userId }));
  }
  if (process.env.NODE_ENV !== "test") {
    seedAdminUser().catch(function(e) { console.error("[auth] Admin user seed failed:", e.message); });
  }

  // Email / SMS OTP transport
  let emailTransporter = null;
  if (MAIL_HOST && MAIL_USER && MAIL_PASS) {
    try {
      emailTransporter = nodemailer.createTransport({
        host: MAIL_HOST, port: MAIL_PORT, secure: MAIL_PORT === 465,
        auth: { user: MAIL_USER, pass: MAIL_PASS },
      });
    } catch (e) { console.error("[auth] Email transport init failed:", e.message); }
  }
  async function sendEmailOtp(email, otp) {
    if (!emailTransporter) { console.log("[auth] Mock email OTP to", email, ":", otp); return { ok: true, mock: true }; }
    try {
      await emailTransporter.sendMail({
        from: MAIL_FROM || MAIL_USER, to: email,
        subject: "Your Chat Shit Bob verification code",
        text: "Your verification code is: " + otp + "\nThis code expires in 10 minutes.",
        html: "<p>Your verification code is: <strong>" + otp + "</strong></p><p>This code expires in 10 minutes.</p>",
      });
      return { ok: true };
    } catch (e) { console.error("[auth] Email send failed:", e.message); return { ok: false, error: e.message }; }
  }
  async function sendSmsOtp(phone, otp) {
    if (!SMS_API_KEY) { console.log("[auth] Mock SMS OTP to", phone, ":", otp); return { ok: true, mock: true }; }
    console.log("[auth] SMS OTP to", phone, ":", otp);
    return { ok: true };
  }

  // Leaderboard
  const leaderboardService = createLeaderboardService({ readHistory, listTopAnalysisRunsByScore: deps.listTopAnalysisRunsByScore || analysisRunServices.listTopAnalysisRunsByScore });

  function sendIndex(req, res) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }

  // Analytics auth middleware
  const requireAdminAccess = createRequireAdminAccess({
    sessionRepository: sessionRepo,
    userRepository: userRepo,
    adminEmail: ADMIN_EMAIL,
    analyticsPagePassword: analyticsPagePassword,
  });

  // Rate limiters
  const {
    fireLimiter, judgeLimiter, configLimiter, publicLimiter,
    authFailLimiter, registerLimiter, loginLimiter,
    otpVerifyLimiter, otpResendLimiter,
  } = createRateLimiters();

  // Analytics caches
  const _analyticsCache = createTtlCache({ ttlMs: 30000 });
  const _failuresCache = createTtlCache({ ttlMs: 30000 });

  function invalidateAnalyticsCaches() {
    _analyticsCache.clear();
    _failuresCache.clear();
  }

  // Middleware
  app.use(express.json({ limit: "100kb" }));
  app.set("trust proxy", 1);

  // Request ID — correlation ID for tracing
  app.use(function(req, res, next) {
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    next();
  });

  app.use(function(req, res, next) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
    next();
  });
  app.use(function(req, res, next) {
    const started = Date.now();
    res.on("finish", function() {
      const durationMs = Date.now() - started;
      metricsServices.recordRequest(metrics, req, res, durationMs);
      console.log(JSON.stringify({
        type: "request",
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: durationMs,
      }));
    });
    next();
  });
  app.use(cors(buildCorsOptions()));
  app.get("/", sendIndex);
  app.get("/analytics", authFailLimiter, requireAdminAccess, sendIndex);
  app.use(express.static(path.join(__dirname, "public")));

  // Route modules
  app.use(createConfigRouter({
    ...deps,
    configLimiter,
    generatePageToken,
    sessionRepository: sessionRepo,
    userRepository: userRepo,
    ADMIN_EMAIL,
  }));

  app.use(createAuthRouter({
    ...deps,
    authMiddleware: authMw,
    sendEmailOtp,
    sendSmsOtp,
    emailTransporter,
    registerLimiter,
    loginLimiter,
    otpVerifyLimiter,
    otpResendLimiter,
    authFailLimiter,
    publicLimiter,
    requireKnownOrigin,
    runSqlParams,
    MAIL_FROM,
    MAIL_USER,
    ADMIN_EMAIL,
  }));

  app.use(createFireRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAccess,
    fireLimiter,
    judgeLimiter,
    publicLimiter,
    requireKnownOrigin,
    dailyLimitExceeded,
    dailyIncrement,
    invalidateAnalyticsCaches,
  }));

  app.use(createAnalyticsRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAccess,
    _analyticsCache,
    _failuresCache,
  }));

  app.use(createPromptsRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAccess,
    publicLimiter,
    tryCreateStore,
  }));

  app.use(createTournamentRouter({
    ...deps,
    authMiddleware: authMw,
    publicLimiter,
  }));

  app.use(createHealthRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAccess,
    checkProviderHealth: deps.checkProviderHealth || providerServices.checkProviderHealth,
  }));

  app.use(createRunRouter({ getAnalysisRun }));

  app.all("/api/*", function(req, res) {
    res.status(404).json({ error: "Not found." });
  });

  app.get("*", function(req, res) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

module.exports = { createApp };
