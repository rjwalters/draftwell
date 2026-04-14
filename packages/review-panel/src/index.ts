export type {
  Persona,
  Severity,
  Category,
  ReviewItem,
  PersonaReview,
  ConsensusCluster,
  AggregatedReview,
  ReviewPanelOptions,
} from "./types.js";

export { DEFAULT_PERSONAS, criticalEditor, domainExpert, generalReader, styleReviewer } from "./personas.js";
export { buildPrompt, parseReviewResponse, runPersonaReview, runAllPersonas } from "./runner.js";
export { textSimilarity, itemsRelated, clusterItems, aggregateReviews } from "./aggregator.js";

import type { AggregatedReview, ReviewPanelOptions } from "./types.js";
import { DEFAULT_PERSONAS } from "./personas.js";
import { runAllPersonas } from "./runner.js";
import { aggregateReviews } from "./aggregator.js";

/**
 * Run a full multi-persona review of a document.
 *
 * This is the main entry point. It:
 * 1. Runs each persona independently against the document (in parallel)
 * 2. Aggregates results, clustering related findings
 * 3. Ranks by consensus strength
 * 4. Separates consensus items from disagreements
 *
 * @example
 * ```ts
 * const result = await reviewDocument("# My Document\n...", {
 *   callModel: (prompt) => callClaude(prompt),
 * });
 *
 * // High-priority fixes (most personas agree)
 * for (const item of result.consensusItems) {
 *   console.log(`[${item.consensusCount}/${item.totalPersonas}] ${item.representativeDescription}`);
 * }
 *
 * // Editorial judgment needed (personas disagree)
 * for (const item of result.disagreements) {
 *   console.log(`[${item.consensusCount}/${item.totalPersonas}] ${item.representativeDescription}`);
 * }
 * ```
 */
export async function reviewDocument(
  document: string,
  options: ReviewPanelOptions,
): Promise<AggregatedReview> {
  const personas = options.personas ?? DEFAULT_PERSONAS;
  const threshold = options.consensusThreshold ?? 0.75;

  const reviews = await runAllPersonas(personas, document, options.callModel);
  return aggregateReviews(reviews, threshold);
}
