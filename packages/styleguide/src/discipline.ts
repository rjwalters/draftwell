/**
 * Discipline checker that runs Orwell/Zinsser/Ogilvy language rules against text.
 */

import type { DisciplineResult, Finding, RevisionPass, DisciplineRule } from "./types.js";
import { orwellRules } from "./rules/orwell.js";
import { zinsserRules, zinsserPasses } from "./rules/zinsser.js";
import { ogilvyRules } from "./rules/ogilvy.js";

const ESCAPE_CLAUSE =
  "Break any of these rules sooner than say anything outright barbarous. " +
  "— George Orwell, rule 6";

/** All rules from all three frameworks. */
export const allRules: readonly DisciplineRule[] = [
  ...orwellRules,
  ...zinsserRules,
  ...ogilvyRules,
];

/** Map of rule ID to rule, for lookup by revision passes. */
const ruleMap = new Map<string, DisciplineRule>(allRules.map((r) => [r.id, r]));

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Run all language discipline rules against the input text.
 * Returns structured findings sorted by position in the text.
 */
export function checkDiscipline(text: string): DisciplineResult {
  const findings: Finding[] = [];
  for (const rule of allRules) {
    findings.push(...rule.check(text));
  }
  findings.sort((a, b) => a.offset - b.offset);
  return {
    findings,
    wordCount: countWords(text),
    escapeClause: ESCAPE_CLAUSE,
  };
}

/**
 * Run only the rules for a specific Zinsser revision pass.
 * This allows the review pipeline to offer a three-pass revision mode.
 */
export function checkPass(
  text: string,
  pass: RevisionPass,
): DisciplineResult {
  const findings: Finding[] = [];
  for (const ruleId of pass.ruleIds) {
    const rule = ruleMap.get(ruleId);
    if (rule) {
      findings.push(...rule.check(text));
    }
  }
  findings.sort((a, b) => a.offset - b.offset);
  return {
    findings,
    wordCount: countWords(text),
    escapeClause: ESCAPE_CLAUSE,
  };
}

/**
 * Run the full Zinsser three-pass revision sequence.
 * Returns results for each pass separately so the reviewer can
 * address one concern layer at a time.
 */
export function checkAllPasses(
  text: string,
): Array<{ pass: RevisionPass; result: DisciplineResult }> {
  return zinsserPasses.map((pass) => ({
    pass,
    result: checkPass(text, pass),
  }));
}

/**
 * Look up the plain replacement for an inflated phrase.
 * Returns undefined if the phrase is not in the table.
 */
export { inflatedPhrases } from "./phrase-table.js";

/** Re-export revision passes for external use. */
export { zinsserPasses } from "./rules/zinsser.js";
