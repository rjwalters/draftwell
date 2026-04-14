import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildPrompt, parseReviewResponse, runPersonaReview, runAllPersonas } from "../runner.js";
import { criticalEditor, DEFAULT_PERSONAS, styleReviewer } from "../personas.js";
import type { Persona } from "../types.js";

describe("buildPrompt", () => {
  it("fills in all template placeholders", () => {
    const prompt = buildPrompt(criticalEditor, "Hello world document");

    assert.ok(prompt.includes(criticalEditor.perspective), "Should include perspective");
    assert.ok(prompt.includes("Hello world document"), "Should include document");
    for (const dim of criticalEditor.dimensions) {
      assert.ok(prompt.includes(dim), `Should include dimension: ${dim}`);
    }
    assert.ok(!prompt.includes("{{perspective}}"), "No unfilled perspective placeholder");
    assert.ok(!prompt.includes("{{dimensions}}"), "No unfilled dimensions placeholder");
    assert.ok(!prompt.includes("{{document}}"), "No unfilled document placeholder");
  });
});

describe("parseReviewResponse", () => {
  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      summary: "Good document overall",
      items: [
        {
          category: "structure",
          severity: "major",
          location: "Introduction",
          description: "Lacks thesis",
          suggestion: "Add a thesis statement",
        },
      ],
    });

    const result = parseReviewResponse("editor", raw);
    assert.equal(result.summary, "Good document overall");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].personaId, "editor");
    assert.equal(result.items[0].category, "structure");
    assert.equal(result.items[0].severity, "major");
    assert.equal(result.items[0].description, "Lacks thesis");
  });

  it("handles JSON wrapped in code fences", () => {
    const raw = '```json\n{"summary": "OK", "items": [{"category": "clarity", "severity": "minor", "description": "test"}]}\n```';

    const result = parseReviewResponse("reader", raw);
    assert.equal(result.summary, "OK");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].category, "clarity");
  });

  it("falls back gracefully for non-JSON response", () => {
    const raw = "This document has several issues with clarity and flow.";

    const result = parseReviewResponse("reader", raw);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].category, "other");
    assert.equal(result.items[0].description, raw);
  });

  it("validates category and severity values", () => {
    const raw = JSON.stringify({
      summary: "Test",
      items: [
        { category: "INVALID", severity: "NOPE", description: "test item" },
      ],
    });

    const result = parseReviewResponse("editor", raw);
    assert.equal(result.items[0].category, "other");
    assert.equal(result.items[0].severity, "suggestion");
  });

  it("skips items without descriptions", () => {
    const raw = JSON.stringify({
      summary: "Test",
      items: [
        { category: "clarity", severity: "major", description: "" },
        { category: "clarity", severity: "major", description: "valid item" },
        { category: "clarity", severity: "major" },
      ],
    });

    const result = parseReviewResponse("editor", raw);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].description, "valid item");
  });
});

describe("runPersonaReview", () => {
  it("calls model with built prompt and returns structured review", async () => {
    const mockResponse = JSON.stringify({
      summary: "The document is well-written",
      items: [
        {
          category: "structure",
          severity: "minor",
          description: "Consider reordering sections",
        },
      ],
    });

    const callModel = async (_prompt: string) => mockResponse;

    const review = await runPersonaReview(criticalEditor, "Test doc", callModel);
    assert.equal(review.personaId, "critical-editor");
    assert.equal(review.personaName, "Critical Editor");
    assert.equal(review.items.length, 1);
    assert.equal(review.summary, "The document is well-written");
  });
});

describe("runAllPersonas", () => {
  it("runs all personas in parallel", async () => {
    const calls: string[] = [];
    const callModel = async (prompt: string) => {
      // Track which persona was called by checking the prompt
      calls.push(prompt.slice(0, 50));
      return JSON.stringify({
        summary: "Review complete",
        items: [
          { category: "other", severity: "suggestion", description: "test finding" },
        ],
      });
    };

    const reviews = await runAllPersonas(DEFAULT_PERSONAS, "Test doc", callModel);
    assert.equal(reviews.length, 4);
    assert.equal(calls.length, 4);

    // Each persona should have produced a review
    const ids = reviews.map((r) => r.personaId);
    assert.ok(ids.includes("critical-editor"));
    assert.ok(ids.includes("domain-expert"));
    assert.ok(ids.includes("general-reader"));
    assert.ok(ids.includes("style-reviewer"));
  });
});

describe("buildPrompt with voice profile", () => {
  it("injects voice profile section for style-reviewer persona", () => {
    const voiceProfile = {
      dimensions: [
        { name: "Sentence length", observation: "Short sentences", rule: "Keep sentences under 20 words" },
        { name: "Tone", observation: "Conversational", rule: "Use second person and contractions" },
      ],
      summary: "Concise, conversational writer",
      escape_clause: "Technical sections may use longer sentences",
    };

    const prompt = buildPrompt(styleReviewer, "Test document", voiceProfile);

    assert.ok(prompt.includes("voice profile"), "Should include voice profile section");
    assert.ok(prompt.includes("Sentence length"), "Should include dimension name");
    assert.ok(prompt.includes("Keep sentences under 20 words"), "Should include rule");
    assert.ok(prompt.includes("Concise, conversational writer"), "Should include summary");
    assert.ok(prompt.includes("Technical sections may use longer sentences"), "Should include escape clause");
    assert.ok(!prompt.includes("{{voiceProfile}}"), "No unfilled voiceProfile placeholder");
  });

  it("does not inject voice profile for non-style-reviewer personas", () => {
    const voiceProfile = {
      dimensions: [
        { name: "Tone", observation: "Formal", rule: "Use formal register" },
      ],
      summary: "Formal writer",
      escape_clause: "None",
    };

    const prompt = buildPrompt(criticalEditor, "Test document", voiceProfile);

    assert.ok(!prompt.includes("voice profile"), "Should not include voice profile for critical editor");
  });

  it("handles missing voice profile gracefully", () => {
    const prompt = buildPrompt(styleReviewer, "Test document");

    assert.ok(!prompt.includes("{{voiceProfile}}"), "No unfilled voiceProfile placeholder");
    assert.ok(prompt.includes("Test document"), "Should include document");
  });
});

describe("user-configurable personas", () => {
  it("accepts custom personas", async () => {
    const custom: Persona = {
      id: "security-reviewer",
      name: "Security Reviewer",
      perspective: "You review for security concerns.",
      dimensions: ["Data exposure", "Input validation"],
      promptTemplate: "{{perspective}}\n{{dimensions}}\n\nReview:\n{{document}}",
    };

    const callModel = async (_prompt: string) =>
      JSON.stringify({
        summary: "No security issues found",
        items: [],
      });

    const review = await runPersonaReview(custom, "Test doc", callModel);
    assert.equal(review.personaId, "security-reviewer");
    assert.equal(review.personaName, "Security Reviewer");
  });
});
