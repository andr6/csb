const express = require("express");
const crypto = require("crypto");

const {
  CONTESTANT_PROVIDER,
  JUDGE_PROVIDER,
  JUDGE_MODEL,
  MODEL_MAP,
  MODEL_METADATA,
} = require("../lib/config");
const { PACKS } = require("../lib/packs");
const judgeServices = require("../lib/judge");

function createConfigRouter(deps) {
  const router = express.Router();

  const configLimiter = deps.configLimiter;
  const generatePageToken = deps.generatePageToken;
  const sessionRepo = deps.sessionRepository;
  const userRepo = deps.userRepository;
  const adminEmail = deps.ADMIN_EMAIL;

  router.get("/api/config", configLimiter, async function(req, res) {
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
            isAdmin: u.email === adminEmail,
          };
        }
      }
    }
    const OAUTH_PROVIDERS = {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      facebook: !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    };
    res.json({
      contestantProvider: CONTESTANT_PROVIDER,
      models: MODEL_MAP,
      modelsMeta: MODEL_METADATA,
      judgeProvider: JUDGE_PROVIDER,
      judgeModel: JUDGE_MODEL,
      packs: Object.values(PACKS).map(function(p) {
        return { id: p.id, name: p.name, tagline: p.tagline, teaser: p.teaser || "", persona: p.persona || "", compatibleModes: p.compatibleModes || [] };
      }),
      criteria: judgeServices.SCORING_CRITERIA.map(function(c) { return { key: c.key, label: c.label }; }),
      redteamCriteria: judgeServices.REDTEAM_CRITERIA.map(function(c) { return { key: c.key, label: c.label }; }),
      _token: deps.generatePageToken ? deps.generatePageToken() : generatePageToken(),
      user: user,
      oauthProviders: OAUTH_PROVIDERS,
    });
  });

  return router;
}

module.exports = { createConfigRouter };
