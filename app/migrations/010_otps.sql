CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  otp_type TEXT NOT NULL DEFAULT 'email_verification',
  otp_hash TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  attempts_count INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_otps_user_type ON otps(user_id, otp_type);
CREATE INDEX IF NOT EXISTS idx_otps_expires ON otps(expires_at);
