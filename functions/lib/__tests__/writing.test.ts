import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleGenerateRefinement,
  handleGenerateReview,
  handleGenerateRevision,
  handleGetReview,
} from "../ai";
import { handleAcceptCandidate } from "../candidates";
import { handleUpdateDocument } from "../documents";
import { callClaudeAPI, parseRevisionResponse } from "../pipeline";
import { saveRevision } from "../revisions";
import type { Document } from "../types";
import { database } from "./database";

vi.mock("../pipeline", async (original) => ({
  ...(await original<typeof import("../pipeline")>()),
  callClaudeAPI: vi.fn(),
}));
const rawRevision = `REVISED_DOCUMENT_START\nImproved document.\nREVISED_DOCUMENT_END\nCHANGE_SUMMARY_START\n{"changes":[{"reviewItemIndex":1,"status":"partial","explanation":"Added detail"}],"overallSummary":"Clearer"}\nCHANGE_SUMMARY_END`;
const request = (body: unknown) =>
  new Request("https://example.test", { method: "POST", body: JSON.stringify(body) });
let db: ReturnType<typeof database>;
beforeEach(() => {
  db = database();
  vi.mocked(callClaudeAPI).mockReset().mockResolvedValue(rawRevision);
});
afterEach(() => db.close());
const document = () =>
  db.sqlite.prepare("SELECT * FROM documents WHERE id = 'document'").get() as unknown as Document;

it.each([
  handleGenerateRevision,
  handleGenerateRefinement,
])("rejects unrelated reviews before model calls (%s)", async (handler) => {
  for (const reviewId of ["foreign-review", "other-review", "missing"]) {
    const response = await handler(
      db.env,
      request({ reviewId, baseRevision: 0 }),
      "project",
      "document",
      "owner",
    );
    expect(response.status).toBe(404);
  }
  expect(callClaudeAPI).not.toHaveBeenCalled();
  expect(db.env.CONTENT_BUCKET.put).not.toHaveBeenCalled();
  expect(
    db.sqlite.prepare("SELECT status FROM review_items WHERE id = 'foreign-item'").get()?.status,
  ).toBe("open");
});

it("keeps candidates separate, accepts atomically, and refines an accepted revision", async () => {
  const response = await handleGenerateRevision(
    db.env,
    request({ reviewId: "review", baseRevision: 0 }),
    "project",
    "document",
    "owner",
  );
  expect(response.status).toBe(201);
  const candidate = await response.json();
  expect(document().current_revision).toBe(0);
  expect(db.env.CONTENT_BUCKET.put).not.toHaveBeenCalled();
  expect(db.sqlite.prepare("SELECT status FROM review_items WHERE id = 'item'").get()?.status).toBe(
    "open",
  );
  const accepted = await handleAcceptCandidate(
    db.env,
    "project",
    "document",
    candidate.candidateId,
    "owner",
  );
  expect(accepted.status).toBe(200);
  expect(document().current_revision).toBe(1);
  expect(db.objects.get(document().r2_key)).toBe("Improved document.");
  expect(db.sqlite.prepare("SELECT status FROM review_items WHERE id = 'item'").get()?.status).toBe(
    "partial",
  );
  expect(
    (await handleAcceptCandidate(db.env, "project", "document", candidate.candidateId, "owner"))
      .status,
  ).toBe(200);
  expect(document().current_revision).toBe(1);
  expect(
    (
      await handleGenerateRefinement(
        db.env,
        request({ reviewId: "review", baseRevision: 1 }),
        "project",
        "document",
        "owner",
      )
    ).status,
  ).toBe(201);
});

it("rejects a stale candidate without overwriting user edits or review statuses", async () => {
  const generated = await handleGenerateRevision(
    db.env,
    request({ reviewId: "review", baseRevision: 0 }),
    "project",
    "document",
    "owner",
  );
  const candidate = await generated.json();
  await saveRevision(db.env, document(), "owner", "My newer edit", 0);
  await expect(
    handleAcceptCandidate(db.env, "project", "document", candidate.candidateId, "owner"),
  ).rejects.toMatchObject({ status: 409 });
  expect(db.objects.get(document().r2_key)).toBe("My newer edit");
  expect(db.sqlite.prepare("SELECT status FROM review_items WHERE id = 'item'").get()?.status).toBe(
    "open",
  );
});

it("only one competing save wins and the original object stays intact", async () => {
  const snapshot = document();
  const results = await Promise.allSettled([
    saveRevision(db.env, snapshot, "owner", "A", 0),
    saveRevision(db.env, snapshot, "owner", "B", 0),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(document().current_revision).toBe(1);
  expect(db.objects.get("original.md")).toBe("Original document.");
  expect(
    db.sqlite.prepare("SELECT count(*) AS n FROM revisions WHERE document_id = 'document'").get()
      ?.n,
  ).toBe(1);
  expect(db.objects.has(document().r2_key)).toBe(true);
});

it("rolls back document and revision metadata together on a batch failure", async () => {
  await expect(
    saveRevision(db.env, document(), "owner", "A", 0, () => [
      db.env.DB.prepare("INSERT INTO nonexistent VALUES (1)"),
    ]),
  ).rejects.toThrow();
  expect(document().current_revision).toBe(0);
  expect(db.sqlite.prepare("SELECT count(*) AS n FROM revisions").get()?.n).toBe(0);
});

it("requires a base revision and rejects foreign voice profiles", async () => {
  await expect(
    handleUpdateDocument(db.env, request({ content: "A" }), "project", "document", "owner"),
  ).rejects.toMatchObject({ status: 428 });
  db.sqlite.exec(
    `INSERT INTO voice_profiles (id, user_id, name, profile_data) VALUES ('voice', 'other', 'Private', '{}')`,
  );
  expect(
    (
      await handleUpdateDocument(
        db.env,
        request({ voiceProfileId: "voice" }),
        "project",
        "document",
        "owner",
      )
    ).status,
  ).toBe(404);
});

it("restores complete finding metadata and review statistics", async () => {
  const response = await handleGetReview(db.env, "project", "document", "review", "owner");
  const data = await response.json();
  expect(data.items[0]).toMatchObject({
    source: "persona",
    suggestion: "Use an example",
    consensusCount: 3,
    status: "open",
  });
  expect(data.stats.personaCount).toBe(4);
});

it("passes owned voice rules and exemplars into review and revision", async () => {
  const profile = JSON.stringify({
    dimensions: [{ name: "Cadence", rule: "Use short sentences", observation: "Brief" }],
    summary: "Direct",
    escape_clause: "Vary when needed",
  });
  db.sqlite
    .prepare("INSERT INTO voice_profiles (id, user_id, name, profile_data) VALUES (?, ?, ?, ?)")
    .run("voice", "owner", "My voice", profile);
  db.sqlite.exec(
    `INSERT INTO voice_samples (id, user_id, voice_profile_id, sample_text, word_count) VALUES ('sample', 'owner', 'voice', 'My exemplar words.', 3); UPDATE documents SET voice_profile_id = 'voice' WHERE id = 'document';`,
  );
  await handleGenerateRevision(
    db.env,
    request({ reviewId: "review", baseRevision: 0 }),
    "project",
    "document",
    "owner",
  );
  expect(vi.mocked(callClaudeAPI).mock.calls[0][0]).toContain("My exemplar words.");
  vi.mocked(callClaudeAPI)
    .mockReset()
    .mockResolvedValue(
      JSON.stringify({
        summary: "Clear",
        items: [
          {
            category: "clarity",
            description: "Clarify",
            severity: "minor",
            suggestion: "Use an example",
          },
        ],
      }),
    );
  const reviewed = await handleGenerateReview(
    db.env,
    request({ baseRevision: 0 }),
    "project",
    "document",
    "owner",
  );
  expect(reviewed.status).toBe(201);
  expect(
    vi.mocked(callClaudeAPI).mock.calls.every(([prompt]) => prompt.includes("My exemplar words.")),
  ).toBe(true);
  expect(
    vi.mocked(callClaudeAPI).mock.calls.some(([prompt]) => prompt.includes("Use short sentences")),
  ).toBe(true);
  const data = await reviewed.json();
  const restored = await (
    await handleGetReview(db.env, "project", "document", data.review.id, "owner")
  ).json();
  expect(
    restored.items.some((item: { suggestion: string }) => item.suggestion === "Use an example"),
  ).toBe(true);
});

describe("model output validation", () => {
  it("rejects malformed or truncated revisions instead of treating them as document text", () => {
    expect(() => parseRevisionResponse("Sorry, I cannot finish this output.")).toThrow();
    expect(() => parseRevisionResponse(rawRevision.replace('"partial"', '"invented"'))).toThrow();
  });
});
