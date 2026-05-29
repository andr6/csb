CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_number TEXT NOT NULL DEFAULT '',
  phone_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL DEFAULT '',
  first_login_completed INTEGER NOT NULL DEFAULT 0,
  custom_mode_access_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  last_login_at TEXT NOT NULL DEFAULT '',
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  account_locked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
