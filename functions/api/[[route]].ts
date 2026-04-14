// Cloudflare Pages Functions API handler
// This provides a simple API layer for the frontend

import {
  buildRefinementPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
  callClaudeAPI,
  chunkSections,
  estimateTokens,
  parseReviewResponse,
  parseRevisionResponse,
  parseSections,
  type ReviewItemResult,
} from "../lib/pipeline";

interface Env {
  DB: D1Database;
  CONTENT_BUCKET: R2Bucket;
  RATE_LIMIT: KVNamespace;
  AI: Ai;
  APP_NAME: string;
  ANTHROPIC_API_KEY: string;
  AI_GATEWAY: string;
  AI_GATEWAY_TOKEN: string;
}

interface VoiceProfile {
  id: string;
  user_id: string;
  name: string;
  profile_data: string;
  created_at: string;
  updated_at: string;
}

interface VoiceSample {
  id: string;
  user_id: string;
  voice_profile_id: string | null;
  sample_text: string | null;
  r2_key: string | null;
  source_url: string | null;
  word_count: number;
  created_at: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

interface Document {
  id: string;
  project_id: string;
  title: string;
  current_revision: number;
  r2_key: string;
  created_at: string;
  updated_at: string;
}

// Session configuration
const SESSION_COOKIE_NAME = "draftwell-session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Simple response helpers
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

// Cookie helpers
function setSessionCookie(sessionId: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function getSessionIdFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...val] = c.trim().split("=");
      return [key, val.join("=")];
    }),
  );
  return cookies[SESSION_COOKIE_NAME] || null;
}

// Password hashing using PBKDF2 (edge-compatible, more secure than plain SHA-256)
async function hashPassword(
  password: string,
  salt?: string,
): Promise<{ hash: string; salt: string }> {
  const encoder = new TextEncoder();
  const passwordSalt =
    salt || btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(passwordSalt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  const hash = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
  return { hash: `${passwordSalt}:${hash}`, salt: passwordSalt };
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;

  const { hash } = await hashPassword(password, salt);
  const [, computedHash] = hash.split(":");

  // Constant-time comparison to prevent timing attacks
  if (computedHash.length !== expectedHash.length) return false;
  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return result === 0;
}

// Session management
async function createSession(env: Env, userId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, expiresAt)
    .run();

  return sessionId;
}

async function getSessionUser(env: Env, sessionId: string): Promise<User | null> {
  const result = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.created_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `)
    .bind(sessionId)
    .first<User>();

  return result || null;
}

async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

async function refreshSession(env: Env, sessionId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
    .bind(expiresAt, sessionId)
    .run();
}

// Clean up expired sessions (call periodically)
async function cleanupExpiredSessions(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// Get authenticated user from session cookie
async function getAuthenticatedUser(env: Env, request: Request): Promise<User | null> {
  const sessionId = getSessionIdFromCookie(request);
  if (!sessionId) return null;
  return getSessionUser(env, sessionId);
}

// Auth handlers
async function handleLogin(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as { email?: string; password?: string };
  const { email, password } = body;

  if (!email || !password) {
    return error("Email and password are required");
  }

  const user = await env.DB.prepare(
    "SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?",
  )
    .bind(email)
    .first<User & { password_hash: string }>();

  if (!user) {
    return error("Invalid email or password", 401);
  }

  const validPassword = await verifyPassword(password, user.password_hash);
  if (!validPassword) {
    return error("Invalid email or password", 401);
  }

  const sessionId = await createSession(env, user.id);
  const maxAge = Math.floor(SESSION_DURATION_MS / 1000);

  return json({ user: { id: user.id, email: user.email, name: user.name } }, 200, {
    "Set-Cookie": setSessionCookie(sessionId, maxAge),
  });
}

async function handleLogout(env: Env, request: Request): Promise<Response> {
  const sessionId = getSessionIdFromCookie(request);

  if (sessionId) {
    await deleteSession(env, sessionId);
  }

  return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function handleRegister(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as { email?: string; name?: string; password?: string };
  const { email, name, password } = body;

  if (!email || !name || !password) {
    return error("Email, name, and password are required");
  }

  if (password.length < 8) {
    return error("Password must be at least 8 characters");
  }

  const id = crypto.randomUUID();
  const { hash: passwordHash } = await hashPassword(password);

  try {
    await env.DB.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
      .bind(id, email, name, passwordHash)
      .run();

    // Auto-login after registration
    const sessionId = await createSession(env, id);
    const maxAge = Math.floor(SESSION_DURATION_MS / 1000);

    return json({ user: { id, email, name } }, 201, {
      "Set-Cookie": setSessionCookie(sessionId, maxAge),
    });
  } catch (e) {
    if ((e as Error).message.includes("UNIQUE constraint failed")) {
      return error("Email already exists", 409);
    }
    throw e;
  }
}

async function handleGetMe(env: Env, request: Request): Promise<Response> {
  const sessionId = getSessionIdFromCookie(request);

  if (!sessionId) {
    return error("Not authenticated", 401);
  }

  const user = await getSessionUser(env, sessionId);

  if (!user) {
    return json({ error: "Session expired" }, 401, { "Set-Cookie": clearSessionCookie() });
  }

  // Refresh session on activity
  await refreshSession(env, sessionId);

  return json({ user });
}

async function handleRefreshSession(env: Env, request: Request): Promise<Response> {
  const sessionId = getSessionIdFromCookie(request);

  if (!sessionId) {
    return error("Not authenticated", 401);
  }

  const user = await getSessionUser(env, sessionId);

  if (!user) {
    return json({ error: "Session expired" }, 401, { "Set-Cookie": clearSessionCookie() });
  }

  await refreshSession(env, sessionId);
  const maxAge = Math.floor(SESSION_DURATION_MS / 1000);

  return json({ user, expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString() }, 200, {
    "Set-Cookie": setSessionCookie(sessionId, maxAge),
  });
}

// Route handlers
async function handleGetUsers(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 100",
  ).all<User>();
  return json({ users: results });
}

async function handleGetUser(env: Env, id: string): Promise<Response> {
  const user = await env.DB.prepare("SELECT id, email, name, created_at FROM users WHERE id = ?")
    .bind(id)
    .first<User>();

  if (!user) {
    return error("User not found", 404);
  }
  return json({ user });
}

async function handleCreateUser(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as { email?: string; name?: string; password?: string };
  const { email, name, password } = body;

  if (!email || !name || !password) {
    return error("Email, name, and password are required");
  }

  const id = crypto.randomUUID();
  const { hash: passwordHash } = await hashPassword(password);

  try {
    await env.DB.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
      .bind(id, email, name, passwordHash)
      .run();

    return json({ user: { id, email, name } }, 201);
  } catch (e) {
    if ((e as Error).message.includes("UNIQUE constraint failed")) {
      return error("Email already exists", 409);
    }
    throw e;
  }
}

async function handleHealthCheck(env: Env): Promise<Response> {
  // Quick DB health check
  try {
    await env.DB.prepare("SELECT 1").first();
    // Opportunistically clean up expired sessions
    await cleanupExpiredSessions(env);
    return json({
      status: "healthy",
      app: env.APP_NAME,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json({ status: "unhealthy", error: "Database unavailable" }, 503);
  }
}

// Project handlers
async function handleGetProjects(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, name, description, status, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<Project>();
  return json({ projects: results });
}

async function handleGetProject(env: Env, id: string, userId: string): Promise<Response> {
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

async function handleCreateProject(env: Env, request: Request, userId: string): Promise<Response> {
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

async function handleUpdateProject(
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

async function handleDeleteProject(env: Env, id: string, userId: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();

  if (!existing) {
    return error("Project not found", 404);
  }

  await env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind(id, userId).run();

  return json({ success: true });
}

// Helper to verify project belongs to user
async function verifyProjectOwnership(
  env: Env,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first();
  return !!project;
}

// Document handlers
async function handleGetDocuments(env: Env, projectId: string, userId: string): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key, created_at, updated_at FROM documents WHERE project_id = ? ORDER BY created_at DESC",
  )
    .bind(projectId)
    .all<Document>();
  return json({ documents: results });
}

async function handleGetDocument(
  env: Env,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key, created_at, updated_at FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) {
    return error("Document not found", 404);
  }

  // Fetch content from R2
  const object = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = object ? await object.text() : "";

  return json({ document: doc, content });
}

async function handleCreateDocument(
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

async function handleUpdateDocument(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const existing = await env.DB.prepare(
    "SELECT id, current_revision FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<{ id: string; current_revision: number }>();

  if (!existing) {
    return error("Document not found", 404);
  }

  const body = (await request.json()) as { content?: string; title?: string };

  if (body.content === undefined && body.title === undefined) {
    return error("No fields to update");
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.content !== undefined) {
    const newRevision = existing.current_revision + 1;
    const newR2Key = `users/${userId}/projects/${projectId}/documents/${docId}/rev_${newRevision}.md`;

    // Store new content in R2
    await env.CONTENT_BUCKET.put(newR2Key, body.content);

    // Create new revision record
    const revisionId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO revisions (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(revisionId, docId, newRevision, newR2Key, now)
      .run();

    updates.push("current_revision = ?");
    values.push(newRevision);
    updates.push("r2_key = ?");
    values.push(newR2Key);
  }

  if (body.title !== undefined) {
    updates.push("title = ?");
    values.push(body.title);
  }

  updates.push("updated_at = ?");
  values.push(now);
  values.push(docId);
  values.push(projectId);

  await env.DB.prepare(`UPDATE documents SET ${updates.join(", ")} WHERE id = ? AND project_id = ?`)
    .bind(...values)
    .run();

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key, created_at, updated_at FROM documents WHERE id = ?",
  )
    .bind(docId)
    .first<Document>();

  return json({ document: doc });
}

async function handleDeleteDocument(
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

// AI Review Pipeline handlers

/** Get the Claude API key from request header or environment */
function getApiKey(env: Env, request: Request): string | null {
  // Allow client to pass their own API key, fall back to platform key
  const headerKey = request.headers.get("x-anthropic-key");
  return headerKey || env.ANTHROPIC_API_KEY || null;
}

/** Get the AI Gateway URL for routing through Cloudflare AI Gateway */
function getGatewayUrl(env: Env): string | undefined {
  if (env.AI_GATEWAY) {
    return `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY}`;
  }
  return undefined;
}

async function handleGenerateReview(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) return error("Document not found", 404);

  const apiKey = getApiKey(env, request);
  if (!apiKey)
    return error("API key required. Set ANTHROPIC_API_KEY or pass x-anthropic-key header.", 400);

  // Fetch document content from R2
  const object = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = object ? await object.text() : "";
  if (!content.trim()) return error("Document is empty", 400);

  // Parse and chunk the document
  const sections = parseSections(content);
  const chunks = chunkSections(sections);

  // Generate review for each chunk
  const allItems: ReviewItemResult[] = [];
  const summaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildReviewPrompt(chunks[i].text, i, chunks.length);
    const response = await callClaudeAPI(prompt, apiKey, {
      maxTokens: 4096,
      gatewayUrl: getGatewayUrl(env),
      gatewayToken: env.AI_GATEWAY_TOKEN,
    });
    const result = parseReviewResponse(response);
    allItems.push(...result.items);
    summaries.push(result.summary);
  }

  const combinedSummary = summaries.join(" ");

  // Create review record
  const reviewId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `users/${userId}/projects/${projectId}/documents/${docId}/reviews/${reviewId}.json`;

  // Store full review data in R2
  const reviewData = {
    summary: combinedSummary,
    items: allItems,
    chunks: chunks.length,
    estimatedTokens: estimateTokens(content),
    generatedAt: now,
  };
  await env.CONTENT_BUCKET.put(r2Key, JSON.stringify(reviewData));

  // Create review record in D1
  await env.DB.prepare(
    "INSERT INTO reviews (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(reviewId, docId, doc.current_revision, r2Key, now)
    .run();

  // Create review_items records in D1
  const itemRecords = [];
  for (const item of allItems) {
    const itemId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO review_items (id, review_id, category, description, severity, location, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
    )
      .bind(itemId, reviewId, item.category, item.description, item.severity, item.location)
      .run();
    itemRecords.push({
      id: itemId,
      review_id: reviewId,
      category: item.category,
      description: item.description,
      severity: item.severity,
      location: item.location,
      suggestion: item.suggestion,
      status: "open",
    });
  }

  return json(
    {
      review: {
        id: reviewId,
        document_id: docId,
        revision_number: doc.current_revision,
        summary: combinedSummary,
        created_at: now,
      },
      items: itemRecords,
    },
    201,
  );
}

async function handleGetReviews(
  env: Env,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const { results: reviews } = await env.DB.prepare(
    "SELECT r.id, r.document_id, r.revision_number, r.r2_key, r.created_at FROM reviews r JOIN documents d ON r.document_id = d.id WHERE d.id = ? AND d.project_id = ? ORDER BY r.created_at DESC",
  )
    .bind(docId, projectId)
    .all<{
      id: string;
      document_id: string;
      revision_number: number;
      r2_key: string;
      created_at: string;
    }>();

  // Fetch summaries from R2 for each review
  const reviewsWithSummaries = await Promise.all(
    reviews.map(async (review) => {
      const object = await env.CONTENT_BUCKET.get(review.r2_key);
      let summary = "";
      if (object) {
        try {
          const data = JSON.parse(await object.text());
          summary = data.summary || "";
        } catch {
          /* ignore parse errors */
        }
      }
      return { ...review, summary };
    }),
  );

  return json({ reviews: reviewsWithSummaries });
}

async function handleGetReview(
  env: Env,
  projectId: string,
  docId: string,
  reviewId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const review = await env.DB.prepare(
    "SELECT r.id, r.document_id, r.revision_number, r.r2_key, r.created_at FROM reviews r JOIN documents d ON r.document_id = d.id WHERE r.id = ? AND d.id = ? AND d.project_id = ?",
  )
    .bind(reviewId, docId, projectId)
    .first<{
      id: string;
      document_id: string;
      revision_number: number;
      r2_key: string;
      created_at: string;
    }>();

  if (!review) return error("Review not found", 404);

  // Fetch items from D1
  const { results: items } = await env.DB.prepare(
    "SELECT id, review_id, category, description, severity, location, status FROM review_items WHERE review_id = ?",
  )
    .bind(reviewId)
    .all();

  // Fetch summary from R2
  const object = await env.CONTENT_BUCKET.get(review.r2_key);
  let summary = "";
  if (object) {
    try {
      const data = JSON.parse(await object.text());
      summary = data.summary || "";
    } catch {
      /* ignore parse errors */
    }
  }

  return json({ review: { ...review, summary }, items });
}

async function handleUpdateReviewItem(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  reviewId: string,
  itemId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { status?: string };
  if (!body.status || !["open", "addressed", "partial", "dismissed"].includes(body.status)) {
    return error("Invalid status. Must be: open, addressed, partial, dismissed");
  }

  // Verify the item belongs to the review which belongs to the document
  const item = await env.DB.prepare(
    `SELECT ri.id FROM review_items ri
     JOIN reviews r ON ri.review_id = r.id
     JOIN documents d ON r.document_id = d.id
     WHERE ri.id = ? AND r.id = ? AND d.id = ? AND d.project_id = ?`,
  )
    .bind(itemId, reviewId, docId, projectId)
    .first();

  if (!item) return error("Review item not found", 404);

  await env.DB.prepare("UPDATE review_items SET status = ? WHERE id = ?")
    .bind(body.status, itemId)
    .run();

  return json({ success: true, status: body.status });
}

async function handleGenerateRevision(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { reviewId: string };
  if (!body.reviewId) return error("reviewId is required");

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) return error("Document not found", 404);

  const apiKey = getApiKey(env, request);
  if (!apiKey)
    return error("API key required. Set ANTHROPIC_API_KEY or pass x-anthropic-key header.", 400);

  // Fetch document content
  const docObject = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = docObject ? await docObject.text() : "";

  // Fetch open review items
  const { results: openItems } = await env.DB.prepare(
    "SELECT id, category, description, severity, location, status FROM review_items WHERE review_id = ? AND status IN ('open', 'partial')",
  )
    .bind(body.reviewId)
    .all<{
      id: string;
      category: string;
      description: string;
      severity: string;
      location: string | null;
      status: string;
    }>();

  if (openItems.length === 0) return error("No open review items to address", 400);

  // Generate revision
  const prompt = buildRevisionPrompt(content, openItems);
  const response = await callClaudeAPI(prompt, apiKey, {
    maxTokens: 8192,
    gatewayUrl: getGatewayUrl(env),
    gatewayToken: env.AI_GATEWAY_TOKEN,
  });
  const result = parseRevisionResponse(response);

  // Store revised document as new revision
  const newRevision = doc.current_revision + 1;
  const newR2Key = `users/${userId}/projects/${projectId}/documents/${docId}/rev_${newRevision}.md`;
  await env.CONTENT_BUCKET.put(newR2Key, result.revisedDocument);

  const now = new Date().toISOString();

  // Create revision record
  const revisionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO revisions (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(revisionId, docId, newRevision, newR2Key, now)
    .run();

  // Update document to point to new revision
  await env.DB.prepare(
    "UPDATE documents SET current_revision = ?, r2_key = ?, updated_at = ? WHERE id = ?",
  )
    .bind(newRevision, newR2Key, now, docId)
    .run();

  // Update review item statuses based on AI's change tracking
  for (const change of result.changes) {
    const itemIndex = change.reviewItemIndex - 1; // 1-indexed from AI
    if (itemIndex >= 0 && itemIndex < openItems.length) {
      const newStatus =
        change.status === "addressed"
          ? "addressed"
          : change.status === "partial"
            ? "partial"
            : "open";
      await env.DB.prepare("UPDATE review_items SET status = ? WHERE id = ?")
        .bind(newStatus, openItems[itemIndex].id)
        .run();
    }
  }

  return json(
    {
      revision: {
        id: revisionId,
        document_id: docId,
        revision_number: newRevision,
        created_at: now,
      },
      changes: result.changes,
      summary: result.overallSummary,
      previousContent: content,
      revisedContent: result.revisedDocument,
    },
    201,
  );
}

// Voice profile handlers
const VOICE_DIMENSIONS = [
  "Sentence structure and length patterns",
  "Vocabulary level and word choice",
  "Tone and register (formal, conversational, etc.)",
  "Paragraph rhythm and transitions",
  "Use of figurative language and imagery",
  "Perspective and point of view tendencies",
  "Hedging vs. assertiveness",
  "Abstract vs. concrete language ratio",
  "Active vs. passive voice preference",
  "Rhythm and cadence patterns",
  "Signature phrases and verbal habits",
];

function buildVoiceAnalysisPrompt(sampleText: string): string {
  return `You are a writing voice analyst. Analyze the following writing sample and extract actionable style rules that capture this author's unique voice.

Analyze across these 11 dimensions:
${VOICE_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join("\n")}

For each dimension, provide:
- A concise observation about the author's pattern
- A concrete, actionable rule an AI reviewer could use to check if new writing matches this voice

IMPORTANT: Generate rules as instructions, not literary analysis. Each rule should be something a reviewer can evaluate objectively.

Respond with a JSON object in this exact format (no markdown fences):
{
  "dimensions": [
    {
      "name": "Dimension name",
      "observation": "What you observed about this dimension",
      "rule": "Actionable instruction for maintaining this voice aspect"
    }
  ],
  "summary": "2-3 sentence overall voice characterization",
  "escape_clause": "Situations where deviating from these rules is acceptable"
}

---

Writing sample:

${sampleText}`;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

async function handleGetVoiceProfiles(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, name, profile_data, created_at, updated_at FROM voice_profiles WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<VoiceProfile>();
  return json({ profiles: results });
}

async function handleGetVoiceProfile(
  env: Env,
  profileId: string,
  userId: string,
): Promise<Response> {
  const profile = await env.DB.prepare(
    "SELECT id, user_id, name, profile_data, created_at, updated_at FROM voice_profiles WHERE id = ? AND user_id = ?",
  )
    .bind(profileId, userId)
    .first<VoiceProfile>();

  if (!profile) {
    return error("Voice profile not found", 404);
  }

  // Also fetch associated samples
  const { results: samples } = await env.DB.prepare(
    "SELECT id, sample_text, source_url, word_count, created_at FROM voice_samples WHERE voice_profile_id = ? AND user_id = ?",
  )
    .bind(profileId, userId)
    .all<VoiceSample>();

  return json({ profile, samples });
}

async function handleDeleteVoiceProfile(
  env: Env,
  profileId: string,
  userId: string,
): Promise<Response> {
  const existing = await env.DB.prepare(
    "SELECT id FROM voice_profiles WHERE id = ? AND user_id = ?",
  )
    .bind(profileId, userId)
    .first();

  if (!existing) {
    return error("Voice profile not found", 404);
  }

  await env.DB.prepare("DELETE FROM voice_profiles WHERE id = ? AND user_id = ?")
    .bind(profileId, userId)
    .run();

  return json({ success: true });
}

async function handleAnalyzeVoice(env: Env, request: Request, userId: string): Promise<Response> {
  const body = (await request.json()) as {
    samples: Array<{ text: string; source_url?: string }>;
    name?: string;
  };

  if (!body.samples || !Array.isArray(body.samples) || body.samples.length === 0) {
    return error("At least one writing sample is required");
  }

  // Validate samples
  const combinedText: string[] = [];
  for (const sample of body.samples) {
    if (!sample.text || typeof sample.text !== "string") {
      return error("Each sample must have a 'text' field");
    }
    const wc = countWords(sample.text);
    if (wc < 50) {
      return error("Each writing sample must be at least 50 words");
    }
    combinedText.push(sample.text);
  }

  const allText = combinedText.join("\n\n---\n\n");
  const totalWords = countWords(allText);

  if (totalWords < 100) {
    return error("Combined writing samples must be at least 100 words");
  }

  // Call Workers AI to analyze the voice
  const prompt = buildVoiceAnalysisPrompt(allText);

  let profileDataRaw: string;
  try {
    const aiResponse = await env.AI.run(
      "@cf/meta/llama-3.1-70b-instruct" as BaseAiTextGenerationModels,
      {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
      },
    );

    if (typeof aiResponse === "object" && aiResponse !== null && "response" in aiResponse) {
      profileDataRaw = (aiResponse as { response: string }).response;
    } else {
      throw new Error("Unexpected AI response format");
    }
  } catch (e) {
    console.error("AI analysis error:", e);
    return error("Failed to analyze writing voice. Please try again.", 500);
  }

  // Parse and validate the AI response
  let profileData: unknown;
  try {
    const cleaned = profileDataRaw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    profileData = JSON.parse(cleaned);
  } catch {
    return error("Failed to parse voice analysis results. Please try again.", 500);
  }

  // Store the profile
  const profileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const profileName = body.name || "Default";

  await env.DB.prepare(
    "INSERT INTO voice_profiles (id, user_id, name, profile_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(profileId, userId, profileName, JSON.stringify(profileData), now, now)
    .run();

  // Store the samples and link them to the profile
  for (const sample of body.samples) {
    const sampleId = crypto.randomUUID();
    const wc = countWords(sample.text);
    const sampleText = wc <= 5000 ? sample.text : null;
    let r2Key: string | null = null;

    // For large samples, store in R2
    if (wc > 5000) {
      r2Key = `users/${userId}/voice-samples/${sampleId}.txt`;
      await env.CONTENT_BUCKET.put(r2Key, sample.text);
    }

    await env.DB.prepare(
      "INSERT INTO voice_samples (id, user_id, voice_profile_id, sample_text, r2_key, source_url, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(sampleId, userId, profileId, sampleText, r2Key, sample.source_url || null, wc, now)
      .run();
  }

  return json(
    {
      profile: {
        id: profileId,
        user_id: userId,
        name: profileName,
        profile_data: JSON.stringify(profileData),
        created_at: now,
        updated_at: now,
      },
    },
    201,
  );
}

async function handleGenerateRefinement(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { reviewId: string };
  if (!body.reviewId) return error("reviewId is required");

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) return error("Document not found", 404);

  const apiKey = getApiKey(env, request);
  if (!apiKey)
    return error("API key required. Set ANTHROPIC_API_KEY or pass x-anthropic-key header.", 400);

  // Fetch current document content
  const docObject = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = docObject ? await docObject.text() : "";

  // Fetch remaining open/partial items
  const { results: remainingItems } = await env.DB.prepare(
    "SELECT id, category, description, severity, location, status FROM review_items WHERE review_id = ? AND status IN ('open', 'partial')",
  )
    .bind(body.reviewId)
    .all<{
      id: string;
      category: string;
      description: string;
      severity: string;
      location: string | null;
      status: string;
    }>();

  if (remainingItems.length === 0) {
    return json({ message: "All review items have been addressed. No refinement needed." });
  }

  // Generate refinement
  const prompt = buildRefinementPrompt(content, remainingItems);
  const response = await callClaudeAPI(prompt, apiKey, {
    maxTokens: 8192,
    gatewayUrl: getGatewayUrl(env),
    gatewayToken: env.AI_GATEWAY_TOKEN,
  });
  const result = parseRevisionResponse(response);

  // Store refined document as new revision
  const newRevision = doc.current_revision + 1;
  const newR2Key = `users/${userId}/projects/${projectId}/documents/${docId}/rev_${newRevision}.md`;
  await env.CONTENT_BUCKET.put(newR2Key, result.revisedDocument);

  const now = new Date().toISOString();

  const revisionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO revisions (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(revisionId, docId, newRevision, newR2Key, now)
    .run();

  await env.DB.prepare(
    "UPDATE documents SET current_revision = ?, r2_key = ?, updated_at = ? WHERE id = ?",
  )
    .bind(newRevision, newR2Key, now, docId)
    .run();

  // Update review item statuses
  for (const change of result.changes) {
    const itemIndex = change.reviewItemIndex - 1;
    if (itemIndex >= 0 && itemIndex < remainingItems.length) {
      const newStatus =
        change.status === "addressed"
          ? "addressed"
          : change.status === "partial"
            ? "partial"
            : "open";
      await env.DB.prepare("UPDATE review_items SET status = ? WHERE id = ?")
        .bind(newStatus, remainingItems[itemIndex].id)
        .run();
    }
  }

  return json(
    {
      revision: {
        id: revisionId,
        document_id: docId,
        revision_number: newRevision,
        created_at: now,
      },
      changes: result.changes,
      summary: result.overallSummary,
      previousContent: content,
      revisedContent: result.revisedDocument,
      remainingOpenItems:
        remainingItems.length - result.changes.filter((c) => c.status === "addressed").length,
    },
    201,
  );
}

// Main request handler
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const method = request.method;

  // Parse route from catch-all parameter
  const route = (params.route as string[])?.join("/") || "";
  const path = `/api/${route}`;

  try {
    // Health check
    if (path === "/api/health" && method === "GET") {
      return handleHealthCheck(env);
    }

    // Auth endpoints
    if (path === "/api/auth/login" && method === "POST") {
      return handleLogin(env, request);
    }

    if (path === "/api/auth/logout" && method === "POST") {
      return handleLogout(env, request);
    }

    if (path === "/api/auth/register" && method === "POST") {
      return handleRegister(env, request);
    }

    if (path === "/api/auth/me" && method === "GET") {
      return handleGetMe(env, request);
    }

    if (path === "/api/auth/refresh" && method === "POST") {
      return handleRefreshSession(env, request);
    }

    // Users endpoints
    if (path === "/api/users" && method === "GET") {
      return handleGetUsers(env);
    }

    if (path === "/api/users" && method === "POST") {
      return handleCreateUser(env, request);
    }

    const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && method === "GET") {
      return handleGetUser(env, userMatch[1]);
    }

    // Projects endpoints (require authentication via session cookie)
    if (path === "/api/projects" && method === "GET") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGetProjects(env, user.id);
    }

    if (path === "/api/projects" && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleCreateProject(env, request, user.id);
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const projectId = projectMatch[1];

      if (method === "GET") {
        return handleGetProject(env, projectId, user.id);
      }
      if (method === "PUT") {
        return handleUpdateProject(env, request, projectId, user.id);
      }
      if (method === "DELETE") {
        return handleDeleteProject(env, projectId, user.id);
      }
    }

    // Document endpoints (require authentication)
    const docsMatch = path.match(/^\/api\/projects\/([^/]+)\/documents$/);
    if (docsMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const projectId = docsMatch[1];

      if (method === "GET") {
        return handleGetDocuments(env, projectId, user.id);
      }
      if (method === "POST") {
        return handleCreateDocument(env, request, projectId, user.id);
      }
    }

    const docMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)$/);
    if (docMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const projectId = docMatch[1];
      const docId = docMatch[2];

      if (method === "GET") {
        return handleGetDocument(env, projectId, docId, user.id);
      }
      if (method === "PUT") {
        return handleUpdateDocument(env, request, projectId, docId, user.id);
      }
      if (method === "DELETE") {
        return handleDeleteDocument(env, projectId, docId, user.id);
      }
    }

    // AI Review endpoints
    const reviewGenerateMatch = path.match(
      /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/review$/,
    );
    if (reviewGenerateMatch && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGenerateReview(
        env,
        request,
        reviewGenerateMatch[1],
        reviewGenerateMatch[2],
        user.id,
      );
    }

    const reviewsListMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/reviews$/);
    if (reviewsListMatch && method === "GET") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGetReviews(env, reviewsListMatch[1], reviewsListMatch[2], user.id);
    }

    const reviewDetailMatch = path.match(
      /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/reviews\/([^/]+)$/,
    );
    if (reviewDetailMatch && method === "GET") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGetReview(
        env,
        reviewDetailMatch[1],
        reviewDetailMatch[2],
        reviewDetailMatch[3],
        user.id,
      );
    }

    const reviewItemMatch = path.match(
      /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/reviews\/([^/]+)\/items\/([^/]+)$/,
    );
    if (reviewItemMatch && method === "PATCH") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleUpdateReviewItem(
        env,
        request,
        reviewItemMatch[1],
        reviewItemMatch[2],
        reviewItemMatch[3],
        reviewItemMatch[4],
        user.id,
      );
    }

    const reviseMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/revise$/);
    if (reviseMatch && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGenerateRevision(env, request, reviseMatch[1], reviseMatch[2], user.id);
    }

    const refineMatch = path.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/ai\/refine$/);
    if (refineMatch && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGenerateRefinement(env, request, refineMatch[1], refineMatch[2], user.id);
    }

    // Voice profile endpoints (require authentication)
    if (path === "/api/voice/profiles" && method === "GET") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleGetVoiceProfiles(env, user.id);
    }

    if (path === "/api/voice/analyze" && method === "POST") {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      return handleAnalyzeVoice(env, request, user.id);
    }

    const voiceProfileMatch = path.match(/^\/api\/voice\/profiles\/([^/]+)$/);
    if (voiceProfileMatch) {
      const user = await getAuthenticatedUser(env, request);
      if (!user) return error("Unauthorized", 401);
      const profileId = voiceProfileMatch[1];

      if (method === "GET") {
        return handleGetVoiceProfile(env, profileId, user.id);
      }
      if (method === "DELETE") {
        return handleDeleteVoiceProfile(env, profileId, user.id);
      }
    }

    // 404 for unknown routes
    return error("Not found", 404);
  } catch (e) {
    console.error("API error:", e);
    return error("Internal server error", 500);
  }
};
