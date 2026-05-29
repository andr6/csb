const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const {
  CONTESTANT_PROVIDER,
  JUDGE_PROVIDER,
  JUDGE_MODEL,
  MODEL_MAP,
  VALID_MODELS,
  ANALYTICS_PAGE_PASSWORD,
  KEYS,
  DAILY_CHALLENGE_PROMPT,
  JUDGE_RUNS,
  WEBHOOK_URL,
  ALLOWED_ORIGINS,
  OTP_PEPPER,
  BCRYPT_ROUNDS,
  OTP_MAX_ATTEMPTS,
  OTP_EXPIRY_MINUTES,
  SESSION_EXPIRY_HOURS,
  ACCOUNT_LOCKOUT_MINUTES,
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
const { validatePrompt } = require("./lib/validation");
const { normalizeFilterOptions } = require("./lib/filterOptions");
const judgeServices = require("./lib/judge");
const { PACKS, getPack } = require("./lib/packs");
const VALID_CRITERIA_KEYS = judgeServices.VALID_CRITERIA_KEYS;
const historyServices = require("./lib/history");
const analysisRunServices = require("./lib/analysisRuns");
const listTopAnalysisRunsByScore = analysisRunServices.listTopAnalysisRunsByScore;
const getAnalysisRun = analysisRunServices.getAnalysisRun;
const metricsServices = require("./lib/metrics");
const { createRateLimitStore } = require("./lib/rateLimitStore");
const { notifyWebhook } = require("./lib/webhook");
const { createTtlCache } = require("./lib/cache");
const pendingPrompts = require("./lib/repositories/pendingPromptsRepository");
const { runSqlParams } = require("./lib/sqlite");
const { createUserRepository } = require("./lib/repositories/userRepository");
const { createOtpRepository } = require("./lib/repositories/otpRepository");
const { createSessionRepository } = require("./lib/repositories/sessionRepository");
const { createPasswordResetRepository } = require("./lib/repositories/passwordResetRepository");
const authService = require("./lib/authService");
const { createAuthMiddleware } = require("./lib/middleware/authMiddleware");
const nodemailer = require("nodemailer");

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

// ── Page token — gates /api/fire and /api/judge to visitors who loaded the page ──
const PAGE_TOKEN_SECRET = process.env.PAGE_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const PAGE_TOKEN_TTL_S = 86400; // 24 hours

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

// Rejects requests to mutating endpoints whose Origin/Referer doesn't match the
// configured ALLOWED_ORIGINS. No-op when ALLOWED_ORIGINS is unset (dev/test).
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
  const callContestant = deps.callContestant || providerServices.callContestant;
  const callJudge = deps.callJudge || providerServices.callJudge;
  const checkProviderHealth = deps.checkProviderHealth || providerServices.checkProviderHealth;
  const judgeRunsOverride = deps.judgeRuns;
  const buildJudgePrompt = deps.buildJudgePrompt || judgeServices.buildJudgePrompt;
  const computeMedianScores = deps.computeMedianScores || judgeServices.computeMedianScores;
  const parseJudgeResponse = deps.parseJudgeResponse || judgeServices.parseJudgeResponse;
  const normalizeJudgePayload = deps.normalizeJudgePayload || judgeServices.normalizeJudgePayload;
  const readHistory = deps.readHistory || historyServices.readHistory;
  const getHistoryStats = deps.getHistoryStats || historyServices.getHistoryStats;
  const listAnalysisRuns = deps.listAnalysisRuns || analysisRunServices.listAnalysisRuns;
  const countAnalysisRuns = deps.countAnalysisRuns || analysisRunServices.countAnalysisRuns;
  const getAnalysisRun = deps.getAnalysisRun || analysisRunServices.getAnalysisRun;
  const addAnalysisRun = deps.addAnalysisRun || analysisRunServices.addAnalysisRun;
  const getAnalysisRunStats = deps.getAnalysisRunStats || analysisRunServices.getAnalysisRunStats;
  const getAnalysisFailureSummary = deps.getAnalysisFailureSummary || analysisRunServices.getAnalysisFailureSummary;
  const getAnalysisAnalytics = deps.getAnalysisAnalytics || analysisRunServices.getAnalysisAnalytics;
  const historyStorageType = deps.historyStorageType || historyServices.storageType;
  const runStorageType = deps.runStorageType || analysisRunServices.storageType;
  const metrics = deps.metrics || metricsServices.defaultStore;
  const notifyWebhookFn = deps.notifyWebhook || notifyWebhook;
  const analyticsPagePassword = deps.analyticsPagePassword !== undefined
    ? String(deps.analyticsPagePassword || "")
    : ANALYTICS_PAGE_PASSWORD;

  // ── Auth wiring ─────────────────────────────────────────────────────────────
  const userRepo = deps.userRepository || createUserRepository();
  const otpRepo = deps.otpRepository || createOtpRepository();
  const sessionRepo = deps.sessionRepository || createSessionRepository();
  const resetRepo = deps.passwordResetRepository || createPasswordResetRepository();
  const authMw = deps.authMiddleware || (process.env.NODE_ENV === "test"
    ? { requireAuth: function(req, res, next) { next(); }, requirePhoneVerified: function(req, res, next) { next(); }, requireCustomModeAccess: function(req, res, next) { next(); } }
    : createAuthMiddleware({ userRepository: userRepo, sessionRepository: sessionRepo }));

  // ── Admin user seed ─────────────────────────────────────────────────────────
  async function seedAdminUser() {
    if (process.env.NODE_ENV === "test") return;
    const existing = userRepo.findByEmail(ADMIN_EMAIL);
    if (existing) return;

    const generatedPassword = crypto.randomBytes(8).toString("hex");
    const passwordHash = await authService.hashPassword(generatedPassword);
    const userId = userRepo.createUser({
      fullName: "admin",
      email: ADMIN_EMAIL,
      phone: "+10000000000",
      passwordHash: passwordHash,
    });
    if (!userId) {
      console.error("[auth] Failed to seed admin user");
      return;
    }
    const now = new Date().toISOString();
    runSqlParams(
      "UPDATE users SET email_verified = 1, phone_verified = 1, first_login_completed = 1, custom_mode_access_enabled = 1, updated_at = ? WHERE id = ?",
      [now, userId]
    );
    console.log("=".repeat(60));
    console.log("ADMIN USER CREATED");
    console.log("Email:    " + ADMIN_EMAIL);
    console.log("Password: " + generatedPassword);
    console.log("=".repeat(60));
    console.log(JSON.stringify({ type: "security", event: "admin_user_seeded", userId: userId }));
  }
  if (process.env.NODE_ENV !== "test") {
    seedAdminUser().catch(function(e) {
      console.error("[auth] Admin user seed failed:", e.message);
    });
  }

  let emailTransporter = null;
  if (MAIL_HOST && MAIL_USER && MAIL_PASS) {
    try {
      emailTransporter = nodemailer.createTransport({
        host: MAIL_HOST,
        port: MAIL_PORT,
        secure: MAIL_PORT === 465,
        auth: { user: MAIL_USER, pass: MAIL_PASS },
      });
    } catch (e) {
      console.error("[auth] Email transport init failed:", e.message);
    }
  }

  async function sendEmailOtp(email, otp) {
    if (!emailTransporter) {
      console.log("[auth] Mock email OTP to", email, ":", otp);
      return { ok: true, mock: true };
    }
    try {
      await emailTransporter.sendMail({
        from: MAIL_FROM || MAIL_USER,
        to: email,
        subject: "Your Chat Shit Bob verification code",
        text: "Your verification code is: " + otp + "\nThis code expires in 10 minutes.",
        html: "<p>Your verification code is: <strong>" + otp + "</strong></p><p>This code expires in 10 minutes.</p>",
      });
      return { ok: true };
    } catch (e) {
      console.error("[auth] Email send failed:", e.message);
      return { ok: false, error: e.message };
    }
  }

  async function sendSmsOtp(phone, otp) {
    if (!SMS_API_KEY) {
      console.log("[auth] Mock SMS OTP to", phone, ":", otp);
      return { ok: true, mock: true };
    }
    // SMS gateway integration placeholder
    console.log("[auth] SMS OTP to", phone, ":", otp);
    return { ok: true };
  }

  function isDisplayableLeaderboardAnswer(answer) {
    var text = String(answer || "").trim();
    if (!text) return false;
    if (/^\[error:/i.test(text)) return false;
    if (/failed:/i.test(text)) return false;
    if (/timed out/i.test(text)) return false;
    return true;
  }

  function getLeaderboardItems() {
    const topRuns = (deps.listTopAnalysisRunsByScore || listTopAnalysisRunsByScore)(20)
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

    const rawHistoryItems = readHistory(20);
    return Array.isArray(rawHistoryItems)
      ? rawHistoryItems.filter(function(item) {
          return item && item.modelId;
        }).slice(0, 10)
      : [];
  }

  function sendIndex(req, res) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }

  function analyticsAuth(req, res, next) {
    const authHeader = String(req.headers.authorization || "");

    // Bearer path: admin session grants analytics access
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const session = sessionRepo.findByTokenHash(tokenHash);
        if (session) {
          const user = userRepo.findById(session.user_id);
          if (user && user.email === ADMIN_EMAIL) {
            req.user = { id: user.id, email: user.email, fullName: user.full_name };
            return next();
          }
        }
      }
    }

    // Basic path: shared analytics password
    if (!analyticsPagePassword) {
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Analytics password required. Set ANALYTICS_PAGE_PASSWORD in .env.");
    }

    if (!authHeader.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Analytics password required.");
    }

    let decoded = "";
    try {
      decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    } catch (error) {
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Invalid analytics credentials.");
    }

    const separatorIndex = decoded.indexOf(":");
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";
    const bufA = Buffer.from(password);
    const bufB = Buffer.from(analyticsPagePassword);
    const valid = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    if (!valid) {
      // Always compare to prevent length-based timing leak
      if (bufA.length !== bufB.length) crypto.timingSafeEqual(bufB, bufB);
      res.setHeader("WWW-Authenticate", 'Basic realm="CSB Analytics"');
      return res.status(401).send("Invalid analytics credentials.");
    }

    next();
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

  function buildFailureRun(prompt, responses, meta, phase, error, rawJudge) {
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
      contestantProvider: CONTESTANT_PROVIDER,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      timings: meta.timings,
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

  function tryCreateStore(name) {
    if (process.env.NODE_ENV === "test") return undefined;
    try { return createRateLimitStore(name); } catch (e) { return undefined; }
  }

  const fireLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    store: tryCreateStore("fire"),
    message: { error: "Too many requests. Slow down." },
  });

  const judgeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 6,
    store: tryCreateStore("judge"),
    message: { error: "Too many judge requests. Slow down." },
  });

  // Tight limit on /api/config — it hands out page tokens; slow down token farming
  const configLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    store: tryCreateStore("config"),
    message: { error: "Too many requests." },
  });

  // Light limit on public read-only endpoints to deter scraping
  const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    store: tryCreateStore("publicread"),
    message: { error: "Too many requests. Slow down." },
  });

  // Counts only failed auth attempts (skipSuccessfulRequests) — brute-force protection
  const authFailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    skipSuccessfulRequests: true,
    store: tryCreateStore("authfail"),
    message: { error: "Too many failed login attempts. Try again in 15 minutes." },
  });

  // ── Auth rate limiters ────────────────────────────────────────────────────────
  const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    store: tryCreateStore("register"),
    message: { error: "Too many registration attempts. Try again in 15 minutes." },
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    store: tryCreateStore("login"),
    message: { error: "Too many failed login attempts. Try again in 15 minutes." },
  });

  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    store: tryCreateStore("otpverify"),
    message: { error: "Too many verification attempts. Try again in 15 minutes." },
  });

  const otpResendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    store: tryCreateStore("otpresend"),
    message: { error: "Too many resend attempts. Try again in 15 minutes." },
  });

  app.use(express.json({ limit: "100kb" }));
  app.set("trust proxy", 1);
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
  app.get("/analytics", authFailLimiter, analyticsAuth, sendIndex);
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/config", configLimiter, async function(req, res) {
    const authHeader = String(req.headers.authorization || "");
    let user = null;
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const session = sessionRepo.findByTokenHash(tokenHash);
      if (session) {
        const u = userRepo.findById(session.user_id);
        if (u) {
          user = {
            id: u.id,
            email: u.email,
            fullName: u.full_name,
            emailVerified: Boolean(u.email_verified),
            phoneVerified: Boolean(u.phone_verified),
            firstLoginCompleted: Boolean(u.first_login_completed),
            customModeEnabled: Boolean(u.custom_mode_access_enabled),
            isAdmin: u.email === ADMIN_EMAIL,
          };
        }
      }
    }
    res.json({
      contestantProvider: CONTESTANT_PROVIDER,
      models: MODEL_MAP,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      packs: Object.values(PACKS).map(function(p) {
        return { id: p.id, name: p.name, tagline: p.tagline, teaser: p.teaser || "", persona: p.persona || "" };
      }),
      criteria: judgeServices.SCORING_CRITERIA.map(function(c) { return { key: c.key, label: c.label }; }),
      redteamCriteria: judgeServices.REDTEAM_CRITERIA.map(function(c) { return { key: c.key, label: c.label }; }),
      _token: deps.generatePageToken ? deps.generatePageToken() : generatePageToken(),
      user: user,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  //  Auth endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  app.post("/api/auth/register", registerLimiter, requireKnownOrigin, async function(req, res) {
    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!authService.validateName(fullName)) {
      return res.status(400).json({ error: authService.getNamePolicyError() });
    }
    if (!authService.validateEmail(email)) {
      return res.status(400).json({ error: authService.getEmailPolicyError() });
    }
    if (!authService.validatePhone(phone)) {
      return res.status(400).json({ error: authService.getPhonePolicyError() });
    }
    if (!authService.validatePasswordPolicy(password)) {
      return res.status(400).json({ error: authService.getPasswordPolicyError() });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const existing = userRepo.findByEmail(email);
    if (existing) {
      // Prevent enumeration: return generic success
      return res.json({ ok: true, message: "If this email is not registered, check your inbox for a verification code." });
    }

    const passwordHash = await authService.hashPassword(password);
    const normalizedPhone = authService.normalizePhone(phone);
    const userId = userRepo.createUser({ fullName, email, phone: normalizedPhone, passwordHash });
    if (!userId) {
      return res.status(500).json({ error: "Registration failed. Please try again." });
    }

    const otp = authService.generateOtp();
    const otpHash = authService.hashOtp(otp);
    const expiresAt = authService.getOtpExpiryDate();
    otpRepo.createOtp({ userId, type: "email_verification", hash: otpHash, expiresAt });

    await sendEmailOtp(email, otp);
    res.json({ ok: true, message: "Registration successful. Check your inbox for a verification code." });
  });

  app.post("/api/auth/verify-email", otpVerifyLimiter, requireKnownOrigin, async function(req, res) {
    const email = String(req.body.email || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();

    if (!authService.validateEmail(email)) {
      return res.status(400).json({ error: authService.getEmailPolicyError() });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "Enter a 6-digit code." });
    }

    const user = userRepo.findByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    const validOtp = otpRepo.findValidOtp(user.id, "email_verification");
    if (!validOtp) {
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    otpRepo.incrementAttempts(validOtp.id);
    if (!authService.verifyOtp(otp, validOtp.otp_hash)) {
      if (validOtp.attempts_count + 1 >= authService.getOtpMaxAttempts()) {
        otpRepo.consumeOtp(validOtp.id);
        console.log(JSON.stringify({ type: "security", event: "otp_exhausted", userId: user.id, otpType: "email" }));
      }
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    otpRepo.consumeOtp(validOtp.id);
    userRepo.markEmailVerified(user.id);

    // Auto-login after email verification
    const token = authService.generateSessionToken();
    const tokenHash = authService.hashToken(token);
    const sessionExpiry = authService.getSessionExpiryDate();
    sessionRepo.createSession({ userId: user.id, tokenHash, expiresAt: sessionExpiry });

    res.json({
      ok: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        emailVerified: true,
        phoneVerified: Boolean(user.phone_verified),
        firstLoginCompleted: Boolean(user.first_login_completed),
        customModeEnabled: Boolean(user.custom_mode_access_enabled),
      },
    });
  });

  app.post("/api/auth/resend-email-otp", otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!authService.validateEmail(email)) {
      return res.status(400).json({ error: authService.getEmailPolicyError() });
    }

    const user = userRepo.findByEmail(email);
    if (!user || user.email_verified) {
      return res.json({ ok: true, message: "If this account exists and requires verification, a new code has been sent." });
    }

    otpRepo.pruneExpired();
    const otp = authService.generateOtp();
    const otpHash = authService.hashOtp(otp);
    const expiresAt = authService.getOtpExpiryDate();
    otpRepo.createOtp({ userId: user.id, type: "email_verification", hash: otpHash, expiresAt });

    await sendEmailOtp(email, otp);
    res.json({ ok: true, message: "A new verification code has been sent." });
  });

  app.post("/api/auth/login", loginLimiter, requireKnownOrigin, async function(req, res) {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!authService.validateEmail(email)) {
      return res.status(400).json({ error: authService.getEmailPolicyError() });
    }

    const user = userRepo.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    if (authService.isAccountLocked(user.account_locked_until)) {
      console.log(JSON.stringify({ type: "security", event: "account_locked_login", userId: user.id }));
      return res.status(403).json({ error: "Account temporarily locked due to too many failed attempts." });
    }

    const valid = await authService.verifyPassword(password, user.password_hash);
    if (!valid) {
      userRepo.incrementFailedLogin(user.id);
      const updated = userRepo.findById(user.id);
      if (updated && updated.failed_login_attempts >= 5) {
        const lockout = authService.getLockoutUntil();
        userRepo.lockAccount(user.id, lockout);
        console.log(JSON.stringify({ type: "security", event: "account_lock", userId: user.id, attempts: updated.failed_login_attempts }));
      }
      return res.status(401).json({ error: "Invalid credentials." });
    }

    if (!user.email_verified) {
      return res.status(403).json({ error: "Email not verified. Please verify your email first." });
    }

    userRepo.updateLastLogin(user.id);
    sessionRepo.deleteByUser(user.id);

    const token = authService.generateSessionToken();
    const tokenHash = authService.hashToken(token);
    const sessionExpiry = authService.getSessionExpiryDate();
    sessionRepo.createSession({ userId: user.id, tokenHash, expiresAt: sessionExpiry });

    res.json({
      ok: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        emailVerified: Boolean(user.email_verified),
        phoneVerified: Boolean(user.phone_verified),
        firstLoginCompleted: Boolean(user.first_login_completed),
        customModeEnabled: Boolean(user.custom_mode_access_enabled),
      },
    });
  });

  app.post("/api/auth/logout", authMw.requireAuth, async function(req, res) {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.slice(7).trim();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    sessionRepo.deleteByTokenHash(tokenHash);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", authMw.requireAuth, async function(req, res) {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        emailVerified: req.user.emailVerified,
        phoneVerified: req.user.phoneVerified,
        firstLoginCompleted: req.user.firstLoginCompleted,
        customModeEnabled: req.user.customModeEnabled,
        isAdmin: req.user.email === ADMIN_EMAIL,
      },
    });
  });

  app.post("/api/auth/verify-phone", authMw.requireAuth, otpVerifyLimiter, requireKnownOrigin, async function(req, res) {
    const otp = String(req.body.otp || "").trim();
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "Enter a 6-digit code." });
    }

    const userId = req.user.id;
    const validOtp = otpRepo.findValidOtp(userId, "phone_verification");
    if (!validOtp) {
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    otpRepo.incrementAttempts(validOtp.id);
    if (!authService.verifyOtp(otp, validOtp.otp_hash)) {
      if (validOtp.attempts_count + 1 >= authService.getOtpMaxAttempts()) {
        otpRepo.consumeOtp(validOtp.id);
        console.log(JSON.stringify({ type: "security", event: "otp_exhausted", userId: userId, otpType: "phone" }));
      }
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    otpRepo.consumeOtp(validOtp.id);
    userRepo.markPhoneVerified(userId);
    userRepo.updateFirstLogin(userId);
    userRepo.enableCustomMode(userId);

    // Issue fresh session token reflecting phone_verified = true
    sessionRepo.deleteByUser(userId);
    const freshToken = authService.generateSessionToken();
    const freshTokenHash = authService.hashToken(freshToken);
    const sessionExpiry = authService.getSessionExpiryDate();
    sessionRepo.createSession({ userId, tokenHash: freshTokenHash, expiresAt: sessionExpiry });

    console.log(JSON.stringify({ type: "security", event: "phone_verified", userId: userId }));

    res.json({
      ok: true,
      token: freshToken,
      message: "Phone verified. Custom Mode is now available.",
      user: {
        id: userId,
        email: req.user.email,
        fullName: req.user.fullName,
        emailVerified: req.user.emailVerified,
        phoneVerified: true,
        firstLoginCompleted: true,
        customModeEnabled: true,
      },
    });
  });

  app.post("/api/auth/resend-phone-otp", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const userId = req.user.id;
    const user = userRepo.findById(userId);
    if (!user || user.phone_verified) {
      return res.json({ ok: true, message: "Phone already verified." });
    }

    otpRepo.pruneExpired();
    const otp = authService.generateOtp();
    const otpHash = authService.hashOtp(otp);
    const expiresAt = authService.getOtpExpiryDate();
    otpRepo.createOtp({ userId, type: "phone_verification", hash: otpHash, expiresAt });

    await sendSmsOtp(user.phone_number, otp);
    console.log(JSON.stringify({ type: "security", event: "phone_otp_resend", userId: userId }));
    res.json({ ok: true, message: "A new verification code has been sent." });
  });

  // ── Update email ────────────────────────────────────────────────────────────
  app.post("/api/auth/update-email", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const userId = req.user.id;
    const user = userRepo.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const newEmail = String(req.body.email || "").trim().toLowerCase();
    if (!authService.validateEmail(newEmail)) {
      return res.status(400).json({ error: authService.getEmailPolicyError() });
    }

    const existing = userRepo.findByEmail(newEmail);
    if (existing && existing.id !== userId) {
      return res.json({ ok: true, message: "If this email is available, it has been updated." });
    }

    runSqlParams("UPDATE users SET email = ?, updated_at = ? WHERE id = ?", [newEmail, new Date().toISOString(), userId]);
    console.log(JSON.stringify({ type: "security", event: "email_updated", userId: userId }));

    // If user was already verified, mark unverified and require re-validation
    if (user.email_verified) {
      userRepo.markEmailUnverified(userId);
      // Invalidate all existing sessions so user must re-verify
      sessionRepo.deleteByUser(userId);
      console.log(JSON.stringify({ type: "security", event: "email_unverified_for_change", userId: userId }));
    }

    // Send email OTP
    otpRepo.pruneExpired();
    const otp = authService.generateOtp();
    const otpHash = authService.hashOtp(otp);
    const expiresAt = authService.getOtpExpiryDate();
    otpRepo.createOtp({ userId, type: "email_verification", hash: otpHash, expiresAt });
    await sendEmailOtp(newEmail, otp);

    res.json({ ok: true, message: "Email updated. A verification code has been sent to confirm the new address." });
  });

  // ── Update phone ──────────────────────────────────────────────────────────────
  app.post("/api/auth/update-phone", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const userId = req.user.id;
    const user = userRepo.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const newPhone = String(req.body.phone || "").trim();
    if (!authService.validatePhone(newPhone)) {
      return res.status(400).json({ error: authService.getPhonePolicyError() });
    }

    const normalizedPhone = authService.normalizePhone(newPhone);
    runSqlParams("UPDATE users SET phone_number = ?, updated_at = ? WHERE id = ?", [normalizedPhone, new Date().toISOString(), userId]);
    console.log(JSON.stringify({ type: "security", event: "phone_updated", userId: userId }));

    // If user was already verified, mark unverified and require re-validation
    if (user.phone_verified) {
      userRepo.markPhoneUnverified(userId);
      console.log(JSON.stringify({ type: "security", event: "phone_unverified_for_change", userId: userId }));
    }

    // Send phone OTP
    otpRepo.pruneExpired();
    const otp = authService.generateOtp();
    const otpHash = authService.hashOtp(otp);
    const expiresAt = authService.getOtpExpiryDate();
    otpRepo.createOtp({ userId, type: "phone_verification", hash: otpHash, expiresAt });
    await sendSmsOtp(normalizedPhone, otp);

    res.json({ ok: true, message: "Phone updated. A verification code has been sent to confirm the new number." });
  });

  // ── Change password ─────────────────────────────────────────────────────────
  app.post("/api/auth/change-password", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const userId = req.user.id;
    const user = userRepo.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required." });
    }
    if (!authService.validatePasswordPolicy(newPassword)) {
      return res.status(400).json({ error: authService.getPasswordPolicyError() });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match." });
    }

    const valid = await authService.verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }

    const passwordHash = await authService.hashPassword(newPassword);
    userRepo.updatePasswordHash(userId, passwordHash);
    // Invalidate all sessions except current
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      sessionRepo.deleteByUser(userId);
      // Re-create current session
      const sessionExpiry = authService.getSessionExpiryDate();
      sessionRepo.createSession({ userId, tokenHash, expiresAt: sessionExpiry });
    } else {
      sessionRepo.deleteByUser(userId);
    }

    console.log(JSON.stringify({ type: "security", event: "password_changed", userId: userId }));
    res.json({ ok: true, message: "Password updated successfully." });
  });

  // ── Update name ─────────────────────────────────────────────────────────────
  app.post("/api/auth/update-name", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const userId = req.user.id;
    const user = userRepo.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const newName = String(req.body.name || "").trim();
    if (!authService.validateName(newName)) {
      return res.status(400).json({ error: authService.getNamePolicyError() });
    }

    userRepo.updateName(userId, newName);
    console.log(JSON.stringify({ type: "security", event: "name_updated", userId: userId }));
    res.json({ ok: true, message: "Name updated successfully.", name: newName });
  });

  // ── Forgot password ───────────────────────────────────────────────────────
  app.post("/api/auth/forgot-password", otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!authService.validateEmail(email)) {
      return res.status(400).json({ error: authService.getEmailPolicyError() });
    }

    const user = userRepo.findByEmail(email);
    if (!user || !user.email_verified) {
      // Generic response to prevent enumeration
      return res.json({ ok: true, message: "If this account exists, a password reset link has been sent." });
    }

    resetRepo.pruneExpired();
    const resetToken = authService.generateSessionToken();
    const resetHash = authService.hashToken(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    resetRepo.createToken({ userId: user.id, tokenHash: resetHash, expiresAt });

    // Log event with no sensitive data
    console.log(JSON.stringify({ type: "security", event: "password_reset_requested", userId: user.id }));

    // Mock email send (real would use nodemailer)
    if (emailTransporter) {
      try {
        await emailTransporter.sendMail({
          from: MAIL_FROM || MAIL_USER,
          to: email,
          subject: "Password reset request",
          text: "A password reset was requested. Use this token: " + resetToken + "\nThis token expires in 1 hour.",
        });
      } catch (e) {
        console.error("[auth] Password reset email failed:", e.message);
      }
    } else {
      console.log("[auth] Mock password reset email to", email, ": token =", resetToken);
    }

    res.json({ ok: true, message: "If this account exists, a password reset link has been sent." });
  });

  // ── Reset password ────────────────────────────────────────────────────────
  app.post("/api/auth/reset-password", otpVerifyLimiter, requireKnownOrigin, async function(req, res) {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!token) return res.status(400).json({ error: "Reset token required." });
    if (!authService.validatePasswordPolicy(password)) {
      return res.status(400).json({ error: authService.getPasswordPolicyError() });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const tokenHash = authService.hashToken(token);
    const resetRow = resetRepo.findValidByHash(tokenHash);
    if (!resetRow) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    const user = userRepo.findById(resetRow.user_id);
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    const passwordHash = await authService.hashPassword(password);
    runSqlParams("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [passwordHash, new Date().toISOString(), user.id]);

    // Invalidate all sessions and reset tokens
    resetRepo.consumeToken(resetRow.id);
    sessionRepo.deleteByUser(user.id);

    console.log(JSON.stringify({ type: "security", event: "password_reset_completed", userId: user.id }));

    res.json({ ok: true, message: "Password updated. Please log in with your new password." });
  });

  app.get("/api/history", publicLimiter, authMw.requireAuth, function(req, res) {
    res.json({
      items: getLeaderboardItems(),
    });
  });

  // Protected prompt endpoints — require valid page token so prompts are only
  // accessible to clients that loaded the app through /api/config.
  function requirePageToken(req, res, next) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }
    next();
  }

  app.get("/api/pack-prompts", publicLimiter, authMw.requireAuth, requirePageToken, function(req, res) {
    const filePath = path.join(__dirname, "lib", "prompts", "pack-prompts.json");
    try {
      const data = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    } catch (e) {
      res.status(500).json({ error: "Prompt data unavailable." });
    }
  });

  app.get("/api/mode-prompts", publicLimiter, authMw.requireAuth, requirePageToken, function(req, res) {
    const filePath = path.join(__dirname, "lib", "prompts", "mode-prompts.json");
    try {
      const data = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    } catch (e) {
      res.status(500).json({ error: "Prompt data unavailable." });
    }
  });

  app.get("/api/runs", authMw.requireAuth, analyticsAuth, function(req, res) {
    const filters = buildRunFilters(req.query);
    res.json({
      items: listAnalysisRuns(filters),
      total: countAnalysisRuns(filters),
    });
  });

  app.get("/api/runs/export", authMw.requireAuth, analyticsAuth, function(req, res) {
    const filters = buildRunFilters(req.query);
    const format = String(req.query.format || "json").toLowerCase();
    const items = listAnalysisRuns({
      ...filters,
      limit: Math.min(500, Number(req.query.limit || 100)),
      offset: req.query.offset || 0,
    });
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"csb-runs-export.csv\"");
      return res.send(toRunsCsv(items));
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"csb-runs-export.json\"");
    res.send(JSON.stringify({ items: items, total: items.length, exportedAt: new Date().toISOString() }, null, 2));
  });

  app.get("/api/runs/:id", authMw.requireAuth, analyticsAuth, function(req, res) {
    const item = getAnalysisRun(req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Run not found." });
    }
    res.json(item);
  });

  app.get("/api/failures/summary", authMw.requireAuth, analyticsAuth, function(req, res) {
    var filters = buildRunFilters(req.query);
    var cacheKey = JSON.stringify(filters);
    var cached = _failuresCache.get(cacheKey);
    if (cached !== undefined) {
      return res.json(cached);
    }
    var result = getAnalysisFailureSummary(filters);
    _failuresCache.set(cacheKey, result);
    res.json(result);
  });

  app.get("/api/analytics", authMw.requireAuth, analyticsAuth, function(req, res) {
    var filters = buildRunFilters(req.query);
    var cacheKey = JSON.stringify(filters);
    var cached = _analyticsCache.get(cacheKey);
    if (cached !== undefined) {
      return res.json(cached);
    }
    var result = getAnalysisAnalytics(filters);
    _analyticsCache.set(cacheKey, result);
    res.json(result);
  });

  app.post("/api/fire", fireLimiter, authMw.requireAuth, requireKnownOrigin, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    if ((deps.dailyLimitExceeded || dailyLimitExceeded)("fire")) {
      return res.status(503).json({ error: "Daily request limit reached. Try again tomorrow." });
    }

    const prompt = req.body.prompt;
    const modelId = req.body.modelId;
    const packId = req.body.pack || "bar";

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    if (!VALID_MODELS.includes(modelId)) {
      return res.status(400).json({ error: "Invalid model ID." });
    }

    try {
      (deps.dailyIncrement || dailyIncrement)("fire");
      const response = await callContestant(modelId, getVoice(modelId, packId), prompt);
      res.json({
        modelId: modelId,
        model: MODEL_MAP[modelId],
        response: response || "...nothing. Which is a response in itself.",
      });
    } catch (e) {
      console.error("[fire] " + modelId + " via " + CONTESTANT_PROVIDER + ":", e.message);
      const category = categorizeError(e.message, e.upstreamStatus, "fire");
      const safe = {
        timeout: "Model timed out.",
        rate_limit: "Model rate limited — try again shortly.",
        upstream_5xx: "Model provider error.",
        network: "Could not reach the model.",
      }[category] || "Model failed.";
      res.status(500).json({ error: safe, modelId: modelId });
    }
  });

  app.post("/api/judge", judgeLimiter, authMw.requireAuth, requireKnownOrigin, async function(req, res) {
    const validateToken = deps.validatePageToken || validatePageToken;
    if (!validateToken(req.headers["x-page-token"])) {
      return res.status(403).json({ error: "Forbidden." });
    }

    if ((deps.dailyLimitExceeded || dailyLimitExceeded)("judge")) {
      return res.status(503).json({ error: "Daily request limit reached. Try again tomorrow." });
    }

    const prompt = req.body.prompt;
    const responses = req.body.responses;
    const meta = req.body.meta && typeof req.body.meta === "object" ? req.body.meta : {};
    const rawCriteria = req.body.criteria;
    const criteria = Array.isArray(rawCriteria)
      ? rawCriteria.filter(function(k) { return VALID_CRITERIA_KEYS.indexOf(k) !== -1; })
      : null;
    const activePackId = req.body.pack || "bar";
    const activePack = getPack(activePackId);
    const activeJudgePrompt = deps.judgeSystemPrompt || activePack.judgeSystemPrompt;

    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    if (!responses || typeof responses !== "object") {
      return res.status(400).json({ error: "Responses object required." });
    }

    // Strip error responses — models that failed shouldn't be judged
    const cleanResponses = Object.fromEntries(
      Object.entries(responses).filter(function(entry) {
        var v = entry[1];
        return typeof v === "string" && v.trim().length > 0 && !v.startsWith("[Error:");
      })
    );
    if (Object.keys(cleanResponses).length === 0) {
      return res.status(400).json({ error: "No successful model responses to judge." });
    }

    const judgeRuns = judgeRunsOverride !== undefined ? Number(judgeRunsOverride) : JUDGE_RUNS;

    try {
      const judgePrompt = buildJudgePrompt(prompt, cleanResponses, criteria || undefined);
      const rawResults = await Promise.all(
        Array.from({ length: judgeRuns }, function() {
          return callJudge(activeJudgePrompt, judgePrompt);
        })
      );

      const responseKeys = Object.keys(cleanResponses);
      const parsedResults = rawResults.map(function(raw) {
        return normalizeJudgePayload(parseJudgeResponse(raw), responseKeys);
      });
      const raw = rawResults[0];

      try {
        const payload = judgeRuns > 1 ? computeMedianScores(parsedResults, responseKeys) : parsedResults[0];
        const willNotify = deps.notifyWebhook !== undefined || !!WEBHOOK_URL;
        const prevTopRun = willNotify ? (deps.listTopAnalysisRunsByScore || listTopAnalysisRunsByScore)(1)[0] : null;
        const prevCrownModelId = prevTopRun ? prevTopRun.crownModelId : null;
        addAnalysisRun({
          prompt: prompt,
          responses: responses,
          judgement: payload,
          crownModelId: payload.crown,
          crownScore: payload.scores && payload.scores[payload.crown] !== undefined ? payload.scores[payload.crown] : 0,
          contestantProvider: CONTESTANT_PROVIDER,
          judgeProvider: JUDGE_PROVIDER,
          judgeModel: JUDGE_MODEL,
          timings: meta.timings,
          execution: (function() {
            var ext = Object.assign({}, meta.execution || {});
            if (criteria && criteria.length) ext.criteria = criteria;
            if (judgeRuns > 1) ext.judgeRuns = judgeRuns;
            if (payload.judgeConfidence) ext.judgeConfidence = payload.judgeConfidence;
            if (activePackId !== "bar") ext.pack = activePackId;
            if (meta.blindMapping) ext.blindMapping = meta.blindMapping;
            return ext;
          }()),
        });
        invalidateAnalyticsCaches();
        if (willNotify) {
          const newTopRun = (deps.listTopAnalysisRunsByScore || listTopAnalysisRunsByScore)(1)[0];
          const newCrownModelId = newTopRun ? newTopRun.crownModelId : null;
          if (newCrownModelId && newCrownModelId !== prevCrownModelId) {
            notifyWebhookFn({ type: "crown_change", newCrown: newCrownModelId, prevCrown: prevCrownModelId, prompt: prompt, score: newTopRun.crownScore });
          }
        }
        (deps.dailyIncrement || dailyIncrement)("judge");
        if (meta.blindMapping) payload.blindMapping = meta.blindMapping;
        res.json(payload);
      } catch (e) {
        addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_parse", e, raw));
        console.error("[judge] JSON parse failed. Raw:", String(raw || "").slice(0, 300));
        return res.status(500).json({ error: "Judge returned invalid JSON." });
      }
    } catch (e) {
      addAnalysisRun(buildFailureRun(prompt, responses, meta, "judge_call", e));
      console.error("[judge] via " + JUDGE_PROVIDER + " (" + JUDGE_MODEL + "):", e.message);
      res.status(500).json({ error: "Judge failed." });
    }
  });

  // F1 — public shareable run endpoint (no auth)
  app.get("/api/runs/:id/public", publicLimiter, function(req, res) {
    const item = getAnalysisRun(req.params.id);
    if (!item) return res.status(404).json({ error: "Run not found." });
    res.json({
      id: item.id,
      prompt: item.prompt,
      responses: item.responses,
      judgement: {
        scores: item.judgement && item.judgement.scores,
        verdicts: item.judgement && item.judgement.verdicts,
        crown: item.judgement && item.judgement.crown,
        roast: item.judgement && item.judgement.roast,
      },
      crownModelId: item.crownModelId,
      crownScore: item.crownScore,
      createdAt: item.createdAt,
      blindMapping: item.execution && item.execution.blindMapping ? item.execution.blindMapping : undefined,
    });
  });

  // F6 — response pattern analytics
  app.get("/api/patterns", authMw.requireAuth, analyticsAuth, function(req, res) {
    res.json({ items: analysisRunServices.getPatternStats(buildRunFilters(req.query)) });
  });

  // F8 — daily challenge trigger
  app.post("/api/challenge", authMw.requireAuth, analyticsAuth, async function(req, res) {
    const prompt = DAILY_CHALLENGE_PROMPT || (req.body && req.body.prompt) || "";
    if (!prompt) return res.status(400).json({ error: "No challenge prompt. Set DAILY_CHALLENGE_PROMPT in .env or pass prompt in body." });
    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });

    res.json({ started: true, prompt: prompt, models: VALID_MODELS });

    // Fire all models + judge in background (non-blocking)
    setImmediate(async function() {
      const startedAt = Date.now();
      const execModels = {};
      const allResponses = {};
      try {
        await Promise.all(VALID_MODELS.map(async function(modelId) {
          const t = Date.now();
          try {
            const resp = await callContestant(modelId, getVoice(modelId), prompt);
            allResponses[modelId] = resp || "";
            execModels[modelId] = { status: "success", durationMs: Date.now() - t };
          } catch (e) {
            allResponses[modelId] = "[Error: " + e.message + "]";
            execModels[modelId] = { status: "error", error: e.message, errorCategory: categorizeError(e.message, e.upstreamStatus, "contestant"), durationMs: Date.now() - t };
          }
        }));
        const judgeStart = Date.now();
        const raw = await callJudge(getPack("bar").judgeSystemPrompt, buildJudgePrompt(prompt, allResponses));
        const judgeMs = Date.now() - judgeStart;
        const payload = normalizeJudgePayload(parseJudgeResponse(raw), Object.keys(allResponses));
        const successCount = VALID_MODELS.filter(function(id) { return execModels[id] && execModels[id].status === "success"; }).length;
        const overallStatus = successCount === VALID_MODELS.length ? "success" : successCount > 0 ? "partial_failure" : "failure";
        addAnalysisRun({
          prompt: prompt,
          responses: allResponses,
          judgement: payload,
          crownModelId: payload.crown,
          crownScore: payload.scores && payload.scores[payload.crown] !== undefined ? payload.scores[payload.crown] : 0,
          contestantProvider: CONTESTANT_PROVIDER,
          judgeProvider: JUDGE_PROVIDER,
          judgeModel: JUDGE_MODEL,
          timings: { judgeMs: judgeMs, totalMs: Date.now() - startedAt },
          execution: { summary: { overallStatus: overallStatus }, models: execModels, judge: { status: "success" }, isChallenge: true },
        });
        invalidateAnalyticsCaches();
        notifyWebhookFn({ type: "challenge_complete", crown: payload.crown, score: payload.scores[payload.crown], prompt: prompt });
      } catch (e) {
        console.error("[challenge] failed:", e.message);
        addAnalysisRun(buildFailureRun(prompt, allResponses, { timings: { totalMs: Date.now() - startedAt }, execution: { models: execModels } }, "judge_call", e));
      }
    });
  });

  // F10 — prompt submission (public, rate-limited)
  const submitLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, store: tryCreateStore("submit"), message: { error: "Too many submissions." } });
  app.post("/api/prompts/submit", submitLimiter, authMw.requireAuth, function(req, res) {
    const prompt = req.body && req.body.prompt;
    const mode = req.body && req.body.mode;
    const err = validatePrompt(prompt);
    if (err) return res.status(400).json({ error: err });
    try {
      pendingPrompts.submitPrompt(prompt, mode);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Submission failed." });
    }
  });

  app.get("/api/prompts/community", publicLimiter, authMw.requireAuth, function(req, res) {
    try {
      res.json({ items: pendingPrompts.getCommunityPrompts() });
    } catch (e) {
      res.json({ items: [] });
    }
  });

  app.get("/api/prompts/pending", authMw.requireAuth, analyticsAuth, function(req, res) {
    try {
      res.json({ items: pendingPrompts.listPending() });
    } catch (e) {
      res.status(500).json({ error: "Failed to load pending prompts." });
    }
  });

  app.post("/api/prompts/:id/approve", authMw.requireAuth, analyticsAuth, function(req, res) {
    try {
      pendingPrompts.approvePrompt(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Approval failed." });
    }
  });

  app.post("/api/prompts/:id/reject", authMw.requireAuth, analyticsAuth, function(req, res) {
    try {
      pendingPrompts.rejectPrompt(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Rejection failed." });
    }
  });

  const tournamentServices = require("./lib/tournament");

  app.post("/api/tournament", publicLimiter, authMw.requireAuth, function(req, res) {
    const models = Array.isArray(req.body.models) ? req.body.models : [];
    if (models.length < 2 || models.length > 16) {
      return res.status(400).json({ error: "Provide 2–16 model IDs." });
    }
    try {
      const tournament = tournamentServices.createBracket(models);
      _tournaments.set(tournament.id, tournament);
      res.json({ id: tournament.id, bracketSize: tournament.bracketSize, rounds: tournament.rounds.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/tournament/:id", publicLimiter, authMw.requireAuth, function(req, res) {
    const tournament = _tournaments.get(req.params.id);
    if (!tournament) return res.status(404).json({ error: "Tournament not found." });
    res.json(tournament);
  });

  app.post("/api/tournament/:id/advance", publicLimiter, authMw.requireAuth, function(req, res) {
    const tournament = _tournaments.get(req.params.id);
    if (!tournament) return res.status(404).json({ error: "Tournament not found." });
    const roundIdx = Number(req.body.roundIdx);
    const matchIdx = Number(req.body.matchIdx);
    const winnerId = String(req.body.winnerId || "");
    const ok = tournamentServices.advanceWinner(tournament, roundIdx, matchIdx, winnerId);
    if (!ok) return res.status(400).json({ error: "Invalid advance request." });
    res.json({ ok: true, status: tournament.status, champion: tournament.champion || null });
  });

  app.get("/api/health", authMw.requireAuth, analyticsAuth, async function(req, res) {
    const keyStatus = {};
    ["openrouter", "anthropic", "openai", "gemini", "litellm"].forEach(function(p) {
      keyStatus[p] = KEYS[p] ? "configured" : "missing";
    });
    const providerStatus = {};
    await Promise.all(
      ["openrouter", "anthropic", "openai", "gemini", "litellm"].map(async function(p) {
        try {
          providerStatus[p] = await checkProviderHealth(p, KEYS[p] || "");
        } catch (e) {
          providerStatus[p] = "error";
        }
      })
    );
    res.json({
      status: "ok",
      contestantProvider: CONTESTANT_PROVIDER,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      modelCount: Object.keys(MODEL_MAP).length,
      sqliteDriver: require("./lib/sqlite").isWasm() ? "wasm" : "native",
      keys: keyStatus,
      providerStatus: providerStatus,
    });
  });

  let _statsAnalyticsCache = null;
  let _statsAnalyticsCacheAt = 0;
  const STATS_ANALYTICS_TTL_MS = 30000;
  const _analyticsCache = createTtlCache(30000);
  const _failuresCache = createTtlCache(30000);

  const _tournaments = new Map();

  function invalidateAnalyticsCaches() {
    _analyticsCache.clear();
    _failuresCache.clear();
    _statsAnalyticsCache = null;
    _statsAnalyticsCacheAt = 0;
  }

  app.get("/api/drift", authMw.requireAuth, analyticsAuth, function(req, res) {
    const { getModelDriftStats } = require("./lib/drift");
    const days = Number(req.query.days || 14);
    const threshold = Number(req.query.threshold || 15);
    res.json(getModelDriftStats(days, threshold));
  });

  app.get("/api/stats", authMw.requireAuth, analyticsAuth, function(req, res) {
    const now = Date.now();
    if (!_statsAnalyticsCache || now - _statsAnalyticsCacheAt > STATS_ANALYTICS_TTL_MS) {
      _statsAnalyticsCache = getAnalysisAnalytics();
      _statsAnalyticsCacheAt = now;
    }
    res.json({
      app: metrics,
      history: getHistoryStats(),
      runs: getAnalysisRunStats(),
      failures: getAnalysisFailureSummary(),
      analytics: _statsAnalyticsCache,
      storage: {
        leaderboard: historyStorageType,
        runs: runStorageType,
        sqliteDriver: require("./lib/sqlite").isWasm() ? "wasm" : "native",
      },
    });
  });

  app.all("/api/*", function(req, res) {
    res.status(404).json({ error: "Not found." });
  });

  app.get("/run/:id", function(req, res, next) {
    const run = getAnalysisRun(req.params.id);
    if (!run) return next();
    const htmlPath = path.join(__dirname, "public", "index.html");
    let html = fs.readFileSync(htmlPath, "utf8");
    const title = "CSB Run — " + (run.crownModelId || "unknown") + " took the crown";
    const desc = "Prompt: " + (run.prompt || "").slice(0, 160);
    html = html.replace("<title>CSB — Chat Shit Bob</title>", "<title>" + title + "</title>");
    html = html.replace(
      '<meta property="og:description" content="The AI benchmarking show nobody asked for. We rank which LLM gave the sh*ttest answer.">',
      '<meta property="og:description" content="' + desc + '">'
    );
    html = html.replace(
      '<meta property="og:title" content="CSB — Chat Shit Bob">',
      '<meta property="og:title" content="' + title + '">'
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  app.get("*", function(req, res) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

module.exports = {
  createApp: createApp,
};
