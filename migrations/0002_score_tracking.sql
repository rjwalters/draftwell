-- Score tracking for calibrated document evaluation
-- Logs scores across revision cycles to track improvement trajectory

-- Document scores (one entry per scoring session)
CREATE TABLE IF NOT EXISTS document_scores (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  overall_score REAL NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Dimension scores (one entry per dimension per scoring session)
CREATE TABLE IF NOT EXISTS dimension_scores (
  id TEXT PRIMARY KEY,
  document_score_id TEXT NOT NULL,
  dimension_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  justification TEXT,
  FOREIGN KEY (document_score_id) REFERENCES document_scores(id) ON DELETE CASCADE
);

-- Dimension weaknesses with quoted evidence
CREATE TABLE IF NOT EXISTS dimension_weaknesses (
  id TEXT PRIMARY KEY,
  dimension_score_id TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT NOT NULL,
  FOREIGN KEY (dimension_score_id) REFERENCES dimension_scores(id) ON DELETE CASCADE
);

-- Elo ratings for document version comparisons
CREATE TABLE IF NOT EXISTS elo_ratings (
  document_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1500,
  matches_played INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (document_id, revision_number),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Comparison results (head-to-head matchups)
CREATE TABLE IF NOT EXISTS comparisons (
  id TEXT PRIMARY KEY,
  version_a_document_id TEXT NOT NULL,
  version_a_revision INTEGER NOT NULL,
  version_b_document_id TEXT NOT NULL,
  version_b_revision INTEGER NOT NULL,
  winner TEXT NOT NULL CHECK (winner IN ('A', 'B')),
  reasoning TEXT,
  model TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_document_scores_doc ON document_scores(document_id);
CREATE INDEX IF NOT EXISTS idx_document_scores_doc_rev ON document_scores(document_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_dimension_scores_parent ON dimension_scores(document_score_id);
CREATE INDEX IF NOT EXISTS idx_dimension_weaknesses_parent ON dimension_weaknesses(dimension_score_id);
CREATE INDEX IF NOT EXISTS idx_comparisons_version_a ON comparisons(version_a_document_id, version_a_revision);
CREATE INDEX IF NOT EXISTS idx_comparisons_version_b ON comparisons(version_b_document_id, version_b_revision);
