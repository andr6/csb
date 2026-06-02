# CSB Refactor & Hardening Plan

> Addresses all items from the Deep Analysis: backend decomposition, frontend modularization, data layer hardening, auth improvements, judge pipeline reliability, and observability.

---

## Problem

CSB has accumulated significant technical debt across four dimensions:
1. **Monoliths**: `app.js` (1,756 lines) and `public/app.js` (4,104 lines) are unmaintainable at current scale.
2. **Ephemeral State**: Tournament brackets, security events, and metrics lack persistence/rollup.
3. **Fragile Pipelines**: Judge JSON parsing is regex-heuristic; no request tracing; provider dispatch is a hardcoded switch.
4. **Auth Overreach**: Four concurrent auth mechanisms (~1,500 lines) for a benchmarking tool, with security gaps (plaintext reset tokens, admin password in stdout).

## Vision

A decomposed backend with clear route ownership, a modular frontend with bounded state, persistent tournament brackets, a queryable audit trail, hardened judge validation with schema enforcement, request-ID tracing end-to-end, a provider plugin interface, and an auth system stripped to its essential value.

## Out of Scope

- Rewriting the frontend in React/Vue/Svelte (stay vanilla JS, just modularized)
- Removing the auth system entirely (still needed for custom mode gating)
- Adding new npm dependencies beyond what's installed
- Changing the core scoring/judging algorithm
- Mobile app or SPA architecture

## Principles

1. **Decomposition over monolith** — Split by domain (auth, analytics, fire/judge, tournament, prompts)
2. **Persistence over memory** — Tournament brackets and security events survive restarts
3. **Schema over regex** — Judge responses validated structurally after parsing
4. **Traceability over guesswork** — Every multi-model run carries a correlation ID
5. **Explicit over implicit** — `VALID_MODELS` renamed to `ACTIVE_MODEL_IDS`; domain language clarified

## Constraints

- No new npm dependencies (use what we have: Express, SQLite, bcrypt, nodemailer, etc.)
- All existing tests must pass after each phase
- Frontend stays vanilla JS with `<script type="module">`
- SQLite-first for new tables (fallback to JSON if SQLite unavailable)
- Maintain backward compatibility on all `/api/*` routes

## Goal

Ship all improvements in 5 phases, each independently verifiable, leaving CSB decomposed, hardened, and operationally transparent.

## Criteria

### Phase 1 — Backend Route Decomposition
- [ ] ISC-1: `routes/` directory exists with `auth.js`, `fire.js`, `analytics.js`, `tournament.js`, `prompts.js`, `health.js`
- [ ] ISC-2: `app.js` is ≤ 400 lines (wiring + middleware only)
- [ ] ISC-3: All existing `/api/*` routes respond identically (backward compatible)
- [ ] ISC-4: `npm test` exits 0 after decomposition

### Phase 2 — Frontend Modularization
- [ ] ISC-5: `public/app.js` split into `js/state.js`, `js/api.js`, `js/ui.js`, `js/modes.js`, `js/tournament.js`, `js/analytics.js`
- [ ] ISC-6: `public/index.html` loads `<script type="module" src="js/app.js">`
- [ ] ISC-7: Global `var` state eliminated; `state.js` exports a single state container
- [ ] ISC-8: `npm test` still passes; no console errors on page load

### Phase 3 — Data Layer Hardening
- [ ] ISC-9: Migration `017_tournaments.sql` creates `tournaments` table with `id, models_json, bracket_json, status, created_at, completed_at`
- [ ] ISC-10: `lib/tournament.js` reads/writes brackets to SQLite; in-memory Map is cache only
- [ ] ISC-11: Migration `018_security_events.sql` creates `security_events` table
- [ ] ISC-12: All `console.log(JSON.stringify({ type: "security", ... }))` replaced with `auditLog.insert()`
- [ ] ISC-13: `lib/metrics.js` adds hourly rollup table `metrics_hourly` with automatic aggregation
- [ ] ISC-14: `npm test` exits 0

### Phase 4 — Judge, Provider, & Observability
- [ ] ISC-15: `lib/judge.js` adds `validateJudgePayload()` with schema enforcement (numeric scores, crown in scores, verdicts present, roast string)
- [ ] ISC-16: Invalid judge payloads rejected at normalization stage with descriptive error
- [ ] ISC-17: `lib/providers.js` refactored to plugin-based dispatch (`registerProvider(name, handler)`)
- [ ] ISC-18: Health checks perform lightweight POST probe (not just HEAD) where supported
- [ ] ISC-19: Express middleware adds `req.requestId = crypto.randomUUID()` to all inbound requests
- [ ] ISC-20: `callContestant` and `callJudge` propagate `requestId` via custom header and log with it
- [ ] ISC-21: `npm test` exits 0

### Phase 5 — Auth & Security Cleanup
- [ ] ISC-22: `seedAdminUser()` stores password hash in SQLite instead of printing to console; one-time setup flag prevents re-generation
- [ ] ISC-23: Password reset flow uses time-limited signed URL (`/reset?token=&sig=&exp=`) instead of raw token in email
- [ ] ISC-24: `VALID_MODELS` renamed to `ACTIVE_MODEL_IDS` across codebase (`lib/config.js`, `lib/judge.js`, all routes)
- [ ] ISC-25: `analyticsAuth` middleware renamed to `requireAdminAccess` (Basic + Bearer)
- [ ] ISC-26: Daily challenge endpoint supports cron trigger via query param (`?trigger=cron`) with skip-if-already-run logic
- [ ] ISC-27: Blind taste test mapping generated server-side (`/api/blind-mapping`) and returned in run response
- [ ] ISC-28: Graceful shutdown handler added to `server.js` (SIGTERM → save metrics, close webhook queue, close DB)
- [ ] ISC-29: `npm test` exits 0

## Test Strategy

| ISC | Type | Check | Tool |
|-----|------|-------|------|
| ISC-1,2 | code | `ls routes/` + `wc -l app.js` | Bash |
| ISC-3 | test | `npm test` + spot-check `/api/*` responses | Bash + Read |
| ISC-5,6 | code | `ls public/js/` + grep `<script type="module"` in index.html | Bash |
| ISC-7 | code | grep `var _pageToken` in public/js/* → should not exist | Grep |
| ISC-9,10 | schema | cat migrations/017_tournaments.sql + read lib/tournament.js | Read |
| ISC-11,12 | schema + code | grep `security_events` in migrations + grep `auditLog` in app.js | Grep |
| ISC-13 | code | grep `metrics_hourly` in lib/metrics.js | Grep |
| ISC-15,16 | code | read lib/judge.js validateJudgePayload | Read |
| ISC-17 | code | grep `registerProvider` in lib/providers.js | Grep |
| ISC-18 | code | read lib/providers.js checkProviderHealth | Read |
| ISC-19,20 | code | grep `requestId` in app.js + lib/providers.js | Grep |
| ISC-22 | code | grep `seedAdminUser` in app.js → no console.log password | Grep |
| ISC-23 | code | read `/api/auth/reset-password` handler | Read |
| ISC-24 | code | grep `VALID_MODELS` → should find 0 hits | Grep |
| ISC-25 | code | grep `analyticsAuth` → should find 0 hits | Grep |
| ISC-28 | code | grep `SIGTERM` in server.js | Grep |
| All | test | `npm test` | Bash |

## Features

| Feature | Description | Satisfies | Depends On |
|---------|-------------|-----------|------------|
| P1-route-decomp | Split app.js into routes/ directory | ISC-1,2,3,4 | None |
| P2-frontend-mod | Split public/app.js into ES modules | ISC-5,6,7,8 | None |
| P3-tournament-persist | SQLite-backed tournament brackets | ISC-9,10 | P1-route-decomp |
| P3-audit-trail | security_events table + audit logger | ISC-11,12 | P1-route-decomp |
| P3-metrics-rollup | Hourly metrics aggregation | ISC-13 | P1-route-decomp |
| P4-judge-schema | Schema validation after parse | ISC-15,16 | None |
| P4-provider-plugin | Register-based provider dispatch | ISC-17 | None |
| P4-health-post | POST probe health checks | ISC-18 | P4-provider-plugin |
| P4-request-id | Correlation ID propagation | ISC-19,20 | P1-route-decomp |
| P5-admin-setup | One-time admin seed, no stdout password | ISC-22 | P3-audit-trail |
| P5-reset-url | Signed URL password reset | ISC-23 | P5-admin-setup |
| P5-rename-models | VALID_MODELS → ACTIVE_MODEL_IDS | ISC-24 | P1-route-decomp |
| P5-rename-auth | analyticsAuth → requireAdminAccess | ISC-25 | P1-route-decomp |
| P5-daily-cron | Cron-aware daily challenge | ISC-26 | P1-route-decomp |
| P5-blind-server | Server-side blind mapping | ISC-27 | P2-frontend-mod |
| P5-graceful | SIGTERM graceful shutdown | ISC-28 | P1-route-decomp |

## Decisions

1. **Route decomposition pattern**: Each `routes/*.js` exports a factory `createRouter(deps)` that receives the same `deps` object `createApp` uses. This preserves dependency injection for testability.
2. **Frontend module split boundary**: `state.js` owns all mutable globals. `api.js` owns all `fetch()` calls. `ui.js` owns DOM helpers. `modes.js` owns pack/mode logic. `tournament.js` owns bracket UI. `analytics.js` owns the analytics page. No cross-import cycles.
3. **Tournament persistence strategy**: Bracket JSON stored in SQLite; in-memory Map used as read-through cache. On server start, load pending tournaments from DB into Map.
4. **Audit trail scope**: Capture `account_lock`, `password_change`, `otp_exhausted`, `oauth_login`, `email_updated`, `phone_updated`, `failed_login`, `password_reset_requested/completed`, `run_created`, `crown_change`.
5. **Judge schema validation**: After `parseJudgeResponse()` succeeds, `validateJudgePayload()` checks: (a) `scores` is object with all numeric values 0-100, (b) `crown` exists in `scores`, (c) `verdicts` has entries for all scored models as strings ≤240 chars, (d) `roast` is string ≤400 chars. Any failure throws with specific field name.
6. **Provider plugin interface**: `registerProvider(name, { call: async fn, healthProbe: async fn })`. `dispatch()` looks up in registry. Default registry seeded with existing 5 providers at startup.
7. **Health POST probe**: For providers that support a lightweight completion call (e.g., max_tokens=1), send a real inference request. For others, keep HEAD. Configurable per provider.
8. **Request ID propagation**: `X-Request-ID` header on provider calls. Log prefix `[req:{id}]` on all `[fire]`, `[judge]`, `[challenge]` logs.
9. **Admin password fix**: On first startup, if no admin exists, generate password, hash it, store in `app_settings` table (new key `admin_password_hash`), print a one-time setup URL with a signed token (not the raw password). After first login, flag `admin_setup_complete = 1`.
10. **Password reset signed URL**: Token + HMAC-SHA256 signature + expiry timestamp in URL params. Server validates signature on arrival. No raw token in email body.
11. **Naming change**: `VALID_MODELS` → `ACTIVE_MODEL_IDS` because it is literally "the currently active model IDs" — not "all valid models in the catalogue." This eliminates the cognitive dissonance.
12. **Blind mapping server-side**: `/api/blind-mapping` generates mapping server-side, returns it in the run response. Client cannot tamper. Mapping stored in run execution_json.
13. **Graceful shutdown**: On SIGTERM/SIGINT, drain HTTP connections (10s max), save metrics snapshot, flush webhook queue, close SQLite DB, exit 0.

## Verification

- `npm test` passes after each phase (not just at the end)
- `node -e "require('./server')"` loads cleanly
- `curl /api/health` returns `status: "ok"` with requestId present
- Tournament creation + server restart + GET `/api/tournament/:id` returns persisted bracket
- Security event after login appears in `security_events` table
- Metrics older than 7 days exist in `metrics_hourly` rollup
- Judge returns schema-invalid JSON → run stored as failure with `phase: "judge_schema"`
- Provider health check for OpenRouter returns `reachable` or `auth_failed` (not just `reachable`/`timeout`)
- grep `VALID_MODELS` codebase → 0 hits
- grep `analyticsAuth` codebase → 0 hits
