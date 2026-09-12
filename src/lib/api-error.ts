/** Keep the server reference visible when a user reports an API failure. */
export function apiErrorMessage(
  data: { error?: unknown; requestId?: unknown },
  fallback: string,
): string {
  const message = typeof data.error === "string" ? data.error : fallback;
  const reference =
    typeof data.requestId === "string" && /^[a-f\d-]{36}$/i.test(data.requestId)
      ? data.requestId
      : null;
  return reference ? `${message} (Reference: ${reference})` : message;
}
