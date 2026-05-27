# CSB Improvement Plan — Fix the Bads, Enhance the Nonsensical

## Context

Deep audit of Chat Shit Bob identified 13 specific issues across security, reliability, operations, and design. This plan delivers fixes in three phases, preserving all 31 existing tests and adding new tests for every backend behavior change. No new npm dependencies.

---

## Phase 1: Security & Reliability (Foundation)

**Goal:** Fix data-integrity hazards, provider fragility, and silent failures before building on top of them.
**Estimated Effort:** ~2.5 days

### 1.1 Judge prompt escaping

**Problem:** `lib/judge.js:36` embeds the raw user prompt into the judge prompt string. A prompt containing `"` or newlines can break the JSON template the judge is asked to produce.

**Fix:** In `buildJudgePrompt`, replace:
```js
'ORIGINAL PROMPT: "' + prompt + '"',
```
with:
```js
"ORIGINAL PROMPT: " + JSON.stringify(prompt),
```

**Files:** `lib/judge.js`
**Test:** `test/smoke.test.js` — assert a prompt with quotes and newlines is safely escaped.

---

### 1.2 parseJudgeResponse structured fallback

**Problem:** `lib/judge.js:78` uses regex to repair broken JSON from judges. Can create valid-but-wrong data.

**Fix:** Refactor into a clear pipeline:
1. Raw parse
2. Inline JSON5-like normalizer (unquoted keys, single-quoted strings, trailing commas)
3. Existing regex repair (missing colons, trailing commas, unclosed braces)
4. Explicit failure with raw snippet in error message

**Files:** `lib/judge.js`
**Test:** `test/smoke.test.js` — tests for each stage and explicit failure with raw snippet.

---

### 1.3 Retry on contestant calls

**Problem:** `app.js:462` throws on any provider error with no retry. Transient blips kill benchmark runs.

**Fix:** Add a `withRetry(fn, opts)` helper in `lib/providers.js` with exponential backoff (max 2 retries, base 500ms). Do not retry 4xx client errors except 429 (rate limit) and 408 (timeout). Wrap `dispatch` calls in `callContestant` and `callJudge`.

**Files:** `lib/providers.js`, `lib/http.js` (reference for withTimeout)
**Test:** `test/api.test.js` — mock contestant that fails once with 502 then succeeds; assert 2 calls and 200 response.

---

### 1.4 Upstream health checks

**Problem:** `/api/health` only checks key presence. The app accepts `/api/fire` even if providers are down.

**Fix:** Enhance `GET /api/health` to perform lightweight reachability probes for each configured provider. Add `checkProviderHealth(provider, key)` in `lib/providers.js` using `fetchJson` or `withTimeout` to hit provider status endpoints. Return `providerStatus` map in response.

**Files:** `app.js` (enhance `/api/health`), `lib/providers.js` (new helper)
**Test:** `test/api.test.js` — assert `providerStatus` object is present in response.

---

## Phase 2: Operational / UX (Should Fix)

**Goal:** Improve resilience, observability, and frontend determinism.
**Estimated Effort:** ~2 days

### 2.1 Rate limit store persistence

**Problem:** `lib/rateLimitStore.js` silently falls back to in-memory `_mem` Map. Restart resets all counters.

**Fix:**
1. In `server.js`, explicitly call `require("./lib/migrations").applyPendingMigrations()` before `app.listen()` to ensure the `rate_limit_hits` table exists.
2. In `lib/rateLimitStore.js`, log a warning when SQLite fallback occurs instead of swallowing silently.
3. Remove try/catch around `pruneExpired` in `init` so startup errors are visible.

**Files:** `server.js`, `lib/rateLimitStore.js`
**Test:** `test/rateLimitStore.test.js` (new) — assert increments persist across store instances.

---

### 2.2 Webhook at-least-once delivery

**Problem:** `lib/webhook.js:6` fire-and-forget with 30s timeout. No retry, no visibility on failures.

**Fix:**
1. New migration `migrations/008_webhook_queue.sql` — `webhook_queue` table with `id, event_json, attempts, next_attempt_at, created_at, succeeded_at, last_error`.
2. New file `lib/webhookQueue.js` — `enqueueWebhook(event)`, `processWebhookQueue()`, `startWebhookProcessor(intervalMs)` using `setInterval` (pattern copied from `lib/metrics.js:startAutoSave`).
3. Modify `lib/webhook.js` — `notifyWebhook(event)` inserts into queue instead of calling `fetch` directly.
4. Modify `server.js` — after `app.listen()`, if `WEBHOOK_URL` is set, start the webhook processor (30s interval).

**Files:** `migrations/008_webhook_queue.sql` (new), `lib/webhookQueue.js` (new), `lib/webhook.js`, `server.js`
**Test:** `test/api.test.js` (assert enqueue on crown change), `test/webhookQueue.test.js` (new — retry logic).

---

### 2.3 Analytics query caching

**Problem:** Every `/api/stats` and `/api/analytics` hits complex `JSON_EXTRACT` queries. `/api/stats` has a 30s inline cache but `/api/analytics` and `/api/failures/summary` do not.

**Fix:**
1. Create `lib/cache.js` — simple in-memory TTL cache:
   ```js
   function createTtlCache(ttlMs) {
     const store = new Map();
     return {
       get(key) { /* ... */ },
       set(key, value) { /* ... */ },
       clear() { store.clear(); },
     };
   }
   ```
2. In `app.js`, add `_analyticsCache` (key = `JSON.stringify(req.query)`, TTL 30s) and `_failuresCache`.
3. On write mutations (`addAnalysisRun` in `/api/judge`, `/api/challenge`), call `_analyticsCache.clear()` and `_failuresCache.clear()`.

**Files:** `lib/cache.js` (new), `app.js`
**Test:** `test/api.test.js` — mock `getAnalysisAnalytics`, call `/api/analytics` twice, assert backend function called once.

---

### 2.4 Deterministic calcShitScore

**Problem:** `public/app.js:892` adds `Math.floor(Math.random()*12)` to symptom scores. Non-deterministic.

**Fix:** Replace random component with deterministic hash-based fuzz:
```js
function calcShitScore(text) {
  const syms = detectSymptoms(text);
  const base = syms.reduce(function(s, x) { return s + x.weight; }, 0);
  var hash = 0;
  for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) & 0xffffffff;
  var fuzz = Math.abs(hash) % 12;
  return Math.min(base + fuzz, 99);
}
```

**Files:** `public/app.js`
**Test:** Manual verification — same prompt produces identical score twice.

---

## Phase 3: Design Clarifications & UX Polish

**Goal:** Remove fragile defaults, add missing UI signals, clean DOM structure.
**Estimated Effort:** ~1.5 days

### 3.1 MODEL_CATALOGUE env validation

**Problem:** `lib/config.js:79` iterates all env vars matching `MODEL_*` with no validation. Empty strings or non-model values pollute the catalogue.

**Fix:** In `lib/config.js`, validate each value:
```js
if (!value || typeof value !== "string" || value.trim().length === 0) {
  console.warn("[config] Skipping empty model env var:", key);
  return;
}
if (!value.includes("/")) {
  console.warn("[config] Skipping model env var without provider prefix:", key, "=", value);
  return;
}
MODEL_CATALOGUE[id] = value.trim();
```

**Files:** `lib/config.js`
**Test:** `test/smoke.test.js` — temporarily set `process.env.MODEL_GARBAGE` and assert exclusion.

---

### 3.2 Social metadata for shareable runs

**Problem:** `/run/:id` is a frontend route but `index.html` has no OpenGraph/Twitter Card meta tags.

**Fix:**
1. In `public/index.html`, add static fallback OG/Twitter tags in `<head>`.
2. In `app.js`, add a dynamic route **before** the catch-all:
   ```js
   app.get("/run/:id", async function(req, res, next) {
     const run = getAnalysisRun(req.params.id);
     if (!run) return next();
     let html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
     const title = "CSB Run — " + (run.crownModelId || "unknown") + " took the crown";
     const desc = "Prompt: " + (run.prompt || "").slice(0, 160);
     html = html.replace("<title>CSB — Chat Shit Bob</title>", "<title>" + title + "</title>");
     html = html.replace(/<meta property=\"og:description\" content=\"[^\"]*\">/, '<meta property="og:description" content="' + desc + '">');
     const ogBlock = '<meta property="og:title" content="' + title + '"><meta property="og:description" content="' + desc + '">';
     html = html.replace("</head>", ogBlock + "</head>");
     res.setHeader("Content-Type", "text/html; charset=utf-8");
     res.send(html);
   });
   ```

**Files:** `app.js`, `public/index.html`
**Test:** `test/api.test.js` — assert `/run/run-1` returns HTML containing the crown model and prompt.

---

### 3.3 Multi-judge confidence badge

**Problem:** When `JUDGE_RUNS > 1`, `computeMedianScores` calculates `judgeConfidence` but the frontend never displays it.

**Fix:**
1. In `public/app.js`, when rendering the crown card, add a small colored badge:
   - `high` → green `#98c26f`
   - `medium` → yellow `#d9b869`
   - `low` → red `#ff7b68`
2. In `renderRunInspector`, add a "Judge Confidence" row showing the confidence map.

**Files:** `public/app.js`
**Test:** Manual verification with `JUDGE_RUNS=3`.

---

### 3.4 Lazy judgeSystemPrompt default

**Problem:** `lib/judge.js:6` sets `JUDGE_SYSTEM_PROMPT = getPack("bar").judgeSystemPrompt` at module load time. If the bar pack is removed, the app crashes on startup.

**Fix:**
1. In `lib/judge.js`, wrap the assignment in try/catch and export a `getDefaultJudgeSystemPrompt()` function.
2. In `app.js`, remove the top-level `JUDGE_SYSTEM_PROMPT` import (line 26). In the `/api/challenge` endpoint, use `getPack("bar").judgeSystemPrompt` directly since challenge doesn't use pack selector.

**Files:** `lib/judge.js`, `app.js`
**Test:** `test/smoke.test.js` — verify `require("../lib/judge")` does not throw.

---

### 3.5 Conditional moderation panel injection

**Problem:** The moderation panel container exists in `index.html` DOM even on the main page (`style="display:none"`).

**Fix:**
1. In `public/index.html`, remove the static moderation panel block.
2. In `public/app.js`, add `injectModerationPanel()` that creates the DOM only when `isAnalyticsPage` is true. Call it from `applyPageMode()`.

**Files:** `public/index.html`, `public/app.js`
**Test:** Manual verification — `#moderationPanel` absent on `/`, present on `/analytics`.

---

## Dependencies & Sequencing

| Phase | Items | Depends On |
|-------|-------|------------|
| 1 | 1.1, 1.2, 1.3, 1.4 | None |
| 2 | 2.1, 2.2, 2.3, 2.4 | 1.3 (retry logic makes webhook queue less critical) |
| 3 | 3.1, 3.2, 3.3, 3.4, 3.5 | 2.3 (analytics caching reduces load before OG tags served) |

## Test Preservation Checklist

Before each phase:
```bash
NODE_ENV=test node --test
```

- [ ] All 31 existing tests pass after Phase 1
- [ ] All 31 existing tests pass after Phase 2
- [ ] All 31 existing tests pass after Phase 3
- [ ] New tests added for every backend behavior change

## Critical Files for Implementation

- `lib/judge.js`
- `lib/providers.js`
- `app.js`
- `lib/rateLimitStore.js`
- `lib/webhook.js`
- `lib/webhookQueue.js` (new)
- `public/app.js`
- `public/index.html`
- `server.js`
- `lib/config.js`
- `lib/cache.js` (new)
- `migrations/008_webhook_queue.sql` (new)
