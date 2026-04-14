import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  SCORING_DIMENSIONS,
  buildScoringPrompt,
  parseScoringResponse,
  computeOverallScore,
  scoreDocument,
} from "../scoring.js";
import type { DimensionScore } from "../types.js";

describe("SCORING_DIMENSIONS", () => {
  it("defines all six dimensions", () => {
    assert.equal(SCORING_DIMENSIONS.length, 6);
    const ids = SCORING_DIMENSIONS.map((d) => d.id);
    assert.deepEqual(ids, ["clarity", "structure", "voice", "completeness", "evidence", "concision"]);
  });

  it("each dimension has calibration anchors", () => {
    for (const dim of SCORING_DIMENSIONS) {
      assert.ok(Object.keys(dim.anchors).length >= 4, `${dim.id} should have at least 4 anchors`);
      // Anchor at 6 should mention "median AI output"
      assert.ok(
        dim.anchors[6]?.toLowerCase().includes("median"),
        `${dim.id} anchor at 6 should mention median`,
      );
      // Anchor at 10 should mention "does not exist"
      assert.ok(
        dim.anchors[10]?.toLowerCase().includes("does not exist"),
        `${dim.id} anchor at 10 should mention impossibility`,
      );
    }
  });
});

describe("buildScoringPrompt", () => {
  it("includes calibration language", () => {
    const prompt = buildScoringPrompt("Test document");
    assert.ok(prompt.includes("median AI-generated document scores a 6"), "Should include calibration baseline");
    assert.ok(prompt.includes("8 means a human editor would keep it"), "Should include 8-level anchor");
    assert.ok(prompt.includes("10 does not exist for a first draft"), "Should include 10-level anchor");
  });

  it("includes mandatory weakness requirement", () => {
    const prompt = buildScoringPrompt("Test document");
    assert.ok(prompt.includes("weakness"), "Should require weakness identification");
    assert.ok(prompt.includes("evidence"), "Should require quoted evidence");
    assert.ok(prompt.includes("score without critique is invalid"), "Should state no score without critique");
  });

  it("includes the document text", () => {
    const prompt = buildScoringPrompt("My special document content");
    assert.ok(prompt.includes("My special document content"));
  });

  it("includes all dimension anchors", () => {
    const prompt = buildScoringPrompt("Test");
    for (const dim of SCORING_DIMENSIONS) {
      assert.ok(prompt.includes(dim.name), `Should include ${dim.name} dimension`);
    }
  });
});

describe("parseScoringResponse", () => {
  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      dimensions: [
        {
          dimensionId: "clarity",
          score: 7,
          justification: "Clear but some passages meander",
          weaknesses: [
            {
              description: "Paragraph 3 restates the opening",
              evidence: "As mentioned earlier, the key insight is...",
            },
          ],
          strengths: ["Strong opening sentence"],
        },
      ],
    });

    const scores = parseScoringResponse(raw);
    assert.equal(scores.length, 1);
    assert.equal(scores[0].dimensionId, "clarity");
    assert.equal(scores[0].score, 7);
    assert.equal(scores[0].weaknesses.length, 1);
    assert.equal(scores[0].weaknesses[0].evidence, "As mentioned earlier, the key insight is...");
    assert.deepEqual(scores[0].strengths, ["Strong opening sentence"]);
  });

  it("clamps scores to 1-10 range", () => {
    const raw = JSON.stringify({
      dimensions: [
        { dimensionId: "clarity", score: 15, justification: "test", weaknesses: [] },
        { dimensionId: "structure", score: -3, justification: "test", weaknesses: [] },
      ],
    });

    const scores = parseScoringResponse(raw);
    assert.equal(scores[0].score, 10);
    assert.equal(scores[1].score, 1);
  });

  it("rejects unknown dimension IDs", () => {
    const raw = JSON.stringify({
      dimensions: [
        { dimensionId: "nonexistent", score: 5, justification: "test", weaknesses: [] },
        { dimensionId: "clarity", score: 6, justification: "test", weaknesses: [] },
      ],
    });

    const scores = parseScoringResponse(raw);
    assert.equal(scores.length, 1);
    assert.equal(scores[0].dimensionId, "clarity");
  });

  it("handles JSON wrapped in code fences", () => {
    const raw = '```json\n{"dimensions": [{"dimensionId": "clarity", "score": 5, "justification": "ok", "weaknesses": []}]}\n```';
    const scores = parseScoringResponse(raw);
    assert.equal(scores.length, 1);
  });

  it("returns empty array for non-JSON", () => {
    const scores = parseScoringResponse("This is not JSON");
    assert.equal(scores.length, 0);
  });

  it("defaults score to 6 if not a number", () => {
    const raw = JSON.stringify({
      dimensions: [
        { dimensionId: "clarity", score: "high", justification: "test", weaknesses: [] },
      ],
    });
    const scores = parseScoringResponse(raw);
    assert.equal(scores[0].score, 6);
  });
});

describe("computeOverallScore", () => {
  it("computes equal-weighted average", () => {
    const scores: DimensionScore[] = [
      { dimensionId: "clarity", score: 6, justification: "", weaknesses: [] },
      { dimensionId: "structure", score: 8, justification: "", weaknesses: [] },
    ];
    const overall = computeOverallScore(scores);
    assert.equal(overall, 7);
  });

  it("supports custom weights", () => {
    const scores: DimensionScore[] = [
      { dimensionId: "clarity", score: 10, justification: "", weaknesses: [] },
      { dimensionId: "structure", score: 0, justification: "", weaknesses: [] },
    ];
    // clarity weight 3, structure weight 1 => (10*3 + 0*1) / 4 = 7.5
    const overall = computeOverallScore(scores, { clarity: 3, structure: 1 });
    assert.equal(overall, 7.5);
  });

  it("returns 0 for empty scores", () => {
    assert.equal(computeOverallScore([]), 0);
  });
});

describe("scoreDocument", () => {
  it("runs scoring pipeline end-to-end", async () => {
    const mockResponse = JSON.stringify({
      dimensions: [
        {
          dimensionId: "clarity",
          score: 7,
          justification: "Good clarity",
          weaknesses: [{ description: "Some vagueness", evidence: "the thing is important" }],
        },
        {
          dimensionId: "structure",
          score: 6,
          justification: "Decent structure",
          weaknesses: [{ description: "Flat hierarchy", evidence: "section 1, section 2, section 3" }],
        },
      ],
    });

    const callModel = async (_prompt: string) => mockResponse;

    const result = await scoreDocument(
      "Test document content",
      "doc-123",
      1,
      callModel,
      { model: "test-model" },
    );

    assert.equal(result.documentId, "doc-123");
    assert.equal(result.revisionNumber, 1);
    assert.equal(result.dimensions.length, 2);
    assert.equal(result.overallScore, 6.5);
    assert.equal(result.model, "test-model");
    assert.ok(result.id.startsWith("score_"));
    assert.ok(result.createdAt);
  });
});
