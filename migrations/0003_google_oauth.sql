-- Google OAuth support
-- Adds an oauth_accounts table linking a provider identity (e.g. Google `sub`)
-- to a local user, so one user can carry multiple identities.
--
-- Google-only accounts store an empty password_hash (''), which satisfies the
-- NOT NULL constraint on users.password_hash and is rejected by handleLogin's
-- falsy-hash guard, so password login on such an account fails with a 401.
--
-- An earlier version of this migration rebuilt the users table (copy into
-- users_new, drop users, rename) to make password_hash nullable. D1 always
-- enforces foreign keys, and dropping a parent table runs an implicit DELETE
-- that fires every ON DELETE CASCADE pointing at it: sessions, projects (and
-- through them documents, reviews, revisions and scores) and voice data were
-- all deleted. PRAGMA defer_foreign_keys does not prevent cascade actions.
-- Never rebuild a parent table this way. A database that already applied the
-- old version keeps a nullable password_hash; the application works with
-- either schema.

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
