const crypto = require("crypto");

/**
 * Admin auth middleware factory.
 *
 * The returned middleware checks Bearer tokens only.
 * The user must be logged in with an admin email (email === adminEmail).
 *
 * ⚠️ Basic auth was removed — analytics access now requires admin login.
 */
function createRequireAdminAccess({ sessionRepository, userRepository, adminEmail }) {
  return function requireAdminAuth(req, res, next) {
    const authHeader = String(req.headers.authorization || "");

    // Bearer path: admin session grants analytics access
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const session = sessionRepository.findByTokenHash(tokenHash);
        if (session) {
          const user = userRepository.findById(session.user_id);
          if (user && user.email === adminEmail) {
            req.user = { id: user.id, email: user.email, fullName: user.full_name };
            return next();
          }
        }
      }
    }

    return res.status(401).json({ error: "Admin session required. Log in as admin." });
  };
}

module.exports = { createRequireAdminAccess };
