ALTER TABLE analysis_runs ADD COLUMN is_challenge INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_runs_is_challenge ON analysis_runs(is_challenge);
