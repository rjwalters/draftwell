import {
  clearSessionCookie,
  error,
  getSessionIdFromCookie,
  json,
  SESSION_DURATION_MS,
  setSessionCookie,
} from "./shared";
import type { Env, User } from "./types";

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
export async function createSession(env: Env, userId: string): Promise<string> {
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
export async function getAuthenticatedUser(env: Env, request: Request): Promise<User | null> {
  const sessionId = getSessionIdFromCookie(request);
  if (!sessionId) return null;
  return getSessionUser(env, sessionId);
}

// Auth handlers
export async function handleLogin(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as { email?: string; password?: string };
  const { email, password } = body;

  if (!email || !password) {
    return error("Email and password are required");
  }

  const user = await env.DB.prepare(
    "SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?",
  )
    .bind(email)
    .first<User & { password_hash: string | null }>();

  if (!user) {
    return error("Invalid email or password", 401);
  }

  // Google-only accounts have a null password_hash — password login must fail
  // cleanly (401) rather than crashing verifyPassword (500).
  if (!user.password_hash) {
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

export async function handleLogout(env: Env, request: Request): Promise<Response> {
  const sessionId = getSessionIdFromCookie(request);

  if (sessionId) {
    await deleteSession(env, sessionId);
  }

  return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

export async function handleRegister(env: Env, request: Request): Promise<Response> {
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

export async function handleGetMe(env: Env, request: Request): Promise<Response> {
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

export async function handleUpdateMe(env: Env, request: Request): Promise<Response> {
  const user = await getAuthenticatedUser(env, request);
  if (!user) return error("Not authenticated", 401);

  const body = (await request.json()) as { name?: string };
  const { name } = body;

  if (!name?.trim()) {
    return error("Name is required");
  }

  await env.DB.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name.trim(), user.id)
    .run();

  return json({ user: { id: user.id, email: user.email, name: name.trim() } });
}

export async function handleDeleteMe(env: Env, request: Request): Promise<Response> {
  const user = await getAuthenticatedUser(env, request);
  if (!user) return error("Not authenticated", 401);

  // Delete user — cascades to sessions, projects, documents, reviews, revisions
  // via ON DELETE CASCADE foreign keys.
  // Also clean up R2 objects for the user's documents and reviews.
  const { results: projects } = await env.DB.prepare("SELECT id FROM projects WHERE user_id = ?")
    .bind(user.id)
    .all<{ id: string }>();

  for (const project of projects) {
    const { results: documents } = await env.DB.prepare(
      "SELECT r2_key FROM documents WHERE project_id = ?",
    )
      .bind(project.id)
      .all<{ r2_key: string }>();

    const { results: reviews } = await env.DB.prepare(
      "SELECT r.r2_key FROM reviews r JOIN documents d ON r.document_id = d.id WHERE d.project_id = ?",
    )
      .bind(project.id)
      .all<{ r2_key: string }>();

    const { results: revisions } = await env.DB.prepare(
      "SELECT rv.r2_key FROM revisions rv JOIN documents d ON rv.document_id = d.id WHERE d.project_id = ?",
    )
      .bind(project.id)
      .all<{ r2_key: string }>();

    const r2Keys = [
      ...documents.map((d) => d.r2_key),
      ...reviews.map((r) => r.r2_key),
      ...revisions.map((r) => r.r2_key),
    ];

    for (const key of r2Keys) {
      await env.CONTENT_BUCKET.delete(key);
    }
  }

  // Delete user row — cascades delete sessions, projects, documents, reviews, etc.
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

  return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

export async function handleRefreshSession(env: Env, request: Request): Promise<Response> {
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

export async function handleHealthCheck(env: Env): Promise<Response> {
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
