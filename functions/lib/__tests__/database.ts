import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

import { vi } from "vitest";
import type { Env } from "../types";

export function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort())
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  function prepare(sql: string) {
    let values: (string | number | null)[] = [];
    const stmt = {
      bind(...args: (string | number | null)[]) {
        values = args;
        return stmt;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      runSync() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async run() {
        return stmt.runSync();
      },
    };
    return stmt;
  }
  const objects = new Map<string, string>([
    ["original.md", "Original document."],
    [
      "review.json",
      JSON.stringify({ summary: "Review", styleguide: { score: 1 }, stats: { personaCount: 4 } }),
    ],
  ]);
  const env = {
    DB: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        sqlite.exec("BEGIN");
        try {
          const result = statements.map((statement) => statement.runSync());
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
    CONTENT_BUCKET: {
      get: vi.fn(async (key: string) =>
        objects.has(key) ? { text: async () => objects.get(key) } : null,
      ),
      put: vi.fn(async (key: string, content: string) => {
        objects.set(key, content);
      }),
      delete: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    },
    ANTHROPIC_API_KEY: "test-only",
  } as unknown as Env;
  sqlite.exec(`
    INSERT INTO users (id, email, name) VALUES ('owner', 'owner@example.test', 'Owner'), ('other', 'other@example.test', 'Other');
    INSERT INTO projects (id, user_id, name) VALUES ('project', 'owner', 'Project'), ('foreign-project', 'other', 'Other');
    INSERT INTO documents (id, project_id, title, r2_key) VALUES ('document', 'project', 'Draft', 'original.md'), ('other-document', 'project', 'Other draft', 'original.md'), ('foreign-document', 'foreign-project', 'Private draft', 'original.md');
    INSERT INTO reviews (id, document_id, revision_number, r2_key) VALUES ('review', 'document', 0, 'review.json'), ('other-review', 'other-document', 0, 'review.json'), ('foreign-review', 'foreign-document', 0, 'review.json');
    INSERT INTO review_items (id, review_id, category, description, severity, status, metadata_json) VALUES ('item', 'review', 'clarity', 'Clarify the argument', 'warning', 'open', '{"source":"persona","suggestion":"Use an example","consensusCount":3}'), ('foreign-item', 'foreign-review', 'clarity', 'Private feedback', 'warning', 'open', NULL);
  `);
  return { env, sqlite, objects, close: () => sqlite.close() };
}
