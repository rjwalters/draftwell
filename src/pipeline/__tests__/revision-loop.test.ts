import { describe, expect, it } from "vitest";
import type { AggregatedReview, ConsensusCluster } from "../../../packages/review-panel/src/types";
import type { CheckReport } from "../../../packages/styleguide/src/types";
import {
  analyzeStoppingConditions,
  buildRevisionScore,
  classifyFeedback,
  compareScores,
  computeCompositeScore,
  computeReviewScore,
  createRevisionLoopState,
  DEFAULT_REVISION_LOOP_CONFIG,
  detectPlateau,
  detectStabilityTrap,
  evaluateRevision,
  formatEvaluationSummary,
  formatStoppingRationale,
  invertStyleguideScore,
  recordCycle,
} from "../revision-loop";
import type { RevisionEvaluation, RevisionScore, ScoreComparison } from "../types";

// -- Test helpers --

function makeCluster(overrides: Partial<ConsensusCluster> = {}): ConsensusCluster {
  return {
    id: `cluster-${Math.random().toString(36).slice(2, 6)}`,
    consensusCount: 3,
    totalPersonas: 4,
    strength: 0.75,
    items: [],
    representativeDescription: "A test finding",
    category: "clarity",
    severity: "major",
    ...overrides,
  };
}

function makeReview(clusters: ConsensusCluster[] = []): AggregatedReview {
  return {
    clusters,
    consensusItems: clusters.filter((c) => c.strength >= 0.75),
    disagreements: clusters.filter((c) => c.strength < 0.75),
    personaReviews: [],
    stats: {
      totalFindings: clusters.reduce((sum, c) => sum + c.items.length, 0),
      totalClusters: clusters.length,
      consensusCount: clusters.filter((c) => c.strength >= 0.75).length,
      disagreementCount: clusters.filter((c) => c.strength < 0.75).length,
      personaCount: 4,
    },
  };
}

function makeScore(
  cycle: number,
  composite: number,
  overrides: Partial<RevisionScore> = {},
): RevisionScore {
  return {
    cycle,
    styleguideScore: composite,
    reviewScore: composite,
    compositeScore: composite,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeCheckReport(score: number): CheckReport {
  return {
    totalIssues: 0,
    counts: { error: 0, warning: 0, info: 0, suggestion: 0 },
    score,
    results: [],
    structuralResults: [],
  };
}

// -- Tests --

describe("computeReviewScore", () => {
  it("returns 10 for a review with no findings", () => {
    const review = makeReview([]);
    expect(computeReviewScore(review)).toBe(10);
  });

  it("returns a lower score for reviews with critical findings", () => {
    const review = makeReview([
      makeCluster({ severity: "critical", strength: 1.0 }),
      makeCluster({ severity: "critical", strength: 1.0 }),
    ]);
    const score = computeReviewScore(review);
    expect(score).toBeLessThan(10);
    expect(score).toBeGreaterThan(0);
  });

  it("weights findings by consensus strength", () => {
    const strongConsensus = makeReview([makeCluster({ severity: "major", strength: 1.0 })]);
    const weakConsensus = makeReview([makeCluster({ severity: "major", strength: 0.25 })]);
    expect(computeReviewScore(weakConsensus)).toBeGreaterThan(computeReviewScore(strongConsensus));
  });

  it("weights critical findings more than suggestions", () => {
    const critical = makeReview([makeCluster({ severity: "critical", strength: 1.0 })]);
    const suggestion = makeReview([makeCluster({ severity: "suggestion", strength: 1.0 })]);
    expect(computeReviewScore(suggestion)).toBeGreaterThan(computeReviewScore(critical));
  });
});

describe("invertStyleguideScore", () => {
  it("inverts 0 (clean) to 10 (best quality)", () => {
    expect(invertStyleguideScore(0)).toBe(10);
  });

  it("inverts 10 (max slop) to 0 (worst quality)", () => {
    expect(invertStyleguideScore(10)).toBe(0);
  });

  it("inverts intermediate scores", () => {
    expect(invertStyleguideScore(3)).toBe(7);
    expect(invertStyleguideScore(7.5)).toBe(2.5);
  });
});

describe("computeCompositeScore", () => {
  it("returns weighted average (40% styleguide, 60% review)", () => {
    // 10 * 0.4 + 10 * 0.6 = 10
    expect(computeCompositeScore(10, 10)).toBe(10);
    // 0 * 0.4 + 0 * 0.6 = 0
    expect(computeCompositeScore(0, 0)).toBe(0);
    // 5 * 0.4 + 5 * 0.6 = 5
    expect(computeCompositeScore(5, 5)).toBe(5);
  });

  it("weighs review score more heavily", () => {
    // High review, low styleguide
    const reviewHigh = computeCompositeScore(2, 8);
    // High styleguide, low review
    const styleguideHigh = computeCompositeScore(8, 2);

    expect(reviewHigh).toBeGreaterThan(styleguideHigh);
  });
});

describe("buildRevisionScore", () => {
  it("builds a score from raw evaluation results", () => {
    const report = makeCheckReport(2); // slop score 2 -> quality 8
    const review = makeReview([]); // no findings -> review score 10

    const score = buildRevisionScore(1, report, review);

    expect(score.cycle).toBe(1);
    expect(score.styleguideScore).toBe(8); // 10 - 2
    expect(score.reviewScore).toBe(10); // no findings
    expect(score.compositeScore).toBe(9.2); // 8*0.4 + 10*0.6
    expect(score.timestamp).toBeTruthy();
  });
});

describe("compareScores", () => {
  it("detects improvement", () => {
    const before = makeScore(1, 5);
    const after = makeScore(2, 7);
    const comparison = compareScores(before, after);

    expect(comparison.delta).toBe(2);
    expect(comparison.improved).toBe(true);
  });

  it("detects regression", () => {
    const before = makeScore(1, 7);
    const after = makeScore(2, 5);
    const comparison = compareScores(before, after);

    expect(comparison.delta).toBe(-2);
    expect(comparison.improved).toBe(false);
  });

  it("reports per-component deltas", () => {
    const before = makeScore(1, 5, { styleguideScore: 6, reviewScore: 4 });
    const after = makeScore(2, 6, { styleguideScore: 5, reviewScore: 7 });
    const comparison = compareScores(before, after);

    expect(comparison.componentDeltas.styleguideScore).toBe(-1);
    expect(comparison.componentDeltas.reviewScore).toBe(3);
  });
});

describe("evaluateRevision", () => {
  it("accepts clear improvements", () => {
    const comparison: ScoreComparison = {
      before: makeScore(1, 5),
      after: makeScore(2, 7),
      delta: 2,
      improved: true,
      componentDeltas: { styleguideScore: 1, reviewScore: 1 },
    };
    const evaluation = evaluateRevision(comparison);
    expect(evaluation.verdict).toBe("accept");
    expect(evaluation.reason).toContain("improved");
  });

  it("rejects significant regressions", () => {
    const comparison: ScoreComparison = {
      before: makeScore(1, 7),
      after: makeScore(2, 5),
      delta: -2,
      improved: false,
      componentDeltas: { styleguideScore: -1, reviewScore: -1 },
    };
    const evaluation = evaluateRevision(comparison);
    expect(evaluation.verdict).toBe("reject");
    expect(evaluation.reason).toContain("regressed");
  });

  it("flags mixed results where one score improves and another regresses", () => {
    const comparison: ScoreComparison = {
      before: makeScore(1, 5),
      after: makeScore(2, 5),
      delta: -0.2,
      improved: false,
      componentDeltas: { styleguideScore: 1, reviewScore: -1 },
    };
    const evaluation = evaluateRevision(comparison);
    expect(evaluation.verdict).toBe("flag-for-review");
    expect(evaluation.reason).toContain("Mixed result");
  });

  it("flags negligible changes as potential plateau", () => {
    const comparison: ScoreComparison = {
      before: makeScore(1, 5),
      after: makeScore(2, 5),
      delta: 0,
      improved: false,
      componentDeltas: { styleguideScore: 0, reviewScore: 0 },
    };
    const evaluation = evaluateRevision(comparison);
    expect(evaluation.verdict).toBe("flag-for-review");
    expect(evaluation.reason).toContain("negligible");
  });

  it("flags minor regressions for review rather than outright reject", () => {
    const comparison: ScoreComparison = {
      before: makeScore(1, 5),
      after: makeScore(2, 4.7),
      delta: -0.3,
      improved: false,
      componentDeltas: { styleguideScore: -0.3, reviewScore: 0 },
    };
    const evaluation = evaluateRevision(comparison);
    expect(evaluation.verdict).toBe("flag-for-review");
    expect(evaluation.reason).toContain("Minor regression");
  });
});

describe("detectPlateau", () => {
  it("does not detect plateau with fewer than minCycles", () => {
    const scores = [makeScore(1, 5), makeScore(2, 5.1)];
    const result = detectPlateau(scores);
    expect(result.detected).toBe(false);
  });

  it("detects plateau when deltas are below threshold", () => {
    const scores = [makeScore(1, 5), makeScore(2, 6), makeScore(3, 6.1), makeScore(4, 6.2)];
    const result = detectPlateau(scores);
    expect(result.detected).toBe(true);
    expect(result.consecutiveCount).toBe(2);
  });

  it("does not detect plateau when scores are still changing", () => {
    const scores = [makeScore(1, 5), makeScore(2, 6), makeScore(3, 7), makeScore(4, 8)];
    const result = detectPlateau(scores);
    expect(result.detected).toBe(false);
  });

  it("respects custom config thresholds", () => {
    const scores = [makeScore(1, 5), makeScore(2, 5.4), makeScore(3, 5.8), makeScore(4, 6.1)];
    // Default threshold 0.3 -> last two deltas are 0.4 and 0.3, second is at threshold
    // With higher threshold, they'd be plateaus
    const result = detectPlateau(scores, {
      ...DEFAULT_REVISION_LOOP_CONFIG,
      scoreThreshold: 0.5,
    });
    expect(result.detected).toBe(true);
  });
});

describe("classifyFeedback", () => {
  it("classifies suggestions as qualified", () => {
    const review = makeReview([
      makeCluster({ severity: "suggestion", representativeDescription: "Consider restructuring" }),
    ]);
    const result = classifyFeedback(review);
    expect(result.qualified).toBe(1);
    expect(result.unqualified).toBe(0);
  });

  it("classifies hedged language as qualified", () => {
    const review = makeReview([
      makeCluster({
        severity: "minor",
        representativeDescription: "The author might consider rephrasing this section",
      }),
    ]);
    const result = classifyFeedback(review);
    expect(result.qualified).toBe(1);
  });

  it("classifies firm feedback as unqualified", () => {
    const review = makeReview([
      makeCluster({
        severity: "critical",
        representativeDescription: "This paragraph contains factual errors",
      }),
    ]);
    const result = classifyFeedback(review);
    expect(result.unqualified).toBe(1);
    expect(result.qualified).toBe(0);
  });

  it("computes ratio correctly", () => {
    const review = makeReview([
      makeCluster({ severity: "suggestion", representativeDescription: "Could perhaps rephrase" }),
      makeCluster({ severity: "suggestion", representativeDescription: "Might consider" }),
      makeCluster({ severity: "critical", representativeDescription: "Factual error in claims" }),
    ]);
    const result = classifyFeedback(review);
    expect(result.ratio).toBeCloseTo(2 / 3, 2);
  });

  it("returns 0 ratio for empty reviews", () => {
    const review = makeReview([]);
    const result = classifyFeedback(review);
    expect(result.ratio).toBe(0);
    expect(result.total).toBe(0);
  });

  it("detects costs-of-approach language", () => {
    const review = makeReview([
      makeCluster({
        severity: "minor",
        representativeDescription: "This is one of the costs of the chosen approach",
      }),
    ]);
    const result = classifyFeedback(review);
    expect(result.qualified).toBe(1);
  });
});

describe("detectStabilityTrap", () => {
  it("returns false with fewer than 3 cycles", () => {
    const scores = [makeScore(1, 5), makeScore(2, 5.1)];
    expect(detectStabilityTrap(scores, [])).toBe(false);
  });

  it("detects trap when scores oscillate in narrow band with minimal improvement", () => {
    const scores = [makeScore(1, 5.0), makeScore(2, 5.1), makeScore(3, 5.15)];
    const evaluations: RevisionEvaluation[] = [
      {
        comparison: {
          before: scores[0],
          after: scores[1],
          delta: 0.1,
          improved: true,
          componentDeltas: { styleguideScore: 0.1, reviewScore: 0.1 },
        },
        verdict: "accept",
        reason: "Improved",
      },
      {
        comparison: {
          before: scores[1],
          after: scores[2],
          delta: 0.05,
          improved: true,
          componentDeltas: { styleguideScore: 0.05, reviewScore: 0.05 },
        },
        verdict: "accept",
        reason: "Improved",
      },
    ];
    expect(detectStabilityTrap(scores, evaluations)).toBe(true);
  });

  it("does not trigger when scores vary significantly", () => {
    const scores = [makeScore(1, 5.0), makeScore(2, 6.0), makeScore(3, 7.0)];
    const evaluations: RevisionEvaluation[] = [
      {
        comparison: {
          before: scores[0],
          after: scores[1],
          delta: 1.0,
          improved: true,
          componentDeltas: { styleguideScore: 0.5, reviewScore: 0.5 },
        },
        verdict: "accept",
        reason: "Improved",
      },
      {
        comparison: {
          before: scores[1],
          after: scores[2],
          delta: 1.0,
          improved: true,
          componentDeltas: { styleguideScore: 0.5, reviewScore: 0.5 },
        },
        verdict: "accept",
        reason: "Improved",
      },
    ];
    expect(detectStabilityTrap(scores, evaluations)).toBe(false);
  });
});

describe("analyzeStoppingConditions", () => {
  it("stops at max cycles", () => {
    const state = createRevisionLoopState("doc-1", { maxCycles: 3 });
    state.currentCycle = 3;
    state.scores = [makeScore(1, 5), makeScore(2, 6), makeScore(3, 7)];

    const analysis = analyzeStoppingConditions(state);
    expect(analysis.shouldStop).toBe(true);
    expect(analysis.reasons.some((r) => r.type === "max-cycles")).toBe(true);
  });

  it("stops on plateau", () => {
    const state = createRevisionLoopState("doc-1");
    state.currentCycle = 4;
    state.scores = [makeScore(1, 5), makeScore(2, 6), makeScore(3, 6.1), makeScore(4, 6.15)];

    const analysis = analyzeStoppingConditions(state);
    expect(analysis.shouldStop).toBe(true);
    expect(analysis.reasons.some((r) => r.type === "plateau")).toBe(true);
  });

  it("stops when no major issues remain", () => {
    const state = createRevisionLoopState("doc-1");
    state.currentCycle = 3;
    state.scores = [makeScore(1, 5), makeScore(2, 6), makeScore(3, 7)];

    const review = makeReview([
      makeCluster({ severity: "minor", strength: 0.5 }),
      makeCluster({ severity: "suggestion", strength: 0.25 }),
    ]);

    const analysis = analyzeStoppingConditions(state, review);
    expect(analysis.reasons.some((r) => r.type === "no-major-issues")).toBe(true);
  });

  it("stops when feedback is mostly qualified", () => {
    const state = createRevisionLoopState("doc-1");
    state.currentCycle = 3;
    state.scores = [makeScore(1, 5), makeScore(2, 6), makeScore(3, 7)];

    const review = makeReview([
      makeCluster({ severity: "suggestion", representativeDescription: "Could perhaps rephrase" }),
      makeCluster({
        severity: "minor",
        representativeDescription: "Might consider alternate wording",
      }),
      makeCluster({ severity: "suggestion", representativeDescription: "Stylistic preference" }),
    ]);

    const analysis = analyzeStoppingConditions(state, review);
    expect(analysis.reasons.some((r) => r.type === "qualified-feedback")).toBe(true);
  });

  it("does not stop when scores are still improving", () => {
    const state = createRevisionLoopState("doc-1");
    state.currentCycle = 2;
    state.scores = [makeScore(1, 3), makeScore(2, 6)];

    const review = makeReview([
      makeCluster({
        severity: "critical",
        strength: 1.0,
        representativeDescription: "Major logical flaw",
      }),
    ]);

    const analysis = analyzeStoppingConditions(state, review);
    expect(analysis.shouldStop).toBe(false);
  });

  it("reports correct metrics", () => {
    const state = createRevisionLoopState("doc-1");
    state.currentCycle = 3;
    state.scores = [makeScore(1, 4), makeScore(2, 6), makeScore(3, 7.5)];

    const analysis = analyzeStoppingConditions(state);
    expect(analysis.metrics.totalCycles).toBe(3);
    expect(analysis.metrics.currentScore).toBe(7.5);
    expect(analysis.metrics.scoreTrajectory).toEqual([4, 6, 7.5]);
  });
});

describe("createRevisionLoopState", () => {
  it("creates state with default config", () => {
    const state = createRevisionLoopState("doc-1");
    expect(state.documentId).toBe("doc-1");
    expect(state.scores).toEqual([]);
    expect(state.evaluations).toEqual([]);
    expect(state.currentCycle).toBe(0);
    expect(state.status).toBe("running");
    expect(state.config).toEqual(DEFAULT_REVISION_LOOP_CONFIG);
  });

  it("merges custom config with defaults", () => {
    const state = createRevisionLoopState("doc-1", { maxCycles: 5 });
    expect(state.config.maxCycles).toBe(5);
    expect(state.config.scoreThreshold).toBe(0.3); // default preserved
  });
});

describe("recordCycle", () => {
  it("records the first cycle without evaluation", () => {
    const state = createRevisionLoopState("doc-1");
    const score = makeScore(1, 5);

    const result = recordCycle(state, score);
    expect(result.evaluation).toBeNull();
    expect(result.state.scores).toHaveLength(1);
    expect(result.state.currentCycle).toBe(1);
  });

  it("records subsequent cycles with evaluation", () => {
    let state = createRevisionLoopState("doc-1");
    state = recordCycle(state, makeScore(1, 5)).state;

    const result = recordCycle(state, makeScore(2, 7));
    expect(result.evaluation).not.toBeNull();
    expect(result.evaluation!.verdict).toBe("accept");
    expect(result.state.scores).toHaveLength(2);
    expect(result.state.evaluations).toHaveLength(1);
  });

  it("sets status to stopped when stopping conditions are met", () => {
    const state = createRevisionLoopState("doc-1", { maxCycles: 2 });
    const s1 = recordCycle(state, makeScore(1, 5)).state;
    const result = recordCycle(s1, makeScore(2, 7));

    expect(result.state.status).toBe("stopped");
    expect(result.state.stoppingAnalysis?.shouldStop).toBe(true);
  });
});

describe("formatStoppingRationale", () => {
  it("formats continuing state", () => {
    const analysis = {
      shouldStop: false,
      reasons: [],
      metrics: {
        totalCycles: 2,
        currentScore: 6,
        scoreTrajectory: [4, 6],
        consecutivePlateaus: 0,
        qualifiedFeedbackRatio: 0,
      },
    };
    const output = formatStoppingRationale(analysis);
    expect(output).toContain("still producing improvements");
    expect(output).toContain("6.0/10");
  });

  it("formats stopped state with plateau", () => {
    const analysis = {
      shouldStop: true,
      reasons: [{ type: "plateau" as const, detail: "Score delta < 0.3 for 2 consecutive cycles" }],
      metrics: {
        totalCycles: 5,
        currentScore: 7.5,
        scoreTrajectory: [4, 6, 7, 7.2, 7.3],
        consecutivePlateaus: 2,
        qualifiedFeedbackRatio: 0.6,
      },
    };
    const output = formatStoppingRationale(analysis);
    expect(output).toContain("stabilized after 5 cycles");
    expect(output).toContain("7.5/10");
    expect(output).toContain("Score delta < 0.3");
    expect(output).toContain("Diminishing returns warning");
  });

  it("includes stability trap warning when detected", () => {
    const analysis = {
      shouldStop: true,
      reasons: [{ type: "stability-trap" as const, detail: "Safe/conservative changes only" }],
      metrics: {
        totalCycles: 3,
        currentScore: 5.1,
        scoreTrajectory: [5, 5.05, 5.1],
        consecutivePlateaus: 2,
        qualifiedFeedbackRatio: 0,
      },
    };
    const output = formatStoppingRationale(analysis);
    expect(output).toContain("Stability trap detected");
    expect(output).toContain("structural rethink");
  });
});

describe("formatEvaluationSummary", () => {
  it("formats accepted evaluation", () => {
    const evaluation: RevisionEvaluation = {
      comparison: {
        before: makeScore(1, 5),
        after: makeScore(2, 7),
        delta: 2,
        improved: true,
        componentDeltas: { styleguideScore: 1, reviewScore: 1 },
      },
      verdict: "accept",
      reason: "Improved",
    };
    const output = formatEvaluationSummary(evaluation);
    expect(output).toContain("[+]");
    expect(output).toContain("5.0 → 7.0");
    expect(output).toContain("+2.0");
    expect(output).toContain("accept");
  });

  it("formats rejected evaluation", () => {
    const evaluation: RevisionEvaluation = {
      comparison: {
        before: makeScore(1, 7),
        after: makeScore(2, 5),
        delta: -2,
        improved: false,
        componentDeltas: { styleguideScore: -1, reviewScore: -1 },
      },
      verdict: "reject",
      reason: "Regressed",
    };
    const output = formatEvaluationSummary(evaluation);
    expect(output).toContain("[-]");
    expect(output).toContain("-2.0");
    expect(output).toContain("reject");
  });

  it("formats flagged evaluation", () => {
    const evaluation: RevisionEvaluation = {
      comparison: {
        before: makeScore(1, 5),
        after: makeScore(2, 5),
        delta: 0,
        improved: false,
        componentDeltas: { styleguideScore: 0, reviewScore: 0 },
      },
      verdict: "flag-for-review",
      reason: "Negligible",
    };
    const output = formatEvaluationSummary(evaluation);
    expect(output).toContain("[?]");
    expect(output).toContain("flag-for-review");
  });
});

describe("integration: full revision loop lifecycle", () => {
  it("runs a loop that improves then plateaus", () => {
    let state = createRevisionLoopState("doc-1");

    // Cycle 1: baseline
    const r1 = recordCycle(state, makeScore(1, 4));
    state = r1.state;
    expect(r1.evaluation).toBeNull();
    expect(state.status).toBe("running");

    // Cycle 2: big improvement
    const r2 = recordCycle(state, makeScore(2, 6.5));
    state = r2.state;
    expect(r2.evaluation!.verdict).toBe("accept");
    expect(state.status).toBe("running");

    // Cycle 3: smaller improvement
    const r3 = recordCycle(state, makeScore(3, 7));
    state = r3.state;
    expect(r3.evaluation!.verdict).toBe("accept");
    expect(state.status).toBe("running");

    // Cycle 4: plateau begins
    const r4 = recordCycle(state, makeScore(4, 7.1));
    state = r4.state;
    expect(r4.evaluation!.verdict).toBe("accept");
    // Plateau detected: cycles 3->4 and 4 scores within 0.3 of each other
    // But need 2 consecutive, check if plateau triggers
    // Delta 3->4 = 0.1 (< 0.3), delta 2->3 = 0.5 (>= 0.3) — only 1 consecutive
    expect(state.status).toBe("running");

    // Cycle 5: plateau continues
    const r5 = recordCycle(state, makeScore(5, 7.15));
    state = r5.state;
    // Delta 4->5 = 0.05, delta 3->4 = 0.1 — both < 0.3, so 2 consecutive
    expect(state.status).toBe("stopped");
    expect(state.stoppingAnalysis!.shouldStop).toBe(true);
    expect(state.stoppingAnalysis!.reasons.some((r) => r.type === "plateau")).toBe(true);
  });

  it("rejects a regression and flags for review", () => {
    let state = createRevisionLoopState("doc-1");
    state = recordCycle(state, makeScore(1, 7)).state;

    const result = recordCycle(state, makeScore(2, 4));
    expect(result.evaluation!.verdict).toBe("reject");
    expect(result.evaluation!.reason).toContain("regressed");
  });
});
