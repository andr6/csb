-- Add unique constraint on phone_number for users table
-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we use a unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number != '';
