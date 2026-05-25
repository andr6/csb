CREATE INDEX IF NOT EXISTS idx_runs_created_at ON analysis_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_crown_model_id ON analysis_runs(crown_model_id);
CREATE INDEX IF NOT EXISTS idx_runs_contestant_provider ON analysis_runs(contestant_provider);
CREATE INDEX IF NOT EXISTS idx_runs_judge_provider ON analysis_runs(judge_provider);
