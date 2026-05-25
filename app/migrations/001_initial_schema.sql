CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL DEFAULT '',
  responses_json TEXT NOT NULL DEFAULT '{}',
  judgement_json TEXT NOT NULL DEFAULT '{}',
  crown_model_id TEXT NOT NULL DEFAULT '',
  crown_score INTEGER NOT NULL DEFAULT 0,
  contestant_provider TEXT NOT NULL DEFAULT '',
  judge_provider TEXT NOT NULL DEFAULT '',
  judge_model TEXT NOT NULL DEFAULT '',
  timings_json TEXT NOT NULL DEFAULT '{}',
  execution_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);
