/**
 * Score logging for tracking improvement trajectories across revision cycles.
 *
 * Maintains an in-memory log of scores that can be persisted externally
 * (e.g., to D1 or R2). Provides trajectory analysis to show whether
 * revisions are actually improving the document.
 */

import type { DocumentScore, ScoreLogEntry } from "./types.js";

/**
 * In-memory score log that tracks scores across revision cycles.
 * Persist externally via export/import for durability.
 */
export class ScoreLog {
  private entries: ScoreLogEntry[] = [];

  /** Record a document score into the log. */
  record(score: DocumentScore): ScoreLogEntry {
    const entry: ScoreLogEntry = {
      documentId: score.documentId,
      revisionNumber: score.revisionNumber,
      overallScore: score.overallScore,
      dimensionScores: Object.fromEntries(
        score.dimensions.map((d) => [d.dimensionId, d.score]),
      ),
      model: score.model,
      createdAt: score.createdAt,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Get the score trajectory for a document across all logged revisions.
   * Returns entries sorted by revision number (ascending).
   */
  getTrajectory(documentId: string): ScoreLogEntry[] {
    return this.entries
      .filter((e) => e.documentId === documentId)
      .sort((a, b) => a.revisionNumber - b.revisionNumber);
  }

  /**
   * Compute improvement deltas between consecutive revisions.
   * Positive delta = improvement, negative = regression.
   */
  getImprovementDeltas(
    documentId: string,
  ): Array<{
    fromRevision: number;
    toRevision: number;
    overallDelta: number;
    dimensionDeltas: Record<string, number>;
  }> {
    const trajectory = this.getTrajectory(documentId);
    const deltas: Array<{
      fromRevision: number;
      toRevision: number;
      overallDelta: number;
      dimensionDeltas: Record<string, number>;
    }> = [];

    for (let i = 1; i < trajectory.length; i++) {
      const prev = trajectory[i - 1];
      const curr = trajectory[i];

      const dimensionDeltas: Record<string, number> = {};
      const allDimensions = new Set([
        ...Object.keys(prev.dimensionScores),
        ...Object.keys(curr.dimensionScores),
      ]);

      for (const dim of allDimensions) {
        const prevScore = prev.dimensionScores[dim] ?? 0;
        const currScore = curr.dimensionScores[dim] ?? 0;
        dimensionDeltas[dim] = Math.round((currScore - prevScore) * 10) / 10;
      }

      deltas.push({
        fromRevision: prev.revisionNumber,
        toRevision: curr.revisionNumber,
        overallDelta: Math.round((curr.overallScore - prev.overallScore) * 10) / 10,
        dimensionDeltas,
      });
    }

    return deltas;
  }

  /** Export all entries for persistence. */
  exportEntries(): ScoreLogEntry[] {
    return [...this.entries];
  }

  /** Import previously persisted entries. */
  importEntries(entries: ScoreLogEntry[]): void {
    this.entries.push(...entries.map((e) => ({ ...e })));
  }
}
