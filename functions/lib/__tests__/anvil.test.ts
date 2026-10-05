import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ANVIL_COMMIT, handleWritingCheck } from "../anvil";
import { database } from "./database";

let db: ReturnType<typeof database>;
beforeEach(() => {
  db = database();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});
const request = () =>
  new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ baseRevision: 0 }),
  });

it("sends an authorized immutable snapshot and accepts only the matching engine result", async () => {
  db.env.ANVIL_URL = "http://localhost:8790";
  db.env.ANVIL_TOKEN = "test-only";
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const body = JSON.parse(init?.body as string);
    expect(body.content).toBe("Original document.");
    expect(body.content_hash).toHaveLength(64);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-only");
    return new Response(
      JSON.stringify({
        ...body,
        anvil_commit: ANVIL_COMMIT,
        rhetoric: { findings: [] },
        numeric: { findings: [] },
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await handleWritingCheck(db.env, request(), "project", "document", "owner");
  expect(result.status).toBe(200);
  expect((await result.json()).revision).toBe(0);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("rejects a stale or incompatible result", async () => {
  db.env.ANVIL_URL = "http://localhost:8790";
  db.env.ANVIL_TOKEN = "test-only";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ...JSON.parse(init?.body as string),
            revision: 4,
            anvil_commit: ANVIL_COMMIT,
            rhetoric: { findings: [] },
            numeric: { findings: [] },
          }),
        ),
    ),
  );
  expect((await handleWritingCheck(db.env, request(), "project", "document", "owner")).status).toBe(
    502,
  );
});

it("does not send content for an unauthorized document or missing configuration", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(
    (await handleWritingCheck(db.env, request(), "project", "foreign-document", "owner")).status,
  ).toBe(404);
  expect((await handleWritingCheck(db.env, request(), "project", "document", "owner")).status).toBe(
    503,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
