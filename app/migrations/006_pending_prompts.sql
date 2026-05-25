CREATE TABLE IF NOT EXISTS pending_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'absurd',
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT
);
