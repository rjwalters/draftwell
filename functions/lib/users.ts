import type { Env, User } from "./types";
import { json, error } from "./shared";

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

export async function handleGetUsers(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 100",
  ).all<User>();
  return json({ users: results });
}

export async function handleGetUser(env: Env, id: string): Promise<Response> {
  const user = await env.DB.prepare("SELECT id, email, name, created_at FROM users WHERE id = ?")
    .bind(id)
    .first<User>();

  if (!user) {
    return error("User not found", 404);
  }
  return json({ user });
}

export async function handleCreateUser(env: Env, request: Request): Promise<Response> {
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
