import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  textSimilarity,
  itemsRelated,
  clusterItems,
  aggregateReviews,
} from "../aggregator.js";
import type { ReviewItem, PersonaReview } from "../types.js";

describe("textSimilarity", () => {
  it("returns 1 for identical strings", () => {
    const sim = textSimilarity("the quick brown fox", "the quick brown fox");
    assert.equal(sim, 1);
  });

  it("returns 0 for completely different strings", () => {
    const sim = textSimilarity("alpha beta gamma", "one two three four");
    assert.equal(sim, 0);
  });

  it("returns partial similarity for overlapping strings", () => {
    const sim = textSimilarity(
      "the document structure is unclear",
      "the structure of this document needs work",
    );
    assert.ok(sim > 0.2, `Expected > 0.2, got ${sim}`);
    assert.ok(sim < 1, `Expected < 1, got ${sim}`);
  });

  it("ignores short words (length <= 2)", () => {
    const sim = textSimilarity("a b c", "a b c");
    assert.equal(sim, 0);
  });
});

describe("itemsRelated", () => {
  const makeItem = (
    personaId: string,
    description: string,
    category = "clarity" as const,
  ): ReviewItem => ({
    personaId,
    category,
    severity: "major",
    description,
  });

  it("returns false for items from the same persona", () => {
    const a = makeItem("editor", "structure is unclear");
    const b = makeItem("editor", "structure is unclear and confusing");
    assert.equal(itemsRelated(a, b), false);
  });

  it("returns true for similar items from different personas", () => {
    const a = makeItem("editor", "the introduction section lacks a clear thesis statement");
    const b = makeItem("reader", "the introduction section is missing a thesis statement");
    assert.equal(itemsRelated(a, b), true);
  });

  it("returns false for unrelated items from different personas", () => {
    const a = makeItem("editor", "paragraph three has redundant content");
    const b = makeItem("style", "the tone shifts abruptly in the conclusion");
    assert.equal(itemsRelated(a, b), false);
  });
});

describe("clusterItems", () => {
  it("clusters related items from different personas", () => {
    const items: ReviewItem[] = [
      {
        personaId: "editor",
        category: "structure",
        severity: "major",
        description: "the introduction lacks a clear thesis statement",
      },
      {
        personaId: "reader",
        category: "clarity",
        severity: "major",
        description: "the introduction is missing a clear thesis statement",
      },
      {
        personaId: "style",
        category: "tone",
        severity: "minor",
        description: "inconsistent use of passive voice throughout",
      },
    ];

    const clusters = clusterItems(items, 4);

    // The thesis items should cluster together, passive voice should be separate
    assert.ok(clusters.length >= 2, `Expected >= 2 clusters, got ${clusters.length}`);

    // Find the thesis cluster
    const thesisCluster = clusters.find((c) =>
      c.representativeDescription.includes("thesis"),
    );
    assert.ok(thesisCluster !== undefined, "Expected a thesis cluster");
    assert.equal(thesisCluster!.consensusCount, 2);
    assert.equal(thesisCluster!.strength, 0.5);
  });

  it("keeps unrelated items in separate clusters", () => {
    const items: ReviewItem[] = [
      {
        personaId: "editor",
        category: "structure",
        severity: "major",
        description: "sections are in the wrong order",
      },
      {
        personaId: "style",
        category: "tone",
        severity: "minor",
        description: "uses too many exclamation marks",
      },
    ];

    const clusters = clusterItems(items, 4);
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0].consensusCount, 1);
    assert.equal(clusters[1].consensusCount, 1);
  });
});

describe("aggregateReviews", () => {
  it("separates consensus from disagreements", () => {
    const reviews: PersonaReview[] = [
      {
        personaId: "editor",
        personaName: "Critical Editor",
        summary: "Needs structural work",
        items: [
          {
            personaId: "editor",
            category: "structure",
            severity: "major",
            description: "the document introduction lacks focus and direction",
          },
        ],
      },
      {
        personaId: "reader",
        personaName: "General Reader",
        summary: "Hard to follow",
        items: [
          {
            personaId: "reader",
            category: "clarity",
            severity: "major",
            description: "the document introduction lacks focus and clear direction",
          },
        ],
      },
      {
        personaId: "expert",
        personaName: "Domain Expert",
        summary: "Missing key context",
        items: [
          {
            personaId: "expert",
            category: "clarity",
            severity: "major",
            description: "the document introduction lacks focus and clear direction for the reader",
          },
        ],
      },
      {
        personaId: "style",
        personaName: "Style Reviewer",
        summary: "Voice is inconsistent",
        items: [
          {
            personaId: "style",
            category: "tone",
            severity: "minor",
            description: "excessive use of passive voice in several paragraphs",
          },
        ],
      },
    ];

    // With threshold 0.75 (default), 3/4 = 0.75 is consensus, 1/4 is not
    const result = aggregateReviews(reviews, 0.75);

    assert.equal(result.stats.personaCount, 4);
    assert.equal(result.stats.totalFindings, 4);

    // The 3 "introduction" items should cluster; passive voice is separate
    assert.ok(result.consensusItems.length >= 1, "Expected at least 1 consensus item");
    assert.ok(result.disagreements.length >= 1, "Expected at least 1 disagreement");

    // Consensus items should be sorted first (higher strength)
    assert.ok(
      result.clusters[0].strength >= result.clusters[result.clusters.length - 1].strength,
      "Clusters should be sorted by strength descending",
    );
  });

  it("returns correct stats", () => {
    const reviews: PersonaReview[] = [
      {
        personaId: "a",
        personaName: "A",
        summary: "ok",
        items: [
          { personaId: "a", category: "other", severity: "minor", description: "issue alpha" },
          { personaId: "a", category: "other", severity: "minor", description: "issue beta" },
        ],
      },
      {
        personaId: "b",
        personaName: "B",
        summary: "ok",
        items: [
          { personaId: "b", category: "other", severity: "minor", description: "issue gamma" },
        ],
      },
    ];

    const result = aggregateReviews(reviews);
    assert.equal(result.stats.totalFindings, 3);
    assert.equal(result.stats.personaCount, 2);
  });
});
