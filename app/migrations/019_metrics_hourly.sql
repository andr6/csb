CREATE TABLE IF NOT EXISTS metrics_hourly (
  hour TEXT PRIMARY KEY,
  total_requests INTEGER NOT NULL DEFAULT 0,
  api_requests INTEGER NOT NULL DEFAULT 0,
  errors_5xx INTEGER NOT NULL DEFAULT 0,
  route_stats_json TEXT NOT NULL DEFAULT '{}'
);
