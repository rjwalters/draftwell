/**
 * Ogilvy's writing-as-action principles.
 *
 * Core tenets:
 * - Write the way you talk.
 * - Short words, short sentences, short paragraphs.
 * - Be crystal clear about what you want the reader to do.
 */

import type { Finding, DisciplineRule } from "../types.js";

// --- Paragraph length ---
const MAX_PARAGRAPH_WORDS = 150;

/** Flags paragraphs over 150 words — Ogilvy demands short paragraphs. */
export const paragraphLengthRule: DisciplineRule= {
  id: "ogilvy-paragraph-length",
  name: "Short paragraphs",
  description:
    "Flags paragraphs over 150 words. Ogilvy: short words, short sentences, short paragraphs.",
  framework: "ogilvy",
  severity: "suggestion",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    // Split on blank lines (two+ consecutive newlines).
    const paragraphs = text.split(/\n\s*\n/);
    let offset = 0;
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        offset += para.length + 1;
        continue;
      }
      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length > MAX_PARAGRAPH_WORDS) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Long paragraph (${words.length} words). Break it up — aim for under ${MAX_PARAGRAPH_WORDS} words.`,
          matched:
            trimmed.slice(0, 80) + (trimmed.length > 80 ? "..." : ""),
          offset: text.indexOf(trimmed, offset),
          length: trimmed.length,
        });
      }
      offset += para.length + 1;
    }
    return findings;
  },
};

// --- Clarity / call-to-action check ---

/**
 * Hedging phrases that undermine clarity about what the reader should do.
 * Ogilvy insists on being crystal clear about the desired action.
 */
const hedgingPhrases: ReadonlyArray<[RegExp, string]> = [
  [/\bperhaps you could\b/gi, "tell them what to do"],
  [/\byou might want to\b/gi, "tell them what to do"],
  [/\bit might be worth\b/gi, "say whether it is or isn't"],
  [/\bconsider maybe\b/gi, "just say what to consider"],
  [/\byou may wish to\b/gi, "tell them what to do"],
  [/\bit would be advisable\b/gi, "say what to do directly"],
  [/\bone option would be\b/gi, "recommend the best option"],
  [/\bit could be argued\b/gi, "make the argument or don't"],
  [/\bwe should probably\b/gi, "commit: should or shouldn't?"],
  [/\bthere is a possibility\b/gi, "state the possibility directly"],
  [/\bit remains to be seen\b/gi, "say what you don't know yet"],
];

/** Ogilvy clarity check: does the writing make clear what the reader should do? */
export const clarityRule: DisciplineRule= {
  id: "ogilvy-clarity",
  name: "Clarity check",
  description:
    "Flags hedging phrases that obscure what the reader should do. Ogilvy: be crystal clear about the desired action.",
  framework: "ogilvy",
  severity: "warning",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const [pattern, suggestion] of hedgingPhrases) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Hedging: "${match[0]}" — ${suggestion}.`,
          matched: match[0],
          offset: match.index,
          length: match[0].length,
        });
      }
    }
    return findings;
  },
};

// --- Conversational tone ---
/**
 * Detects constructions that nobody would say aloud.
 * Ogilvy: write the way you talk.
 */
const unnaturalConstructions: ReadonlyArray<[RegExp, string]> = [
  [/\bwith respect to the matter of\b/gi, "about"],
  [/\bin light of the foregoing\b/gi, "so"],
  [/\bit should be borne in mind that\b/gi, "remember"],
  [/\bthe question as to whether\b/gi, "whether"],
  [/\bthere is no doubt but that\b/gi, "no doubt"],
  [/\bin a very real sense\b/gi, "cut entirely"],
  [/\bfor all intents and purposes\b/gi, "in effect"],
  [/\bit is incumbent upon\b/gi, "must"],
  [/\bat this juncture\b/gi, "now"],
  [/\bthe foregoing notwithstanding\b/gi, "still"],
];

/** Ogilvy conversational tone: write the way you talk. */
export const conversationalRule: DisciplineRule= {
  id: "ogilvy-conversational",
  name: "Write the way you talk",
  description:
    "Flags constructions nobody would say in conversation. Ogilvy: write the way you talk.",
  framework: "ogilvy",
  severity: "suggestion",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const [pattern, suggestion] of unnaturalConstructions) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Unnatural: "${match[0]}" — try "${suggestion}" instead.`,
          matched: match[0],
          replacement: suggestion,
          offset: match.index,
          length: match[0].length,
        });
      }
    }
    return findings;
  },
};

/** All Ogilvy rules. */
export const ogilvyRules: readonly DisciplineRule[] = [
  paragraphLengthRule,
  clarityRule,
  conversationalRule,
];
