ALTER TABLE documents ADD COLUMN voice_profile_id TEXT REFERENCES voice_profiles(id) ON DELETE SET NULL;
ALTER TABLE review_items ADD COLUMN metadata_json TEXT;

-- Generated text is a proposal until explicitly accepted against its base revision.
CREATE TABLE revision_candidates (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  accepted_revision INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_candidates_document ON revision_candidates(document_id);
