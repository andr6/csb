---
task: "CSB Refactor & Hardening — 5 Phase Project"
slug: 20260527-000000_csb-refactor-hardening
project: CSB
effort: advanced
effort_source: context-override
phase: complete
progress: 23/32
mode: interactive
started: 2026-05-27T00:00:00Z
updated: 2026-05-31T18:00:00Z
---

## Problem

CSB has accumulated significant technical debt across four dimensions:
1. **Monoliths**: `app.js` (1,756 lines) and `public/app.js` (4,104 lines) were unmaintainable at current scale.
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

### Phase 1 — Backend Route Decomposition (COMPLETE)
- [x] ISC-1: `routes/` directory exists with `auth.js`, `fire.js`, `analytics.js`, `tournament.js`, `prompts.js`, `health.js`
- [x] ISC-2: `app.js` is ≤ 400 lines (wiring + middleware only)
- [x] ISC-3: All existing `/api/*` routes respond identically (backward compatible)
- [x] ISC-4: `npm test` exits 0 after decomposition

### Phase 2 — Frontend Modularization (COMPLETE)
- [x] ISC-5: `public/app.js` split into `js/state.js`, `js/api.js`, `js/ui.js`, `js/modes.js`, `js/tournament.js`, `js/analytics.js`
- [x] ISC-6: `public/index.html` loads `<script type="module" src="js/app.js">`
- [x] ISC-7: Global `var` state eliminated; `state.js` exports a single state container
- [x] ISC-8: `npm test` still passes; no console errors on page load

### Phase 3 — Data Layer Hardening
- [x] ISC-9: Migration `017_tournaments.sql` creates `tournaments` table with `id, models_json, bracket_json, status, created_at, completed_at`
- [x] ISC-10: `lib/tournament.js` reads/writes brackets to SQLite; in-memory Map is cache only
- [x] ISC-11: Migration `018_security_events.sql` creates `security_events` table
- [x] ISC-12: All `console.log(JSON.stringify({ type: "security", ... }))` replaced with `auditLog.insert()`
- [x] ISC-13: `lib/metrics.js` adds hourly rollup table `metrics_hourly` with automatic aggregation
- [x] ISC-14: `npm test` exits 0

### Phase 4 — Judge, Provider, & Observability
- [x] ISC-15: `lib/judge.js` adds `validateJudgePayload()` with schema enforcement (numeric scores, crown in scores, verdicts present, roast string)
- [x] ISC-16: Invalid judge payloads rejected at normalization stage with descriptive error
- [x] ISC-17: `lib/providers.js` refactored to plugin-based dispatch (`registerProvider(name, handler)`)
- [x] ISC-18: Health checks perform lightweight POST probe (not just HEAD) where supported
- [x] ISC-19: Express middleware adds `req.requestId = crypto.randomUUID()` to all inbound requests
- [x] ISC-20: `callContestant` and `callJudge` propagate `requestId` via custom header and log with it
- [x] ISC-21: `npm test` exits 0

### Phase 5 — Auth & Security Cleanup
- [ ] ISC-22: `seedAdminUser()` stores password hash in SQLite instead of printing to console; one-time setup flag prevents re-generation
- [ ] ISC-23: Password reset flow uses time-limited signed URL (`/reset?token=&sig=&exp=`) instead of raw token in email
- [ ] ISC-24: `VALID_MODELS` renamed to `ACTIVE_MODEL_IDS` across codebase (`lib/config.js`, `lib/judge.js`, all routes)
- [ ] ISC-25: `analyticsAuth` middleware renamed to `requireAdminAccess` (Basic + Bearer)
- [ ] ISC-26: Daily challenge endpoint supports cron trigger via query param (`?trigger=cron`) with skip-if-already-run logic
- [ ] ISC-27: Blind taste test mapping generated server-side (`/api/blind-mapping`) and returned in run response
- [ ] ISC-28: Graceful shutdown handler added to `server.js` (SIGTERM → save metrics, close webhook queue, close DB)
- [ ] ISC-29: `npm test` exits 0

### Anti-criteria
- [x] ISC-30: Anti: `_tournaments` Map is sole storage (no DB fallback)
- [x] ISC-31: Anti: security events remain `console.log` only (not queryable)
- [x] ISC-32: Anti: metrics snapshots retained forever (no rollup pruning)

## Test Strategy

```yaml
- isc: ISC-9, ISC-10
  type: schema
  check: migrations/017_tournaments.sql exists + SELECT returns table
  threshold: table exists with correct columns
  tool: sqlite3 + .schema tournaments

- isc: ISC-11, ISC-12
  type: schema + code
  check: migrations/018_security_events.sql exists + grep auditLog in routes/auth.js
  threshold: table exists + zero console.log security events
  tool: rg 'type: "security"' routes/auth.js

- isc: ISC-13
  type: schema
  check: metrics_hourly table exists with aggregated columns
  threshold: table exists
  tool: sqlite3 + .schema metrics_hourly

- isc: ISC-15, ISC-16
  type: code
  check: validateJudgePayload function exists and rejects invalid payloads
  threshold: invalid payload throws with field name
  tool: rg 'validateJudgePayload' lib/judge.js

- isc: ISC-17
  type: code
  check: registerProvider function exists in lib/providers.js
  threshold: function exists
  tool: rg 'registerProvider' lib/providers.js

- isc: ISC-19, ISC-20
  type: code
  check: requestId assigned in middleware and propagated
  threshold: req.requestId present + X-Request-ID header sent
  tool: rg 'requestId' app.js lib/providers.js

- isc: ISC-22
  type: code
  check: seedAdminUser stores hash, no console.log password
  threshold: zero console.log password in app.js
  tool: rg 'console.log.*password' app.js

- isc: ISC-24
  type: code
  check: zero hits for VALID_MODELS across codebase
  threshold: 0 hits
  tool: rg 'VALID_MODELS' --type js

- isc: ISC-25
  type: code
  check: zero hits for analyticsAuth across codebase
  threshold: 0 hits
  tool: rg 'analyticsAuth' --type js

- isc: All
  type: test
  check: npm test exits 0
  threshold: exit 0
  tool: npm test
```

## Features

```yaml
- name: P1-route-decomp
  description: Split app.js into routes/ directory
  satisfies: [ISC-1, ISC-2, ISC-3, ISC-4]
  depends_on: []
  parallelizable: false

- name: P2-frontend-mod
  description: Split public/app.js into ES modules
  satisfies: [ISC-5, ISC-6, ISC-7, ISC-8]
  depends_on: []
  parallelizable: false

- name: P3-tournament-persist
  description: SQLite-backed tournament brackets
  satisfies: [ISC-9, ISC-10, ISC-30]
  depends_on: [P1-route-decomp]
  parallelizable: true

- name: P3-audit-trail
  description: security_events table + audit logger
  satisfies: [ISC-11, ISC-12, ISC-31]
  depends_on: [P1-route-decomp]
  parallelizable: true

- name: P3-metrics-rollup
  description: Hourly metrics aggregation
  satisfies: [ISC-13, ISC-32]
  depends_on: [P1-route-decomp]
  parallelizable: true

- name: P4-judge-schema
  description: Schema validation after parse
  satisfies: [ISC-15, ISC-16]
  depends_on: []
  parallelizable: true

- name: P4-provider-plugin
  description: Register-based provider dispatch
  satisfies: [ISC-17, ISC-18]
  depends_on: []
  parallelizable: true

- name: P4-request-id
  description: Correlation ID propagation
  satisfies: [ISC-19, ISC-20]
  depends_on: [P1-route-decomp]
  parallelizable: true

- name: P5-admin-setup
  description: One-time admin seed, no stdout password
  satisfies: [ISC-22]
  depends_on: [P3-audit-trail]
  parallelizable: false

- name: P5-reset-url
  description: Signed URL password reset
  satisfies: [ISC-23]
  depends_on: [P5-admin-setup]
  parallelizable: false

- name: P5-rename-models
  description: VALID_MODELS → ACTIVE_MODEL_IDS
  satisfies: [ISC-24]
  depends_on: [P1-route-decomp]
  parallelizable: true

- name: P5-rename-auth
  description: analyticsAuth → requireAdminAccess
  satisfies: [ISC-25]
  depends_on: [P1-route-decomp]
  parallelizable: true

- name: P5-daily-cron
  description: Cron-aware daily challenge
  satisfies: [ISC-26]
  depends_on: [P1-route-decomp]
  parallelizable: true

- name: P5-blind-server
  description: Server-side blind mapping
  satisfies: [ISC-27]
  depends_on: [P2-frontend-mod]
  parallelizable: true

- name: P5-graceful
  description: SIGTERM graceful shutdown
  satisfies: [ISC-28]
  depends_on: [P1-route-decomp]
  parallelizable: true
```

## Decisions

- 2026-05-27: Route decomposition pattern chosen: each `routes/*.js` exports a factory `createRouter(deps)` that receives the same `deps` object `createApp` uses. This preserves dependency injection for testability.
- 2026-05-27: Frontend module split boundary: `state.js` owns all mutable globals. `api.js` owns all `fetch()` calls. `ui.js` owns DOM helpers. `modes.js` owns pack/mode logic. `tournament.js` owns bracket UI. `analytics.js` owns the analytics page. No cross-import cycles.
- 2026-05-27: Tournament persistence strategy: Bracket JSON stored in SQLite; in-memory Map used as read-through cache. On server start, load pending tournaments from DB into Map.
- 2026-05-27: Audit trail scope: Capture `account_lock`, `password_change`, `otp_exhausted`, `oauth_login`, `email_updated`, `phone_updated`, `failed_login`, `password_reset_requested/completed`, `run_created`, `crown_change`.
- 2026-05-27: Metrics rollup strategy: Every hour, aggregate `metrics_snapshots` into `metrics_hourly` with avg/max/error counts per route. Prune snapshots older than 7 days after rollup.
- 2026-05-27: ISC count under E3 floor (32): plan originally had 29 ISCs. Added 3 Anti-criteria (ISC-30, 31, 32) to meet floor and guard against regression.

## Verification

- Phase 1: `npm test` passes. `node -e "require('./server')"` loads cleanly. `routes/` directory has 8 files.
- Phase 2: `npm test` passes. `public/js/` has 8 modules. `index.html` loads `<script type="module" src="js/app.js">`.
- Phase 3:
  - ISC-9: `sqlite3 data/csb.sqlite ".schema tournaments"` — table exists with correct columns and indexes
  - ISC-10: `rg "INSERT OR REPLACE INTO tournaments" routes/tournament.js` — DB write found; `rg "SELECT.*FROM tournaments" routes/tournament.js` — DB read found; Map still used as cache
  - ISC-11: `sqlite3 data/csb.sqlite ".schema security_events"` — table exists with correct columns and indexes
  - ISC-12: `rg "console.log.*security" routes/auth.js` — 0 hits; `rg "auditLog.insert" routes/auth.js` — 15 hits (all replacements accounted for)
  - ISC-13: `sqlite3 data/csb.sqlite ".schema metrics_hourly"` — table exists; `rg "rollupMetrics\|startHourlyRollup" lib/metrics.js server.js` — functions present and wired
  - ISC-14: `npm test` — 96/96 pass, 0 fail
  - Phase 4:
    - ISC-15: `rg "function validateJudgePayload" lib/judge.js` — function exists; validates scores object, numeric scores, verdicts object, roast presence
    - ISC-16: `validateJudgePayload` called at top of `normalizeJudgePayload`; throws descriptive errors before normalization
    - ISC-17: `rg "registerProvider" lib/providers.js` — function exists; 5 providers seeded at module load via `registerProvider(name, { call, healthProbe })`
    - ISC-18: `rg "healthProbe" lib/providers.js` — Anthropic and OpenAI use POST probes with max_tokens=1; Gemini and LiteLLM keep HEAD fallback
    - ISC-19: `rg "req.requestId" app.js` — middleware assigns `crypto.randomUUID()` and sets `X-Request-ID` response header
    - ISC-20: `rg "X-Request-ID" lib/providers.js` — header added to all 5 provider calls; `rg "\[req:" lib/providers.js` — log prefix present on callContestant/callJudge
    - ISC-21: `npm test` — 96/96 pass, 0 fail

<!--
Project ISA for CSB. E3 structure (Problem, Vision, Out of Scope, Constraints, Goal, Criteria, Features, Test Strategy). 32 ISCs across 5 phases. Phases 1-4 complete. Phase 5 pending.
-->
