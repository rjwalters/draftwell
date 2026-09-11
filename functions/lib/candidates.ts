import {
  buildRefinementPrompt,
  buildRevisionPrompt,
  callClaudeAPI,
  parseRevisionResponse,
} from "./pipeline";
import { verifyProjectOwnership } from "./projects";
import { requireRevision, saveRevision } from "./revisions";
import { error, json } from "./shared";
import type { Document, Env } from "./types";
import { loadWritingVoice } from "./writing-voice";

interface Change {
  itemId: string;
  previousStatus: string;
  status: string;
  explanation: string;
}
interface Candidate {
  id: string;
  document_id: string;
  review_id: string;
  base_revision: number;
  content: string;
  changes_json: string;
  summary: string;
  accepted_revision: number | null;
}

export async function generateCandidate(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
  refine: boolean,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId)))
    return error("Project not found", 404);
  const body = (await request.json()) as { reviewId?: string; baseRevision?: unknown };
  if (typeof body.reviewId !== "string" || !body.reviewId) return error("reviewId is required");
  // Authorize the review itself before reading any of its feedback.
  const review = await env.DB.prepare(
    "SELECT r.id, r.revision_number FROM reviews r JOIN documents d ON r.document_id = d.id WHERE r.id = ? AND d.id = ? AND d.project_id = ?",
  )
    .bind(body.reviewId, docId, projectId)
    .first<{ id: string; revision_number: number }>();
  if (!review) return error("Review not found", 404);
  const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND project_id = ?")
    .bind(docId, projectId)
    .first<Document>();
  if (!doc) return error("Document not found", 404);
  const baseRevision = requireRevision(body.baseRevision);
  if (baseRevision !== doc.current_revision)
    return error("Document changed. Save and review again.", 409);
  if (review.revision_number !== baseRevision) {
    const prior = await env.DB.prepare(
      "SELECT id FROM revision_candidates WHERE document_id = ? AND review_id = ? AND accepted_revision = ?",
    )
      .bind(docId, review.id, baseRevision)
      .first();
    if (!prior)
      return error(
        "This review is out of date. Generate a new review for the current document.",
        409,
      );
  }
  const apiKey = request.headers.get("x-anthropic-key") || env.ANTHROPIC_API_KEY;
  if (!apiKey) return error("Writing review is not configured.", 503);
  const object = await env.CONTENT_BUCKET.get(doc.r2_key);
  if (!object) return error("Document content is unavailable", 503);
  const content = await object.text();
  const { results: items } = await env.DB.prepare(
    "SELECT id, category, description, severity, location, status FROM review_items WHERE review_id = ? AND status IN ('open', 'partial') ORDER BY id",
  )
    .bind(review.id)
    .all<{
      id: string;
      category: string;
      description: string;
      severity: string;
      location: string | null;
      status: string;
    }>();
  if (!items.length) return json({ message: "All review items have been addressed." });
  const voice = await loadWritingVoice(env, userId, doc.voice_profile_id);
  const prompt = (refine ? buildRefinementPrompt : buildRevisionPrompt)(content, items);
  const raw = await callClaudeAPI(`${prompt}\n\n${voice.context}`, apiKey, {
    maxTokens: 8192,
    gatewayUrl: env.AI_GATEWAY
      ? `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY}`
      : undefined,
    gatewayToken: env.AI_GATEWAY_TOKEN,
  });
  const result = parseRevisionResponse(raw);
  const changes: Change[] = result.changes.flatMap((change) => {
    const item = items[change.reviewItemIndex - 1];
    return item
      ? [
          {
            itemId: item.id,
            previousStatus: item.status,
            status:
              change.status === "addressed"
                ? "addressed"
                : change.status === "partial"
                  ? "partial"
                  : "open",
            explanation: change.explanation,
          },
        ]
      : [];
  });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO revision_candidates (id, document_id, review_id, base_revision, content, changes_json, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      docId,
      review.id,
      baseRevision,
      result.revisedDocument,
      JSON.stringify(changes),
      result.overallSummary,
      new Date().toISOString(),
    )
    .run();
  return json(
    {
      candidateId: id,
      baseRevision,
      previousContent: content,
      revisedContent: result.revisedDocument,
      summary: result.overallSummary,
      changes,
    },
    201,
  );
}

export async function handleAcceptCandidate(
  env: Env,
  projectId: string,
  docId: string,
  candidateId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId)))
    return error("Project not found", 404);
  const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND project_id = ?")
    .bind(docId, projectId)
    .first<Document>();
  if (!doc) return error("Document not found", 404);
  const candidate = await env.DB.prepare(
    "SELECT * FROM revision_candidates WHERE id = ? AND document_id = ?",
  )
    .bind(candidateId, docId)
    .first<Candidate>();
  if (!candidate) return error("Revision proposal not found", 404);
  if (candidate.accepted_revision !== null) {
    if (candidate.accepted_revision !== doc.current_revision)
      return error("The document has changed since this proposal was accepted.", 409);
    return json({ content: candidate.content, revision: candidate.accepted_revision });
  }
  const changes = JSON.parse(candidate.changes_json) as Change[];
  const saved = await saveRevision(
    env,
    doc,
    userId,
    candidate.content,
    candidate.base_revision,
    (key, next) => [
      env.DB.prepare(
        "UPDATE revision_candidates SET accepted_revision = ? WHERE id = ? AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND r2_key = ?)",
      ).bind(next, candidateId, docId, key),
      ...changes.map((change) =>
        env.DB.prepare(
          "UPDATE review_items SET status = ? WHERE id = ? AND review_id = ? AND status = ? AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND r2_key = ?)",
        ).bind(
          change.status,
          change.itemId,
          candidate.review_id,
          change.previousStatus,
          docId,
          key,
        ),
      ),
    ],
  );
  return json({ content: candidate.content, revision: saved.revision });
}
