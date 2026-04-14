/**
 * Core types for the Draftwell revision pipeline.
 */

/** Document section parsed from markdown. */
export interface Section {
  heading: string;
  level: number;
  content: string;
  startLine: number;
  tokens: number;
}

/** Cut classification types from the adversarial editing technique. */
export type CutType =
  | "OVER-EXPLAIN"
  | "REDUNDANT"
  | "FAT"
  | "TELL"
  | "STRUCTURAL"
  | "GENERIC";

/** A single proposed cut from the adversarial edit pass. */
export interface ProposedCut {
  id: string;
  type: CutType;
  passage: string;
  reason: string;
  section: string;
  wordCount: number;
  status: "pending" | "accepted" | "rejected";
}

/** Distribution of cut types as a document quality signal. */
export type CutDistribution = Record<CutType, number>;

/** Result of an adversarial edit pass on a document. */
export interface AdversarialEditResult {
  documentId: string;
  cuts: ProposedCut[];
  distribution: CutDistribution;
  totalWordsProposed: number;
  model: string;
  createdAt: string;
}

/** Configuration for the adversarial edit pass. */
export interface AdversarialEditConfig {
  /** Target number of cuts to identify (default: 15). */
  targetCuts: number;
  /** Approximate word count to propose cutting (guides the LLM). */
  targetWordsCut: number;
  /** Claude model to use. */
  model: string;
  /** API key for Claude. */
  apiKey: string;
  /** Optional base URL for the API. */
  baseUrl?: string;
}

/** Stage in the revision pipeline where adversarial edit fits. */
export type PipelineStage =
  | "review"
  | "adversarial-edit"
  | "revision"
  | "refinement";

// -- Score-gated revision loop types --

/** Configuration for the revision loop's stopping heuristics. */
export interface RevisionLoopConfig {
  /** Score delta below which a cycle is considered a plateau (default: 0.3). */
  scoreThreshold: number;
  /** Maximum revision cycles before forced stop (default: 8). */
  maxCycles: number;
  /** Minimum cycles before plateau detection activates (default: 3). */
  minCycles: number;
  /** Consecutive plateau cycles required to trigger stop (default: 2). */
  consecutivePlateauCycles: number;
  /** Fraction of hedged/qualified feedback that signals diminishing returns (default: 0.5). */
  qualifiedFeedbackThreshold: number;
}

/** Score snapshot captured at the end of a revision cycle. */
export interface RevisionScore {
  /** Which revision cycle produced this score (1-indexed). */
  cycle: number;
  /** Styleguide checker score (0 = clean, 10 = maximum slop). Inverted for composite. */
  styleguideScore: number;
  /** Review panel score (0 = worst, 10 = best). Derived from consensus findings. */
  reviewScore: number;
  /** Combined score (0 = worst, 10 = best). */
  compositeScore: number;
  /** ISO timestamp of when the score was recorded. */
  timestamp: string;
}

/** Before/after comparison of two revision scores. */
export interface ScoreComparison {
  before: RevisionScore;
  after: RevisionScore;
  /** Change in composite score (positive = improvement). */
  delta: number;
  /** Whether the composite score improved. */
  improved: boolean;
  /** Per-component deltas (positive = improvement). */
  componentDeltas: {
    styleguideScore: number;
    reviewScore: number;
  };
}

/** Verdict on whether to keep or discard a revision. */
export interface RevisionEvaluation {
  comparison: ScoreComparison;
  /** "accept" = keep revision, "reject" = discard, "flag-for-review" = ambiguous. */
  verdict: "accept" | "reject" | "flag-for-review";
  /** Human-readable explanation of the verdict. */
  reason: string;
}

/** A single reason why the revision loop should (or did) stop. */
export type StoppingReason =
  | { type: "plateau"; detail: string }
  | { type: "max-cycles"; detail: string }
  | { type: "no-major-issues"; detail: string }
  | { type: "qualified-feedback"; detail: string }
  | { type: "diminishing-returns"; detail: string }
  | { type: "stability-trap"; detail: string };

/** Full analysis of whether the revision loop should stop. */
export interface StoppingAnalysis {
  shouldStop: boolean;
  reasons: StoppingReason[];
  metrics: {
    totalCycles: number;
    currentScore: number;
    scoreTrajectory: number[];
    consecutivePlateaus: number;
    qualifiedFeedbackRatio: number;
  };
}

/** Tracks the full state of a revision loop across cycles. */
export interface RevisionLoopState {
  documentId: string;
  scores: RevisionScore[];
  evaluations: RevisionEvaluation[];
  currentCycle: number;
  status: "running" | "stopped" | "completed";
  stoppingAnalysis: StoppingAnalysis | null;
  config: RevisionLoopConfig;
}
