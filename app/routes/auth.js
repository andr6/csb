const express = require("express");
const crypto = require("crypto");

const {
  MAIL_FROM: _MAIL_FROM,
  MAIL_USER: _MAIL_USER,
  ADMIN_EMAIL: _ADMIN_EMAIL,
} = require("../lib/config");

const _authService = require("../lib/authService");
const _oauthService = require("../lib/oauthService");
const { createUserRepository: _createUserRepository } = require("../lib/repositories/userRepository");
const { createOtpRepository: _createOtpRepository } = require("../lib/repositories/otpRepository");
const { createSessionRepository: _createSessionRepository } = require("../lib/repositories/sessionRepository");
const { createPasswordResetRepository: _createPasswordResetRepository } = require("../lib/repositories/passwordResetRepository");
const { runSqlParams: _runSqlParams } = require("../lib/sqlite");
const _auditLog = require("../lib/auditLog");

function createAuthRouter(deps) {
  const router = express.Router();

  const authService = deps.authService || _authService;
  const userRepo = deps.userRepository || _createUserRepository();
  const otpRepo = deps.otpRepository || _createOtpRepository();
  const sessionRepo = deps.sessionRepository || _createSessionRepository();
  const resetRepo = deps.passwordResetRepository || _createPasswordResetRepository();
  const authMw = deps.authMiddleware;
  const sendEmailOtp = deps.sendEmailOtp;
  const sendSmsOtp = deps.sendSmsOtp;
  const emailTransporter = deps.emailTransporter;
  const oauthService = deps.oauthService || _oauthService;
  const MAIL_FROM = deps.MAIL_FROM !== undefined ? deps.MAIL_FROM : _MAIL_FROM;
  const MAIL_USER = deps.MAIL_USER !== undefined ? deps.MAIL_USER : _MAIL_USER;
  const ADMIN_EMAIL = deps.ADMIN_EMAIL !== undefined ? deps.ADMIN_EMAIL : _ADMIN_EMAIL;
  const registerLimiter = deps.registerLimiter;
  const loginLimiter = deps.loginLimiter;
  const otpVerifyLimiter = deps.otpVerifyLimiter;
  const otpResendLimiter = deps.otpResendLimiter;
  const authFailLimiter = deps.authFailLimiter;
  const publicLimiter = deps.publicLimiter;
  const requireKnownOrigin = deps.requireKnownOrigin;
  const runSqlParams = deps.runSqlParams || _runSqlParams;
  const auditLog = deps.auditLog || _auditLog;

  // ═══════════════════════════════════════════════════════════════════════════════
  //  Auth endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  router.post("/api/auth/register", registerLimiter, requireKnownOrigin, async function(req, res) {
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

  router.post("/api/auth/verify-email", otpVerifyLimiter, requireKnownOrigin, async function(req, res) {
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
        auditLog.insert("otp_exhausted", user.id, { otpType: "email" });
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

  router.post("/api/auth/resend-email-otp", otpResendLimiter, requireKnownOrigin, async function(req, res) {
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

  router.post("/api/auth/login", loginLimiter, requireKnownOrigin, async function(req, res) {
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
      auditLog.insert("account_locked_login", user.id);
      return res.status(403).json({ error: "Account temporarily locked due to too many failed attempts." });
    }

    const valid = await authService.verifyPassword(password, user.password_hash);
    if (!valid) {
      userRepo.incrementFailedLogin(user.id);
      const updated = userRepo.findById(user.id);
      if (updated && updated.failed_login_attempts >= 5) {
        const lockout = authService.getLockoutUntil();
        userRepo.lockAccount(user.id, lockout);
        auditLog.insert("account_lock", user.id, { attempts: updated.failed_login_attempts });
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

  router.post("/api/auth/logout", authMw.requireAuth, async function(req, res) {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.slice(7).trim();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    sessionRepo.deleteByTokenHash(tokenHash);
    res.json({ ok: true });
  });

  router.get("/api/auth/me", authMw.requireAuth, async function(req, res) {
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

  router.post("/api/auth/verify-phone", authMw.requireAuth, otpVerifyLimiter, requireKnownOrigin, async function(req, res) {
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
        auditLog.insert("otp_exhausted", userId, { otpType: "phone" });
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

    auditLog.insert("phone_verified", userId);

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

  router.post("/api/auth/resend-phone-otp", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
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
    auditLog.insert("phone_otp_resend", userId);
    res.json({ ok: true, message: "A new verification code has been sent." });
  });

  // ── Update email ────────────────────────────────────────────────────────────
  router.post("/api/auth/update-email", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
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
    auditLog.insert("email_updated", userId);

    // If user was already verified, mark unverified and require re-validation
    if (user.email_verified) {
      userRepo.markEmailUnverified(userId);
      // Invalidate all existing sessions so user must re-verify
      sessionRepo.deleteByUser(userId);
      auditLog.insert("email_unverified_for_change", userId);
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
  router.post("/api/auth/update-phone", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const userId = req.user.id;
    const user = userRepo.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const newPhone = String(req.body.phone || "").trim();
    if (!authService.validatePhone(newPhone)) {
      return res.status(400).json({ error: authService.getPhonePolicyError() });
    }

    const normalizedPhone = authService.normalizePhone(newPhone);
    runSqlParams("UPDATE users SET phone_number = ?, updated_at = ? WHERE id = ?", [normalizedPhone, new Date().toISOString(), userId]);
    auditLog.insert("phone_updated", userId);

    // If user was already verified, mark unverified and require re-validation
    if (user.phone_verified) {
      userRepo.markPhoneUnverified(userId);
      auditLog.insert("phone_unverified_for_change", userId);
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
  router.post("/api/auth/change-password", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
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

    auditLog.insert("password_changed", userId);
    res.json({ ok: true, message: "Password updated successfully." });
  });

  // ── Update name ─────────────────────────────────────────────────────────────
  router.post("/api/auth/update-name", authMw.requireAuth, otpResendLimiter, requireKnownOrigin, async function(req, res) {
    const userId = req.user.id;
    const user = userRepo.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    const newName = String(req.body.name || "").trim();
    if (!authService.validateName(newName)) {
      return res.status(400).json({ error: authService.getNamePolicyError() });
    }

    userRepo.updateName(userId, newName);
    auditLog.insert("name_updated", userId);
    res.json({ ok: true, message: "Name updated successfully.", name: newName });
  });

  // ── Signed URL helpers for password reset ───────────────────────────────
  function signResetToken(token, expiresAt) {
    const secret = process.env.RESET_SECRET || process.env.PAGE_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
    const payload = token + "|" + expiresAt;
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }
  function verifyResetToken(token, expiresAt, signature) {
    const expected = signResetToken(token, expiresAt);
    const aBuf = Buffer.from(signature, "hex");
    const eBuf = Buffer.from(expected, "hex");
    return aBuf.length === eBuf.length && crypto.timingSafeEqual(aBuf, eBuf);
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  router.post("/api/auth/forgot-password", otpResendLimiter, requireKnownOrigin, async function(req, res) {
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

    // Build signed URL
    const sig = signResetToken(resetToken, expiresAt);
    const resetUrl = "/reset-password?t=" + encodeURIComponent(resetToken) + "&s=" + sig + "&e=" + encodeURIComponent(expiresAt);

    // Log event with no sensitive data
    auditLog.insert("password_reset_requested", user.id);

    // Mock email send (real would use nodemailer)
    if (emailTransporter) {
      try {
        await emailTransporter.sendMail({
          from: MAIL_FROM || MAIL_USER,
          to: email,
          subject: "Password reset request",
          text: "A password reset was requested. Use this link to reset your password: " + resetUrl + "\nThis link expires in 1 hour.",
        });
      } catch (e) {
        console.error("[auth] Password reset email failed:", e.message);
      }
    } else {
      console.log("[auth] Mock password reset email to", email, ":", resetUrl);
    }

    res.json({ ok: true, message: "If this account exists, a password reset link has been sent." });
  });

  // ── Reset password ────────────────────────────────────────────────────────
  router.post("/api/auth/reset-password", otpVerifyLimiter, requireKnownOrigin, async function(req, res) {
    const token = String(req.body.token || "").trim();
    const signature = String(req.body.signature || "").trim();
    const expiresAt = String(req.body.expiresAt || "").trim();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!token) return res.status(400).json({ error: "Reset token required." });

    // Signed URL validation (new flow) — if signature and expiresAt provided, validate them
    if (signature && expiresAt) {
      if (new Date(expiresAt) < new Date()) return res.status(400).json({ error: "Reset link has expired." });
      if (!verifyResetToken(token, expiresAt, signature)) {
        return res.status(400).json({ error: "Invalid reset signature." });
      }
    }

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

    auditLog.insert("password_reset_completed", user.id);

    res.json({ ok: true, message: "Password updated. Please log in with your new password." });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  //  OAuth endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  const OAUTH_PROVIDERS = {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    facebook: !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    instagram: !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
  };

  function getOAuthRedirectUri(provider, req) {
    var base = process.env.OAUTH_REDIRECT_BASE || (req.headers.origin || "").replace(/^https?:\/\//, "");
    // Strip any existing scheme so we don't double it (e.g. base already contains https://)
    base = base.replace(/^https?:\/\//, "");
    return "https://" + base + "/api/auth/oauth/" + provider + "/callback";
  }

  // Start OAuth flow — redirect to provider consent screen
  router.get("/api/auth/oauth/:provider/start", publicLimiter, function(req, res) {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!OAUTH_PROVIDERS[provider]) {
      return res.status(400).json({ error: "OAuth provider not configured." });
    }

    const state = oauthService.generateState();
    oauthService.storeState(state);

    const redirectUri = getOAuthRedirectUri(provider, req);
    const authUrl = oauthService.buildAuthUrl(provider, state, redirectUri);
    res.redirect(authUrl);
  });

  // OAuth callback — exchange code for token, fetch profile, create/link user
  router.get("/api/auth/oauth/:provider/callback", publicLimiter, async function(req, res) {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!OAUTH_PROVIDERS[provider]) {
      return res.status(400).send("OAuth provider not configured.");
    }

    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const error = String(req.query.error || "");

    if (error) {
      return renderOAuthResult(res, { error: "OAuth authorization denied or failed." });
    }
    if (!code) {
      return renderOAuthResult(res, { error: "Authorization code missing." });
    }
    if (!oauthService.validateState(state)) {
      return renderOAuthResult(res, { error: "Invalid or expired OAuth state." });
    }

    let profile;
    try {
      const redirectUri = getOAuthRedirectUri(provider, req);
      profile = await oauthService.exchangeCode(provider, code, redirectUri);
    } catch (e) {
      console.error("[oauth]", provider, "exchange failed:", e.message);
      return renderOAuthResult(res, { error: "OAuth token exchange failed." });
    }

    if (!profile.subject) {
      return renderOAuthResult(res, { error: "OAuth provider did not return a user identifier." });
    }

    // Try to find existing user by OAuth pair first
    let user = userRepo.findByOAuth(provider, profile.subject);
    let isNewUser = false;

    if (!user && profile.email) {
      // Try to link by email
      user = userRepo.findByEmail(profile.email);
      if (user) {
        userRepo.linkOAuth(user.id, provider, profile.subject);
        user = userRepo.findById(user.id); // refresh
      }
    }

    if (!user) {
      // Create new OAuth user
      const userId = userRepo.createOAuthUser({
        fullName: profile.fullName || profile.email.split("@")[0] || "OAuth User",
        email: profile.email || (provider + "_" + profile.subject + "@oauth.local"),
        provider: provider,
        subject: profile.subject,
      });
      user = userRepo.findById(userId);
      isNewUser = true;
    }

    if (!user) {
      return renderOAuthResult(res, { error: "Failed to create or link OAuth account." });
    }

    // Issue session token
    sessionRepo.deleteByUser(user.id);
    const token = authService.generateSessionToken();
    const tokenHash = authService.hashToken(token);
    const sessionExpiry = authService.getSessionExpiryDate();
    sessionRepo.createSession({ userId: user.id, tokenHash, expiresAt: sessionExpiry });
    userRepo.updateLastLogin(user.id);

    auditLog.insert("oauth_login", user.id, { provider: provider, isNew: isNewUser });

    const userPayload = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      emailVerified: Boolean(user.email_verified),
      phoneVerified: Boolean(user.phone_verified),
      firstLoginCompleted: Boolean(user.first_login_completed),
      customModeEnabled: Boolean(user.custom_mode_access_enabled),
      isAdmin: user.email === ADMIN_EMAIL,
      oauthProvider: provider,
    };

    return renderOAuthResult(res, { token: token, user: userPayload });
  });

  function renderOAuthResult(res, payload) {
    const html =
      '<!DOCTYPE html><html><head><title>OAuth Result</title></head><body>' +
      '<script>' +
      'try { window.opener.postMessage(' + JSON.stringify(JSON.stringify({ type: "oauth_result", payload: payload })) + ', "*"); } catch(e) {}' +
      'setTimeout(function() { window.close(); }, 500);' +
      '</script>' +
      '<p>' + (payload.error ? "Authentication failed." : "Authentication successful. You can close this window.") + '</p>' +
      '</body></html>';
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  }

  return router;
}

module.exports = { createAuthRouter };
