ALTER TABLE analysis_runs ADD COLUMN contestant_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN judge_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN judge_model TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN timings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE analysis_runs ADD COLUMN execution_json TEXT NOT NULL DEFAULT '{}';
