const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const crypto = require("crypto");

const {
  CONTESTANT_PROVIDER,
  JUDGE_PROVIDER,
  JUDGE_MODEL,
  MODEL_MAP,
  ALLOWED_ORIGINS,
  MAIL_HOST,
  MAIL_PORT,
  MAIL_USER,
  MAIL_PASS,
  MAIL_FROM,
  SMS_API_KEY,
  ADMIN_EMAIL,
  PAGE_TOKEN_SECRET,
} = require("./lib/config");
require("./lib/config").validateSecrets();
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
const { createRequireAdminAccess } = require("./lib/middleware/requireAdminAuth");
const { createLeaderboardService } = require("./lib/leaderboard");
const { validatePageToken: _validatePageToken } = require("./lib/fireHelpers");
const { createRateLimiters, tryCreateStore } = require("./lib/rateLimiters");
const logger = require("./lib/logger");
const nodemailer = require("nodemailer");

const { createAuthRouter } = require("./routes/auth");
const { createFireRouter } = require("./routes/fire");
const { createRunsRouter } = require("./routes/runs");
const { createJudgeRouter } = require("./routes/judge");
const { createChallengeRouter } = require("./routes/challenge");
const { createAnalyticsRouter } = require("./routes/analytics");
const { createPromptsRouter } = require("./routes/prompts");
const { createTournamentRouter } = require("./routes/tournament");
const { createAdminRouter } = require("./routes/admin");
const { createHealthRouter } = require("./routes/health");
const { createConfigRouter } = require("./routes/config");
const { createRunRouter } = require("./routes/run");

// ── Daily call circuit breaker (SQLite-backed, survives restarts) ─────────────
const { dailyTryIncrement } = require("./lib/dailyLimits");

// ── Page token ─ gates /api/fire and /api/judge to visitors who loaded the page ──
const PAGE_TOKEN_TTL_S = 86400;

function generatePageToken() {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", PAGE_TOKEN_SECRET).update(String(ts)).digest("hex");
  return ts + "." + sig;
}

// Rejects requests whose Origin header doesn't match ALLOWED_ORIGINS.
// For mutating methods (POST, PUT, DELETE, PATCH) the Origin header is
// required — browsers always send it on cross-origin POSTs, so a missing
// Origin is treated as a non-browser client and rejected.
function requireKnownOrigin(req, res, next) {
  if (!ALLOWED_ORIGINS.length) return next();
  const origin = req.headers["origin"];
  if (origin !== undefined) {
    if (!isAllowedOrigin(origin)) return res.status(403).json({ error: "Forbidden." });
    return next();
  }
  // Origin is undefined. For safe methods we allow it (same-origin GETs,
  // direct curl without Origin, etc.). For mutating methods we require it.
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
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

  // Auth wiring
  const userRepo = deps.userRepository || createUserRepository();
  const otpRepo = deps.otpRepository || createOtpRepository();
  const sessionRepo = deps.sessionRepository || createSessionRepository();
  const resetRepo = deps.passwordResetRepository || createPasswordResetRepository();
  const authMw = deps.authMiddleware || createAuthMiddleware({ userRepository: userRepo, sessionRepository: sessionRepo });

  // Deprecation warning: ANALYTICS_PAGE_PASSWORD is no longer used
  if (process.env.ANALYTICS_PAGE_PASSWORD) {
    console.warn("[deprecated] ANALYTICS_PAGE_PASSWORD is no longer used. Analytics requires admin login.");
  }

  // Admin user seed — one-time setup with signed URL (no raw password in stdout)
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

  // Admin auth middleware — Bearer token admin sessions only.
  // ⚠️ NEVER chain this with authMw.requireAuth on the same route.
  const requireAdminAuth = createRequireAdminAccess({
    sessionRepository: sessionRepo,
    userRepository: userRepo,
    adminEmail: ADMIN_EMAIL,
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
  app.use(cookieParser());
  app.set("trust proxy", 1);

  // Request ID — correlation ID for tracing
  app.use(function(req, res, next) {
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    next();
  });

  // Structured request logging
  app.use(function(req, res, next) {
    var start = Date.now();
    res.on("finish", function() {
      logger.info(req.method + " " + req.path, {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip,
      });
    });
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
  app.get("/analytics", authFailLimiter, requireAdminAuth, sendIndex);
  app.use(function(req, res, next) {
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/.test(req.path)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
    next();
  });
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
    publicLimiter,
    fireLimiter,
    requireKnownOrigin,
    dailyTryIncrement,
    listBottomAnalysisRunsByScore: deps.listBottomAnalysisRunsByScore || analysisRunServices.listBottomAnalysisRunsByScore,
  }));

  app.use(createRunsRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAuth,
    publicLimiter,
  }));

  app.use(createJudgeRouter({
    ...deps,
    authMiddleware: authMw,
    judgeLimiter,
    requireKnownOrigin,
    dailyTryIncrement,
    invalidateAnalyticsCaches,
  }));

  app.use(createChallengeRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAuth,
  }));

  app.use(createAnalyticsRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAuth,
    _analyticsCache,
    _failuresCache,
  }));

  app.use(createPromptsRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAuth,
    publicLimiter,
    tryCreateStore,
  }));

  app.use(createTournamentRouter({
    ...deps,
    authMiddleware: authMw,
    publicLimiter,
    validatePageToken: _validatePageToken,
    dailyTryIncrement: dailyTryIncrement,
  }));

  app.use(createHealthRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAuth,
    checkProviderHealth: deps.checkProviderHealth || providerServices.checkProviderHealth,
  }));

  app.use(createRunRouter({ getAnalysisRun }));

  app.use(createAdminRouter({
    ...deps,
    authMiddleware: authMw,
    requireAdminAuth,
    publicLimiter,
  }));

  app.all("/api/*", function(req, res) {
    res.status(404).json({ error: "Not found." });
  });

  app.get("*", function(req, res) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

// Standalone admin seed — call from server.js after createApp(), not inside the factory.
async function seedAdminUser() {
  if (process.env.NODE_ENV === "test") return;
  const { ADMIN_EMAIL } = require("./lib/config");
  const { createUserRepository } = require("./lib/repositories/userRepository");
  const { runSqlParams, queryJsonParams } = require("./lib/sqlite");
  const authService = require("./lib/authService");
  const userRepo = createUserRepository();

  const existing = userRepo.findByEmail(ADMIN_EMAIL);
  if (existing) return;

  // Check if setup was already completed
  try {
    const setupRows = queryJsonParams("SELECT value FROM app_settings WHERE key = ?", ["admin_setup_complete"]);
    if (setupRows.length && setupRows[0].value === "1") return;
  } catch (e) {
    // app_settings may not exist yet — migration will create it
  }

  const generatedPassword = require("crypto").randomBytes(8).toString("hex");
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
    "UPDATE users SET email_verified = 1, phone_verified = 1, first_login_completed = 1, updated_at = ? WHERE id = ?",
    [now, userId]
  );

  // Store hash in app_settings so password can be rotated without re-printing
  runSqlParams(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
    ["admin_password_hash", passwordHash]
  );

  // Generate one-time setup token with HMAC signature
  const setupToken = require("crypto").randomBytes(16).toString("hex");
  const setupSig = require("crypto").createHmac("sha256", process.env.SETUP_SECRET || PAGE_TOKEN_SECRET).update(setupToken).digest("hex");
  const setupUrl = "/admin-setup?t=" + setupToken + "&s=" + setupSig;

  console.log("=".repeat(60));
  console.log("ADMIN USER CREATED");
  console.log("Email:    " + ADMIN_EMAIL);
  console.log("One-time setup URL: " + setupUrl);
  console.log("=".repeat(60));
  console.log(JSON.stringify({ type: "security", event: "admin_user_seeded", userId: userId }));
}

module.exports = { createApp, seedAdminUser };
