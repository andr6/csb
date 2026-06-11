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

function mockAuth(req, res, next) {
  req.user = { id: 1, email: "test@example.com", fullName: "Test", isAdmin: true };
  next();
}

var _lastTournamentId = 0;

const mockTournamentServices = {
  createBracket: function(models) {
    _lastTournamentId += 1;
    return {
      id: "t" + _lastTournamentId,
      models: models,
      bracketSize: models.length,
      rounds: [{ matches: [{ slotA: { id: models[0] }, slotB: { id: models[1] }, winner: null }] }],
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  },
  advanceWinner: function(tournament, roundIdx, matchIdx, winnerId) {
    var round = tournament.rounds[roundIdx];
    if (!round) return false;
    var match = round.matches[matchIdx];
    if (!match) return false;
    match.winner = winnerId;
    if (roundIdx === tournament.rounds.length - 1) {
      tournament.status = "complete";
      tournament.champion = winnerId;
    }
    return true;
  },
};

function createTournamentApp(overrides) {
  return createApp(Object.assign({
    tournamentServices: mockTournamentServices,
    authMiddleware: { requireAuth: mockAuth },
    validatePageToken: function() { return true; },
    dailyTryIncrement: function() { return { allowed: true }; },
    getVoice: function() { return "mock-voice"; },
    callContestant: function(id) { return Promise.resolve("Response from " + id); },
    callJudge: function() { return Promise.resolve("{\"crown\":\"alpha\",\"scores\":{\"alpha\":80,\"beta\":60}}"); },
    buildJudgePrompt: function(p, r) { return "judge:" + p; },
    parseJudgeResponse: function(r) { return r; },
    normalizeJudgePayload: function(j, ids) { return { crown: "alpha", scores: { alpha: 80, beta: 60 }, verdicts: {}, roast: "" }; },
    getPack: function() { return { judgeSystemPrompt: "mock" }; },
    addAnalysisRun: function() {},
    runSqlParams: function() {},
    queryJsonParams: function() { return []; },
  }, overrides || {}));
}

test("POST /api/tournament creates bracket with valid models", async function() {
  const app = createTournamentApp();
  const res = await invoke(app, "POST", "/api/tournament", { models: ["alpha", "beta"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.id);
  assert.equal(res.body.bracketSize, 2);
});

test("POST /api/tournament rejects too few models", async function() {
  const app = createTournamentApp();
  const res = await invoke(app, "POST", "/api/tournament", { models: ["alpha"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/tournament rejects missing page token", async function() {
  const app = createTournamentApp({ validatePageToken: function() { return false; } });
  const res = await invoke(app, "POST", "/api/tournament", { models: ["alpha", "beta"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
  });
  assert.equal(res.statusCode, 403);
});

test("GET /api/tournament/:id returns tournament", async function() {
  const app = createTournamentApp();
  const createRes = await invoke(app, "POST", "/api/tournament", { models: ["alpha", "beta"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  const id = createRes.body.id;
  const res = await invoke(app, "GET", "/api/tournament/" + id, null, {
    origin: "https://chatshitbob.com",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, id);
});

test("GET /api/tournament/:id returns 404 for unknown", async function() {
  const app = createTournamentApp();
  const res = await invoke(app, "GET", "/api/tournament/nonexistent", null, {
    origin: "https://chatshitbob.com",
  });
  assert.equal(res.statusCode, 404);
});

test("POST /api/tournament/:id/advance advances winner", async function() {
  const app = createTournamentApp();
  const createRes = await invoke(app, "POST", "/api/tournament", { models: ["alpha", "beta"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  const id = createRes.body.id;
  const res = await invoke(app, "POST", "/api/tournament/" + id + "/advance", { roundIdx: 0, matchIdx: 0, winnerId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.champion, "alpha");
});

test("POST /api/tournament/:id/run-match auto-runs match", async function() {
  const app = createTournamentApp();
  const createRes = await invoke(app, "POST", "/api/tournament", { models: ["alpha", "beta"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  const id = createRes.body.id;
  const res = await invoke(app, "POST", "/api/tournament/" + id + "/run-match", {
    roundIdx: 0,
    matchIdx: 0,
    prompt: "Tell me a joke",
    pack: "bar",
  }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.winnerId);
});

test("POST /api/tournament/:id/run-match skips decided match", async function() {
  const app = createTournamentApp();
  const createRes = await invoke(app, "POST", "/api/tournament", { models: ["alpha", "beta"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  const id = createRes.body.id;
  // Decide match first
  await invoke(app, "POST", "/api/tournament/" + id + "/advance", { roundIdx: 0, matchIdx: 0, winnerId: "alpha" }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  const res = await invoke(app, "POST", "/api/tournament/" + id + "/run-match", {
    roundIdx: 0, matchIdx: 0, prompt: "hello", pack: "bar",
  }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.skipped, true);
});

test("POST /api/tournament/:id/run-match rejects daily limit", async function() {
  const app = createTournamentApp({
    dailyTryIncrement: function() { return { allowed: false }; },
  });
  const createRes = await invoke(app, "POST", "/api/tournament", { models: ["alpha", "beta"] }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  const id = createRes.body.id;
  const res = await invoke(app, "POST", "/api/tournament/" + id + "/run-match", {
    roundIdx: 0, matchIdx: 0, prompt: "hello", pack: "bar",
  }, {
    origin: "https://chatshitbob.com",
    "content-type": "application/json",
    authorization: "Bearer test-token",
    "x-page-token": "test",
  });
  assert.equal(res.statusCode, 503);
});
