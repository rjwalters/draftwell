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
