import { verifyProjectOwnership } from "./projects";
import { requireRevision } from "./revisions";
import { error, json } from "./shared";
import type { Document, Env } from "./types";

export const ANVIL_COMMIT = "422a295da45b85d40aa628a01df9c6d2d88e300a";

function validFindings(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (finding) =>
        finding &&
        typeof finding.message === "string" &&
        (finding.line === null || (Number.isSafeInteger(finding.line) && finding.line > 0)),
    )
  );
}

export async function handleWritingCheck(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId)))
    return error("Project not found", 404);
  const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND project_id = ?")
    .bind(docId, projectId)
    .first<Document>();
  if (!doc) return error("Document not found", 404);
  const input = (await request.json()) as { baseRevision?: unknown };
  if (requireRevision(input.baseRevision) !== doc.current_revision)
    return error("Document changed. Save and check again.", 409);
  if (!env.ANVIL_URL || !env.ANVIL_TOKEN)
    return error("Writing checks are not available yet.", 503);
  const object = await env.CONTENT_BUCKET.get(doc.r2_key);
  if (!object) return error("Document content is unavailable", 503);
  const content = await object.text();
  if (content.length > 100_000)
    return error("Writing checks support up to 100,000 characters at a time.", 413);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const contentHash = Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join(
    "",
  );
  try {
    const response = await fetch(new URL("/check", env.ANVIL_URL), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ANVIL_TOKEN}` },
      body: JSON.stringify({
        schema_version: "1",
        document_id: docId,
        revision: doc.current_revision,
        content_hash: contentHash,
        content,
      }),
    });
    if (!response.ok) return error("Writing checks could not finish. Please try again.", 502);
    const data = (await response.json()) as {
      schema_version: string;
      anvil_commit: string;
      document_id: string;
      revision: number;
      content_hash: string;
      rhetoric?: { findings: unknown[] };
      numeric?: { findings: unknown[] };
    };
    if (
      data.schema_version !== "1" ||
      data.anvil_commit !== ANVIL_COMMIT ||
      data.document_id !== docId ||
      data.revision !== doc.current_revision ||
      data.content_hash !== contentHash ||
      !validFindings(data.rhetoric?.findings) ||
      !validFindings(data.numeric?.findings)
    ) {
      return error("Writing checks returned an incompatible result.", 502);
    }
    return json(data);
  } catch (err) {
    console.error(
      "Writing check connection failed:",
      err instanceof Error ? err.message : "Unknown error",
    );
    return error("Writing checks are temporarily unavailable. Please try again.", 503);
  }
}
