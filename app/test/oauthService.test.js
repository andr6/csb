const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-32-bytes-long-ok";

const { generatePKCE, buildStateJwt, validateState, generateState, storeState } = require("../lib/oauthService");

test("generatePKCE produces verifier and challenge", function() {
  var pkce = generatePKCE();
  assert.ok(pkce.code_verifier, "has verifier");
  assert.ok(pkce.code_challenge, "has challenge");
  assert.equal(typeof pkce.code_verifier, "string");
  assert.equal(typeof pkce.code_challenge, "string");
});

test("generatePKCE challenge is S256 of verifier", function() {
  var pkce = generatePKCE();
  var expected = require("node:crypto").createHash("sha256").update(pkce.code_verifier).digest("base64url");
  assert.equal(pkce.code_challenge, expected);
});

test("buildStateJwt returns a three-part JWT", function() {
  var jwt = buildStateJwt("google", "verifier123");
  var parts = jwt.split(".");
  assert.equal(parts.length, 3);
});

test("validateState parses valid JWT and extracts provider + code_verifier", function() {
  var pkce = generatePKCE();
  var jwt = buildStateJwt("facebook", pkce.code_verifier);
  var parsed = validateState(jwt);
  assert.ok(parsed, "parsed successfully");
  assert.equal(parsed.provider, "facebook");
  assert.equal(parsed.code_verifier, pkce.code_verifier);
});

test("validateState rejects tampered JWT", function() {
  var jwt = buildStateJwt("google", "v");
  var tampered = jwt.slice(0, -5) + "XXXXX";
  var parsed = validateState(tampered);
  assert.equal(parsed, null);
});

test("validateState rejects expired JWT", async function() {
  // Build a JWT with a very short expiry that we can force to expire
  // We manipulate the payload by decoding, editing, and re-signing
  var crypto = require("node:crypto");
  var secret = process.env.SESSION_SECRET;
  function base64url(str) { return Buffer.from(str, "utf8").toString("base64url"); }
  function sign(data, s) { return crypto.createHmac("sha256", s).update(data).digest("base64url"); }
  var header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  var body = base64url(JSON.stringify({ provider: "google", cv: "v", iat: Date.now() - 10000, exp: Date.now() - 1 }));
  var sig = sign(header + "." + body, secret);
  var expiredJwt = header + "." + body + "." + sig;
  var parsed = validateState(expiredJwt);
  assert.equal(parsed, null);
});

test("validateState falls back to legacy Map for raw state strings", function() {
  var raw = generateState();
  storeState(raw, { provider: "google", code_verifier: "legacy-v" });
  var parsed = validateState(raw);
  assert.ok(parsed, "legacy fallback worked");
  assert.equal(parsed.provider, "google");
  assert.equal(parsed.code_verifier, "legacy-v");
});

test("validateState returns null for empty input", function() {
  assert.equal(validateState(""), null);
  assert.equal(validateState(null), null);
  assert.equal(validateState(undefined), null);
});

test("generateState returns 48-char hex string", function() {
  var s = generateState();
  assert.equal(s.length, 48);
  assert.ok(/^[a-f0-9]+$/.test(s));
});
