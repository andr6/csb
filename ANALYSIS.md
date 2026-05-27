# CSB Deep Analysis — Chat Shit Bob Audit

> Date: 2026-05-27
> Scope: Full-stack audit of `/opt/csb/app` — backend, frontend, operations, design
> Status: All 13 improvement items implemented and tested

---

## The Good

1. **Clean dependency-injection architecture** — `createApp(overrides)` makes every backend path testable without HTTP servers. MockSocket-based integration tests run via `node --test`.
2. **Dual SQLite driver strategy** — Native `better-sqlite3` with automatic `node-sqlite3-wasm` fallback. Handles stale prebuilds gracefully.
3. **Pack system** — 8 persona packs (bar, lab, midway, booth, news, globe, irc, rally) with provider-specific flavor text keeps the UX fresh without code changes.
4. **Analytics engine** — Cost estimation, budget caps, policy thresholds (promote/hold/demote), scenario planner, and lineup proposals. Real operational value.
5. **Rate limiting with SQLite persistence** — `lib/rateLimitStore.js` persists counters across restarts (when SQLite is available).
6. **Metrics auto-save** — Snapshots to SQLite every 5 minutes, loads on startup. Survives restarts.
7. **Frontend as a single deterministic artifact** — One 2400-line vanilla-JS file, no build step, loads fast.
8. **Run replay / diff** — Stash baseline scores and diff against reruns. Good for regression testing models.

---

## The Bad (Fixed)

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 1.1 | Judge prompt injection risk | `lib/judge.js:36` | `JSON.stringify(prompt)` instead of raw concatenation |
| 1.2 | Fragile JSON repair regex | `lib/judge.js:78` | 4-stage pipeline with JSON5-like normalizer (unquoted keys, trailing commas, single quotes) |
| 1.3 | No retry on transient provider failures | `app.js:462` | `withRetry()` in `lib/providers.js` — exponential backoff, 2 retries, skips 4xx except 429/408 |
| 1.4 | Health check only verifies key presence | `app.js /api/health` | `checkProviderHealth()` does HEAD probes with 5s timeout; returns `providerStatus` map |
| 2.1 | Rate limit table missing on fresh start | `server.js` | `applyPendingMigrations()` called before `app.listen()` |
| 2.2 | Webhook fire-and-forget, no retry | `lib/webhook.js` | SQLite-backed `webhook_queue` with `lib/webhookQueue.js`; up to 5 attempts with exponential backoff |
| 2.3 | Analytics queries uncached | `app.js` | `lib/cache.js` — 30s TTL caches for `/api/analytics` and `/api/failures/summary`; invalidate on writes |
| 2.4 | Non-deterministic `calcShitScore` | `public/app.js:892` | Hash-based fuzz instead of `Math.random()` |
| 3.1 | `MODEL_CATALOGUE` accepts garbage env vars | `lib/config.js:79` | Validation: skip empty values and entries without provider `/` prefix |
| 3.2 | No OpenGraph meta for shareable runs | `public/index.html` | Static OG/Twitter tags + dynamic `/run/:id` route injects run-specific title/description |
| 3.3 | `judgeConfidence` calculated but never shown | `lib/judge.js:75` | Crown card now shows colored badge (high/medium/low); run inspector displays confidence map |
| 3.4 | `JUDGE_SYSTEM_PROMPT` crashes if bar pack missing | `lib/judge.js:6` | Lazy default wrapped in try/catch; `getDefaultJudgeSystemPrompt()` exported |
| 3.5 | Moderation panel always in DOM | `public/index.html` | Removed static block; `injectModerationPanel()` creates it only on `/analytics` |

---

## What Doesn't Make Sense (Design Clarifications)

1. **`VALID_MODELS` vs `MODEL_MAP` vs `MODEL_CATALOGUE`** — Three overlapping structures. `CATALOGUE` is the raw env map, `ACTIVE_MODELS` filters it, `MODEL_MAP` is the final lookup. The indirection is intentional (env → active → mapped) but easy to confuse.
2. **`JUDGE_RUNS` median vs single-run path** — `computeMedianScores` only runs when `JUDGE_RUNS > 1`, but the frontend has no signal that multi-judge mode was used. The new confidence badge helps.
3. **`public/app.js` is 2400 lines** — Works for now, but any new feature increases the risk of merge conflicts and accidental global state leaks. Consider splitting into modules if the file crosses 3000 lines.
4. **`/api/runs/:id` and `/run/:id` are different things** — The API route returns JSON; the frontend route serves HTML. This is correct but the naming similarity confuses newcomers.
5. **`analyticsAuth` guards both the page and the API** — This is correct (Basic auth for both), but the name implies page-only. No change needed, just a mental note.

---

## New Functionality Suggestions

Based on the project's goal (AI-native cybersecurity benchmarking with offensive-to-defensive integration):

1. **Adversarial Prompt Injection Benchmark** — A dedicated pack that scores how well models resist jailbreaks, prompt injection, and social engineering. This aligns with the user's cybersecurity mission.
2. **Model Drift Detection** — Track score variance per model over time. Alert when a model's average score shifts by >15% week-over-week (indicates a stealth update or training change).
3. **Cost-Aware Auto-Rotation** — Instead of manual lineup proposals, an endpoint that automatically suggests the cheapest reliable model based on the last N runs and current pricing.
4. **Export to Markdown Report** — `GET /api/runs/:id/report` returns a styled markdown summary suitable for posting to GitHub issues or sharing with stakeholders.
5. **Scheduled Challenge Runner** — A cron-able endpoint (`POST /api/challenge/scheduled`) that runs the daily challenge, stores results, and optionally posts to a webhook/Slack. Reduces manual operation.
6. **Purple-Team Mode** — Two-phase judging: first an offensive model tries to break safety guardrails, then a defensive model scores the breach. This directly maps to the user's purple-team strategy.

---

## Test Summary

- **Total tests:** 37
- **Passing:** 35
- **Pre-existing failures:** 2 (`parseAllowedOrigins` www expansion test; `validatePrompt` length limit mismatch)
- **New tests added:** 8 (retry logic, health checks, analytics caching, webhook queue, judge escaping, judge JSON5, config validation, lazy judge prompt)

---

## Files Changed

- `lib/judge.js` — Prompt escaping, parseJudgeResponse pipeline, lazy default
- `lib/providers.js` — `withRetry()`, `checkProviderHealth()`
- `lib/config.js` — `MODEL_CATALOGUE` validation
- `lib/webhook.js` — Enqueue-only
- `lib/webhookQueue.js` — New: SQLite-backed retry queue
- `lib/cache.js` — New: TTL cache
- `lib/rateLimitStore.js` — Warning on fallback
- `app.js` — Health checks, analytics caching, `/run/:id` OG route, challenge uses pack prompt directly
- `server.js` — Migrations at startup, webhook processor startup
- `public/index.html` — OG meta tags, moderation panel removed
- `public/app.js` — Deterministic shit score, confidence badge, moderation panel injection
- `migrations/008_webhook_queue.sql` — New
- `test/providers.test.js` — New
- `test/webhookQueue.test.js` — New
- `test/smoke.test.js` — New tests for judge/config
- `test/api.test.js` — Health, caching, OG route tests
