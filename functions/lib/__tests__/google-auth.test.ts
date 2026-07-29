import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleLogin } from "../auth";
import { handleGoogleAuth, handleGoogleCallback } from "../google-auth";
import type { Env } from "../types";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret";

// Base64url-encode an object (JWT segment style).
function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Build a fake (unsigned) Google ID token with the given payload.
function makeIdToken(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(payload)}.signature`;
}

function defaultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: "google-sub-123",
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
    aud: CLIENT_ID,
    iss: "https://accounts.google.com",
    ...overrides,
  };
}

interface DbState {
  oauthLink: { user_id: string } | null;
  userByEmail: { id: string } | null;
  insertedUsers: unknown[][];
  insertedLinks: unknown[][];
  sessions: unknown[][];
}

function makeDb(state: Partial<DbState> = {}): { db: D1Database; state: DbState } {
  const s: DbState = {
    oauthLink: state.oauthLink ?? null,
    userByEmail: state.userByEmail ?? null,
    insertedUsers: [],
    insertedLinks: [],
    sessions: [],
  };

  const db = {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first() {
          if (sql.includes("FROM oauth_accounts WHERE provider")) {
            return s.oauthLink;
          }
          if (sql.includes("FROM users WHERE email")) {
            return s.userByEmail;
          }
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO users")) s.insertedUsers.push(boundArgs);
          if (sql.startsWith("INSERT INTO oauth_accounts")) s.insertedLinks.push(boundArgs);
          if (sql.startsWith("INSERT INTO sessions")) s.sessions.push(boundArgs);
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, state: s };
}

function makeEnv(db: D1Database, configured = true): Env {
  return {
    DB: db,
    APP_NAME: "test-app",
    GOOGLE_CLIENT_ID: configured ? CLIENT_ID : undefined,
    GOOGLE_CLIENT_SECRET: configured ? CLIENT_SECRET : undefined,
  } as unknown as Env;
}

function callbackRequest(opts: { state?: string; cookieState?: string; error?: string }): Request {
  const params = new URLSearchParams();
  if (opts.error) params.set("error", opts.error);
  if (opts.state) params.set("state", opts.state);
  if (opts.state) params.set("code", "auth-code-abc");
  const url = `https://draftwell.org/api/auth/google/callback?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (opts.cookieState) headers.Cookie = `draftwell-oauth-state=${opts.cookieState}`;
  return new Request(url, { headers });
}

function mockTokenEndpoint(payload: Record<string, unknown>, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(ok ? { id_token: makeIdToken(payload) } : { error: "bad" }), {
      status: ok ? 200 : 400,
    }),
  ) as typeof fetch;
}

describe("handleGoogleAuth", () => {
  it("returns 503 when Google secrets are not configured", async () => {
    const { db } = makeDb();
    const res = await handleGoogleAuth(
      makeEnv(db, false),
      new Request("https://draftwell.org/api/auth/google"),
    );
    expect(res.status).toBe(503);
  });

  it("redirects to Google with state cookie when configured", async () => {
    const { db } = makeDb();
    const res = await handleGoogleAuth(
      makeEnv(db),
      new Request("https://draftwell.org/api/auth/google"),
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain(`client_id=${encodeURIComponent(CLIENT_ID)}`);
    expect(location).toContain("scope=openid+email+profile");
    expect(location).toContain("state=");
    expect(location).toContain(
      "redirect_uri=https%3A%2F%2Fdraftwell.org%2Fapi%2Fauth%2Fgoogle%2Fcallback",
    );

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("draftwell-oauth-state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });
});

describe("handleGoogleCallback", () => {
  const STATE = "state-token-xyz";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 503 when Google secrets are not configured", async () => {
    const { db } = makeDb();
    const res = await handleGoogleCallback(
      makeEnv(db, false),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );
    expect(res.status).toBe(503);
  });

  it("returns 400 when state does not match the cookie", async () => {
    const { db } = makeDb();
    mockTokenEndpoint(defaultPayload());
    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: "different-state" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the state cookie is missing", async () => {
    const { db } = makeDb();
    const res = await handleGoogleCallback(makeEnv(db), callbackRequest({ state: STATE }));
    expect(res.status).toBe(400);
  });

  it("redirects to /login?error=oauth when the user denies consent", async () => {
    const { db } = makeDb();
    const req = callbackRequest({ error: "access_denied", cookieState: STATE });
    const res = await handleGoogleCallback(makeEnv(db), req);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=oauth");
  });

  it("creates a new passwordless user and session on first sign-in", async () => {
    const { db, state } = makeDb({ oauthLink: null, userByEmail: null });
    mockTokenEndpoint(defaultPayload());

    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/dashboard");
    expect(res.headers.get("Set-Cookie")).toContain("draftwell-session=");

    // One new user, one oauth link, one session created.
    expect(state.insertedUsers).toHaveLength(1);
    expect(state.insertedLinks).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    // The user was inserted with the Google email and derived name.
    expect(state.insertedUsers[0]).toContain("user@example.com");
  });

  it("logs into the existing account matched by Google sub (not email)", async () => {
    const { db, state } = makeDb({ oauthLink: { user_id: "existing-user-1" } });
    mockTokenEndpoint(defaultPayload());

    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );

    expect(res.status).toBe(302);
    // No new user or link — logged into the linked account.
    expect(state.insertedUsers).toHaveLength(0);
    expect(state.insertedLinks).toHaveLength(0);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toContain("existing-user-1");
  });

  it("links to an existing email account only when email_verified is true", async () => {
    const { db, state } = makeDb({ userByEmail: { id: "pw-user-1" } });
    mockTokenEndpoint(defaultPayload({ email_verified: true }));

    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );

    expect(res.status).toBe(302);
    expect(state.insertedUsers).toHaveLength(0);
    expect(state.insertedLinks).toHaveLength(1);
    expect(state.insertedLinks[0]).toContain("pw-user-1");
    expect(state.sessions[0]).toContain("pw-user-1");
  });

  it("refuses to link an email account when email_verified is false (403)", async () => {
    const { db, state } = makeDb({ userByEmail: { id: "pw-user-1" } });
    mockTokenEndpoint(defaultPayload({ email_verified: false }));

    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );

    expect(res.status).toBe(403);
    expect(state.insertedLinks).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
  });

  it("rejects a token whose audience is not our client id", async () => {
    const { db } = makeDb({ oauthLink: null, userByEmail: null });
    mockTokenEndpoint(defaultPayload({ aud: "someone-else" }));

    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=oauth");
  });

  it("rejects a token with an invalid issuer", async () => {
    const { db } = makeDb({ oauthLink: null, userByEmail: null });
    mockTokenEndpoint(defaultPayload({ iss: "https://evil.example.com" }));

    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=oauth");
  });

  it("falls back to the email local-part when Google omits the name claim", async () => {
    const { db, state } = makeDb({ oauthLink: null, userByEmail: null });
    mockTokenEndpoint(
      defaultPayload({ name: undefined, email: "alice@example.com", sub: "sub-a" }),
    );

    const res = await handleGoogleCallback(
      makeEnv(db),
      callbackRequest({ state: STATE, cookieState: STATE }),
    );

    expect(res.status).toBe(302);
    expect(state.insertedUsers[0]).toContain("alice");
  });
});

describe("handleLogin — Google-only account guard", () => {
  it("returns 401 (not 500) when the account has a null password_hash", async () => {
    const db = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return {
              id: "google-user-1",
              email: "user@example.com",
              name: "Test User",
              password_hash: null,
              created_at: "2024-01-01",
            };
          },
          async run() {
            return { success: true };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const env = makeEnv(db);
    const request = new Request("https://draftwell.org/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "whatever123" }),
    });

    const res = await handleLogin(env, request);
    expect(res.status).toBe(401);
  });
});
