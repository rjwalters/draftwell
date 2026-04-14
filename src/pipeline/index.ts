/**
 * Draftwell revision pipeline.
 *
 * Pipeline stages:
 *   Draft -> Critical Review -> [Adversarial Edit] -> Revision -> Refinement
 *
 * The adversarial edit pass is optional, inserted between review and revision.
 * It identifies passages to cut rather than improve, producing a concrete
 * revision plan based on what should be removed.
 *
 * The revision loop orchestrates iterative cycles with score-gated
 * accept/reject and plateau detection to prevent over-revision.
 */

export {
  adversarialEdit,
  applyCuts,
  computeDistribution,
  formatReport,
  parseAdversarialResponse,
} from "./adversarial-edit";

export {
  buildRevisionScore,
  classifyFeedback,
  compareScores,
  computeCompositeScore,
  computeReviewScore,
  createRevisionLoopState,
  DEFAULT_REVISION_LOOP_CONFIG,
  detectPlateau,
  detectStabilityTrap,
  evaluateRevision,
  analyzeStoppingConditions,
  formatEvaluationSummary,
  formatStoppingRationale,
  invertStyleguideScore,
  recordCycle,
} from "./revision-loop";

export type {
  AdversarialEditConfig,
  AdversarialEditResult,
  CutDistribution,
  CutType,
  PipelineStage,
  ProposedCut,
  RevisionEvaluation,
  RevisionLoopConfig,
  RevisionLoopState,
  RevisionScore,
  ScoreComparison,
  Section,
  StoppingAnalysis,
  StoppingReason,
} from "./types";
