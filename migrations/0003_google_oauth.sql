-- Google OAuth support
-- 1. Relax users.password_hash to nullable so Google-only accounts (which have
--    no password) can be stored. SQLite cannot drop a NOT NULL constraint via
--    ALTER TABLE, so the users table is recreated and its rows copied over.
-- 2. Add an oauth_accounts table linking a provider identity (e.g. Google `sub`)
--    to a local user, so one user can carry multiple identities.
--
-- Migration ordering note: D1 applies migrations in lexicographic filename
-- order, so this 0003_ file runs after both 0002_ files (0002_score_tracking.sql,
-- 0002_voice_profiles.sql).

-- Recreate users with a nullable password_hash.
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, email, password_hash, name, verified, created_at, updated_at)
SELECT id, email, password_hash, name, verified, created_at, updated_at FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- Recreate the email index dropped along with the old users table.
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Provider identity links. PRIMARY KEY (provider, provider_user_id) enforces
-- that a given Google account maps to at most one local user.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);
