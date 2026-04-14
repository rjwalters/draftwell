import type {
  AggregatedReview,
  Category,
  ConsensusCluster,
  PersonaReview,
  ReviewItem,
  Severity,
} from "./types.js";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  major: 2,
  minor: 1,
  suggestion: 0,
};

/**
 * Compute text similarity between two descriptions using word overlap (Jaccard index).
 * This is a simple heuristic; in production, embeddings would be more accurate.
 */
export function textSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const wordsA = new Set(normalize(a));
  const wordsB = new Set(normalize(b));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/**
 * Check if two review items likely refer to the same issue.
 * Uses category match + text similarity.
 */
export function itemsRelated(a: ReviewItem, b: ReviewItem): boolean {
  // Same persona items are never clustered together
  if (a.personaId === b.personaId) return false;

  const sameCategoryBoost = a.category === b.category ? 0.15 : 0;
  const sameLocationBoost =
    a.location && b.location && a.location === b.location ? 0.1 : 0;
  const descSimilarity = textSimilarity(a.description, b.description);

  return descSimilarity + sameCategoryBoost + sameLocationBoost >= 0.3;
}

/**
 * Get the most common category in a set of items.
 */
function dominantCategory(items: ReviewItem[]): Category {
  const counts = new Map<Category, number>();
  for (const item of items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  let best: Category = "other";
  let bestCount = 0;
  for (const [cat, count] of counts) {
    if (count > bestCount) {
      best = cat;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Get the highest severity in a set of items.
 */
function highestSeverity(items: ReviewItem[]): Severity {
  let best: Severity = "suggestion";
  for (const item of items) {
    if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[best]) {
      best = item.severity;
    }
  }
  return best;
}

/**
 * Build a representative description from clustered items.
 * Uses the most detailed item (longest description) as the representative.
 */
function buildRepresentative(items: ReviewItem[]): string {
  // Pick the longest (most detailed) description
  let best = items[0];
  for (const item of items) {
    if (item.description.length > best.description.length) {
      best = item;
    }
  }
  return best.description;
}

/**
 * Cluster related review items from different personas.
 * Uses greedy single-linkage clustering.
 */
export function clusterItems(
  allItems: ReviewItem[],
  totalPersonas: number,
): ConsensusCluster[] {
  // Track which items have been assigned to a cluster
  const assigned = new Set<number>();
  const clusters: ConsensusCluster[] = [];
  let nextId = 1;

  for (let i = 0; i < allItems.length; i++) {
    if (assigned.has(i)) continue;

    const clusterItems: ReviewItem[] = [allItems[i]];
    assigned.add(i);

    // Find all related items from different personas
    for (let j = i + 1; j < allItems.length; j++) {
      if (assigned.has(j)) continue;

      // Check if this item is related to any item already in the cluster
      const related = clusterItems.some((existing) =>
        itemsRelated(existing, allItems[j]),
      );
      if (related) {
        clusterItems.push(allItems[j]);
        assigned.add(j);
      }
    }

    // Count unique personas in this cluster
    const uniquePersonas = new Set(clusterItems.map((item) => item.personaId));

    clusters.push({
      id: `cluster-${nextId++}`,
      consensusCount: uniquePersonas.size,
      totalPersonas,
      strength: uniquePersonas.size / totalPersonas,
      items: clusterItems,
      representativeDescription: buildRepresentative(clusterItems),
      category: dominantCategory(clusterItems),
      severity: highestSeverity(clusterItems),
    });
  }

  return clusters;
}

/**
 * Aggregate multiple persona reviews into a single structured result.
 *
 * - Clusters related findings across personas
 * - Ranks by consensus strength (4/4 > 3/4 > 2/4 > 1/4)
 * - Separates consensus items from disagreements
 */
export function aggregateReviews(
  reviews: PersonaReview[],
  consensusThreshold = 0.75,
): AggregatedReview {
  const totalPersonas = reviews.length;

  // Collect all items
  const allItems: ReviewItem[] = reviews.flatMap((r) => r.items);

  // Cluster related items
  const clusters = clusterItems(allItems, totalPersonas);

  // Sort by strength (descending), then by severity
  clusters.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });

  // Split into consensus vs disagreements
  const consensusItems = clusters.filter((c) => c.strength >= consensusThreshold);
  const disagreements = clusters.filter((c) => c.strength < consensusThreshold);

  return {
    clusters,
    consensusItems,
    disagreements,
    personaReviews: reviews,
    stats: {
      totalFindings: allItems.length,
      totalClusters: clusters.length,
      consensusCount: consensusItems.length,
      disagreementCount: disagreements.length,
      personaCount: totalPersonas,
    },
  };
}
