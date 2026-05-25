const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ALLOWED_ORIGINS = "https://chatshitbob.com, https://www.chatshitbob.com";
process.env.NODE_ENV = "test";
process.env.ACTIVE_MODELS = "alpha,beta";
process.env.MODEL_ALPHA = "openai/gpt-4o-mini";
process.env.MODEL_BETA = "anthropic/claude-sonnet-4-5";

const { parseAllowedOrigins } = require("../lib/config");
const { isAllowedOrigin } = require("../lib/cors");
const { validatePrompt } = require("../lib/validation");
const { normalizeJudgePayload, parseJudgeResponse } = require("../lib/judge");

test("parseAllowedOrigins returns trimmed entries", function() {
  assert.deepEqual(
    parseAllowedOrigins(" https://a.test,https://b.test ,, "),
    ["https://a.test", "https://b.test"]
  );
});

test("isAllowedOrigin accepts configured origins and no-origin requests", function() {
  assert.equal(isAllowedOrigin(undefined), true);
  assert.equal(isAllowedOrigin("https://chatshitbob.com"), true);
  assert.equal(isAllowedOrigin("https://evil.test"), false);
});

test("validatePrompt enforces prompt bounds", function() {
  assert.equal(validatePrompt("ok"), "Prompt too short.");
  assert.equal(validatePrompt("a".repeat(501)), "Prompt too long (max 500 chars).");
  assert.equal(validatePrompt("tell me something cursed"), null);
});

test("normalizeJudgePayload clamps and fills missing judgement fields", function() {
  const payload = normalizeJudgePayload({
    scores: { alpha: 120, beta: -2 },
    verdicts: { alpha: "bad", beta: 99 },
    crown: "missing",
    roast: "overall roast",
  });

  assert.deepEqual(payload.scores, { alpha: 100, beta: 0 });
  assert.deepEqual(payload.verdicts, { alpha: "bad", beta: "" });
  assert.equal(payload.crown, "alpha");
  assert.equal(payload.roast, "overall roast");
});

test("parseJudgeResponse handles bare json prefix before payload", function() {
  const parsed = parseJudgeResponse(
    'json\n{"scores":{"alpha":75,"beta":10},"verdicts":{"alpha":"bad","beta":"fine"},"crown":"alpha","roast":"overall"}'
  );

  assert.deepEqual(parsed, {
    scores: { alpha: 75, beta: 10 },
    verdicts: { alpha: "bad", beta: "fine" },
    crown: "alpha",
    roast: "overall",
  });
});
