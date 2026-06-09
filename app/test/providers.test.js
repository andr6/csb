const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.ACTIVE_MODELS = "alpha,beta";
process.env.MODEL_ALPHA = "openai/gpt-4o-mini";
process.env.MODEL_BETA = "anthropic/claude-sonnet-4-5";

const {
  registerProvider,
  getProvider,
  listProviders,
  dispatch,
  withRetry,
  checkProviderHealth,
  callContestant,
  callJudge,
  getHealthyModelIds,
} = require("../lib/providers");

const { runSqlParams } = require("../lib/sqlite");

function _resetHealth() {
  try { runSqlParams("DELETE FROM model_health_log;", []); } catch (e) {}
}

test("registerProvider adds provider to registry", function() {
  registerProvider("fake", {
    call: async function() { return "fake-result"; },
    healthProbe: async function() { return "reachable"; },
  });
  assert.ok(getProvider("fake"), "provider exists");
  assert.ok(listProviders().indexOf("fake") !== -1, "listed");
});

test("registerProvider throws on invalid name", function() {
  assert.throws(function() {
    registerProvider("", { call: async function() {} });
  }, /name must be a non-empty string/);
});

test("registerProvider throws on missing call", function() {
  assert.throws(function() {
    registerProvider("bad", {});
  }, /handler.call must be a function/);
});

test("dispatch calls registered provider", async function() {
  var called = false;
  registerProvider("dispatch-fake", {
    call: async function(model, system, userPrompt, key, timeoutMs, requestId, jsonMode) {
      called = true;
      assert.equal(model, "m1");
      return "dispatched";
    },
  });
  var result = await dispatch("dispatch-fake", "m1", "sys", "prompt", {}, 5000, "req-1", false);
  assert.equal(result, "dispatched");
  assert.equal(called, true);
});

test("dispatch throws for unknown provider", async function() {
  await assert.rejects(async function() {
    await dispatch("nonexistent", "m1", "sys", "prompt", {}, 5000, null, false);
  }, /Unknown provider: nonexistent/);
});

test("checkProviderHealth calls custom healthProbe", async function() {
  registerProvider("health-fake", {
    call: async function() { return "ok"; },
    healthProbe: async function(key) { return key === "good" ? "reachable" : "auth_failed"; },
  });
  var status = await checkProviderHealth("health-fake", "good");
  assert.equal(status, "reachable");
  var bad = await checkProviderHealth("health-fake", "bad");
  assert.equal(bad, "auth_failed");
});

test("checkProviderHealth returns missing_key when no key", async function() {
  var status = await checkProviderHealth("health-fake", null);
  assert.equal(status, "missing_key");
});

test("checkProviderHealth returns unknown for unregistered provider", async function() {
  var status = await checkProviderHealth("totally-unknown", "key");
  assert.equal(status, "unknown");
});

test("callContestant throws for unknown modelId and records failure", async function() {
  _resetHealth();
  await assert.rejects(async function() {
    await callContestant("nonexistent-model", "sys", "prompt", "req-1");
  });
  var stats = require("../lib/modelHealth").getRecentStats("nonexistent-model", 10);
  assert.equal(stats.calls, 1);
  assert.equal(stats.successes, 0);
});

test("callJudge throws when judge provider is not configured", async function() {
  // If judge provider is missing or model is missing, dispatch throws.
  await assert.rejects(async function() {
    await callJudge("sys", "prompt", "req-1");
  });
});

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

test("getHealthyModelIds filters out sick models", function() {
  _resetHealth();
  // Seed health data manually via modelHealth
  const { recordOutcome } = require("../lib/modelHealth");
  recordOutcome("model-a", true, null);
  recordOutcome("model-a", true, null);
  recordOutcome("model-a", true, null);
  recordOutcome("model-b", false, "err");
  recordOutcome("model-b", false, "err");
  recordOutcome("model-b", false, "err");
  var ids = getHealthyModelIds(["model-a", "model-b", "model-c"]);
  assert.ok(ids.indexOf("model-a") !== -1);
  assert.ok(ids.indexOf("model-b") === -1);
  assert.ok(ids.indexOf("model-c") !== -1); // no data = healthy
});
