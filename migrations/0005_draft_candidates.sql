-- First drafts and prompted rewrites do not require an earlier review.
-- No tables reference revision_candidates; existing proposals retain their IDs.
CREATE TABLE revision_candidates_new (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  accepted_revision INTEGER,
  created_at TEXT NOT NULL
);
INSERT INTO revision_candidates_new SELECT * FROM revision_candidates;
DROP TABLE revision_candidates;
ALTER TABLE revision_candidates_new RENAME TO revision_candidates;
CREATE INDEX idx_candidates_document ON revision_candidates(document_id);
