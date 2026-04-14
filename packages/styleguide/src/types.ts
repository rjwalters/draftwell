/**
 * Severity tiers for styleguide rules.
 *
 * - error: Kill-on-sight. Always wrong in any context (e.g., "delve", chatbot artifacts).
 * - warning: Suspicious in clusters. One occurrence is fine; multiple indicate AI slop.
 * - info: Style suggestions. Not wrong per se but worth flagging for author awareness.
 */
export type Severity = "error" | "warning" | "info";

/**
 * Categories of AI writing patterns.
 */
export type PatternCategory =
  | "banned-phrase"
  | "overused-word"
  | "structural"
  | "style"
  | "communication";

/**
 * A single styleguide rule that can be mechanically checked via regex.
 */
export interface StyleguideRule {
  /** Unique identifier, e.g. "banned-phrase-delve" */
  id: string;
  /** Human-readable description of the problem */
  description: string;
  /** Severity tier */
  severity: Severity;
  /** Category for grouping */
  category: PatternCategory;
  /** Regex pattern to match (case-insensitive by default) */
  pattern: string;
  /** Regex flags (defaults to "gi") */
  flags?: string;
  /** Suggested fix or replacement */
  suggestion?: string;
}

/**
 * A structural rule that analyzes document-level patterns rather than
 * individual phrase matches. These compute metrics over the full document.
 */
export interface StructuralRule {
  /** Unique identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Severity tier */
  severity: Severity;
  /** Category is always "structural" */
  category: "structural";
  /** Type of structural check */
  type:
    | "em-dash-density"
    | "sentence-length-uniformity"
    | "triadic-listing"
    | "balanced-antithesis"
    | "show-dont-tell"
    | "excessive-hedging";
  /** Threshold above which the rule triggers */
  threshold: number;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Complete styleguide configuration.
 */
export interface Styleguide {
  /** Name of this styleguide */
  name: string;
  /** Version for compatibility tracking */
  version: string;
  /** Pattern-matching rules (phrase, word, style, communication) */
  rules: StyleguideRule[];
  /** Document-level structural rules */
  structuralRules: StructuralRule[];
}

/**
 * A single match found by the mechanical checker.
 */
export interface CheckResult {
  /** Rule that was triggered */
  ruleId: string;
  /** Severity of the match */
  severity: Severity;
  /** Category of the match */
  category: PatternCategory;
  /** Description of the problem */
  description: string;
  /** The matched text */
  match: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Result from a structural check (document-level).
 */
export interface StructuralCheckResult {
  /** Rule that was triggered */
  ruleId: string;
  /** Severity */
  severity: Severity;
  /** Description of the problem */
  description: string;
  /** Computed metric value */
  value: number;
  /** Threshold that was exceeded */
  threshold: number;
  /** Suggested fix */
  suggestion?: string;
  /** Specific locations where the pattern appears, if applicable */
  locations?: Array<{ line: number; text: string }>;
}

/**
 * Complete report from the mechanical checker.
 */
export interface CheckReport {
  /** Total number of issues found */
  totalIssues: number;
  /** Breakdown by severity */
  counts: Record<Severity, number>;
  /** Composite score (0 = clean, 10 = maximum AI slop) */
  score: number;
  /** Individual pattern matches */
  results: CheckResult[];
  /** Structural analysis results */
  structuralResults: StructuralCheckResult[];
}
