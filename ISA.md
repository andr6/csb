---
task: Implement 10 new CSB features
slug: csb-features
effort: advanced
phase: complete
progress: 49/49
mode: algorithm
started: 2026-05-23
updated: 2026-05-24
project: csb
---

## Problem

CSB lacks viral sharing, engagement depth, and operator tooling. No way to share a specific run result, no head-to-head comparison, no webhook alerts, no scheduled daily challenge, no crowd-sourced prompts, no pattern analytics, no custom scoring, and no consensus judge scoring.

## Vision

Every completed run is shareable with one URL. Operators get webhook alerts when crowns change. Daily challenges run automatically. Community prompts accumulate. Analytics show AI-speak fingerprints per model. Custom judge criteria let users tune what "shitty" means. All delivered without breaking the existing 26 tests.

## Out of Scope

OAuth/user accounts. Native mobile app. Full SPA refactor. Paid tiers.

## Constraints

- No new npm dependencies beyond what's already installed
- All new endpoints follow existing auth patterns (public vs analyticsAuth)
- JUDGE_RUNS defaults to 1 — F3 is opt-in, zero behavior change unless configured
- Frontend additions to index.html must not break existing mode/leaderboard/analytics flows

## Goal

Ship all 10 features: webhook (F5), shareable URLs (F1), head-to-head (F7), model profiles (F2), prompt replay (F4), daily challenge (F8), pattern analytics (F6), custom judge (F9), crowd curation (F10), multi-judge consensus (F3).

## Criteria

- [x] ISC-1: `lib/webhook.js` exports `notifyWebhook(event)`
- [x] ISC-2: `lib/config.js` exports `WEBHOOK_URL`
- [x] ISC-3: `app.js` calls `notifyWebhook` in judge success path when crown changes
- [x] ISC-4: `app.get("/api/runs/:id/public", ...)` exists with no analyticsAuth — returns safe subset
- [x] ISC-5: Public runs endpoint returns `id, prompt, responses, judgement (scores/verdicts/crown/roast), crownModelId, crownScore, createdAt` only
- [x] ISC-6: `index.html` detects `/run/:id` pathname and renders a shareable run view
- [x] ISC-7: `index.html` has a "share" button on completed runs that copies `/run/{id}` URL
- [x] ISC-8: VERSUS mode added to MODES array in `index.html`
- [x] ISC-9: In versus mode, two model selects appear and only those two models are fired
- [x] ISC-10: `index.html` detects `/model/:id` pathname and renders model profile view
- [x] ISC-11: Model profile fetches `/api/analytics?crownModelId=MODEL_ID` for per-model stats
- [x] ISC-12: Run inspector in `index.html` has a "Replay" button that pre-fills the prompt and fires
- [x] ISC-13: After replay, a score diff is shown comparing new vs stored scores
- [x] ISC-14: Migration `005_challenge_flag.sql` adds `is_challenge INTEGER DEFAULT 0` to `analysis_runs`
- [x] ISC-15: `POST /api/challenge` endpoint exists (analyticsAuth) — fires all models + judge, stores run with challenge flag
- [x] ISC-16: `lib/config.js` exports `DAILY_CHALLENGE_PROMPT`
- [x] ISC-17: `computePatternStats(rows)` exported from `lib/analyticsEngine.js`
- [x] ISC-18: `GET /api/patterns` endpoint exists (analyticsAuth)
- [x] ISC-19: `index.html` analytics page has a "Fingerprints" panel showing per-model AI-speak rates
- [x] ISC-20: `lib/judge.js:buildJudgePrompt` accepts optional `criteria` array third parameter
- [x] ISC-21: When `criteria` provided, only selected scoring items appear in judge prompt
- [x] ISC-22: `POST /api/judge` accepts optional `criteria` array in body, whitelisted server-side
- [x] ISC-23: Active criteria stored in run's `execution_json` under `criteria` key
- [x] ISC-24: `index.html` has CUSTOM mode with criteria checkboxes
- [x] ISC-25: Migration `006_pending_prompts.sql` creates `pending_prompts` table
- [x] ISC-26: `POST /api/prompts/submit` exists (public, rate-limited) — inserts into pending_prompts
- [x] ISC-27: `GET /api/prompts/pending` exists (analyticsAuth) — returns pending submissions
- [x] ISC-28: `POST /api/prompts/:id/approve` exists (analyticsAuth)
- [x] ISC-29: `POST /api/prompts/:id/reject` exists (analyticsAuth)
- [x] ISC-30: `GET /api/prompts/community` exists (public) — returns approved prompts JSON
- [x] ISC-31: `index.html` shows community prompts as pills in the random strip
- [x] ISC-32: `lib/judge.js` exports `computeMedianScores(results)` function
- [x] ISC-33: `lib/config.js` exports `JUDGE_RUNS` (default 1, max 5)
- [x] ISC-34: When `JUDGE_RUNS > 1`, judge is called N times and median scores are used
- [x] ISC-35: Anti: `/api/runs/:id/public` does not return `timings`, `execution`, `contestantProvider`, `judgeProvider`, `judgeModel`
- [x] ISC-36: Anti: `JUDGE_RUNS=1` (default) produces identical behavior to pre-F3 code path
- [x] ISC-37: `npm test` exits 0
- [x] ISC-38: `node -e "require('./server')"` exits 0
- [x] ISC-39: `public/app.js` exists and contains all JS from index.html script block
- [x] ISC-40: `index.html` `<script>` block replaced with `<script src="app.js"></script>`
- [x] ISC-41: `index.html` line count under 750 (HTML + CSS only, no inline JS)
- [x] ISC-42: `<div id="moderationPanel">` exists in index.html body
- [x] ISC-43: `loadModerationPanel()` defined in app.js, fetches `/api/prompts/pending`
- [x] ISC-44: Approve button inside moderation list POSTs to `/api/prompts/:id/approve` and reloads
- [x] ISC-45: Reject button POSTs to `/api/prompts/:id/reject` and reloads list
- [x] ISC-46: Moderation list renders "no pending prompts" message when queue is empty
- [x] ISC-47: Anti: `loadModerationPanel()` guards on `isAnalyticsPage` — no-op on main page
- [x] ISC-48: `npm test` still passes 31/31 after P6 and P9 changes
- [x] ISC-49: `node -e "require('./server')"` loads cleanly after changes

## Test Strategy

| isc | type | check | threshold | tool |
|-----|------|-------|-----------|------|
| ISC-1,2 | code | ls lib/webhook.js + grep WEBHOOK_URL in config | both present | Bash |
| ISC-4,5,35 | code | Read /api/runs/:id/public handler | no auth, safe fields | Read |
| ISC-14 | schema | cat 005_challenge_flag.sql | column present | Read |
| ISC-15,16 | code | grep /api/challenge + DAILY_CHALLENGE_PROMPT | both present | Grep |
| ISC-17,18 | code | grep computePatternStats + /api/patterns | both defined | Grep |
| ISC-20,21,22 | code | Read judge.js buildJudgePrompt | criteria param | Read |
| ISC-25,26,27,28,29,30 | code | grep pending_prompts routes in app.js | all present | Grep |
| ISC-32,33,34,36 | code | grep computeMedianScores + JUDGE_RUNS | present | Grep |
| ISC-37 | test | npm test | exit 0 | Bash |
| ISC-38 | runtime | node -e require server | exit 0 | Bash |

## Features

| name | description | satisfies | depends_on | parallelizable |
|------|-------------|-----------|------------|----------------|
| F5-webhook | lib/webhook.js + config + app.js hook | ISC-1,2,3 | none | true |
| F1-backend | /api/runs/:id/public endpoint | ISC-4,5,35 | none | true |
| F1-frontend | /run/:id route + share button | ISC-6,7 | F1-backend | false |
| F7-frontend | VERSUS mode in index.html | ISC-8,9 | none | true |
| F2-frontend | /model/:id route | ISC-10,11 | none | true |
| F4-frontend | Replay button + score diff | ISC-12,13 | none | true |
| F8-migration | 005_challenge_flag migration | ISC-14 | none | true |
| F8-backend | /api/challenge endpoint | ISC-15,16 | F8-migration | false |
| F6-backend | computePatternStats + /api/patterns | ISC-17,18 | none | true |
| F6-frontend | Fingerprints panel | ISC-19 | F6-backend | false |
| F9-judge | buildJudgePrompt criteria param | ISC-20,21 | none | true |
| F9-backend | /api/judge criteria acceptance | ISC-22,23 | F9-judge | false |
| F9-frontend | CUSTOM mode + checkboxes | ISC-24 | F9-backend | false |
| F10-migration | 006_pending_prompts migration | ISC-25 | none | true |
| F10-backend | prompts CRUD endpoints | ISC-26,27,28,29,30 | F10-migration | false |
| F10-frontend | community prompts strip | ISC-31 | F10-backend | false |
| F3-judge | computeMedianScores + JUDGE_RUNS | ISC-32,33,34,36 | none | true |
| verify | npm test + server load | ISC-37,38 | all | false |
