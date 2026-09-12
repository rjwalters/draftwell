CREATE TABLE request_diagnostics (
  request_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  document_id TEXT,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_kind TEXT,
  events_json TEXT NOT NULL
);
CREATE INDEX idx_diagnostics_created ON request_diagnostics(created_at);
CREATE INDEX idx_diagnostics_document ON request_diagnostics(document_id, created_at);
