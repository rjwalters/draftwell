import type {
  Styleguide,
  StyleguideRule,
  StructuralRule,
  CheckResult,
  StructuralCheckResult,
  CheckReport,
  Severity,
} from "./types.js";

/**
 * Mechanical (regex-based) styleguide checker.
 * Scores documents against a styleguide without calling any LLM.
 * Designed as a fast pre-check before LLM-based quality review.
 */
export function check(document: string, styleguide: Styleguide): CheckReport {
  const results = checkPatterns(document, styleguide.rules);
  const structuralResults = checkStructural(document, styleguide.structuralRules);

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const r of results) {
    counts[r.severity]++;
  }
  for (const r of structuralResults) {
    counts[r.severity]++;
  }

  const score = computeScore(counts, results.length + structuralResults.length);

  return {
    totalIssues: results.length + structuralResults.length,
    counts,
    score,
    results,
    structuralResults,
  };
}

/**
 * Run pattern-matching rules against the document.
 */
function checkPatterns(document: string, rules: StyleguideRule[]): CheckResult[] {
  const lines = document.split("\n");
  const results: CheckResult[] = [];

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, rule.flags ?? "gi");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(document)) !== null) {
      const { line, column } = offsetToLocation(document, lines, match.index);

      results.push({
        ruleId: rule.id,
        severity: rule.severity,
        category: rule.category,
        description: rule.description,
        match: match[0],
        line,
        column,
        suggestion: rule.suggestion,
      });

      // Prevent infinite loops on zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
  }

  // Sort by line, then column
  results.sort((a, b) => a.line - b.line || a.column - b.column);
  return results;
}

/**
 * Run structural (document-level) checks.
 */
function checkStructural(
  document: string,
  rules: StructuralRule[],
): StructuralCheckResult[] {
  const results: StructuralCheckResult[] = [];
  const wordCount = countWords(document);
  if (wordCount === 0) return results;

  const per1000 = 1000 / wordCount;

  for (const rule of rules) {
    const result = runStructuralCheck(document, rule, wordCount, per1000);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

function runStructuralCheck(
  document: string,
  rule: StructuralRule,
  wordCount: number,
  per1000: number,
): StructuralCheckResult | null {
  switch (rule.type) {
    case "em-dash-density":
      return checkEmDashDensity(document, rule, per1000);
    case "sentence-length-uniformity":
      return checkSentenceUniformity(document, rule, wordCount);
    case "triadic-listing":
      return checkTriadicListing(document, rule, per1000);
    case "balanced-antithesis":
      return checkBalancedAntithesis(document, rule, per1000);
    case "show-dont-tell":
      return checkShowDontTell(document, rule, per1000);
    case "excessive-hedging":
      return checkExcessiveHedging(document, rule, per1000);
    default:
      return null;
  }
}

// -- Structural check implementations --

function checkEmDashDensity(
  document: string,
  rule: StructuralRule,
  per1000: number,
): StructuralCheckResult | null {
  const emDashPattern = /\u2014|---?(?!-)/g;
  const matches = document.match(emDashPattern);
  const count = matches?.length ?? 0;
  const density = count * per1000;

  if (density <= rule.threshold) return null;

  const locations = findLocations(document, emDashPattern);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    description: rule.description,
    value: Math.round(density * 10) / 10,
    threshold: rule.threshold,
    suggestion: rule.suggestion,
    locations,
  };
}

function checkSentenceUniformity(
  document: string,
  rule: StructuralRule,
  wordCount: number,
): StructuralCheckResult | null {
  // Need enough content to measure
  if (wordCount < 50) return null;

  const sentences = extractSentences(document);
  if (sentences.length < 5) return null;

  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance =
    lengths.reduce((sum, len) => sum + Math.pow(len - mean, 2), 0) / lengths.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean; // coefficient of variation

  // Low CV means too uniform
  if (cv >= rule.threshold) return null;

  return {
    ruleId: rule.id,
    severity: rule.severity,
    description: rule.description,
    value: Math.round(cv * 100) / 100,
    threshold: rule.threshold,
    suggestion: rule.suggestion,
  };
}

function checkTriadicListing(
  document: string,
  rule: StructuralRule,
  per1000: number,
): StructuralCheckResult | null {
  // Pattern: "X, Y, and Z" or "X, Y, and Z."
  const triadicPattern = /\b\w+(?:\s+\w+)?,\s+\w+(?:\s+\w+)?,\s+and\s+\w+/gi;
  const matches = document.match(triadicPattern);
  const count = matches?.length ?? 0;
  const density = count * per1000;

  if (density <= rule.threshold) return null;

  const locations = findLocations(document, triadicPattern);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    description: rule.description,
    value: Math.round(density * 10) / 10,
    threshold: rule.threshold,
    suggestion: rule.suggestion,
    locations,
  };
}

function checkBalancedAntithesis(
  document: string,
  rule: StructuralRule,
  per1000: number,
): StructuralCheckResult | null {
  // Patterns like "not X but Y", "not only X but also Y", "X yet Y", "while X, Y"
  const antithesisPattern =
    /\bnot (?:only |just |merely )?[\w\s]+(?:,\s*)?but (?:also |rather |instead )?[\w\s]+|(?:while|whereas|although) [\w\s]+, [\w\s]+/gi;
  const matches = document.match(antithesisPattern);
  const count = matches?.length ?? 0;
  const density = count * per1000;

  if (density <= rule.threshold) return null;

  const locations = findLocations(document, antithesisPattern);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    description: rule.description,
    value: Math.round(density * 10) / 10,
    threshold: rule.threshold,
    suggestion: rule.suggestion,
    locations,
  };
}

function checkShowDontTell(
  document: string,
  rule: StructuralRule,
  per1000: number,
): StructuralCheckResult | null {
  // Patterns that tell rather than show
  const tellPatterns =
    /\b(?:(?:he|she|they|it|this|the \w+) (?:was|were|felt|seemed|appeared) (?:very |quite |extremely |incredibly |deeply )?(?:important|significant|meaningful|powerful|profound|remarkable|extraordinary|moving|inspiring|transformative|beautiful|stunning|elegant)|(?:this|it|the \w+) (?:is|was|represents?) (?:a |an )?(?:testament|embodiment|epitome|pinnacle|hallmark))\b/gi;
  const matches = document.match(tellPatterns);
  const count = matches?.length ?? 0;
  const density = count * per1000;

  if (density <= rule.threshold) return null;

  const locations = findLocations(document, tellPatterns);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    description: rule.description,
    value: Math.round(density * 10) / 10,
    threshold: rule.threshold,
    suggestion: rule.suggestion,
    locations,
  };
}

function checkExcessiveHedging(
  document: string,
  rule: StructuralRule,
  per1000: number,
): StructuralCheckResult | null {
  const hedgePattern =
    /\b(?:perhaps|maybe|possibly|arguably|somewhat|relatively|fairly|rather|to some (?:extent|degree)|in some ways?|it (?:could|might|may) be (?:argued|said|suggested)|one could argue|it seems|it appears|it would seem)\b/gi;
  const matches = document.match(hedgePattern);
  const count = matches?.length ?? 0;
  const density = count * per1000;

  if (density <= rule.threshold) return null;

  const locations = findLocations(document, hedgePattern);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    description: rule.description,
    value: Math.round(density * 10) / 10,
    threshold: rule.threshold,
    suggestion: rule.suggestion,
    locations,
  };
}

// -- Utility functions --

function offsetToLocation(
  _document: string,
  lines: string[],
  offset: number,
): { line: number; column: number } {
  let remaining = offset;
  for (let i = 0; i < lines.length; i++) {
    if (remaining <= lines[i].length) {
      return { line: i + 1, column: remaining + 1 };
    }
    remaining -= lines[i].length + 1; // +1 for newline
  }
  return { line: lines.length, column: 1 };
}

function countWords(document: string): number {
  // Strip markdown formatting for word count
  const stripped = document
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\*|_/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
  const words = stripped.match(/\b\w+\b/g);
  return words?.length ?? 0;
}

function extractSentences(document: string): string[] {
  // Strip code blocks and headings
  const stripped = document
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "");

  // Split on sentence-ending punctuation
  const raw = stripped.split(/[.!?]+\s+/);
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.split(/\s+/).length >= 3);
}

function findLocations(
  document: string,
  pattern: RegExp,
): Array<{ line: number; text: string }> {
  const lines = document.split("\n");
  const locations: Array<{ line: number; text: string }> = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(document)) !== null) {
    const { line } = offsetToLocation(document, lines, match.index);
    locations.push({ line, text: match[0].slice(0, 80) });
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  return locations;
}

/**
 * Compute a composite slop score from 0 (clean) to 10 (maximum AI slop).
 * Inspired by autonovel's evaluate.py scoring.
 */
function computeScore(
  counts: Record<Severity, number>,
  _totalIssues: number,
): number {
  // Weighted: errors = 1.0, warnings = 0.5, info = 0.1
  const weighted = counts.error * 1.0 + counts.warning * 0.5 + counts.info * 0.1;

  // Sigmoid-like mapping to 0-10 range
  // score = 10 * (1 - e^(-weighted/10))
  const score = 10 * (1 - Math.exp(-weighted / 10));

  return Math.round(score * 10) / 10;
}
