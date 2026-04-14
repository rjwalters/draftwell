// Anti-slop checker types and API
export type {
  Severity,
  PatternCategory,
  StyleguideRule,
  StructuralRule,
  Styleguide,
  CheckResult,
  StructuralCheckResult,
  CheckReport,
} from "./types.js";

export { check } from "./checker.js";
export { defaultStyleguide } from "./rules/index.js";

// Language discipline types and API (Orwell, Zinsser, Ogilvy)
export type {
  Framework,
  Finding,
  DisciplineRule,
  RevisionPass,
  DisciplineResult,
} from "./types.js";

export { checkDiscipline, checkPass, checkAllPasses, allRules } from "./discipline.js";
export { inflatedPhrases, buildPhrasePattern } from "./phrase-table.js";
export {
  orwellRules,
  deadMetaphorRule,
  inflatedPhraseRule,
  shortWordRule,
  activeVoiceRule,
  cutFillerRule,
} from "./rules/orwell.js";
export {
  zinsserRules,
  zinsserPasses,
  clutterRule,
  humanizeRule,
  sentenceLengthRule,
} from "./rules/zinsser.js";
export {
  ogilvyRules,
  paragraphLengthRule,
  clarityRule,
  conversationalRule,
} from "./rules/ogilvy.js";
