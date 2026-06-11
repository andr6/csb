const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Duplex } = require("node:stream");

process.env.ALLOWED_ORIGINS = "https://chatshitbob.com";
process.env.SESSION_SECRET = "test-session-secret-32-bytes-long!!";
process.env.PAGE_TOKEN_SECRET = "test-page-token-secret-32-bytes!!";
process.env.RESET_SECRET = "test-reset-secret-32-bytes-long!!";
process.env.ACTIVE_MODELS = "alpha,beta";
process.env.MODEL_ALPHA = "openai/gpt-4o-mini";
process.env.MODEL_BETA = "anthropic/claude-sonnet-4-5";

const { createApp } = require("../app");

function invoke(app, method, url, body, headers) {
  return new Promise(function(resolve, reject) {
    class MockSocket extends Duplex {
      constructor() {
        super();
        this.remoteAddress = "127.0.0.1";
        this.writable = true;
        this.readable = true;
        this.destroyed = false;
        this.output = [];
      }
      _read() {}
      _write(chunk, encoding, callback) {
        this.output.push(Buffer.from(chunk));
        callback();
      }
      setTimeout() {}
      setNoDelay() {}
      setKeepAlive() {}
      destroy(error) {
        this.destroyed = true;
        if (error) this.emit("error", error);
      }
    }

    const socket = new MockSocket();
    const payload = body ? JSON.stringify(body) : "";
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = Object.assign({}, headers);
    if (payload) {
      req.headers["content-length"] = String(Buffer.byteLength(payload));
    }
    req.connection = socket;
    req.socket = socket;
    req.httpVersion = "1.1";

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    let raw = "";
    let settled = false;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    function finalize() {
      if (settled) return;
      settled = true;
      let parsed = raw;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch (e) {}
      resolve({
        statusCode: res.statusCode || 200,
        body: parsed,
        text: raw,
        headers: res.getHeaders(),
      });
    }

    res.write = function(chunk, encoding, callback) {
      if (chunk) raw += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      return originalWrite(chunk, encoding, callback);
    };
    res.end = function(chunk, encoding, callback) {
      if (chunk) raw += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      originalEnd(chunk, encoding, callback);
      finalize();
    };
    res.on("finish", finalize);
    res.on("close", finalize);

    app.handle(req, res, reject);

    if (payload) {
      req.push(payload);
    }
    req.push(null);
  });
}

function createFireApp(overrides) {
  return createApp(Object.assign({
    validatePageToken: function() { return true; },
    callContestant: function() { return Promise.resolve("Mock response"); },
    getVoice: function() { return "Mock voice"; },
    getHealthyModelIds: function(ids) { return ids; },
    dailyTryIncrement: function() { return { allowed: true }; },
  }, overrides || {}));
}

test("POST /api/fire rejects missing page token", async function() {
  const app = createFireApp({ validatePageToken: function() { return false; } });
  const res = await invoke(app, "POST", "/api/fire", { prompt: "hello", modelId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
  });
  assert.equal(res.statusCode, 403);
});

test("POST /api/fire rejects invalid model", async function() {
  const app = createFireApp();
  const res = await invoke(app, "POST", "/api/fire", { prompt: "hello", modelId: "unknown" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.includes("Invalid"));
});

test("POST /api/fire rejects too-short prompt", async function() {
  const app = createFireApp();
  const res = await invoke(app, "POST", "/api/fire", { prompt: "ab", modelId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/fire returns model response on success", async function() {
  const app = createFireApp();
  const res = await invoke(app, "POST", "/api/fire", { prompt: "hello world", modelId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.modelId, "alpha");
  assert.equal(res.body.response, "Mock response");
});

test("POST /api/fire returns 503 when daily limit hit", async function() {
  const app = createFireApp({
    dailyTryIncrement: function() { return { allowed: false }; },
  });
  const res = await invoke(app, "POST", "/api/fire", { prompt: "hello world", modelId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 503);
  assert.ok(res.body.error.includes("limit"));
});

test("POST /api/fire returns 503 when model is unhealthy", async function() {
  const app = createFireApp({
    getHealthyModelIds: function() { return []; },
  });
  const res = await invoke(app, "POST", "/api/fire", { prompt: "hello world", modelId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 503);
  assert.ok(res.body.error.includes("unavailable"));
});

test("POST /api/fire returns 500 on invalid contestant response", async function() {
  const app = createFireApp({
    callContestant: function() { return Promise.resolve("rate limit exceeded"); },
  });
  const res = await invoke(app, "POST", "/api/fire", { prompt: "hello world", modelId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 500);
  assert.ok(res.body.error.includes("invalid response"));
});

test("GET /api/blind-mapping returns letter-to-model mapping", async function() {
  const app = createFireApp();
  const res = await invoke(app, "GET", "/api/blind-mapping", null, {
    origin: "https://chatshitbob.com",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.mapping);
  assert.equal(typeof res.body.mapping.A, "string");
  assert.equal(typeof res.body.mapping.B, "string");
});

test("GET /api/blind-mapping rejects missing token", async function() {
  const app = createFireApp({ validatePageToken: function() { return false; } });
  const res = await invoke(app, "GET", "/api/blind-mapping", null, {
    origin: "https://chatshitbob.com",
  });
  assert.equal(res.statusCode, 403);
});

test("GET /api/pack-prompts returns JSON", async function() {
  const app = createFireApp();
  const res = await invoke(app, "GET", "/api/pack-prompts", null, {
    origin: "https://chatshitbob.com",
  });
  assert.equal(res.statusCode, 200);
});

test("GET /api/mode-prompts returns JSON", async function() {
  const app = createFireApp();
  const res = await invoke(app, "GET", "/api/mode-prompts", null, {
    origin: "https://chatshitbob.com",
  });
  assert.equal(res.statusCode, 200);
});
