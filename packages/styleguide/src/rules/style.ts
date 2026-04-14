import type { StyleguideRule, StructuralRule } from "../types.js";

/**
 * Style pattern rules: formatting and structural tells.
 * Sources: writewell SKILL.md, autonovel ANTI-PATTERNS.md
 */

export const styleRules: StyleguideRule[] = [
  // -- Bold abuse --
  {
    id: "style-bold-abuse",
    description: "Excessive bold formatting for emphasis (AI writing tell)",
    severity: "warning",
    category: "style",
    pattern: "\\*\\*[^*]{1,80}\\*\\*",
    suggestion: "Reserve bold for headings and key terms. Let word choice carry emphasis.",
  },

  // -- Emoji in prose --
  {
    id: "style-emoji-in-prose",
    description: "Emoji used in prose text (chatbot style)",
    severity: "warning",
    category: "style",
    pattern: "[\\u{1F600}-\\u{1F64F}\\u{1F300}-\\u{1F5FF}\\u{1F680}-\\u{1F6FF}\\u{1F1E0}-\\u{1F1FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]",
    flags: "gu",
    suggestion: "Remove emoji from prose. Use words instead.",
  },

  // -- Rhetorical question openers --
  {
    id: "style-rhetorical-question-opener",
    description: "Section starting with a rhetorical question (AI pattern)",
    severity: "warning",
    category: "style",
    pattern: "(?:^|\\n)#{1,6} .+\\n+(?:Have you ever|What if|Did you know|Ever wondered|Isn't it|Wouldn't it|Could it be|How (?:often|many|much)|Why (?:do|does|is|are|would|should))[^?]*\\?",
    flags: "gm",
    suggestion: "Start sections with a statement, not a question.",
  },

  // -- Copula avoidance (showing off vocabulary instead of using 'is/was') --
  {
    id: "style-copula-avoidance",
    description: "Using elaborate verbs to avoid simple 'is/was' (AI pattern)",
    severity: "info",
    category: "style",
    pattern: "\\b(?:constitutes|represents|embodies|exemplifies|epitomizes|encapsulates|encompasses)\\b",
    suggestion: "Consider whether 'is' or 'was' would be clearer.",
  },

  // -- Synonym cycling (using a different word for the same concept each time) --
  // This is hard to detect mechanically, but we can flag some common patterns
  {
    id: "style-thesaurus-abuse",
    description: "Unnecessarily elaborate word choice (possible synonym cycling)",
    severity: "info",
    category: "style",
    pattern: "\\b(?:commence|endeavor|facilitate|aforementioned|henceforth|therein|whereby|inasmuch)\\b",
    suggestion: "Use simpler, more natural language.",
  },

  // -- Excessive em-dash usage (individual instances flagged; density checked structurally) --
  {
    id: "style-em-dash",
    description: "Em dash usage (fine individually, AI-sounding when overused)",
    severity: "info",
    category: "style",
    pattern: "\\u2014|---?(?!-)",
    flags: "g",
    suggestion: "Em dashes are fine in moderation. If overused, replace some with commas, parentheses, or separate sentences.",
  },
];

/**
 * Structural rules: document-level pattern analysis.
 * Sources: autonovel ANTI-PATTERNS.md (12 structural AI failure modes)
 */
export const structuralRules: StructuralRule[] = [
  {
    id: "structural-em-dash-density",
    description: "Too many em dashes per 1000 words indicates AI writing",
    severity: "warning",
    category: "structural",
    type: "em-dash-density",
    threshold: 5, // more than 5 em dashes per 1000 words
    suggestion: "Reduce em dash usage. Replace some with commas, parentheses, or restructure sentences.",
  },
  {
    id: "structural-sentence-uniformity",
    description: "Sentences are too uniform in length (AI tends to produce same-length sentences)",
    severity: "warning",
    category: "structural",
    type: "sentence-length-uniformity",
    threshold: 0.15, // coefficient of variation below 0.15 = too uniform
    suggestion: "Vary sentence length. Mix short punchy sentences with longer ones.",
  },
  {
    id: "structural-triadic-listing",
    description: "Excessive use of three-item lists/series (AI default pattern)",
    severity: "warning",
    category: "structural",
    type: "triadic-listing",
    threshold: 3, // more than 3 triadic patterns per 1000 words
    suggestion: "Vary list lengths. Use two items, four items, or restructure as prose.",
  },
  {
    id: "structural-balanced-antithesis",
    description: "Excessive balanced antithetical constructions (AI rhetorical pattern)",
    severity: "info",
    category: "structural",
    type: "balanced-antithesis",
    threshold: 2, // more than 2 per 1000 words
    suggestion: "Reduce symmetrical contrast patterns. Express ideas asymmetrically.",
  },
  {
    id: "structural-show-dont-tell",
    description: "Telling emotions/significance instead of showing them",
    severity: "warning",
    category: "structural",
    type: "show-dont-tell",
    threshold: 3, // more than 3 violations per 1000 words
    suggestion: "Show through action, detail, and consequence rather than stating emotions or significance.",
  },
  {
    id: "structural-excessive-hedging",
    description: "Too many hedging phrases weakening the prose",
    severity: "warning",
    category: "structural",
    type: "excessive-hedging",
    threshold: 4, // more than 4 hedges per 1000 words
    suggestion: "Commit to your statements. Remove hedges and state claims directly.",
  },
];
