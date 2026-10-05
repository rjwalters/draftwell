-- Google OAuth support without rebuilding users. Dropping users would invoke
-- ON DELETE CASCADE on projects, documents, revisions, sessions and voice data.
-- Passwordless accounts use an empty password_hash, rejected by handleLogin.
-- This also works with databases that already applied the nullable-hash version.

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
