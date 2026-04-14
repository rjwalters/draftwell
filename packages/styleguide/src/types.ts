/**
 * Severity tiers for styleguide rules.
 *
 * - error: Kill-on-sight. Always wrong in any context (e.g., "delve", chatbot artifacts).
 * - warning: Suspicious in clusters. One occurrence is fine; multiple indicate AI slop.
 * - info: Style suggestions. Not wrong per se but worth flagging for author awareness.
 * - suggestion: Language discipline suggestion from Orwell/Zinsser/Ogilvy rules.
 */
export type Severity = "error" | "warning" | "info" | "suggestion";

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

// -- Language discipline types (Orwell, Zinsser, Ogilvy) --

/** Framework source for a language discipline rule. */
export type Framework = "orwell" | "zinsser" | "ogilvy";

/** A single finding produced by a discipline rule check. */
export interface Finding {
  ruleId: string;
  framework: Framework;
  severity: Severity;
  message: string;
  /** The matched text that triggered the finding. */
  matched: string;
  /** Suggested replacement, if applicable. */
  replacement?: string;
  /** Character offset in the input text. */
  offset: number;
  /** Length of the matched span. */
  length: number;
}

/** A reviewable language discipline rule with a testable check function. */
export interface DisciplineRule {
  id: string;
  name: string;
  description: string;
  framework: Framework;
  severity: Severity;
  /**
   * Check the input text and return any findings.
   * Rules should return an empty array if no issues are found.
   */
  check(text: string): Finding[];
}

/**
 * Zinsser's three revision passes, usable as a revision mode option.
 * Each pass has a name, goal, and set of rules to apply.
 */
export interface RevisionPass {
  id: string;
  name: string;
  goal: string;
  /** Rule IDs to apply during this pass. */
  ruleIds: string[];
}

/** Result of running the discipline checker against a document. */
export interface DisciplineResult {
  findings: Finding[];
  /** Total number of words in the input. */
  wordCount: number;
  /**
   * Escape clause reminder: "Break any rule rather than write something
   * barbarous." Every result carries this so reviewers remember that
   * mechanical rules are guidelines, not absolutes.
   */
  escapeClause: string;
}
