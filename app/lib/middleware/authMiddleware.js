const { queryJsonParams } = require("../sqlite");

function createAuthMiddleware(deps) {
  const sessionRepo = deps.sessionRepository;
  const userRepo = deps.userRepository;

  async function requireAuth(req, res, next) {
    const authHeader = String(req.headers.authorization || "");
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const tokenHash = require("crypto").createHash("sha256").update(token).digest("hex");
    const session = sessionRepo.findByTokenHash(tokenHash);
    if (!session) {
      return res.status(401).json({ error: "Session expired or invalid." });
    }

    const user = userRepo.findById(session.user_id);
    if (!user) {
      return res.status(401).json({ error: "User not found." });
    }

    if (user.account_locked_until && new Date() < new Date(user.account_locked_until)) {
      return res.status(403).json({ error: "Account temporarily locked due to too many failed attempts." });
    }

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      emailVerified: Boolean(user.email_verified),
      phoneVerified: Boolean(user.phone_verified),
      firstLoginCompleted: Boolean(user.first_login_completed),
      customModeEnabled: Boolean(user.custom_mode_access_enabled),
    };
    next();
  }

  function requirePhoneVerified(req, res, next) {
    if (!req.user || !req.user.phoneVerified) {
      return res.status(403).json({ error: "Phone verification required before accessing this feature." });
    }
    next();
  }

  function requireCustomModeAccess(req, res, next) {
    if (!req.user || !req.user.customModeEnabled) {
      return res.status(403).json({ error: "Custom Mode access not enabled." });
    }
    next();
  }

  return {
    requireAuth,
    requirePhoneVerified,
    requireCustomModeAccess,
  };
}

module.exports = { createAuthMiddleware };
