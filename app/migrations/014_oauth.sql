-- Add OAuth provider columns to users table
ALTER TABLE users ADD COLUMN oauth_provider TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN oauth_subject TEXT DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject) WHERE oauth_provider != '';
