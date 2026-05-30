CREATE TABLE IF NOT EXISTS user_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL DEFAULT '',
  event_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ua_events_user ON user_analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ua_events_type ON user_analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ua_events_created ON user_analytics_events(created_at DESC);
