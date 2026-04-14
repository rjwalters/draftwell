-- Initial schema for Draftwell
-- Core tables for user management, projects, documents, reviews, and revisions

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Sessions table for auth
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Documents table (content stored in R2, metadata here)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  current_revision INTEGER DEFAULT 0,
  r2_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Reviews table (review content stored in R2, metadata here)
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Review items (individual critique items within a review)
CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'suggestion')),
  location TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'addressed', 'partial', 'dismissed')),
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

-- Revisions table (revision content stored in R2, metadata here)
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_reviews_document_id ON reviews(document_id);
CREATE INDEX IF NOT EXISTS idx_review_items_review_id ON review_items(review_id);
CREATE INDEX IF NOT EXISTS idx_revisions_document_id ON revisions(document_id);
