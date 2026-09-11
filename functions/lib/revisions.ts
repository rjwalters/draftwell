import type { Document, Env } from "./types";

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RequestError(
      "A valid baseRevision is required. Reload the document and try again.",
      428,
    );
  }
  return value as number;
}

/** Unique objects plus an atomic D1 compare-and-swap keep concurrent writers isolated. */
export async function saveRevision(
  env: Env,
  doc: Document,
  userId: string,
  content: string,
  baseRevision: number,
  extraStatements?: (key: string, revision: number) => D1PreparedStatement[],
): Promise<{ revision: number; r2Key: string; updatedAt: string }> {
  if (doc.current_revision !== baseRevision) {
    throw new RequestError(
      "This document has changed. Reload before saving or accepting a revision.",
      409,
    );
  }
  const id = crypto.randomUUID();
  const revision = baseRevision + 1;
  const key = `users/${userId}/projects/${doc.project_id}/documents/${doc.id}/revisions/${id}.md`;
  const now = new Date().toISOString();
  await env.CONTENT_BUCKET.put(key, content);

  // The insert and any candidate/status updates are conditional on winning the CAS.
  // D1 batches run in one transaction, so no other writer can interleave here.
  const statements = [
    env.DB.prepare(
      "UPDATE documents SET current_revision = ?, r2_key = ?, updated_at = ? WHERE id = ? AND project_id = ? AND current_revision = ?",
    ).bind(revision, key, now, doc.id, doc.project_id, baseRevision),
    env.DB.prepare(
      "INSERT INTO revisions (id, document_id, revision_number, r2_key, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM documents WHERE id = ? AND r2_key = ?)",
    ).bind(id, doc.id, revision, key, now, doc.id, key),
    ...(extraStatements?.(key, revision) ?? []),
  ];
  // Do not delete the object on ambiguous transport failure: the transaction may
  // have committed. An unreferenced object is safer than deleting accepted text.
  const results = await env.DB.batch(statements);
  if (results[0].meta.changes !== 1) {
    await env.CONTENT_BUCKET.delete(key);
    throw new RequestError(
      "This document has changed. Reload before saving or accepting a revision.",
      409,
    );
  }
  return { revision, r2Key: key, updatedAt: now };
}
