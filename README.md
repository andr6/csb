# Chat Shit Bob

Small Express app that sends one prompt to multiple LLMs, then asks a separate judge model to rank the responses.

## Current stack

- Node.js 18+
- Express static frontend + JSON API
- Provider switching via `app/.env`

## Local setup

1. `cd /opt/csb/app`
2. `cp env.example .env`
3. Fill in provider keys and model config.
4. `npm install`
5. `npm start`

## Environment

Key variables are documented in [app/env.example](/opt/csb/app/env.example).

- `ACTIVE_MODELS`: comma-separated model ids exposed to the UI
- `CONTESTANT_PROVIDER`: provider used for contestant requests
- `JUDGE_PROVIDER`: provider used for ranking
- `ALLOWED_ORIGINS`: comma-separated allowed browser origins
- `HTTP_TIMEOUT_MS`: upstream request timeout in milliseconds, default `15000`
- `MODEL_PRICE_<MODEL_ID>_USD`: optional estimated USD cost per contestant call used by analytics
- `JUDGE_PRICE_USD`: optional estimated USD cost per judge call used by analytics
- `ANALYTICS_SLICE_BUDGET_USD`, `ANALYTICS_DAILY_BUDGET_USD`, `ANALYTICS_MONTHLY_BUDGET_USD`: optional budget caps used for alerting in analytics
  If pricing is unset, analytics falls back to coarse heuristic cost bands so the dashboard still renders.
- `ANALYTICS_POLICY_MIN_RELIABILITY_PCT`, `ANALYTICS_POLICY_MAX_UNIT_COST_USD`, `ANALYTICS_POLICY_MIN_SCORE_PER_DOLLAR`, `ANALYTICS_POLICY_MIN_AVG_SCORE`: optional thresholds used to classify models as promote, hold, or demote

## API helpers

- `GET /api/history`: persisted leaderboard entries
- `GET /api/runs`: recent persisted analysis runs
  Supports `limit`, `offset`, `query`, `crownModelId`, `status`, `contestantProvider`, `judgeProvider`, `failedModelId`, `dateFrom`, `dateTo`, and `phase`
- `GET /api/runs/export`: downloadable export of the currently filtered run set
  Supports `format=json` and `format=csv`
- `GET /api/runs/:id`: one persisted analysis run with responses and judgement
- `GET /api/analytics`: filtered analytics summary with run counts, success rate, score/latency trends, per-model comparison stats, estimated spend, score-per-dollar metrics, budget alerts, policy thresholds, planning scenarios, lineup proposals, and recommendation fields such as best overall, most reliable, fastest, best value, recommended default, cheap fallback, cheapest reliable, premium option, top spend driver, promote/hold/demote picks, active/fallback/retire sets, budget-risk models, and rotation candidates
- `GET /api/failures/summary`: filtered aggregate failure counts by status, model, provider, judge phase, retry/fallback policy, structured error category, upstream status, common error message, and latest parse-failure samples
- `GET /api/stats`: app request metrics plus leaderboard aggregate stats

## Persistence

- The app prefers SQLite at `app/data/csb.sqlite` when the runtime can execute `sqlite3`
- If SQLite is unavailable, it falls back to JSON repositories at `app/data/leaderboard.json` and `app/data/analysis-runs.json`
- Existing `app/data/leaderboard.json` data is migrated into SQLite on first access when SQLite is available
- SQLite uses explicit SQL migrations from `app/migrations/`
- Analysis runs persist prompt, responses, judgement, provider metadata, captured timing data, per-model execution status, and retry/fallback policy metadata
- Judge-call failures and judge-parse failures are persisted as failed runs, so the runs console and export endpoints include unsuccessful executions too
- The runs console exposes date-range/provider/model filters, saved incident views, one-click drill-down from failure buckets into the run list, focused compare actions in the run inspector, retry/fallback rollups, structured error categories, and recent judge-parse raw snippets to speed up operational debugging
- The analytics dashboard summarizes seven-day trends, average winning score, judge latency, per-model score/win/reliability comparisons, estimated spend, budget pressure, spend-driver hotspots, policy actions, scenario-planning cards, and concrete lineup proposals so default, fallback, premium, and rotation decisions can be derived directly from stored run data

## Scripts

- `npm start`: run the app
- `npm run dev`: run with `nodemon`
- `npm test`: run smoke tests
