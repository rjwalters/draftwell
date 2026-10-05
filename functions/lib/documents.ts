import { verifyProjectOwnership } from "./projects";
import { requireRevision, saveRevision } from "./revisions";
import { error, json } from "./shared";
import type { Document, Env } from "./types";

export async function handleGetDocuments(
  env: Env,
  projectId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, project_id, title, voice_profile_id, current_revision, r2_key, created_at, updated_at FROM documents WHERE project_id = ? ORDER BY created_at DESC",
  )
    .bind(projectId)
    .all<Document>();
  return json({ documents: results });
}

export async function handleGetDocument(
  env: Env,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, voice_profile_id, current_revision, r2_key, created_at, updated_at FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) {
    return error("Document not found", 404);
  }

  // Fetch content from R2
  const object = await env.CONTENT_BUCKET.get(doc.r2_key);
  if (!object) return error("Document content is unavailable. Please try again.", 503);
  const content = await object.text();

  return json({ document: doc, content });
}

export async function handleCreateDocument(
  env: Env,
  request: Request,
  projectId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { title?: string; content?: string };
  const { title, content } = body;

  if (!title) {
    return error("Title is required");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `users/${userId}/projects/${projectId}/documents/${id}/rev_0.md`;

  // Store content in R2
  await env.CONTENT_BUCKET.put(r2Key, content || "");

  // Create document record in D1
  await env.DB.prepare(
    "INSERT INTO documents (id, project_id, title, current_revision, r2_key, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)",
  )
    .bind(id, projectId, title, r2Key, now, now)
    .run();

  // Create initial revision record
  const revisionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO revisions (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, 0, ?, ?)",
  )
    .bind(revisionId, id, r2Key, now)
    .run();

  return json(
    {
      document: {
        id,
        project_id: projectId,
        title,
        current_revision: 0,
        r2_key: r2Key,
        created_at: now,
        updated_at: now,
      },
    },
    201,
  );
}

export async function handleUpdateDocument(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const existing = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND project_id = ?")
    .bind(docId, projectId)
    .first<Document>();
  if (!existing) return error("Document not found", 404);
  const body = (await request.json()) as {
    content?: unknown;
    title?: unknown;
    baseRevision?: unknown;
    voiceProfileId?: unknown;
  };
  if (body.content === undefined && body.title === undefined && body.voiceProfileId === undefined)
    return error("No fields to update");
  if (body.content !== undefined && typeof body.content !== "string")
    return error("Content must be text");
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim()))
    return error("Title must be nonempty text");
  if (body.voiceProfileId !== undefined && body.voiceProfileId !== null) {
    if (typeof body.voiceProfileId !== "string") return error("Invalid voice profile");
    const voice = await env.DB.prepare("SELECT id FROM voice_profiles WHERE id = ? AND user_id = ?")
      .bind(body.voiceProfileId, userId)
      .first();
    if (!voice) return error("Voice profile not found", 404);
  }
  // Content saves and metadata changes are separate operations so a profile/title
  // update cannot partially succeed after a failed content compare-and-swap.
  if (typeof body.content === "string") {
    if (body.title !== undefined || body.voiceProfileId !== undefined)
      return error("Save content separately from document settings");
    const baseRevision = requireRevision(body.baseRevision);
    const saved = await saveRevision(env, existing, userId, body.content, baseRevision);
    return json({
      document: {
        ...existing,
        current_revision: saved.revision,
        r2_key: saved.r2Key,
        updated_at: saved.updatedAt,
      },
    });
  } else {
    const updates: string[] = ["updated_at = ?"];
    const values: (string | null)[] = [new Date().toISOString()];
    if (typeof body.title === "string") {
      updates.push("title = ?");
      values.push(body.title);
    }
    if (body.voiceProfileId !== undefined) {
      updates.push("voice_profile_id = ?");
      values.push(body.voiceProfileId as string | null);
    }
    await env.DB.prepare(
      `UPDATE documents SET ${updates.join(", ")} WHERE id = ? AND project_id = ?`,
    )
      .bind(...values, docId, projectId)
      .run();
  }
  const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND project_id = ?")
    .bind(docId, projectId)
    .first<Document>();
  return json({ document: doc });
}

export async function handleDeleteDocument(
  env: Env,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const existing = await env.DB.prepare(
    "SELECT id, r2_key, current_revision FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<{ id: string; r2_key: string; current_revision: number }>();

  if (!existing) {
    return error("Document not found", 404);
  }

  // Clean up R2 objects for all revisions
  const { results: revisions } = await env.DB.prepare(
    "SELECT r2_key FROM revisions WHERE document_id = ?",
  )
    .bind(docId)
    .all<{ r2_key: string }>();

  for (const rev of revisions) {
    await env.CONTENT_BUCKET.delete(rev.r2_key);
  }

  // Delete from D1 (cascade will handle revisions table)
  await env.DB.prepare("DELETE FROM documents WHERE id = ? AND project_id = ?")
    .bind(docId, projectId)
    .run();

  return json({ success: true });
}
