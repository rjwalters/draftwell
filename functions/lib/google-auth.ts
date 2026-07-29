// Google OAuth 2.0 (authorization code grant) for Cloudflare Pages Functions.
//
// Flow:
//   GET /api/auth/google           -> 302 to Google's consent screen, sets a
//                                     short-lived state cookie (CSRF protection).
//   GET /api/auth/google/callback  -> verifies state, exchanges the code for
//                                     tokens, resolves/creates the local user,
//                                     establishes a session, then 302 to /dashboard.
//
// Deployment prerequisite (operator): create a Google Cloud OAuth 2.0 web client
// and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET via `wrangler secret put`.
// Code and tests do not depend on live credentials.

import { createSession } from "./auth";
import {
  clearStateCookie,
  error,
  getStateFromCookie,
  SESSION_DURATION_MS,
  setSessionCookie,
  setStateCookie,
} from "./shared";
import type { Env } from "./types";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = "openid email profile";
const PROVIDER = "google";
const VALID_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

interface GoogleIdTokenPayload {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  aud?: string;
  iss?: string;
}

function isConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function callbackRedirectUri(request: Request): string {
  return new URL("/api/auth/google/callback", request.url).toString();
}

// Base64url-decode a JWT payload segment. The ID token comes directly from
// Google over TLS, so signature verification is optional here — but we still
// validate `aud` and `iss` in the callback.
function decodeIdTokenPayload(idToken: string): GoogleIdTokenPayload {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed ID token");
  }
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const decoded = atob(padded);
  return JSON.parse(decoded) as GoogleIdTokenPayload;
}

function redirectToLoginError(request: Request): Response {
  const location = new URL("/login?error=oauth", request.url).toString();
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Set-Cookie": clearStateCookie() },
  });
}

// GET /api/auth/google — begin the OAuth dance.
export async function handleGoogleAuth(env: Env, request: Request): Promise<Response> {
  if (!isConfigured(env)) {
    return error("Google sign-in is not configured", 503);
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID as string,
    redirect_uri: callbackRedirectUri(request),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state,
    access_type: "online",
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`,
      "Set-Cookie": setStateCookie(state),
    },
  });
}

// GET /api/auth/google/callback — complete the OAuth dance and sign the user in.
export async function handleGoogleCallback(env: Env, request: Request): Promise<Response> {
  if (!isConfigured(env)) {
    return error("Google sign-in is not configured", 503);
  }

  const url = new URL(request.url);

  // User denied consent (or Google returned an error) → back to login.
  if (url.searchParams.get("error")) {
    return redirectToLoginError(request);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = getStateFromCookie(request);

  // CSRF check: the state echoed by Google must match the cookie we set.
  if (!state || !expectedState || state !== expectedState) {
    return error("Invalid OAuth state", 400);
  }

  if (!code) {
    return error("Missing authorization code", 400);
  }

  // Exchange the authorization code for tokens.
  let payload: GoogleIdTokenPayload;
  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID as string,
        client_secret: env.GOOGLE_CLIENT_SECRET as string,
        redirect_uri: callbackRedirectUri(request),
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      return redirectToLoginError(request);
    }

    const tokenData = (await tokenResponse.json()) as { id_token?: string };
    if (!tokenData.id_token) {
      return redirectToLoginError(request);
    }

    payload = decodeIdTokenPayload(tokenData.id_token);
  } catch {
    return redirectToLoginError(request);
  }

  // Validate token audience and issuer.
  if (
    payload.aud !== env.GOOGLE_CLIENT_ID ||
    !payload.iss ||
    !VALID_ISSUERS.includes(payload.iss)
  ) {
    return redirectToLoginError(request);
  }

  const sub = payload.sub;
  const email = payload.email;
  if (!sub || !email) {
    return redirectToLoginError(request);
  }

  // Google reports email_verified as a boolean, but some flows stringify it.
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  const userId = await resolveUser(env, { sub, email, emailVerified, name: payload.name });
  if (!userId) {
    // Email collision with an existing password account, but Google has not
    // verified the email — refuse to link (account-takeover guard).
    return error("Email is not verified by Google; cannot link to existing account", 403);
  }

  const sessionId = await createSession(env, userId);
  const maxAge = Math.floor(SESSION_DURATION_MS / 1000);
  const location = new URL("/dashboard", request.url).toString();

  const headers = new Headers();
  headers.append("Location", location);
  headers.append("Set-Cookie", setSessionCookie(sessionId, maxAge));
  headers.append("Set-Cookie", clearStateCookie());

  return new Response(null, { status: 302, headers });
}

interface ResolveInput {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

// Resolve the local user for a Google identity, creating or linking as needed.
// Returns the user id, or null when linking is refused (unverified email).
async function resolveUser(env: Env, input: ResolveInput): Promise<string | null> {
  const { sub, email, emailVerified, name } = input;

  // 1. Existing oauth link by Google `sub` → log in.
  const existingLink = await env.DB.prepare(
    "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?",
  )
    .bind(PROVIDER, sub)
    .first<{ user_id: string }>();

  if (existingLink) {
    return existingLink.user_id;
  }

  // 2. Existing user by email → link only when Google has verified the email.
  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  if (existingUser) {
    if (!emailVerified) {
      return null;
    }
    await linkOAuthAccount(env, existingUser.id, sub);
    return existingUser.id;
  }

  // 3. No match → create a new (passwordless) user and link the identity.
  const newUserId = crypto.randomUUID();
  const displayName = name?.trim() || email.split("@")[0];

  await env.DB.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, NULL)")
    .bind(newUserId, email, displayName)
    .run();

  await linkOAuthAccount(env, newUserId, sub);
  return newUserId;
}

async function linkOAuthAccount(env: Env, userId: string, sub: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)",
  )
    .bind(userId, PROVIDER, sub)
    .run();
}
