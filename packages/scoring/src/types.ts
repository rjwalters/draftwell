/**
 * Core types for calibrated document scoring with writer/judge model separation.
 */

// --- Scoring Dimensions ---

export type DimensionId =
  | "clarity"
  | "structure"
  | "voice"
  | "completeness"
  | "accuracy"
  | "conciseness"
  | "audience-fit";

export interface ScoringDimension {
  id: DimensionId;
  name: string;
  description: string;
  /** Anchor descriptions for calibration: what each score level means */
  anchors: Record<number, string>;
  /** Weight for computing composite score (0-1, must sum to 1 across all dimensions) */
  weight: number;
}

// --- Scores ---

export interface DimensionScore {
  dimensionId: DimensionId;
  score: number; // 1-10
  justification: string;
  /** Weaknesses with quoted evidence from the document */
  weaknesses: WeaknessWithEvidence[];
}

export interface WeaknessWithEvidence {
  description: string;
  /** Direct quote from the document demonstrating the weakness */
  quotedEvidence: string;
  severity: "minor" | "moderate" | "major";
  suggestion: string;
}

export interface DocumentScore {
  documentId: string;
  revisionNumber: number;
  dimensions: DimensionScore[];
  compositeScore: number;
  overallAssessment: string;
  model: string;
  timestamp: string;
}

// --- Model Configuration ---

export type ModelRole = "writer" | "judge";

export interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ModelPair {
  writer: ModelConfig;
  judge: ModelConfig;
}

// --- Elo Comparison ---

export interface ComparisonPair {
  versionA: { documentId: string; revisionNumber: number; content: string };
  versionB: { documentId: string; revisionNumber: number; content: string };
}

export interface ComparisonResult {
  winner: "A" | "B";
  /** Mandatory explanation for the forced choice */
  reasoning: string;
  dimensionBreakdown: Array<{
    dimensionId: DimensionId;
    winner: "A" | "B";
    explanation: string;
  }>;
  model: string;
  timestamp: string;
}

export interface EloRating {
  documentId: string;
  revisionNumber: number;
  rating: number;
  matchCount: number;
}

// --- Score Tracking ---

export interface RevisionScoreEntry {
  documentId: string;
  revisionNumber: number;
  score: DocumentScore;
  comparisonVsPrevious?: ComparisonResult;
  timestamp: string;
}

export interface ScoreTrajectory {
  documentId: string;
  entries: RevisionScoreEntry[];
  trend: "improving" | "stable" | "declining";
  /** Change in composite score from first to latest revision */
  totalDelta: number;
}
