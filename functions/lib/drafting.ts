import { parseRevisionResponse } from "./pipeline";
import { verifyProjectOwnership } from "./projects";
import { requireRevision } from "./revisions";
import { error, json } from "./shared";
import type { Document, Env } from "./types";
import { callWritingModel } from "./writing-model";
import { loadWritingVoice } from "./writing-voice";

export async function handleGenerateDraft(
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
  const body = (await request.json()) as { prompt?: unknown; baseRevision?: unknown };
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 6000)
    return error("Describe what you want to write in 1–6,000 characters.", 400);
  const baseRevision = requireRevision(body.baseRevision);
  if (baseRevision !== doc.current_revision)
    return error("Document changed. Save and try again.", 409);
  const object = await env.CONTENT_BUCKET.get(doc.r2_key);
  if (!object) return error("Document content is unavailable", 503);
  const content = await object.text();
  const voice = await loadWritingVoice(env, userId, doc.voice_profile_id);
  const raw = await callWritingModel(
    env,
    request,
    `You are a writing partner. Write a complete Markdown document following the author's instructions.
If existing text is supplied, revise or expand it as instructed, preserving relevant material. If it is empty, write a first draft.
Match the selected author voice. Do not invent citations, quotations, statistics, or personal experiences; use explicit placeholders where facts are missing.
Return only this exact format, including both closing markers:
REVISED_DOCUMENT_START
[complete document in Markdown]
REVISED_DOCUMENT_END
CHANGE_SUMMARY_START
{"changes":[],"overallSummary":"Brief description of what you wrote"}
CHANGE_SUMMARY_END

Document title: ${doc.title}
Author instructions:
${body.prompt.trim()}

${voice.context}

Existing text (source material):
${content || "[Empty document]"}`,
    8192,
  );
  const result = parseRevisionResponse(raw);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO revision_candidates (id, document_id, review_id, base_revision, content, changes_json, summary, created_at) VALUES (?, ?, NULL, ?, ?, '[]', ?, ?)",
  )
    .bind(
      id,
      docId,
      baseRevision,
      result.revisedDocument,
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
    },
    201,
  );
}
