const https = require("node:https");
const querystring = require("node:querystring");
const crypto = require("node:crypto");

// In-memory state store for OAuth CSRF protection (5-minute TTL)
const _oauthStates = new Map();
const STATE_TTL_MS = 5 * 60 * 1000;

function generateState() {
  return crypto.randomBytes(24).toString("hex");
}

function storeState(state) {
  _oauthStates.set(state, Date.now() + STATE_TTL_MS);
  // Prune old states periodically
  const now = Date.now();
  for (const [k, v] of _oauthStates) {
    if (v < now) _oauthStates.delete(k);
  }
}

function validateState(state) {
  if (!state || typeof state !== "string") return false;
  const expires = _oauthStates.get(state);
  if (!expires || Date.now() > expires) return false;
  _oauthStates.delete(state);
  return true;
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
function buildGoogleAuthUrl(state, redirectUri) {
  const params = {
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state,
    access_type: "online",
    prompt: "consent",
  };
  return "https://accounts.google.com/o/oauth2/v2/auth?" + querystring.stringify(params);
}

async function exchangeGoogleCode(code, redirectUri) {
  const tokenBody = querystring.stringify({
    code: code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await httpsRequest("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }, tokenBody);

  if (tokenRes.status >= 400 || !tokenRes.body.access_token) {
    throw new Error("Google token exchange failed: " + JSON.stringify(tokenRes.body));
  }

  const userRes = await httpsRequest(
    "https://openidconnect.googleapis.com/v1/userinfo?access_token=" + encodeURIComponent(tokenRes.body.access_token),
    { method: "GET", headers: { "Accept": "application/json" } }
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
function buildFacebookAuthUrl(state, redirectUri) {
  const params = {
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "email,public_profile",
    state: state,
  };
  return "https://www.facebook.com/v18.0/dialog/oauth?" + querystring.stringify(params);
}

async function exchangeFacebookCode(code, redirectUri) {
  const tokenBody = querystring.stringify({
    code: code,
    client_id: process.env.FACEBOOK_APP_ID,
    client_secret: process.env.FACEBOOK_APP_SECRET,
    redirect_uri: redirectUri,
  });

  const tokenRes = await httpsRequest("https://graph.facebook.com/v18.0/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }, tokenBody);

  if (tokenRes.status >= 400 || !tokenRes.body.access_token) {
    throw new Error("Facebook token exchange failed: " + JSON.stringify(tokenRes.body));
  }

  const userRes = await httpsRequest(
    "https://graph.facebook.com/v18.0/me?fields=id,name,email,picture&access_token=" + encodeURIComponent(tokenRes.body.access_token),
    { method: "GET", headers: { "Accept": "application/json" } }
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

// ── Instagram (Basic Display) ────────────────────────────────────────────────
function buildInstagramAuthUrl(state, redirectUri) {
  const params = {
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "user_profile",
    state: state,
  };
  return "https://api.instagram.com/oauth/authorize?" + querystring.stringify(params);
}

async function exchangeInstagramCode(code, redirectUri) {
  const tokenBody = querystring.stringify({
    code: code,
    client_id: process.env.INSTAGRAM_APP_ID,
    client_secret: process.env.INSTAGRAM_APP_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await httpsRequest("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }, tokenBody);

  if (tokenRes.status >= 400 || !tokenRes.body.access_token) {
    throw new Error("Instagram token exchange failed: " + JSON.stringify(tokenRes.body));
  }

  const userRes = await httpsRequest(
    "https://graph.instagram.com/me?fields=id,username&access_token=" + encodeURIComponent(tokenRes.body.access_token),
    { method: "GET", headers: { "Accept": "application/json" } }
  );

  const profile = userRes.body;
  const subject = String(profile.id || "");
  // Instagram Basic Display does not provide email
  return {
    provider: "instagram",
    subject: subject,
    email: "instagram_" + subject + "@oauth.local",
    fullName: String(profile.username || ""),
    picture: "",
    emailVerified: false,
  };
}

// ── Router ───────────────────────────────────────────────────────────────────
function buildAuthUrl(provider, state, redirectUri) {
  switch (provider) {
    case "google": return buildGoogleAuthUrl(state, redirectUri);
    case "facebook": return buildFacebookAuthUrl(state, redirectUri);
    case "instagram": return buildInstagramAuthUrl(state, redirectUri);
    default: throw new Error("Unknown OAuth provider: " + provider);
  }
}

async function exchangeCode(provider, code, redirectUri) {
  switch (provider) {
    case "google": return exchangeGoogleCode(code, redirectUri);
    case "facebook": return exchangeFacebookCode(code, redirectUri);
    case "instagram": return exchangeInstagramCode(code, redirectUri);
    default: throw new Error("Unknown OAuth provider: " + provider);
  }
}

module.exports = {
  generateState,
  storeState,
  validateState,
  buildAuthUrl,
  exchangeCode,
};
