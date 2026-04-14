import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ScoreLog } from "../score-log.js";
import type { DocumentScore } from "../types.js";

function makeScore(
  documentId: string,
  revisionNumber: number,
  scores: Record<string, number>,
): DocumentScore {
  const dimensions = Object.entries(scores).map(([id, score]) => ({
    dimensionId: id,
    score,
    justification: "test",
    weaknesses: [],
  }));

  const overallScore =
    dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;

  return {
    id: `score_${revisionNumber}`,
    documentId,
    revisionNumber,
    dimensions,
    overallScore: Math.round(overallScore * 10) / 10,
    model: "test-model",
    createdAt: new Date().toISOString(),
  };
}

describe("ScoreLog", () => {
  it("records and retrieves scores", () => {
    const log = new ScoreLog();
    const score = makeScore("doc1", 1, { clarity: 6, structure: 7 });
    log.record(score);

    const trajectory = log.getTrajectory("doc1");
    assert.equal(trajectory.length, 1);
    assert.equal(trajectory[0].documentId, "doc1");
    assert.equal(trajectory[0].revisionNumber, 1);
    assert.equal(trajectory[0].overallScore, 6.5);
    assert.equal(trajectory[0].dimensionScores["clarity"], 6);
  });

  it("returns trajectory sorted by revision number", () => {
    const log = new ScoreLog();
    // Record out of order
    log.record(makeScore("doc1", 3, { clarity: 8 }));
    log.record(makeScore("doc1", 1, { clarity: 5 }));
    log.record(makeScore("doc1", 2, { clarity: 7 }));

    const trajectory = log.getTrajectory("doc1");
    assert.equal(trajectory.length, 3);
    assert.equal(trajectory[0].revisionNumber, 1);
    assert.equal(trajectory[1].revisionNumber, 2);
    assert.equal(trajectory[2].revisionNumber, 3);
  });

  it("filters trajectory by document ID", () => {
    const log = new ScoreLog();
    log.record(makeScore("doc1", 1, { clarity: 6 }));
    log.record(makeScore("doc2", 1, { clarity: 7 }));
    log.record(makeScore("doc1", 2, { clarity: 8 }));

    assert.equal(log.getTrajectory("doc1").length, 2);
    assert.equal(log.getTrajectory("doc2").length, 1);
    assert.equal(log.getTrajectory("doc3").length, 0);
  });

  it("computes improvement deltas", () => {
    const log = new ScoreLog();
    log.record(makeScore("doc1", 1, { clarity: 5, structure: 6 }));
    log.record(makeScore("doc1", 2, { clarity: 7, structure: 6 }));
    log.record(makeScore("doc1", 3, { clarity: 8, structure: 5 }));

    const deltas = log.getImprovementDeltas("doc1");
    assert.equal(deltas.length, 2);

    // Rev 1 -> 2: clarity +2, structure 0
    assert.equal(deltas[0].fromRevision, 1);
    assert.equal(deltas[0].toRevision, 2);
    assert.equal(deltas[0].dimensionDeltas["clarity"], 2);
    assert.equal(deltas[0].dimensionDeltas["structure"], 0);
    assert.ok(deltas[0].overallDelta > 0);

    // Rev 2 -> 3: clarity +1, structure -1
    assert.equal(deltas[1].dimensionDeltas["clarity"], 1);
    assert.equal(deltas[1].dimensionDeltas["structure"], -1);
  });

  it("returns empty deltas for single revision", () => {
    const log = new ScoreLog();
    log.record(makeScore("doc1", 1, { clarity: 6 }));
    assert.equal(log.getImprovementDeltas("doc1").length, 0);
  });

  it("supports export and import", () => {
    const log1 = new ScoreLog();
    log1.record(makeScore("doc1", 1, { clarity: 6 }));
    log1.record(makeScore("doc1", 2, { clarity: 8 }));

    const exported = log1.exportEntries();

    const log2 = new ScoreLog();
    log2.importEntries(exported);

    assert.equal(log2.getTrajectory("doc1").length, 2);
  });
});
