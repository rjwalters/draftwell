// Session configuration
export const SESSION_COOKIE_NAME = "draftwell-session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// OAuth state (CSRF) cookie configuration
export const OAUTH_STATE_COOKIE_NAME = "draftwell-oauth-state";
export const OAUTH_STATE_DURATION_S = 10 * 60; // 10 minutes

// Simple response helpers
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function error(message: string, status = 400) {
  return json({ error: message }, status);
}

// Cookie helpers
export function setSessionCookie(sessionId: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function getSessionIdFromCookie(request: Request): string | null {
  return getCookie(request, SESSION_COOKIE_NAME);
}

// OAuth state cookie helpers. SameSite=Lax (not Strict) so the cookie is sent on
// the top-level GET navigation back from Google to the callback endpoint.
export function setStateCookie(state: string): string {
  return `${OAUTH_STATE_COOKIE_NAME}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_STATE_DURATION_S}`;
}

export function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getStateFromCookie(request: Request): string | null {
  return getCookie(request, OAUTH_STATE_COOKIE_NAME);
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...val] = c.trim().split("=");
      return [key, val.join("=")];
    }),
  );
  return cookies[name] || null;
}
