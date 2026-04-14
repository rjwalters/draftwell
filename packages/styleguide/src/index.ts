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
