/**
 * Orwell's language discipline rules from "Politics and the English Language" (1946).
 *
 * Six rules:
 * 1. Never use a metaphor, simile or other figure of speech which you are used to seeing in print.
 * 2. Never use a long word where a short one will do.
 * 3. If it is possible to cut a word out, always cut it out.
 * 4. Never use the passive where you can use the active.
 * 5. Never use a foreign phrase, a scientific word or a jargon word if you can think of an everyday English equivalent.
 * 6. Break any of these rules sooner than say anything outright barbarous.
 */

import type { Finding, DisciplineRule } from "../types.js";
import { buildPhrasePattern, inflatedPhrases } from "../phrase-table.js";

// --- Dead metaphors ---
// Common dead metaphors where the physical image is lost.
const deadMetaphors: readonly string[] = [
  "level playing field",
  "move the goalposts",
  "toe the line",
  "run it up the flagpole",
  "leave no stone unturned",
  "take the bull by the horns",
  "throw the baby out with the bathwater",
  "think outside the box",
  "push the envelope",
  "at the end of the day",
  "the bottom line",
  "behind the curve",
  "ahead of the curve",
  "raise the bar",
  "tip of the iceberg",
  "on the same page",
  "low-hanging fruit",
  "move the needle",
  "open the floodgates",
  "a perfect storm",
  "the elephant in the room",
  "a slippery slope",
  "kick the can down the road",
  "double-edged sword",
  "reinvent the wheel",
  "burning the midnight oil",
  "barking up the wrong tree",
  "break the ice",
  "hit the nail on the head",
  "back to the drawing board",
  "cutting edge",
  "state of the art",
  "game-changer",
  "deep dive",
  "circle back",
  "peel back the onion",
  "boil the ocean",
  "swim lane",
  "paradigm shift",
];

function buildDeadMetaphorPattern(): RegExp {
  const escaped = deadMetaphors.map((m) =>
    m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  escaped.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

/** Rule 1: Dead metaphor test — "Can you picture the physical scene?" */
export const deadMetaphorRule: DisciplineRule= {
  id: "orwell-dead-metaphor",
  name: "Dead metaphor test",
  description:
    'Flags dead metaphors where the physical image is lost. Ask: "Can you picture the physical scene?" If not, replace it.',
  framework: "orwell",
  severity: "warning",
  check(text: string): Finding[] {
    const pattern = buildDeadMetaphorPattern();
    const findings: Finding[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      findings.push({
        ruleId: this.id,
        framework: this.framework,
        severity: this.severity,
        message: `Dead metaphor: "${match[0]}". Can you picture the physical scene? If not, replace with a fresh image or plain language.`,
        matched: match[0],
        offset: match.index,
        length: match[0].length,
      });
    }
    return findings;
  },
};

/** Rule 2 & 5: Verbal false limbs and jargon — inflated phrase lookup. */
export const inflatedPhraseRule: DisciplineRule= {
  id: "orwell-inflated-phrase",
  name: "Verbal false limbs / jargon",
  description:
    "Flags inflated phrases and jargon that have simpler everyday equivalents.",
  framework: "orwell",
  severity: "warning",
  check(text: string): Finding[] {
    const pattern = buildPhrasePattern();
    const findings: Finding[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const plain = inflatedPhrases.get(match[0].toLowerCase());
      findings.push({
        ruleId: this.id,
        framework: this.framework,
        severity: this.severity,
        message: `Inflated phrase: "${match[0]}" -> "${plain}".`,
        matched: match[0],
        replacement: plain,
        offset: match.index,
        length: match[0].length,
      });
    }
    return findings;
  },
};

// --- Long words where short ones will do ---
// Pairs: [long word pattern, short replacement].
const longWordReplacements: ReadonlyArray<[RegExp, string]> = [
  [/\badditionally\b/gi, "also"],
  [/\bconsequently\b/gi, "so"],
  [/\bfurthermore\b/gi, "also"],
  [/\bnevertheless\b/gi, "still"],
  [/\bnotwithstanding\b/gi, "despite"],
  [/\bapproximately\b/gi, "about"],
  [/\bsubsequently\b/gi, "then"],
  [/\bmethodology\b/gi, "method"],
  [/\bdemonstrate\b/gi, "show"],
  [/\bsufficient\b/gi, "enough"],
  [/\bnumerous\b/gi, "many"],
  [/\bpurchase\b/gi, "buy"],
  [/\binquire\b/gi, "ask"],
  [/\bassist\b/gi, "help"],
  [/\battempt\b/gi, "try"],
  [/\brequire\b/gi, "need"],
  [/\bmodify\b/gi, "change"],
  [/\bobtain\b/gi, "get"],
  [/\binitial\b/gi, "first"],
  [/\bremaining\b/gi, "left"],
  [/\bcurrently\b/gi, "now"],
  [/\bpreviously\b/gi, "before"],
];

/** Rule 2: Short word preference. */
export const shortWordRule: DisciplineRule= {
  id: "orwell-short-word",
  name: "Short word preference",
  description: "Never use a long word where a short one will do.",
  framework: "orwell",
  severity: "suggestion",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const [pattern, replacement] of longWordReplacements) {
      let match: RegExpExecArray | null;
      // Reset lastIndex for each pattern since we reuse them.
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Consider shorter word: "${match[0]}" -> "${replacement}".`,
          matched: match[0],
          replacement,
          offset: match.index,
          length: match[0].length,
        });
      }
    }
    return findings;
  },
};

// --- Passive voice detection ---
// Simple heuristic: auxiliary "be" forms + past participle pattern (word ending in -ed).
// This won't catch irregular past participles, but avoids false positives.
const passivePattern =
  /\b(is|are|was|were|be|been|being)\s+(\w+ed)\b/gi;

/** Rule 4: Active voice preference. */
export const activeVoiceRule: DisciplineRule= {
  id: "orwell-active-voice",
  name: "Active voice preference",
  description: "Prefer active over passive construction.",
  framework: "orwell",
  severity: "suggestion",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    let match: RegExpExecArray | null;
    passivePattern.lastIndex = 0;
    while ((match = passivePattern.exec(text)) !== null) {
      // Skip common false positives where the -ed word is typically an adjective.
      const participle = match[2].toLowerCase();
      if (adjectiveExceptions.has(participle)) continue;
      findings.push({
        ruleId: this.id,
        framework: this.framework,
        severity: this.severity,
        message: `Possible passive voice: "${match[0]}". Consider rewriting in active voice.`,
        matched: match[0],
        offset: match.index,
        length: match[0].length,
      });
    }
    return findings;
  },
};

const adjectiveExceptions = new Set([
  "interested",
  "excited",
  "pleased",
  "tired",
  "bored",
  "concerned",
  "surprised",
  "confused",
  "satisfied",
  "disappointed",
  "embarrassed",
  "overwhelmed",
  "married",
  "related",
  "based",
  "focused",
  "dedicated",
  "committed",
  "limited",
  "required",
  "expected",
  "supposed",
  "allowed",
  "located",
  "designed",
  "intended",
]);

// --- Filler words and phrases (Rule 3: Cut what adds nothing) ---
const fillerPatterns: ReadonlyArray<[RegExp, string]> = [
  [/\bvery\b/gi, "very"],
  [/\breally\b/gi, "really"],
  [/\bquite\b/gi, "quite"],
  [/\bjust\b/gi, "just"],
  [/\bsimply\b/gi, "simply"],
  [/\bbasically\b/gi, "basically"],
  [/\bactually\b/gi, "actually"],
  [/\bessentially\b/gi, "essentially"],
  [/\bliterally\b/gi, "literally"],
  [/\bdefinitely\b/gi, "definitely"],
  [/\babsolutely\b/gi, "absolutely"],
  [/\bit should be noted that\b/gi, "it should be noted that"],
  [/\bit is worth noting that\b/gi, "it is worth noting that"],
  [/\bit is important to note that\b/gi, "it is important to note that"],
  [/\bneedless to say\b/gi, "needless to say"],
  [/\bit goes without saying\b/gi, "it goes without saying"],
  [/\bas a matter of fact\b/gi, "as a matter of fact"],
  [/\bin my opinion\b/gi, "in my opinion"],
  [/\ball things considered\b/gi, "all things considered"],
  [/\bfirst and foremost\b/gi, "first and foremost"],
];

/** Rule 3: Cut filler — if a word doesn't earn its place, remove it. */
export const cutFillerRule: DisciplineRule= {
  id: "orwell-cut-filler",
  name: "Cut what adds nothing",
  description:
    "Flags filler words and phrases that can usually be removed without changing meaning.",
  framework: "orwell",
  severity: "suggestion",
  check(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const [pattern, label] of fillerPatterns) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          ruleId: this.id,
          framework: this.framework,
          severity: this.severity,
          message: `Filler: "${label}" can probably be cut without losing meaning.`,
          matched: match[0],
          offset: match.index,
          length: match[0].length,
        });
      }
    }
    return findings;
  },
};

/** All Orwell rules. */
export const orwellRules: readonly DisciplineRule[] = [
  deadMetaphorRule,
  inflatedPhraseRule,
  shortWordRule,
  activeVoiceRule,
  cutFillerRule,
];
