import type { Env, Project } from "./types";
import { json, error } from "./shared";

export async function verifyProjectOwnership(
  env: Env,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first();
  return !!project;
}

export async function handleGetProjects(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, name, description, status, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<Project>();
  return json({ projects: results });
}

export async function handleGetProject(env: Env, id: string, userId: string): Promise<Response> {
  const project = await env.DB.prepare(
    "SELECT id, user_id, name, description, status, created_at, updated_at FROM projects WHERE id = ? AND user_id = ?",
  )
    .bind(id, userId)
    .first<Project>();

  if (!project) {
    return error("Project not found", 404);
  }
  return json({ project });
}

export async function handleCreateProject(env: Env, request: Request, userId: string): Promise<Response> {
  const body = (await request.json()) as { name?: string; description?: string };
  const { name, description } = body;

  if (!name) {
    return error("Name is required");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO projects (id, user_id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
  )
    .bind(id, userId, name, description || null, now, now)
    .run();

  return json(
    {
      project: {
        id,
        user_id: userId,
        name,
        description: description || null,
        status: "active",
        created_at: now,
        updated_at: now,
      },
    },
    201,
  );
}

export async function handleUpdateProject(
  env: Env,
  request: Request,
  id: string,
  userId: string,
): Promise<Response> {
  const existing = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();

  if (!existing) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { name?: string; description?: string; status?: string };
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name);
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description);
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "archived") {
      return error("Status must be 'active' or 'archived'");
    }
    updates.push("status = ?");
    values.push(body.status);
  }

  if (updates.length === 0) {
    return error("No fields to update");
  }

  const now = new Date().toISOString();
  updates.push("updated_at = ?");
  values.push(now);
  values.push(id);
  values.push(userId);

  await env.DB.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`)
    .bind(...values)
    .run();

  const project = await env.DB.prepare(
    "SELECT id, user_id, name, description, status, created_at, updated_at FROM projects WHERE id = ?",
  )
    .bind(id)
    .first<Project>();

  return json({ project });
}

export async function handleDeleteProject(env: Env, id: string, userId: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();

  if (!existing) {
    return error("Project not found", 404);
  }

  await env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind(id, userId).run();

  return json({ success: true });
}
