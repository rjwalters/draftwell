import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { errorDetails, inStage, logStage, withDiagnostics } from "../diagnostics";
import { RequestError } from "../revisions";
import { json } from "../shared";
import { callWritingModel, generateWritingRevision } from "../writing-model";
import { database } from "./database";

let db: ReturnType<typeof database>;
let pending: Promise<unknown>[];
let info: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  db = database();
  pending = [];
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(pending);
  db.close();
  vi.restoreAllMocks();
});
function context(request: Request) {
  return {
    request,
    env: db.env,
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  } as unknown as Parameters<typeof withDiagnostics>[0];
}

it("retains a failed stage and a matching reference without sensitive request or error text", async () => {
  const secret = "do-not-log-secret";
  const request = new Request(
    `https://example.test/api/projects/${secret}/documents/8375b3ba-4729-42e1-98ce-b6512454585c/ai/draft?code=${secret}`,
    {
      method: "POST",
      headers: { Cookie: secret, Authorization: secret, "X-Request-ID": secret },
      body: secret,
    },
  );
  const response = await withDiagnostics(context(request), async () => {
    await inStage(request, "candidate.save", async () => {
      throw new Error(`D1_ERROR: no such table: ${secret}`);
    });
    return json({});
  });
  await Promise.all(pending);
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body.error).toBe("Internal server error");
  expect(body.requestId).toBe(response.headers.get("X-Request-ID"));
  expect(body.requestId).not.toBe(secret);
  const row = db.sqlite
    .prepare("SELECT * FROM request_diagnostics WHERE request_id = ?")
    .get(body.requestId);
  expect(row?.route).toBe("/api/projects/:id/documents/:id/ai/draft");
  expect(row?.error_kind).toBe("database_schema");
  expect(JSON.parse(row?.events_json as string)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: "candidate.save",
        outcome: "failed",
        errorKind: "database_schema",
      }),
    ]),
  );
  expect(JSON.stringify([row, info.mock.calls, errors.mock.calls])).not.toContain(secret);
});

it("retains provider status and input size without logging prompts, credentials, or upstream response bodies", async () => {
  db.env.ANTHROPIC_API_KEY = "";
  db.env.AI = {
    run: vi.fn().mockRejectedValue(new Error("API error (429): private-provider-payload")),
  } as unknown as Ai;
  const request = new Request("https://example.test/api/projects/p/documents/d/ai/draft", {
    method: "POST",
  });
  const response = await withDiagnostics(context(request), async () => {
    await callWritingModel(db.env, request, "private-prompt");
    return json({});
  });
  await Promise.all(pending);
  const row = db.sqlite.prepare("SELECT * FROM request_diagnostics").get();
  expect(response.status).toBe(503);
  const events = JSON.parse(row?.events_json as string);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: "model",
        outcome: "failed",
        providerStatus: 429,
        inputChars: 14,
      }),
    ]),
  );
  expect(JSON.stringify([row, info.mock.calls])).not.toContain("private-");
});

it("keeps concurrent traces separate and prunes expired records", async () => {
  db.sqlite.exec(
    "INSERT INTO request_diagnostics VALUES ('expired', '2000-01-01', 'POST', '/api/test', NULL, 500, 0, 'test', '[]')",
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = new Request("https://example.test/api/projects/a/documents/a/ai/draft");
  const second = new Request("https://example.test/api/projects/b/documents/b/ai/draft");
  const a = withDiagnostics(context(first), async () => {
    await gate;
    logStage(first, "output.parse", "succeeded", { attempt: 1, outputChars: 111 });
    return json({});
  });
  const b = await withDiagnostics(context(second), async () => {
    logStage(second, "output.parse", "failed", { attempt: 2, outputChars: 222 });
    throw new RequestError("Invalid completion", 502, "incomplete_output");
  });
  release();
  const firstResponse = await a;
  await Promise.all(pending);
  expect(firstResponse.headers.get("X-Request-ID")).not.toBe(b.headers.get("X-Request-ID"));
  const rows = db.sqlite.prepare("SELECT * FROM request_diagnostics ORDER BY status").all();
  expect(rows).toHaveLength(2);
  expect(JSON.parse(rows[0].events_json as string)[0].outputChars).toBe(111);
  expect(JSON.parse(rows[1].events_json as string)[0].outputChars).toBe(222);
});

it("returns a successful response even if diagnostic storage fails", async () => {
  db.env.DB.batch = vi.fn().mockRejectedValue(new Error("D1_ERROR: unavailable"));
  const request = new Request("https://example.test/api/projects/p/documents/d/ai/draft");
  const response = await withDiagnostics(context(request), async () => {
    logStage(request, "candidate.save", "succeeded");
    return json({ candidateId: "saved" }, 201);
  });
  await Promise.all(pending);
  expect(response.status).toBe(201);
  expect((await response.json()).candidateId).toBe("saved");
  expect(errors).toHaveBeenCalledWith(expect.stringContaining("diagnostics.persist_failed"));
});

it("classifies malformed JSON without exposing its contents", () => {
  expect(errorDetails(new SyntaxError("secret input"))).toEqual({ errorKind: "invalid_json" });
});

it("retains both failed parsing and successful retry under one request ID", async () => {
  db.env.ANTHROPIC_API_KEY = "";
  db.env.AI = {
    run: vi
      .fn()
      .mockResolvedValueOnce({
        response: "REVISED_DOCUMENT_START\nunfinished",
        choices: [{ finish_reason: "length" }],
      })
      .mockResolvedValueOnce({
        response:
          'REVISED_DOCUMENT_START\nFinished draft.\nREVISED_DOCUMENT_END\nCHANGE_SUMMARY_START\n{"changes":[],"overallSummary":"Finished"}\nCHANGE_SUMMARY_END',
        choices: [{ finish_reason: "stop" }],
      }),
  } as unknown as Ai;
  const request = new Request("https://example.test/api/projects/p/documents/d/ai/draft");
  const response = await withDiagnostics(context(request), async () =>
    json(await generateWritingRevision(db.env, request, "Write an invitation")),
  );
  await Promise.all(pending);
  const row = db.sqlite
    .prepare("SELECT * FROM request_diagnostics WHERE request_id = ?")
    .get(response.headers.get("X-Request-ID"));
  const events = JSON.parse(row?.events_json as string);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: "model",
        outcome: "succeeded",
        attempt: 1,
        finishReason: "length",
      }),
      expect.objectContaining({
        stage: "output.parse",
        outcome: "failed",
        errorKind: "incomplete_output",
        documentMarkers: false,
      }),
      expect.objectContaining({ stage: "output.parse", outcome: "retry", attempt: 1 }),
      expect.objectContaining({ stage: "output.parse", outcome: "succeeded", attempt: 2 }),
    ]),
  );
  expect(response.status).toBe(200);
});
