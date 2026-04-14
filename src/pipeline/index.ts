/**
 * Draftwell revision pipeline.
 *
 * Pipeline stages:
 *   Draft -> Critical Review -> [Adversarial Edit] -> Revision -> Refinement
 *
 * The adversarial edit pass is optional, inserted between review and revision.
 * It identifies passages to cut rather than improve, producing a concrete
 * revision plan based on what should be removed.
 */

export {
  adversarialEdit,
  applyCuts,
  computeDistribution,
  formatReport,
  parseAdversarialResponse,
} from "./adversarial-edit";

export type {
  AdversarialEditConfig,
  AdversarialEditResult,
  CutDistribution,
  CutType,
  PipelineStage,
  ProposedCut,
  Section,
} from "./types";
