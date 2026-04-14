/**
 * Score-gated revision loop with plateau detection.
 *
 * Implements autonovel's approach to iterative document refinement:
 * - Each revision is scored before/after; improvements are kept, regressions flagged.
 * - Plateau detection stops the loop when scores stabilize.
 * - Sophisticated stopping heuristics prevent over-revision (which degrades
 *   quality after ~4 cycles: "fixing one score often drops another").
 *
 * Stopping conditions (from autonovel):
 * 1. Score delta < threshold across 2 consecutive cycles (min 3 cycles)
 * 2. No major unqualified issues remain in feedback
 * 3. >50% of remaining feedback items are qualified/hedged
 * 4. Feedback language shifts from problems to "costs of the chosen approach"
 *
 * Additionally detects the "stability trap": when revisions make only
 * safe/conservative changes that don't genuinely improve the document.
 */

import type { AggregatedReview } from "../../packages/review-panel/src/types";
import type { CheckReport } from "../../packages/styleguide/src/types";
import type {
  RevisionEvaluation,
  RevisionLoopConfig,
  RevisionLoopState,
  RevisionScore,
  ScoreComparison,
  StoppingAnalysis,
  StoppingReason,
} from "./types";

/** Default configuration matching autonovel's heuristics. */
export const DEFAULT_REVISION_LOOP_CONFIG: RevisionLoopConfig = {
  scoreThreshold: 0.3,
  maxCycles: 8,
  minCycles: 3,
  consecutivePlateauCycles: 2,
  qualifiedFeedbackThreshold: 0.5,
};

/**
 * Derive a 0-10 quality score from an aggregated review.
 *
 * Higher = better quality. Based on severity-weighted findings:
 * - critical findings: 2.0 points each
 * - major findings: 1.0 points each
 * - minor findings: 0.3 points each
 * - suggestions: 0.1 points each
 *
 * Score = 10 * e^(-weighted / 8), so a document with zero findings scores 10,
 * and scores decay toward 0 as findings accumulate.
 */
export function computeReviewScore(review: AggregatedReview): number {
  const severityWeights: Record<string, number> = {
    critical: 2.0,
    major: 1.0,
    minor: 0.3,
    suggestion: 0.1,
  };

  let weighted = 0;
  for (const cluster of review.clusters) {
    // Weight by consensus strength — unanimous findings matter more
    const consensusMultiplier = cluster.strength;
    const severityWeight = severityWeights[cluster.severity] ?? 0.1;
    weighted += severityWeight * consensusMultiplier;
  }

  // Exponential decay: 0 findings -> 10, many findings -> 0
  const score = 10 * Math.exp(-weighted / 8);
  return Math.round(score * 10) / 10;
}

/**
 * Convert a styleguide slop score (0=clean, 10=max slop) into a quality score
 * (0=worst, 10=best) by inverting it.
 */
export function invertStyleguideScore(slopScore: number): number {
  return Math.round((10 - slopScore) * 10) / 10;
}

/**
 * Compute a composite quality score from styleguide and review scores.
 * Both inputs should be on 0-10 scale where higher = better.
 *
 * Weights: 40% styleguide (mechanical), 60% review (substantive).
 */
export function computeCompositeScore(styleguideQuality: number, reviewScore: number): number {
  const composite = styleguideQuality * 0.4 + reviewScore * 0.6;
  return Math.round(composite * 10) / 10;
}

/**
 * Build a RevisionScore snapshot from raw evaluation results.
 */
export function buildRevisionScore(
  cycle: number,
  styleguideReport: CheckReport,
  review: AggregatedReview,
): RevisionScore {
  const styleguideQuality = invertStyleguideScore(styleguideReport.score);
  const reviewScore = computeReviewScore(review);
  const compositeScore = computeCompositeScore(styleguideQuality, reviewScore);

  return {
    cycle,
    styleguideScore: styleguideQuality,
    reviewScore,
    compositeScore,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compare two revision scores to determine improvement or regression.
 */
export function compareScores(before: RevisionScore, after: RevisionScore): ScoreComparison {
  const delta = Math.round((after.compositeScore - before.compositeScore) * 10) / 10;

  return {
    before,
    after,
    delta,
    improved: delta > 0,
    componentDeltas: {
      styleguideScore: Math.round((after.styleguideScore - before.styleguideScore) * 10) / 10,
      reviewScore: Math.round((after.reviewScore - before.reviewScore) * 10) / 10,
    },
  };
}

/**
 * Evaluate a revision: accept improvements, reject regressions, flag ambiguous.
 *
 * - Accept: composite improved (delta > 0)
 * - Reject: composite worsened significantly (delta < -0.5)
 * - Flag for review: minor regression or one component improved while other regressed
 */
export function evaluateRevision(comparison: ScoreComparison): RevisionEvaluation {
  const { delta, componentDeltas } = comparison;

  // Clear improvement
  if (delta > 0) {
    return {
      comparison,
      verdict: "accept",
      reason: `Revision improved composite score by ${delta.toFixed(1)} points`,
    };
  }

  // Significant regression
  if (delta < -0.5) {
    return {
      comparison,
      verdict: "reject",
      reason: `Revision regressed composite score by ${Math.abs(delta).toFixed(1)} points — discard and revert`,
    };
  }

  // Mixed: one improved, one regressed
  const styleguideImproved = componentDeltas.styleguideScore > 0;
  const reviewImproved = componentDeltas.reviewScore > 0;

  if (styleguideImproved !== reviewImproved && (styleguideImproved || reviewImproved)) {
    const improved = styleguideImproved ? "styleguide" : "review";
    const regressed = styleguideImproved ? "review" : "styleguide";
    return {
      comparison,
      verdict: "flag-for-review",
      reason: `Mixed result: ${improved} score improved but ${regressed} score regressed — fixing one score dropped another`,
    };
  }

  // Negligible change
  if (Math.abs(delta) <= 0.1) {
    return {
      comparison,
      verdict: "flag-for-review",
      reason: `Revision produced negligible change (delta: ${delta.toFixed(1)}) — may indicate plateau`,
    };
  }

  // Minor regression (between -0.5 and 0)
  return {
    comparison,
    verdict: "flag-for-review",
    reason: `Minor regression of ${Math.abs(delta).toFixed(1)} points — review before discarding`,
  };
}

/**
 * Detect whether the score trajectory has plateaued.
 *
 * A plateau exists when the absolute score delta is below the threshold
 * for `consecutivePlateauCycles` consecutive cycles, with a minimum of
 * `minCycles` total cycles completed.
 */
export function detectPlateau(
  scores: RevisionScore[],
  config: RevisionLoopConfig = DEFAULT_REVISION_LOOP_CONFIG,
): { detected: boolean; consecutiveCount: number } {
  if (scores.length < config.minCycles) {
    return { detected: false, consecutiveCount: 0 };
  }

  let consecutiveCount = 0;

  // Check deltas from most recent backwards
  for (let i = scores.length - 1; i > 0; i--) {
    const delta = Math.abs(scores[i].compositeScore - scores[i - 1].compositeScore);
    if (delta < config.scoreThreshold) {
      consecutiveCount++;
    } else {
      break;
    }
  }

  return {
    detected: consecutiveCount >= config.consecutivePlateauCycles,
    consecutiveCount,
  };
}

/** Hedging patterns that indicate qualified/tentative feedback. */
const HEDGING_PATTERNS = [
  /\bcould perhaps\b/i,
  /\bmight consider\b/i,
  /\bmay want to\b/i,
  /\bcould potentially\b/i,
  /\bpossibly consider\b/i,
  /\bmight benefit from\b/i,
  /\bcould arguably\b/i,
  /\bminor (?:point|issue|concern|suggestion)\b/i,
  /\bnitpick\b/i,
  /\bsubjective\b/i,
  /\btaste\b/i,
  /\bstylistic (?:preference|choice)\b/i,
  /\bcosts? of the chosen approach\b/i,
  /\btrade-?off\b/i,
  /\binherent (?:limitation|trade-?off)\b/i,
];

/**
 * Classify feedback items as qualified (hedged/tentative) or unqualified (firm).
 *
 * Autonovel stopping condition: >50% qualified feedback means the document
 * has reached a state where remaining issues are matters of taste, not substance.
 */
export function classifyFeedback(review: AggregatedReview): {
  qualified: number;
  unqualified: number;
  total: number;
  ratio: number;
} {
  let qualified = 0;
  let unqualified = 0;

  for (const cluster of review.clusters) {
    const description = cluster.representativeDescription;

    // Suggestions are inherently qualified
    if (cluster.severity === "suggestion") {
      qualified++;
      continue;
    }

    // Check for hedging patterns
    const isHedged = HEDGING_PATTERNS.some((p) => p.test(description));
    if (isHedged) {
      qualified++;
    } else {
      unqualified++;
    }
  }

  const total = qualified + unqualified;
  return {
    qualified,
    unqualified,
    total,
    ratio: total > 0 ? qualified / total : 0,
  };
}

/**
 * Detect the "stability trap": revisions making only safe/conservative changes
 * that don't genuinely improve the document.
 *
 * Indicators:
 * - Multiple consecutive cycles with tiny positive deltas (0 < delta < 0.2)
 * - All recent evaluations are "accept" but with minimal improvement
 * - Score oscillates in a narrow band (standard deviation < 0.2)
 *
 * This catches the case where AI revisions favor stability over genuine
 * transformation — making small safe edits that technically improve scores
 * but don't address substantive issues.
 */
export function detectStabilityTrap(
  scores: RevisionScore[],
  evaluations: RevisionEvaluation[],
): boolean {
  // Need at least 3 cycles to detect the pattern
  if (scores.length < 3 || evaluations.length < 2) {
    return false;
  }

  // Check last 3 scores for narrow oscillation band
  const recentScores = scores.slice(-3);
  const mean = recentScores.reduce((sum, s) => sum + s.compositeScore, 0) / recentScores.length;
  const variance =
    recentScores.reduce((sum, s) => sum + (s.compositeScore - mean) ** 2, 0) / recentScores.length;
  const stddev = Math.sqrt(variance);

  if (stddev >= 0.2) {
    return false; // Scores are varying enough — not trapped
  }

  // Check that recent evaluations show minimal improvement
  const recentEvals = evaluations.slice(-2);
  const allMinimalImprovement = recentEvals.every(
    (e) => e.comparison.delta >= 0 && e.comparison.delta < 0.2,
  );

  return allMinimalImprovement;
}

/**
 * Analyze all stopping conditions and decide whether the loop should stop.
 */
export function analyzeStoppingConditions(
  state: RevisionLoopState,
  latestReview?: AggregatedReview,
): StoppingAnalysis {
  const reasons: StoppingReason[] = [];
  const { scores, evaluations, config } = state;

  // 1. Max cycles reached
  if (state.currentCycle >= config.maxCycles) {
    reasons.push({
      type: "max-cycles",
      detail: `Reached maximum of ${config.maxCycles} revision cycles`,
    });
  }

  // 2. Plateau detection
  const plateau = detectPlateau(scores, config);
  if (plateau.detected) {
    reasons.push({
      type: "plateau",
      detail: `Score delta < ${config.scoreThreshold} for ${plateau.consecutiveCount} consecutive cycles`,
    });
  }

  // 3. No major unqualified issues
  if (latestReview) {
    const hasMajorIssues = latestReview.clusters.some(
      (c) => (c.severity === "critical" || c.severity === "major") && c.strength >= 0.5,
    );
    if (!hasMajorIssues) {
      reasons.push({
        type: "no-major-issues",
        detail: "No critical or major consensus issues remain in feedback",
      });
    }

    // 4. Qualified feedback threshold
    const feedback = classifyFeedback(latestReview);
    if (feedback.ratio > config.qualifiedFeedbackThreshold && feedback.total > 0) {
      reasons.push({
        type: "qualified-feedback",
        detail: `${Math.round(feedback.ratio * 100)}% of feedback is qualified/hedged (threshold: ${Math.round(config.qualifiedFeedbackThreshold * 100)}%)`,
      });
    }
  }

  // 5. Diminishing returns: if we've done 4+ cycles and recent deltas are shrinking
  if (scores.length >= 4) {
    const recentDeltas = [];
    for (let i = scores.length - 1; i > 0 && recentDeltas.length < 3; i--) {
      recentDeltas.push(Math.abs(scores[i].compositeScore - scores[i - 1].compositeScore));
    }
    const avgDelta = recentDeltas.reduce((sum, d) => sum + d, 0) / recentDeltas.length;
    if (avgDelta < config.scoreThreshold && scores.length > 4) {
      reasons.push({
        type: "diminishing-returns",
        detail: `Average recent improvement is ${avgDelta.toFixed(2)} points — diminishing returns detected`,
      });
    }
  }

  // 6. Stability trap
  if (detectStabilityTrap(scores, evaluations)) {
    reasons.push({
      type: "stability-trap",
      detail:
        "Revisions are making only safe/conservative changes — scores oscillate in a narrow band without genuine improvement",
    });
  }

  // Compute feedback ratio for metrics
  let qualifiedFeedbackRatio = 0;
  if (latestReview) {
    qualifiedFeedbackRatio = classifyFeedback(latestReview).ratio;
  }

  return {
    shouldStop: reasons.length > 0,
    reasons,
    metrics: {
      totalCycles: state.currentCycle,
      currentScore: scores.length > 0 ? scores[scores.length - 1].compositeScore : 0,
      scoreTrajectory: scores.map((s) => s.compositeScore),
      consecutivePlateaus: plateau.consecutiveCount,
      qualifiedFeedbackRatio,
    },
  };
}

/**
 * Create a fresh revision loop state for a document.
 */
export function createRevisionLoopState(
  documentId: string,
  config: Partial<RevisionLoopConfig> = {},
): RevisionLoopState {
  return {
    documentId,
    scores: [],
    evaluations: [],
    currentCycle: 0,
    status: "running",
    stoppingAnalysis: null,
    config: { ...DEFAULT_REVISION_LOOP_CONFIG, ...config },
  };
}

/**
 * Record a new cycle's score and evaluation into the loop state.
 * Returns the updated state and the evaluation for this cycle.
 */
export function recordCycle(
  state: RevisionLoopState,
  score: RevisionScore,
  latestReview?: AggregatedReview,
): { state: RevisionLoopState; evaluation: RevisionEvaluation | null } {
  const updatedScores = [...state.scores, score];
  let evaluation: RevisionEvaluation | null = null;

  if (state.scores.length > 0) {
    const previousScore = state.scores[state.scores.length - 1];
    const comparison = compareScores(previousScore, score);
    evaluation = evaluateRevision(comparison);
  }

  const updatedEvaluations = evaluation
    ? [...state.evaluations, evaluation]
    : [...state.evaluations];

  const updatedState: RevisionLoopState = {
    ...state,
    scores: updatedScores,
    evaluations: updatedEvaluations,
    currentCycle: score.cycle,
  };

  // Check stopping conditions
  const analysis = analyzeStoppingConditions(updatedState, latestReview);
  updatedState.stoppingAnalysis = analysis;

  if (analysis.shouldStop) {
    updatedState.status = "stopped";
  }

  return { state: updatedState, evaluation };
}

/**
 * Format a stopping analysis as a human-readable rationale.
 */
export function formatStoppingRationale(analysis: StoppingAnalysis): string {
  const lines: string[] = [];

  if (!analysis.shouldStop) {
    lines.push("Revision loop is still producing improvements — continue iterating.");
    lines.push("");
    lines.push(`Current score: ${analysis.metrics.currentScore.toFixed(1)}/10`);
    lines.push(`Cycles completed: ${analysis.metrics.totalCycles}`);
    return lines.join("\n");
  }

  lines.push(
    `Revision stabilized after ${analysis.metrics.totalCycles} cycles — remaining feedback is minor/qualified.`,
  );
  lines.push("");
  lines.push(`Final score: ${analysis.metrics.currentScore.toFixed(1)}/10`);
  lines.push("");

  // Group reasons by type for a clear summary
  const reasonsByType = new Map<string, StoppingReason>();
  for (const reason of analysis.reasons) {
    reasonsByType.set(reason.type, reason);
  }

  lines.push("**Why we stopped:**");
  for (const reason of analysis.reasons) {
    lines.push(`- ${reason.detail}`);
  }

  // Warn about over-revision if we hit many cycles
  if (analysis.metrics.totalCycles >= 4) {
    lines.push("");
    lines.push(
      "**Diminishing returns warning**: After 4+ revision cycles, fixing one issue often introduces another. Further revision may degrade overall quality.",
    );
  }

  // Stability trap warning
  if (reasonsByType.has("stability-trap")) {
    lines.push("");
    lines.push(
      "**Stability trap detected**: Recent revisions favored safe, conservative changes over genuine transformation. Consider whether the document needs a structural rethink rather than incremental polish.",
    );
  }

  return lines.join("\n");
}

/**
 * Format a revision evaluation as a concise summary line.
 */
export function formatEvaluationSummary(evaluation: RevisionEvaluation): string {
  const { comparison, verdict } = evaluation;
  const icon = verdict === "accept" ? "+" : verdict === "reject" ? "-" : "?";
  const scoreLine = `${comparison.before.compositeScore.toFixed(1)} → ${comparison.after.compositeScore.toFixed(1)}`;
  const deltaSign = comparison.delta >= 0 ? "+" : "";

  return `[${icon}] Cycle ${comparison.before.cycle}→${comparison.after.cycle}: ${scoreLine} (${deltaSign}${comparison.delta.toFixed(1)}) — ${verdict}`;
}
