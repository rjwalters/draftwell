import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  buildComparisonPrompt,
  parseComparisonResponse,
  compareDocuments,
  expectedScore,
  updateEloRatings,
  EloRanking,
} from "../comparison.js";

describe("buildComparisonPrompt", () => {
  it("includes both document versions", () => {
    const prompt = buildComparisonPrompt("Doc A content", "Doc B content");
    assert.ok(prompt.includes("Doc A content"));
    assert.ok(prompt.includes("Doc B content"));
  });

  it("enforces forced choice", () => {
    const prompt = buildComparisonPrompt("A", "B");
    assert.ok(prompt.includes("MUST choose a winner"));
    assert.ok(prompt.includes("no ties"));
  });

  it("includes dimension descriptions", () => {
    const prompt = buildComparisonPrompt("A", "B");
    assert.ok(prompt.includes("Clarity"));
    assert.ok(prompt.includes("Structure"));
  });
});

describe("parseComparisonResponse", () => {
  it("parses valid response", () => {
    const raw = JSON.stringify({
      dimensionWins: [
        { dimensionId: "clarity", winner: "A", reasoning: "Clearer prose" },
        { dimensionId: "structure", winner: "B", reasoning: "Better flow" },
      ],
      winner: "A",
      reasoning: "Version A has better overall clarity despite weaker structure",
    });

    const result = parseComparisonResponse(raw);
    assert.ok(result !== null);
    assert.equal(result!.winner, "A");
    assert.equal(result!.dimensionWins.length, 2);
    assert.equal(result!.dimensionWins[0].winner, "A");
  });

  it("returns null for missing winner", () => {
    const raw = JSON.stringify({ dimensionWins: [], reasoning: "no winner" });
    assert.equal(parseComparisonResponse(raw), null);
  });

  it("returns null for invalid winner value", () => {
    const raw = JSON.stringify({ winner: "tie", dimensionWins: [], reasoning: "tied" });
    assert.equal(parseComparisonResponse(raw), null);
  });

  it("returns null for non-JSON", () => {
    assert.equal(parseComparisonResponse("not json at all"), null);
  });

  it("handles code-fenced JSON", () => {
    const raw = '```json\n{"winner": "B", "dimensionWins": [], "reasoning": "B wins"}\n```';
    const result = parseComparisonResponse(raw);
    assert.ok(result !== null);
    assert.equal(result!.winner, "B");
  });
});

describe("compareDocuments", () => {
  it("runs comparison end-to-end", async () => {
    const mockResponse = JSON.stringify({
      dimensionWins: [
        { dimensionId: "clarity", winner: "B", reasoning: "Version B is clearer" },
      ],
      winner: "B",
      reasoning: "B is better overall",
    });

    const result = await compareDocuments(
      { documentId: "doc1", revisionNumber: 1, content: "Version A text" },
      { documentId: "doc1", revisionNumber: 2, content: "Version B text" },
      async () => mockResponse,
      { model: "test-model" },
    );

    assert.equal(result.winner, "B");
    assert.equal(result.versionA.revisionNumber, 1);
    assert.equal(result.versionB.revisionNumber, 2);
    assert.equal(result.model, "test-model");
  });

  it("throws on invalid model response", async () => {
    await assert.rejects(
      () => compareDocuments(
        { documentId: "d", revisionNumber: 1, content: "A" },
        { documentId: "d", revisionNumber: 2, content: "B" },
        async () => "invalid response",
      ),
      { message: /Failed to parse comparison response/ },
    );
  });
});

describe("Elo calculations", () => {
  it("expectedScore returns ~0.5 for equal ratings", () => {
    const expected = expectedScore(1500, 1500);
    assert.ok(Math.abs(expected - 0.5) < 0.001);
  });

  it("expectedScore favors higher-rated player", () => {
    const expected = expectedScore(1600, 1400);
    assert.ok(expected > 0.7);
  });

  it("updateEloRatings increases winner and decreases loser", () => {
    const { newRatingA, newRatingB } = updateEloRatings(1500, 1500, "A");
    assert.ok(newRatingA > 1500);
    assert.ok(newRatingB < 1500);
    // Zero-sum: changes should be equal and opposite
    assert.equal(newRatingA - 1500, 1500 - newRatingB);
  });

  it("upset victory produces larger rating changes", () => {
    const { newRatingA: upset } = updateEloRatings(1300, 1700, "A");
    const { newRatingA: expected } = updateEloRatings(1700, 1300, "A");
    // The underdog winning (1300 beats 1700) should gain more than favorite winning
    assert.ok((upset - 1300) > (expected - 1700));
  });
});

describe("EloRanking", () => {
  it("initializes new documents at 1500", () => {
    const ranking = new EloRanking();
    const rating = ranking.getRating("doc1", 1);
    assert.equal(rating.rating, 1500);
    assert.equal(rating.matchesPlayed, 0);
  });

  it("updates ratings after recording a result", () => {
    const ranking = new EloRanking();

    ranking.recordResult({
      versionA: { documentId: "doc1", revisionNumber: 1 },
      versionB: { documentId: "doc1", revisionNumber: 2 },
      winner: "B",
      dimensionWins: [],
      reasoning: "B is better",
      model: "test",
      createdAt: new Date().toISOString(),
    });

    const ratingA = ranking.getRating("doc1", 1);
    const ratingB = ranking.getRating("doc1", 2);

    assert.ok(ratingA.rating < 1500, "Loser should have lower rating");
    assert.ok(ratingB.rating > 1500, "Winner should have higher rating");
    assert.equal(ratingA.matchesPlayed, 1);
    assert.equal(ratingB.matchesPlayed, 1);
  });

  it("maintains leaderboard sorted by rating", () => {
    const ranking = new EloRanking();

    // Record B beating A twice
    for (let i = 0; i < 2; i++) {
      ranking.recordResult({
        versionA: { documentId: "doc1", revisionNumber: 1 },
        versionB: { documentId: "doc1", revisionNumber: 2 },
        winner: "B",
        dimensionWins: [],
        reasoning: "B better",
        model: "test",
        createdAt: new Date().toISOString(),
      });
    }

    const leaderboard = ranking.getLeaderboard();
    assert.equal(leaderboard.length, 2);
    assert.equal(leaderboard[0].revisionNumber, 2); // B should be first
    assert.ok(leaderboard[0].rating > leaderboard[1].rating);
  });

  it("supports export and import", () => {
    const ranking1 = new EloRanking();
    ranking1.recordResult({
      versionA: { documentId: "doc1", revisionNumber: 1 },
      versionB: { documentId: "doc1", revisionNumber: 2 },
      winner: "A",
      dimensionWins: [],
      reasoning: "A wins",
      model: "test",
      createdAt: new Date().toISOString(),
    });

    const exported = ranking1.exportRatings();

    const ranking2 = new EloRanking();
    ranking2.importRatings(exported);

    const rating = ranking2.getRating("doc1", 1);
    assert.ok(rating.rating > 1500);
    assert.equal(rating.matchesPlayed, 1);
  });
});
