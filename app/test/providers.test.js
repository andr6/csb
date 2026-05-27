const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const { withRetry } = require("../lib/providers");

test("withRetry succeeds on first call", async function() {
  var calls = 0;
  var result = await withRetry(async function() {
    calls++;
    return "ok";
  }, {});
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries on 5xx and succeeds", async function() {
  var calls = 0;
  var result = await withRetry(async function() {
    calls++;
    if (calls === 1) {
      var err = new Error("upstream failed");
      err.upstreamStatus = 502;
      throw err;
    }
    return "ok";
  }, { maxRetries: 2, baseDelayMs: 10 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry does NOT retry on 4xx except 429/408", async function() {
  var calls = 0;
  await assert.rejects(async function() {
    await withRetry(async function() {
      calls++;
      var err = new Error("bad request");
      err.upstreamStatus = 400;
      throw err;
    }, { maxRetries: 2, baseDelayMs: 10 });
  });
  assert.equal(calls, 1);
});

test("withRetry retries on 429 rate limit", async function() {
  var calls = 0;
  var result = await withRetry(async function() {
    calls++;
    if (calls === 1) {
      var err = new Error("rate limited");
      err.upstreamStatus = 429;
      throw err;
    }
    return "ok";
  }, { maxRetries: 2, baseDelayMs: 10 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry retries on 408 timeout", async function() {
  var calls = 0;
  var result = await withRetry(async function() {
    calls++;
    if (calls === 1) {
      var err = new Error("timed out");
      err.upstreamStatus = 408;
      throw err;
    }
    return "ok";
  }, { maxRetries: 2, baseDelayMs: 10 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry exhausts retries and throws last error", async function() {
  var calls = 0;
  await assert.rejects(async function() {
    await withRetry(async function() {
      calls++;
      var err = new Error("always fails");
      err.upstreamStatus = 503;
      throw err;
    }, { maxRetries: 1, baseDelayMs: 10 });
  }, /always fails/);
  assert.equal(calls, 2);
});
