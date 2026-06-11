const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validatePrompt,
  clampScore,
  validateContestantResponse,
  validateJudgeInput,
} = require("../lib/validation");

test("validatePrompt rejects null", function() {
  assert.equal(validatePrompt(null), "Prompt is required.");
});

test("validatePrompt rejects empty string", function() {
  assert.equal(validatePrompt(""), "Prompt is required.");
});

test("validatePrompt rejects non-string", function() {
  assert.equal(validatePrompt(123), "Prompt is required.");
});

test("validatePrompt rejects too short", function() {
  assert.equal(validatePrompt("ab"), "Prompt too short.");
});

test("validatePrompt rejects too long", function() {
  assert.equal(validatePrompt("x".repeat(1501)), "Prompt too long (max 1500 chars).");
});

test("validatePrompt accepts valid prompt", function() {
  assert.equal(validatePrompt("What is the meaning of life?"), null);
});

test("validatePrompt accepts exactly 1500 chars", function() {
  assert.equal(validatePrompt("x".repeat(1500)), null);
});

test("clampScore clamps negative to 0", function() {
  assert.equal(clampScore(-10), 0);
});

test("clampScore clamps >100 to 100", function() {
  assert.equal(clampScore(150), 100);
});

test("clampScore rounds floats", function() {
  assert.equal(clampScore(45.4), 45);
  assert.equal(clampScore(45.6), 46);
});

test("clampScore rejects NaN/Infinity to 0", function() {
  assert.equal(clampScore(NaN), 0);
  assert.equal(clampScore(Infinity), 0);
});

test("validateContestantResponse rejects null", function() {
  var r = validateContestantResponse(null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "Empty or non-string response.");
});

test("validateContestantResponse rejects empty string", function() {
  var r = validateContestantResponse("   ");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "Empty response.");
});

test("validateContestantResponse rejects HTML doctype", function() {
  var r = validateContestantResponse("<!DOCTYPE html><html>");
  assert.equal(r.ok, false);
});

test("validateContestantResponse rejects rate limit text", function() {
  var r = validateContestantResponse("Rate limit exceeded, try again later.");
  assert.equal(r.ok, false);
});

test("validateContestantResponse rejects JSON error", function() {
  var r = validateContestantResponse('{\"error\":\"invalid\"}');
  assert.equal(r.ok, false);
});

test("validateContestantResponse accepts normal text", function() {
  var r = validateContestantResponse("The sky is blue because of Rayleigh scattering.");
  assert.equal(r.ok, true);
});

test("validateContestantResponse accepts text with a few HTML-like tags", function() {
  var r = validateContestantResponse("Use <code>print()</code> in Python.");
  assert.equal(r.ok, true);
});

test("validateJudgeInput rejects non-object", function() {
  var r = validateJudgeInput("not an object");
  assert.equal(r.ok, false);
});

test("validateJudgeInput rejects per-response overflow", function() {
  var r = validateJudgeInput({ a: "x".repeat(10001) }, 50000, 10000);
  assert.equal(r.ok, false);
  assert.ok(r.reason.indexOf("a") !== -1);
});

test("validateJudgeInput rejects total overflow", function() {
  var r = validateJudgeInput({ a: "x".repeat(30000), b: "x".repeat(21000) }, 50000, 100000);
  assert.equal(r.ok, false);
  assert.ok(r.reason.indexOf("Total") !== -1);
});

test("validateJudgeInput accepts within limits", function() {
  var r = validateJudgeInput({ a: "hello", b: "world" });
  assert.equal(r.ok, true);
});

test("validateJudgeInput uses custom limits", function() {
  var r = validateJudgeInput({ a: "hello" }, 3, 100);
  assert.equal(r.ok, false);
  assert.ok(r.reason.indexOf("Total") !== -1);
});
