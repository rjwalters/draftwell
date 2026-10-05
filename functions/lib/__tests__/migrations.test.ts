import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

it("preserves existing account data when upgrading the original production schema", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
    db.exec(`
      INSERT INTO users (id, email, name, password_hash) VALUES ('u', 'u@example.test', 'User', 'existing-hash');
      INSERT INTO sessions (id, user_id, expires_at) VALUES ('s', 'u', '2099-01-01');
      INSERT INTO projects (id, user_id, name) VALUES ('p', 'u', 'Project');
      INSERT INTO documents (id, project_id, title, r2_key) VALUES ('d', 'p', 'Draft', 'draft.md');
      INSERT INTO revisions (id, document_id, revision_number, r2_key) VALUES ('r', 'd', 1, 'revision.md');
    `);
    for (const migration of [
      "0002_score_tracking.sql",
      "0002_voice_profiles.sql",
      "0003_google_oauth.sql",
      "0004_writing_workflow.sql",
    ]) {
      db.exec(readFileSync(`migrations/${migration}`, "utf8"));
    }
    db.exec(`
      INSERT INTO reviews (id, document_id, revision_number, r2_key) VALUES ('review', 'd', 1, 'review.json');
      INSERT INTO revision_candidates (id, document_id, review_id, base_revision, content, changes_json, summary, created_at)
      VALUES ('candidate', 'd', 'review', 1, 'Existing proposal', '[]', 'Summary', '2026-09-11');
    `);
    db.exec(readFileSync("migrations/0005_draft_candidates.sql", "utf8"));
    expect(
      db.prepare("SELECT content, review_id FROM revision_candidates WHERE id = 'candidate'").get(),
    ).toEqual({ content: "Existing proposal", review_id: "review" });
    for (const table of ["users", "sessions", "projects", "documents", "revisions"]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(1);
    }
    expect(db.prepare("SELECT password_hash FROM users WHERE id = 'u'").get()?.password_hash).toBe(
      "existing-hash",
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
