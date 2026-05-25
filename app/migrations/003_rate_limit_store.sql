CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key TEXT NOT NULL,
  limiter TEXT NOT NULL DEFAULT '',
  total_hits INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, limiter)
);
