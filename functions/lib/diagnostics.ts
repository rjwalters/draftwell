import { RequestError } from "./revisions";
import { error } from "./shared";
import type { Env } from "./types";

type Stage =
  | "document.load"
  | "content.load"
  | "voice.load"
  | "model"
  | "output.parse"
  | "candidate.save";
type Details = {
  attempt?: number;
  provider?: "claude" | "workers-ai";
  model?: string;
  inputChars?: number;
  outputChars?: number;
  maxTokens?: number;
  finishReason?: "stop" | "length" | "other";
  outputType?: "text" | "json" | "missing";
  documentMarkers?: boolean;
  summaryMarkers?: boolean;
  errorKind?: string;
  providerStatus?: number;
  providerCode?: number;
};
interface Event extends Details {
  stage: Stage;
  outcome: "started" | "succeeded" | "failed" | "retry";
  elapsedMs: number;
  durationMs?: number;
}
interface Trace {
  requestId: string;
  started: number;
  method: string;
  route: string;
  documentId?: string;
  events: Event[];
}
const traces = new WeakMap<Request, Trace>();
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const staticSegments = new Set([
  "api",
  "health",
  "auth",
  "login",
  "logout",
  "register",
  "me",
  "refresh",
  "google",
  "callback",
  "projects",
  "documents",
  "reviews",
  "items",
  "candidates",
  "accept",
  "writing-check",
  "ai",
  "draft",
  "review",
  "revise",
  "refine",
  "score",
  "compare",
  "voice",
  "profiles",
  "analyze",
]);

/** Classify exceptions without retaining messages, bodies, SQL, or credentials. */
export function errorDetails(
  cause: unknown,
): Pick<Details, "errorKind" | "providerStatus" | "providerCode"> {
  const message = cause instanceof Error ? cause.message : "";
  let errorKind = "unexpected_error";
  if (cause instanceof RequestError) errorKind = cause.code ?? `http_${cause.status}`;
  else if (cause instanceof SyntaxError) errorKind = "invalid_json";
  else if (/no such (table|column)/i.test(message)) errorKind = "database_schema";
  else if (/constraint failed/i.test(message)) errorKind = "database_constraint";
  else if (/D1_ERROR|SQLITE_/i.test(message)) errorKind = "database_error";
  else if (/timed?\s*out|timeout|abort/i.test(message)) errorKind = "timeout";
  else if (/rate.limit|quota|too many requests/i.test(message)) errorKind = "provider_rate_limit";
  else if (/context.length|context.window|too many tokens/i.test(message))
    errorKind = "model_context_limit";
  else if (cause instanceof TypeError) errorKind = "type_error";
  const status = message.match(/(?:API error\s*\(|status[=: ]+)([45]\d{2})\b/i);
  const code = message.match(/(?:code[=: ]+|error\s+)(\d{3,6})\b/i);
  return {
    errorKind,
    ...(status ? { providerStatus: Number(status[1]) } : {}),
    ...(code ? { providerCode: Number(code[1]) } : {}),
  };
}

export function logStage(
  request: Request,
  stage: Stage,
  outcome: Event["outcome"],
  details: Details = {},
  durationMs?: number,
) {
  const trace = traces.get(request);
  if (!trace) return;
  // Explicit fields prevent accidental request/response-body logging by callers.
  const event: Event = {
    stage,
    outcome,
    elapsedMs: Date.now() - trace.started,
    durationMs,
    attempt: details.attempt,
    provider: details.provider,
    model: details.model,
    inputChars: details.inputChars,
    outputChars: details.outputChars,
    maxTokens: details.maxTokens,
    finishReason: details.finishReason,
    outputType: details.outputType,
    documentMarkers: details.documentMarkers,
    summaryMarkers: details.summaryMarkers,
    errorKind: details.errorKind,
    providerStatus: details.providerStatus,
    providerCode: details.providerCode,
  };
  if (trace.events.length < 64) trace.events.push(event);
  console.info(JSON.stringify({ event: "request.stage", requestId: trace.requestId, ...event }));
}

export async function inStage<T>(
  request: Request,
  stage: Stage,
  work: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  logStage(request, stage, "started");
  try {
    const result = await work();
    logStage(request, stage, "succeeded", {}, Date.now() - start);
    return result;
  } catch (cause) {
    logStage(request, stage, "failed", errorDetails(cause), Date.now() - start);
    throw cause;
  }
}

export async function withDiagnostics(
  context: Parameters<PagesFunction<Env>>[0],
  dispatch: () => Promise<Response>,
): Promise<Response> {
  const { request, env } = context;
  const path = new URL(request.url).pathname;
  const trace: Trace = {
    requestId: crypto.randomUUID(),
    started: Date.now(),
    method: request.method,
    route: path
      .split("/")
      .map((part) => (!part || staticSegments.has(part) ? part : ":id"))
      .join("/")
      .slice(0, 300),
    documentId: path.match(/\/documents\/([a-f\d-]{36})(?:\/|$)/i)?.[1],
    events: [],
  };
  traces.set(request, trace);
  let response: Response;
  let failure: ReturnType<typeof errorDetails> | undefined;
  try {
    response = await dispatch();
  } catch (cause) {
    failure = errorDetails(cause);
    response =
      cause instanceof RequestError
        ? error(cause.message, cause.status)
        : error("Internal server error", 500);
  }
  response = new Response(response.body, response);
  response.headers.set("X-Request-ID", trace.requestId);
  if (
    response.status >= 400 &&
    response.headers.get("Content-Type")?.includes("application/json")
  ) {
    try {
      const body = (await response.clone().json()) as Record<string, unknown>;
      response = new Response(JSON.stringify({ ...body, requestId: trace.requestId }), response);
    } catch {
      // A diagnostic reference must never prevent delivery of the original response.
    }
  }
  const durationMs = Date.now() - trace.started;
  const errorKind =
    failure?.errorKind ?? (response.status >= 400 ? `http_${response.status}` : null);
  console.info(
    JSON.stringify({
      event: "request.completed",
      requestId: trace.requestId,
      method: trace.method,
      route: trace.route,
      status: response.status,
      durationMs,
      ...failure,
    }),
  );
  if (response.status >= 500 || trace.events.length > 0) {
    const persist = async () => {
      try {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO request_diagnostics (request_id, created_at, method, route, document_id, status, duration_ms, error_kind, events_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).bind(
            trace.requestId,
            new Date(trace.started).toISOString(),
            trace.method,
            trace.route,
            trace.documentId ?? null,
            response.status,
            durationMs,
            errorKind,
            JSON.stringify(trace.events),
          ),
          env.DB.prepare("DELETE FROM request_diagnostics WHERE created_at < ?").bind(
            new Date(Date.now() - RETENTION_MS).toISOString(),
          ),
        ]);
      } catch (cause) {
        console.error(
          JSON.stringify({
            event: "diagnostics.persist_failed",
            requestId: trace.requestId,
            ...errorDetails(cause),
          }),
        );
      }
    };
    const pending = persist();
    if (context.waitUntil) context.waitUntil(pending);
    else await pending;
  }
  traces.delete(request);
  return response;
}
