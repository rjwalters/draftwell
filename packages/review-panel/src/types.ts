/**
 * A review persona defines a particular critical lens through which
 * a document is evaluated. Each persona has its own perspective,
 * evaluation dimensions, and prompt template.
 */
export interface Persona {
  /** Unique identifier for the persona (e.g., "critical-editor") */
  id: string;
  /** Display name (e.g., "Critical Editor") */
  name: string;
  /** The perspective this persona brings to a review */
  perspective: string;
  /** Specific dimensions this persona evaluates */
  dimensions: string[];
  /** Prompt template. Use {{document}} as placeholder for document content. */
  promptTemplate: string;
}

/** Severity of a review finding */
export type Severity = "critical" | "major" | "minor" | "suggestion";

/** Category of a review finding */
export type Category =
  | "structure"
  | "clarity"
  | "accuracy"
  | "completeness"
  | "readability"
  | "consistency"
  | "terminology"
  | "tone"
  | "style"
  | "flow"
  | "engagement"
  | "other";

/**
 * A single finding from a persona's review.
 */
export interface ReviewItem {
  /** Which persona produced this item */
  personaId: string;
  /** Category of the issue */
  category: Category;
  /** How severe the issue is */
  severity: Severity;
  /** Location in the document (optional, line-based or section reference) */
  location?: string;
  /** Description of the issue */
  description: string;
  /** Suggested fix or improvement */
  suggestion?: string;
}

/**
 * The complete review output from a single persona.
 */
export interface PersonaReview {
  personaId: string;
  personaName: string;
  items: ReviewItem[];
  /** Overall assessment summary from this persona */
  summary: string;
}

/**
 * A cluster of related review items from different personas
 * that address the same underlying issue.
 */
export interface ConsensusCluster {
  /** Unique ID for this cluster */
  id: string;
  /** How many personas flagged this issue (1-4 typically) */
  consensusCount: number;
  /** Total number of personas that reviewed */
  totalPersonas: number;
  /** Consensus strength as a ratio (consensusCount / totalPersonas) */
  strength: number;
  /** The individual review items that form this cluster */
  items: ReviewItem[];
  /** Representative description synthesized from all items */
  representativeDescription: string;
  /** The most common category across items */
  category: Category;
  /** The highest severity across items */
  severity: Severity;
}

/**
 * The final aggregated review combining all persona reviews.
 */
export interface AggregatedReview {
  /** All consensus clusters, sorted by strength (highest first) */
  clusters: ConsensusCluster[];
  /** Clusters where all or most personas agree (strength >= threshold) */
  consensusItems: ConsensusCluster[];
  /** Clusters where personas disagree (strength < threshold) */
  disagreements: ConsensusCluster[];
  /** Individual persona reviews for reference */
  personaReviews: PersonaReview[];
  /** Summary statistics */
  stats: {
    totalFindings: number;
    totalClusters: number;
    consensusCount: number;
    disagreementCount: number;
    personaCount: number;
  };
}

/**
 * A voice dimension rule extracted from a user's writing samples.
 */
export interface VoiceDimensionRule {
  name: string;
  observation: string;
  rule: string;
}

/**
 * A voice profile containing actionable style rules for personalized review.
 */
export interface VoiceProfileRules {
  dimensions: VoiceDimensionRule[];
  summary: string;
  escape_clause: string;
}

/**
 * Options for configuring the review panel.
 */
export interface ReviewPanelOptions {
  /** Personas to use. Defaults to the four built-in personas. */
  personas?: Persona[];
  /** Consensus threshold (fraction). Items at or above this are "consensus". Default: 0.75 */
  consensusThreshold?: number;
  /** Function to call the AI model. Allows different backends (Claude API, local, etc.) */
  callModel: (prompt: string) => Promise<string>;
  /** Optional voice profile rules to personalize the Style Reviewer persona. */
  voiceProfile?: VoiceProfileRules;
}

// --- Calibrated Scoring Types ---

/**
 * A scoring dimension with calibration anchors that prevent score inflation.
 * Each anchor gives the model a concrete reference point for what a given score means.
 */
export interface ScoringDimension {
  /** Unique identifier (e.g., "clarity", "structure") */
  id: string;
  /** Display name */
  name: string;
  /** What this dimension measures */
  description: string;
  /** Calibration anchors mapping score values to concrete descriptions */
  anchors: Record<number, string>;
}

/**
 * A score for a single dimension, with mandatory weakness identification.
 * No score without critique — the model must quote evidence from the document.
 */
export interface DimensionScore {
  /** Which dimension was scored */
  dimensionId: string;
  /** Numeric score (1-10) */
  score: number;
  /** Brief justification for the score */
  justification: string;
  /** Identified weaknesses with quoted evidence from the document */
  weaknesses: Array<{
    /** Description of the weakness */
    description: string;
    /** Exact quote from the document demonstrating the weakness */
    evidence: string;
  }>;
  /** Identified strengths (optional but encouraged) */
  strengths?: string[];
}

/**
 * Complete scored evaluation of a document across all dimensions.
 */
export interface DocumentScore {
  /** Unique ID for this scoring session */
  id: string;
  /** Document identifier */
  documentId: string;
  /** Revision number that was scored */
  revisionNumber: number;
  /** Individual dimension scores */
  dimensions: DimensionScore[];
  /** Weighted overall score */
  overallScore: number;
  /** Model used for this evaluation */
  model: string;
  /** Timestamp */
  createdAt: string;
}

/**
 * Result of a head-to-head comparison between two document versions.
 * Forced choice produces more reliable rankings than absolute scoring.
 */
export interface ComparisonResult {
  /** ID of version A */
  versionA: { documentId: string; revisionNumber: number };
  /** ID of version B */
  versionB: { documentId: string; revisionNumber: number };
  /** Which version won ("A" | "B") — forced choice, no ties */
  winner: "A" | "B";
  /** Dimension-by-dimension comparison */
  dimensionWins: Array<{
    dimensionId: string;
    winner: "A" | "B";
    reasoning: string;
  }>;
  /** Overall reasoning for the choice */
  reasoning: string;
  /** Model used for comparison */
  model: string;
  /** Timestamp */
  createdAt: string;
}

/**
 * Elo rating for a document version, updated after each comparison.
 */
export interface EloRating {
  documentId: string;
  revisionNumber: number;
  rating: number;
  matchesPlayed: number;
}

/**
 * A log entry tracking scores across revision cycles.
 */
export interface ScoreLogEntry {
  documentId: string;
  revisionNumber: number;
  overallScore: number;
  dimensionScores: Record<string, number>;
  model: string;
  createdAt: string;
}

// --- Model Configuration Types ---

/** Role-based model configuration for writer/judge separation. */
export type ModelRole = "writer" | "judge";

/**
 * Configuration for a specific model role.
 * Different roles should use different models/temperatures to prevent
 * self-congratulatory feedback loops.
 */
export interface ModelRoleConfig {
  /** Model identifier (e.g., "claude-sonnet-4-20250514", "claude-opus-4-20250514") */
  model: string;
  /** Temperature setting (lower = more deterministic judgment) */
  temperature: number;
  /** Maximum tokens for response */
  maxTokens: number;
}

/**
 * Complete model configuration with writer/judge separation.
 * The judge should default to a more capable model than the writer.
 */
export interface ModelConfig {
  /** Model config for content generation / revision */
  writer: ModelRoleConfig;
  /** Model config for evaluation / scoring / comparison */
  judge: ModelRoleConfig;
}
