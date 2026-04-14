import type { Styleguide } from "../types.js";
import { bannedPhrases } from "./phrases.js";
import { overusedWords } from "./words.js";
import { styleRules, structuralRules } from "./style.js";

/**
 * Default draftwell styleguide.
 * Merges content from writewell's AI pattern catalogue and autonovel's
 * tiered anti-slop lists.
 */
export const defaultStyleguide: Styleguide = {
  name: "draftwell-default",
  version: "0.1.0",
  rules: [...bannedPhrases, ...overusedWords, ...styleRules],
  structuralRules,
};
