import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleAcceptCandidate } from "../candidates";
import { handleGenerateDraft } from "../drafting";
import { callClaudeAPI } from "../pipeline";
import { saveRevision } from "../revisions";
import type { Document } from "../types";
import { callWritingModel, WRITING_MODEL } from "../writing-model";
import { database } from "./database";

vi.mock("../pipeline", async (original) => ({
  ...(await original<typeof import("../pipeline")>()),
  callClaudeAPI: vi.fn(),
}));
const raw =
  'REVISED_DOCUMENT_START\n# A new draft\n\nAn introduction.\nREVISED_DOCUMENT_END\nCHANGE_SUMMARY_START\n{"changes":[],"overallSummary":"Wrote an introduction"}\nCHANGE_SUMMARY_END';
const request = (body: unknown) =>
  new Request("https://example.test", { method: "POST", body: JSON.stringify(body) });
let db: ReturnType<typeof database>;
let run: ReturnType<typeof vi.fn>;
beforeEach(() => {
  db = database();
  db.env.ANTHROPIC_API_KEY = "";
  run = vi.fn().mockResolvedValue({ response: raw });
  db.env.AI = { run } as unknown as Ai;
});
afterEach(() => db.close());

it("writes a first draft without an API key or review and saves only after acceptance", async () => {
  db.objects.set("original.md", "");
  const response = await handleGenerateDraft(
    db.env,
    request({ prompt: "Introduce our neighborhood garden", baseRevision: 0 }),
    "project",
    "document",
    "owner",
  );
  expect(response.status).toBe(201);
  const candidate = await response.json();
  expect(run).toHaveBeenCalledWith(WRITING_MODEL, expect.objectContaining({ max_tokens: 8192 }));
  expect(db.env.CONTENT_BUCKET.put).not.toHaveBeenCalled();
  expect(
    db.sqlite.prepare("SELECT review_id FROM revision_candidates").get()?.review_id,
  ).toBeNull();
  const accepted = await handleAcceptCandidate(
    db.env,
    "project",
    "document",
    candidate.candidateId,
    "owner",
  );
  expect(accepted.status).toBe(200);
  expect((await accepted.json()).content).toContain("# A new draft");
  expect(
    db.sqlite.prepare("SELECT current_revision FROM documents WHERE id = 'document'").get()
      ?.current_revision,
  ).toBe(1);
});

it.each([
  [{ prompt: "", baseRevision: 0 }, "owner", 400],
  [{ prompt: "x".repeat(6001), baseRevision: 0 }, "owner", 400],
  [{ prompt: "A letter", baseRevision: 1 }, "owner", 409],
  [{ prompt: "A letter", baseRevision: 0 }, "other", 404],
])("rejects invalid or unauthorized drafting requests", async (body, user, status) => {
  const response = await handleGenerateDraft(db.env, request(body), "project", "document", user);
  expect(response.status).toBe(status);
  expect(run).not.toHaveBeenCalled();
});

it("does not replace newer edits with generated text", async () => {
  const response = await handleGenerateDraft(
    db.env,
    request({ prompt: "Expand the draft", baseRevision: 0 }),
    "project",
    "document",
    "owner",
  );
  const candidate = await response.json();
  const doc = db.sqlite
    .prepare("SELECT * FROM documents WHERE id = 'document'")
    .get() as unknown as Document;
  await saveRevision(db.env, doc, "owner", "Newer words", 0);
  await expect(
    handleAcceptCandidate(db.env, "project", "document", candidate.candidateId, "owner"),
  ).rejects.toMatchObject({ status: 409 });
});

it("does not store truncated model output", async () => {
  run.mockResolvedValue({ response: "REVISED_DOCUMENT_START\nunfinished" });
  await expect(
    handleGenerateDraft(
      db.env,
      request({ prompt: "Write a letter", baseRevision: 0 }),
      "project",
      "document",
      "owner",
    ),
  ).rejects.toThrow("incomplete");
  expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM revision_candidates").get()?.count).toBe(
    0,
  );
});

it("uses a configured Claude key and does not silently switch after provider errors", async () => {
  db.env.ANTHROPIC_API_KEY = "test-key";
  vi.mocked(callClaudeAPI).mockResolvedValue("Claude output");
  expect(await callWritingModel(db.env, request({}), "prompt")).toBe("Claude output");
  expect(run).not.toHaveBeenCalled();
  vi.mocked(callClaudeAPI).mockRejectedValue(new Error("provider secret details"));
  await expect(callWritingModel(db.env, request({}), "prompt")).rejects.toThrow(
    "AI writing could not finish",
  );
  expect(run).not.toHaveBeenCalled();
});

it("normalizes structured Workers AI review output for the review parser", async () => {
  const review = { summary: "Clear and concise", items: [] };
  run.mockResolvedValue({ response: review });
  expect(JSON.parse(await callWritingModel(db.env, request({}), "Review this document"))).toEqual(
    review,
  );
});
