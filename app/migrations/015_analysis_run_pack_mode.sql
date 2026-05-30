ALTER TABLE analysis_runs ADD COLUMN pack TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN mode TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_runs_pack ON analysis_runs(pack);
CREATE INDEX IF NOT EXISTS idx_runs_mode ON analysis_runs(mode);
