/**
 * Zinsser's clutter removal system from "On Writing Well".
 *
 * Three revision passes:
 * 1. Cut filler — aim for 20-30% word reduction.
 * 2. Clarify and humanize — "Would I say this aloud to a smart friend?"
 * 3. Reader test — read aloud, fix stumbles, trim opening and closing.
 */

import type { Finding, RevisionPass, DisciplineRule } from "../types.js";

// --- Pass 1: Clutter detection ---

/** Redundant pairs where one word does the work of two. */
const redundantPairs: ReadonlyArray<[RegExp, string]> = [
  [/\beach and every\b/gi, "each"],
  [/\bfirst and foremost\b/gi, "first"],
  [/\bany and all\b/gi, "all"],
  [/\bvarious and sundry\b/gi, "various"],
  [/\bhope and trust\b/gi, "trust"],
  [/\bnull and void\b/gi, "void"],
  [/\bfull and complete\b/gi, "complete"],
  [/\btrue and accurate\b/gi, "accurate"],
  [/\bbasic and fundamental\b/gi, "fundamental"],
  [/\bplain and simple\b/gi, "simple"],
];

/** Wordy qualifiers that add bulk without meaning. */
const wordyQualifiers: ReadonlyArray<[RegExp, string]> = [
  [/\ba bit\b/gi, "a bit"],
  [/\bkind of\b/gi, "kind of"],
  [/\bsort of\b/gi, "sort of"],
  [/\btype of\b/gi, "type of"],
  [/\bin terms of\b/gi, "in terms of"],
  [/\bthe fact that\b/gi, "the fact that"],
  [/\bwhat I mean is\b/gi, "what I mean is"],
  [/\bwhat I'm saying is\b/gi, "what I'm saying is"],
  [/\bif you will\b/gi, "if you will"],
  [/\bas it were\b/gi, "as it were"],
  [/\bso to speak\b/gi, "so to speak"],
];

/** Pass 1 rule: Cut clutter. */
export const clutterRule: DisciplineRule= {
  id: "zinsser-clutter",
  name: "Cut the clutter",
  description:
    "Flags redundant pairs, wordy qualifiers, and padded phrases. Aim for 20-30% word reduction.",
  framework: "zinsser",
  severity: "warning",
  check(text: string): Finding[] {
    const findings: Finding[] = [];

    for (const [pattern, replacement] of redundantPairs) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Redundant pair: "${match[0]}" -> "${replacement}".`,
          matched: match[0],
          replacement,
          offset: match.index,
          length: match[0].length,
        });
      }
    }

    for (const [pattern, label] of wordyQualifiers) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Wordy qualifier: "${label}" — can you cut it?`,
          matched: match[0],
          offset: match.index,
          length: match[0].length,
        });
      }
    }

    return findings;
  },
};

// --- Pass 2: Humanize check ---

/**
 * Detects overly formal or stiff constructions that fail the
 * "Would I say this aloud to a smart friend?" test.
 */
const stiffConstructions: ReadonlyArray<[RegExp, string]> = [
  [/\bit is widely recognized that\b/gi, "drop — just state the claim"],
  [/\bit has been established that\b/gi, "drop — just state the claim"],
  [/\bone might argue that\b/gi, "drop — just state the argument"],
  [/\bit can be observed that\b/gi, "drop — just state the observation"],
  [/\bit is generally accepted that\b/gi, "drop — just state the claim"],
  [
    /\bthe aforementioned\b/gi,
    'use a specific reference ("that module", "the parser")',
  ],
  [/\bherein\b/gi, "here"],
  [/\btherein\b/gi, "there"],
  [/\bwherein\b/gi, "where"],
  [/\bthereby\b/gi, "so"],
  [/\bhitherto\b/gi, "until now"],
  [/\bnotwithstanding\b/gi, "despite"],
  [/\binasmuch as\b/gi, "since"],
  [/\binsofar as\b/gi, "as far as"],
];

/** Pass 2 rule: Humanize stiff writing. */
export const humanizeRule: DisciplineRule= {
  id: "zinsser-humanize",
  name: "Clarify and humanize",
  description:
    'Flags overly formal constructions. Test: "Would I say this aloud to a smart friend?"',
  framework: "zinsser",
  severity: "suggestion",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const [pattern, suggestion] of stiffConstructions) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Stiff construction: "${match[0]}" — ${suggestion}.`,
          matched: match[0],
          offset: match.index,
          length: match[0].length,
        });
      }
    }
    return findings;
  },
};

// --- Pass 3: Reader test (structural checks) ---

/** Sentence length threshold (words). Sentences over this tend to cause stumbles. */
const MAX_SENTENCE_WORDS = 35;

/** Pass 3 rule: Long sentence detection (read-aloud stumble proxy). */
export const sentenceLengthRule: DisciplineRule= {
  id: "zinsser-sentence-length",
  name: "Reader test: sentence length",
  description:
    "Flags sentences over 35 words — a proxy for the read-aloud stumble test.",
  framework: "zinsser",
  severity: "suggestion",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    // Split on sentence-ending punctuation followed by space or end.
    const sentences = text.split(/(?<=[.!?])\s+/);
    let offset = 0;
    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/).filter(Boolean);
      if (words.length > MAX_SENTENCE_WORDS) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Long sentence (${words.length} words). Try breaking it up — read it aloud and split where you pause.`,
          matched: sentence.slice(0, 80) + (sentence.length > 80 ? "..." : ""),
          offset,
          length: sentence.length,
        });
      }
      offset += sentence.length + 1; // +1 for the split separator
    }
    return findings;
  },
};

/** All Zinsser rules. */
export const zinsserRules: readonly DisciplineRule[] = [
  clutterRule,
  humanizeRule,
  sentenceLengthRule,
];

/**
 * Zinsser's three-pass revision structure.
 * Each pass specifies which rules to apply, forming a progressive
 * revision mode option for the review pipeline.
 */
export const zinsserPasses: readonly RevisionPass[] = [
  {
    id: "zinsser-pass-1",
    name: "Cut filler",
    goal: "Aim for 20-30% word reduction. Remove every word that doesn't earn its place.",
    ruleIds: [
      "zinsser-clutter",
      "orwell-cut-filler",
      "orwell-inflated-phrase",
    ],
  },
  {
    id: "zinsser-pass-2",
    name: "Clarify and humanize",
    goal: 'Would you say this aloud to a smart friend? Replace stiff constructions with natural language.',
    ruleIds: [
      "zinsser-humanize",
      "orwell-active-voice",
      "orwell-short-word",
    ],
  },
  {
    id: "zinsser-pass-3",
    name: "Reader test",
    goal: "Read aloud. Fix stumbles. Trim opening and closing. Check sentence length.",
    ruleIds: ["zinsser-sentence-length", "orwell-dead-metaphor"],
  },
];
