const crypto = require("crypto");

function createRequireAdminAccess({ sessionRepository, userRepository, adminEmail, analyticsPagePassword }) {
  return function requireAdminAccess(req, res, next) {
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
  };
}

module.exports = { createRequireAdminAccess };
