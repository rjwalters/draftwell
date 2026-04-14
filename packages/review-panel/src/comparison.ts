/**
 * Head-to-head comparison module for document versions.
 *
 * Key insight from autonovel: Absolute 1-10 scoring "collapses to a 2-point
 * band regardless of rubric calibration." Forced-choice pairwise comparison
 * produces more reliable rankings. This module implements Elo-style ranking
 * from pairwise comparisons.
 */

import type {
  ComparisonResult,
  EloRating,
  ScoringDimension,
} from "./types.js";
import { SCORING_DIMENSIONS } from "./scoring.js";

/** Default Elo rating for new documents */
const DEFAULT_ELO = 1500;

/** K-factor controls how much ratings change per match */
const K_FACTOR = 32;

/**
 * Build a forced-choice comparison prompt for two document versions.
 * The model must pick a winner — no ties allowed.
 */
export function buildComparisonPrompt(
  documentA: string,
  documentB: string,
  dimensions: ScoringDimension[] = SCORING_DIMENSIONS,
): string {
  const dimensionList = dimensions
    .map((d) => `- **${d.name}** (${d.id}): ${d.description}`)
    .join("\n");

  return `You are comparing two versions of a document. You MUST choose a winner — no ties.

COMPARISON DIMENSIONS:
${dimensionList}

INSTRUCTIONS:
1. Read both versions carefully.
2. For each dimension, decide which version is better and explain why in one sentence.
3. Choose an overall winner based on which version is better across all dimensions.
4. You MUST pick a winner. "They are equal" is not an option. If they seem close, identify the tiebreaker dimension and use it.

RESPONSE FORMAT:
Respond with a JSON object (no markdown fences):
{
  "dimensionWins": [
    {
      "dimensionId": "<dimension id>",
      "winner": "A" or "B",
      "reasoning": "<one sentence explaining why>"
    }
  ],
  "winner": "A" or "B",
  "reasoning": "<overall reasoning for the choice>"
}

---

VERSION A:

${documentA}

---

VERSION B:

${documentB}`;
}

/**
 * Parse the model's comparison response.
 */
export function parseComparisonResponse(
  raw: string,
): { winner: "A" | "B"; dimensionWins: ComparisonResult["dimensionWins"]; reasoning: string } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

  try {
    const parsed = JSON.parse(cleaned);

    const winner = parsed.winner === "A" || parsed.winner === "B"
      ? parsed.winner
      : null;

    if (!winner) return null;

    const dimensionWins: ComparisonResult["dimensionWins"] = [];
    if (Array.isArray(parsed.dimensionWins)) {
      for (const dw of parsed.dimensionWins) {
        if (
          typeof dw.dimensionId === "string" &&
          (dw.winner === "A" || dw.winner === "B") &&
          typeof dw.reasoning === "string"
        ) {
          dimensionWins.push({
            dimensionId: dw.dimensionId,
            winner: dw.winner,
            reasoning: dw.reasoning.trim(),
          });
        }
      }
    }

    return {
      winner,
      dimensionWins,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "",
    };
  } catch {
    return null;
  }
}

/**
 * Run a head-to-head comparison between two document versions.
 */
export async function compareDocuments(
  versionA: { documentId: string; revisionNumber: number; content: string },
  versionB: { documentId: string; revisionNumber: number; content: string },
  callModel: (prompt: string) => Promise<string>,
  options?: {
    dimensions?: ScoringDimension[];
    model?: string;
  },
): Promise<ComparisonResult> {
  const dimensions = options?.dimensions ?? SCORING_DIMENSIONS;
  const prompt = buildComparisonPrompt(versionA.content, versionB.content, dimensions);
  const raw = await callModel(prompt);
  const parsed = parseComparisonResponse(raw);

  if (!parsed) {
    throw new Error("Failed to parse comparison response — model did not return valid JSON with a winner");
  }

  return {
    versionA: { documentId: versionA.documentId, revisionNumber: versionA.revisionNumber },
    versionB: { documentId: versionB.documentId, revisionNumber: versionB.revisionNumber },
    winner: parsed.winner,
    dimensionWins: parsed.dimensionWins,
    reasoning: parsed.reasoning,
    model: options?.model ?? "unknown",
    createdAt: new Date().toISOString(),
  };
}

// --- Elo Rating System ---

/**
 * Calculate expected win probability for player A against player B.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update Elo ratings after a match.
 * Returns new ratings for both players.
 */
export function updateEloRatings(
  ratingA: number,
  ratingB: number,
  winner: "A" | "B",
  kFactor: number = K_FACTOR,
): { newRatingA: number; newRatingB: number } {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  const actualA = winner === "A" ? 1 : 0;
  const actualB = winner === "B" ? 1 : 0;

  return {
    newRatingA: Math.round(ratingA + kFactor * (actualA - expectedA)),
    newRatingB: Math.round(ratingB + kFactor * (actualB - expectedB)),
  };
}

/**
 * Manage Elo ratings for a set of document versions.
 * Tracks ratings in memory; persist externally as needed.
 */
export class EloRanking {
  private ratings: Map<string, EloRating> = new Map();

  private key(documentId: string, revisionNumber: number): string {
    return `${documentId}:${revisionNumber}`;
  }

  /** Get or initialize rating for a document version. */
  getRating(documentId: string, revisionNumber: number): EloRating {
    const k = this.key(documentId, revisionNumber);
    let rating = this.ratings.get(k);
    if (!rating) {
      rating = { documentId, revisionNumber, rating: DEFAULT_ELO, matchesPlayed: 0 };
      this.ratings.set(k, rating);
    }
    return { ...rating };
  }

  /** Record a comparison result and update ratings. */
  recordResult(result: ComparisonResult): { ratingA: EloRating; ratingB: EloRating } {
    const keyA = this.key(result.versionA.documentId, result.versionA.revisionNumber);
    const keyB = this.key(result.versionB.documentId, result.versionB.revisionNumber);

    const ratingA = this.getRating(result.versionA.documentId, result.versionA.revisionNumber);
    const ratingB = this.getRating(result.versionB.documentId, result.versionB.revisionNumber);

    const { newRatingA, newRatingB } = updateEloRatings(
      ratingA.rating,
      ratingB.rating,
      result.winner,
    );

    const updatedA: EloRating = {
      ...ratingA,
      rating: newRatingA,
      matchesPlayed: ratingA.matchesPlayed + 1,
    };
    const updatedB: EloRating = {
      ...ratingB,
      rating: newRatingB,
      matchesPlayed: ratingB.matchesPlayed + 1,
    };

    this.ratings.set(keyA, updatedA);
    this.ratings.set(keyB, updatedB);

    return { ratingA: { ...updatedA }, ratingB: { ...updatedB } };
  }

  /** Get all ratings sorted by rating (highest first). */
  getLeaderboard(): EloRating[] {
    return [...this.ratings.values()]
      .sort((a, b) => b.rating - a.rating);
  }

  /** Export all ratings for persistence. */
  exportRatings(): EloRating[] {
    return [...this.ratings.values()];
  }

  /** Import previously persisted ratings. */
  importRatings(ratings: EloRating[]): void {
    for (const r of ratings) {
      this.ratings.set(this.key(r.documentId, r.revisionNumber), { ...r });
    }
  }
}
