const https = require("node:https");
const querystring = require("node:querystring");
const crypto = require("node:crypto");

const SESSION_SECRET = process.env.SESSION_SECRET || "";
const STATE_TTL_MS = 5 * 60 * 1000;

// In-memory state store is DEPRECATED — we now use signed JWTs for stateless
// CSRF protection. This empty Map is kept only so any legacy in-flight states
// gracefully expire (will be removed in a future cleanup).
const _oauthStates = new Map();

function _base64url(str) {
  return Buffer.from(str, "utf8")
    .toString("base64url");
}

function _sign(data, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
}

function _buildJwt(payload) {
  const header = _base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = _base64url(JSON.stringify(payload));
  const sig = _sign(header + "." + body, SESSION_SECRET);
  return header + "." + body + "." + sig;
}

function _parseJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = _sign(header + "." + body, SESSION_SECRET);
  if (!crypto.timingSafeEqual(Buffer.from(signature, "base64url"), Buffer.from(expected, "base64url"))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function generateState() {
  return crypto.randomBytes(24).toString("hex");
}

// ── Signed JWT state (stateless, works across processes) ─────────────────────
function buildStateJwt(provider, codeVerifier) {
  return _buildJwt({
    provider: provider,
    cv: codeVerifier,
    iat: Date.now(),
    exp: Date.now() + STATE_TTL_MS,
  });
}

// ── PKCE ─────────────────────────────────────────────────────────────────────
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { code_verifier: verifier, code_challenge: challenge };
}

function storeState(state, meta) {
  // Legacy in-memory fallback — new flows use JWTs, but if a caller still
  // provides a raw state string we keep a short-lived backup.
  _oauthStates.set(state, { expires: Date.now() + STATE_TTL_MS, meta: meta || {} });
  // Prune old states periodically
  const now = Date.now();
  for (const [k, v] of _oauthStates) {
    if (v.expires < now) _oauthStates.delete(k);
  }
}

function validateState(state) {
  if (!state || typeof state !== "string") return null;

  // 1. Try signed JWT first (stateless, works across processes)
  const jwtPayload = _parseJwt(state);
  if (jwtPayload) {
    return {
      provider: jwtPayload.provider,
      code_verifier: jwtPayload.cv,
    };
  }

  // 2. Fallback to legacy in-memory Map (for in-flight requests during deploy)
  const record = _oauthStates.get(state);
  if (!record || Date.now() > record.expires) return null;
  _oauthStates.delete(state);
  return record.meta || {};
}

// ── Generic HTTPS request helper ─────────────────────────────────────────────
function httpsRequest(url, options, body) {
  return new Promise(function(resolve, reject) {
    const req = https.request(url, options, function(res) {
      let data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Google ───────────────────────────────────────────────────────────────────
function buildGoogleAuthUrl(state, redirectUri, pkce) {
  const params = {
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state,
    access_type: "online",
    prompt: "consent",
  };
  if (pkce && pkce.code_challenge) {
    params.code_challenge = pkce.code_challenge;
    params.code_challenge_method = "S256";
  }
  return "https://accounts.google.com/o/oauth2/v2/auth?" + querystring.stringify(params);
}

async function exchangeGoogleCode(code, redirectUri, codeVerifier) {
  const tokenBodyObj = {
    code: code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };
  if (codeVerifier) tokenBodyObj.code_verifier = codeVerifier;
  const tokenBody = querystring.stringify(tokenBodyObj);

  const tokenRes = await httpsRequest("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }, tokenBody);

  if (tokenRes.status >= 400 || !tokenRes.body.access_token) {
    throw new Error("Google token exchange failed: " + JSON.stringify(tokenRes.body));
  }

  // Hardened: pass token in Authorization header, NOT query param
  const userRes = await httpsRequest(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { method: "GET", headers: { "Accept": "application/json", "Authorization": "Bearer " + tokenRes.body.access_token } }
  );

  const profile = userRes.body;
  return {
    provider: "google",
    subject: String(profile.sub || ""),
    email: String(profile.email || "").toLowerCase(),
    fullName: String(profile.name || ""),
    picture: String(profile.picture || ""),
    emailVerified: Boolean(profile.email_verified),
  };
}

// ── Facebook ─────────────────────────────────────────────────────────────────
function buildFacebookAuthUrl(state, redirectUri, pkce) {
  const params = {
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "email,public_profile",
    state: state,
  };
  if (pkce && pkce.code_challenge) {
    params.code_challenge = pkce.code_challenge;
    params.code_challenge_method = "S256";
  }
  return "https://www.facebook.com/v18.0/dialog/oauth?" + querystring.stringify(params);
}

async function exchangeFacebookCode(code, redirectUri, codeVerifier) {
  const tokenBodyObj = {
    code: code,
    client_id: process.env.FACEBOOK_APP_ID,
    client_secret: process.env.FACEBOOK_APP_SECRET,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) tokenBodyObj.code_verifier = codeVerifier;
  const tokenBody = querystring.stringify(tokenBodyObj);

  const tokenRes = await httpsRequest("https://graph.facebook.com/v18.0/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }, tokenBody);

  if (tokenRes.status >= 400 || !tokenRes.body.access_token) {
    throw new Error("Facebook token exchange failed: " + JSON.stringify(tokenRes.body));
  }

  // Hardened: pass token in Authorization header, NOT query param
  const userRes = await httpsRequest(
    "https://graph.facebook.com/v18.0/me?fields=id,name,email,picture",
    { method: "GET", headers: { "Accept": "application/json", "Authorization": "Bearer " + tokenRes.body.access_token } }
  );

  const profile = userRes.body;
  return {
    provider: "facebook",
    subject: String(profile.id || ""),
    email: String(profile.email || "").toLowerCase(),
    fullName: String(profile.name || ""),
    picture: String((profile.picture && profile.picture.data && profile.picture.data.url) || ""),
    emailVerified: true,
  };
}

// ── Router ───────────────────────────────────────────────────────────────────
function buildAuthUrl(provider, state, redirectUri, pkce) {
  switch (provider) {
    case "google": return buildGoogleAuthUrl(state, redirectUri, pkce);
    case "facebook": return buildFacebookAuthUrl(state, redirectUri, pkce);
    default: throw new Error("Unknown OAuth provider: " + provider);
  }
}

async function exchangeCode(provider, code, redirectUri, codeVerifier) {
  switch (provider) {
    case "google": return exchangeGoogleCode(code, redirectUri, codeVerifier);
    case "facebook": return exchangeFacebookCode(code, redirectUri, codeVerifier);
    default: throw new Error("Unknown OAuth provider: " + provider);
  }
}

module.exports = {
  generateState,
  buildStateJwt,
  generatePKCE,
  storeState,
  validateState,
  buildAuthUrl,
  exchangeCode,
};
