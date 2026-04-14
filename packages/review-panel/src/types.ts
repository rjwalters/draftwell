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
 * Options for configuring the review panel.
 */
export interface ReviewPanelOptions {
  /** Personas to use. Defaults to the four built-in personas. */
  personas?: Persona[];
  /** Consensus threshold (fraction). Items at or above this are "consensus". Default: 0.75 */
  consensusThreshold?: number;
  /** Function to call the AI model. Allows different backends (Claude API, local, etc.) */
  callModel: (prompt: string) => Promise<string>;
}
