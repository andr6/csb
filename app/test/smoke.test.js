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

test("parseAllowedOrigins returns trimmed entries with www variants", function() {
  assert.deepEqual(
    parseAllowedOrigins(" https://a.test,https://b.test ,, "),
    ["https://a.test", "https://www.a.test", "https://b.test", "https://www.b.test"]
  );
});

test("isAllowedOrigin accepts configured origins and no-origin requests", function() {
  assert.equal(isAllowedOrigin(undefined), true);
  assert.equal(isAllowedOrigin("https://chatshitbob.com"), true);
  assert.equal(isAllowedOrigin("https://evil.test"), false);
});

test("validatePrompt enforces prompt bounds", function() {
  assert.equal(validatePrompt("ok"), "Prompt too short.");
  assert.equal(validatePrompt("a".repeat(1501)), "Prompt too long (max 1500 chars).");
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

test("buildJudgePrompt JSON-escapes the user prompt", function() {
  const { buildJudgePrompt } = require("../lib/judge");
  var out = buildJudgePrompt('say "hello"\nand newline', { alpha: "a" }, null);
  assert.ok(out.indexOf('"say \\"hello\\"\\nand newline"') !== -1);
});

test("parseJudgeResponse handles JSON5-like unquoted keys", function() {
  const { parseJudgeResponse } = require("../lib/judge");
  var parsed = parseJudgeResponse('{"scores":{alpha:75,beta:10},"crown":"alpha","roast":"overall"}');
  assert.equal(parsed.scores.alpha, 75);
  assert.equal(parsed.crown, "alpha");
});

test("parseJudgeResponse throws with raw snippet on total failure", function() {
  const { parseJudgeResponse } = require("../lib/judge");
  assert.throws(function() {
    parseJudgeResponse("this is not json at all");
  }, /this is not json at all/);
});

test("parseJudgeResponse throws clear message on empty response", function() {
  const { parseJudgeResponse } = require("../lib/judge");
  assert.throws(function() {
    parseJudgeResponse("");
  }, /empty response/);
  assert.throws(function() {
    parseJudgeResponse("   ");
  }, /empty response/);
  assert.throws(function() {
    parseJudgeResponse(null);
  }, /empty response/);
});

test("MODEL_CATALOGUE skips empty and unprefixed values", function() {
  const originalGarbage = process.env.MODEL_GARBAGE;
  const originalEmpty = process.env.MODEL_EMPTY;
  process.env.MODEL_GARBAGE = "nope";
  process.env.MODEL_EMPTY = "";

  delete require.cache[require.resolve("../lib/config")];
  const { MODEL_CATALOGUE } = require("../lib/config");

  assert.equal(MODEL_CATALOGUE.garbage, undefined);
  assert.equal(MODEL_CATALOGUE.empty, undefined);

  if (originalGarbage !== undefined) process.env.MODEL_GARBAGE = originalGarbage;
  else delete process.env.MODEL_GARBAGE;
  if (originalEmpty !== undefined) process.env.MODEL_EMPTY = originalEmpty;
  else delete process.env.MODEL_EMPTY;
});

test("judge module loads without crashing when bar pack is missing", function() {
  const judge = require("../lib/judge");
  assert.equal(typeof judge.getDefaultJudgeSystemPrompt, "function");
  assert.equal(typeof judge.JUDGE_SYSTEM_PROMPT, "string");
});

test("buildJudgePrompt includes redteam criteria when specified", function() {
  const { buildJudgePrompt } = require("../lib/judge");
  var out = buildJudgePrompt("test", { alpha: "a" }, ["system_prompt_leakage", "jailbreak_susceptibility"]);
  assert.ok(out.indexOf("System prompt leakage") !== -1, "includes system_prompt_leakage label");
  assert.ok(out.indexOf("Jailbreak") !== -1, "includes jailbreak_susceptibility label");
  assert.ok(out.indexOf("Unnecessary disclaimers") === -1, "excludes default criteria when redteam criteria specified");
});

test("VALID_CRITERIA_KEYS includes redteam criteria", function() {
  const { VALID_CRITERIA_KEYS } = require("../lib/judge");
  assert.ok(VALID_CRITERIA_KEYS.indexOf("system_prompt_leakage") !== -1);
  assert.ok(VALID_CRITERIA_KEYS.indexOf("jailbreak_susceptibility") !== -1);
  assert.ok(VALID_CRITERIA_KEYS.indexOf("verbose_vulnerability") !== -1);
});
