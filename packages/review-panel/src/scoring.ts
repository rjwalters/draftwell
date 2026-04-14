/**
 * Calibrated scoring module for document evaluation.
 *
 * Key insight from autonovel: Without explicit calibration, AI scores collapse
 * to a 2-point band (typically 7-9). Calibration anchors fix this by giving
 * the model concrete reference points for what each score means.
 *
 * Every score requires mandatory weakness identification with quoted evidence
 * from the document — no score without critique.
 */

import type {
  ScoringDimension,
  DimensionScore,
  DocumentScore,
} from "./types.js";

// --- Default Scoring Dimensions ---

export const SCORING_DIMENSIONS: ScoringDimension[] = [
  {
    id: "clarity",
    name: "Clarity",
    description: "How clearly ideas are expressed. Can a reader understand the point on first read?",
    anchors: {
      2: "Most sentences require re-reading. Key terms undefined. Reader constantly lost.",
      4: "Main argument is discernible but buried. Several confusing passages remain.",
      6: "Median AI output. Ideas are understandable but some sections meander or use vague language.",
      8: "Exceptional. A human editor would keep this with minor notes. Every sentence earns its place.",
      10: "Does not exist for a first draft. Reserved for published, professionally edited prose.",
    },
  },
  {
    id: "structure",
    name: "Structure",
    description: "Organization, logical flow, and document architecture.",
    anchors: {
      2: "No discernible organization. Paragraphs could be reordered without effect.",
      4: "Some grouping of related ideas, but transitions are missing and sections feel arbitrary.",
      6: "Median AI output. Has sections and headers but flow is predictable rather than purposeful.",
      8: "Exceptional. Each section builds on the last. Reader never wonders 'why is this here?'",
      10: "Does not exist for a first draft.",
    },
  },
  {
    id: "voice",
    name: "Voice",
    description: "Distinctiveness, consistency of tone, and authorial presence.",
    anchors: {
      2: "Generic corporate/academic tone. Could have been written by any LLM with no prompting.",
      4: "Attempts at voice but inconsistent — shifts register between paragraphs.",
      6: "Median AI output. Competent but unremarkable. Reads like a well-prompted AI.",
      8: "Exceptional. Distinctive voice sustained throughout. Reader can identify the author.",
      10: "Does not exist for a first draft.",
    },
  },
  {
    id: "completeness",
    name: "Completeness",
    description: "Whether the document covers its topic adequately without critical gaps.",
    anchors: {
      2: "Major aspects of the topic are missing. Reads like an outline, not a document.",
      4: "Covers the basics but skips important nuances or counterarguments.",
      6: "Median AI output. Hits the expected points but adds no surprising depth.",
      8: "Exceptional. Anticipates reader questions. Covers edge cases and counterarguments.",
      10: "Does not exist for a first draft.",
    },
  },
  {
    id: "evidence",
    name: "Evidence & Specificity",
    description: "Use of concrete examples, data, and specific details rather than vague assertions.",
    anchors: {
      2: "All assertions, no evidence. 'This is important because it matters.'",
      4: "Some examples but generic. Could apply to any topic in the domain.",
      6: "Median AI output. Has examples but they feel like textbook illustrations, not lived experience.",
      8: "Exceptional. Specific data, concrete examples, original observations that couldn't come from a template.",
      10: "Does not exist for a first draft.",
    },
  },
  {
    id: "concision",
    name: "Concision",
    description: "Economy of expression. Every word earns its place.",
    anchors: {
      2: "Could cut 50%+ without losing meaning. Drowning in filler and redundancy.",
      4: "Noticeably verbose. Many passages restate what was already said.",
      6: "Median AI output. Competent length but with fat that a good editor would trim.",
      8: "Exceptional. Lean prose. Removing any sentence would leave a gap.",
      10: "Does not exist for a first draft.",
    },
  },
];

// --- Calibrated Scoring Prompt ---

/**
 * Build a calibrated scoring prompt for a document.
 *
 * The prompt includes:
 * - Explicit calibration language ("median AI output = 6, an 8 is exceptional")
 * - Anchor points for each dimension
 * - Mandatory weakness identification with quoted evidence
 */
export function buildScoringPrompt(
  document: string,
  dimensions: ScoringDimension[] = SCORING_DIMENSIONS,
): string {
  const dimensionBlocks = dimensions
    .map((dim) => {
      const anchorLines = Object.entries(dim.anchors)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([score, desc]) => `  ${score}: ${desc}`)
        .join("\n");
      return `### ${dim.name} (${dim.id})\n${dim.description}\n\nCalibration anchors:\n${anchorLines}`;
    })
    .join("\n\n");

  return `You are a calibrated document evaluator. Score this document on each dimension below.

CRITICAL CALIBRATION INSTRUCTIONS:
- The median AI-generated document scores a 6. This is the baseline, not a low score.
- An 8 means a human editor would keep it with minor notes. This is exceptional.
- A 10 does not exist for a first draft. Never award a 10.
- Scores of 1-3 indicate serious problems. Scores of 9 are extraordinarily rare.
- If you cannot identify at least one weakness per dimension, your score is too high.
- You MUST quote specific passages from the document as evidence for every weakness.

SCORING DIMENSIONS:

${dimensionBlocks}

RESPONSE FORMAT:
Respond with a JSON object (no markdown fences):
{
  "dimensions": [
    {
      "dimensionId": "<dimension id>",
      "score": <number 1-10>,
      "justification": "<why this score — reference calibration anchors>",
      "weaknesses": [
        {
          "description": "<what is weak>",
          "evidence": "<exact quoted passage from the document>"
        }
      ],
      "strengths": ["<optional: what works well>"]
    }
  ]
}

Every dimension MUST have at least one weakness entry with a direct quote. A score without critique is invalid.

---

DOCUMENT TO EVALUATE:

${document}`;
}

/**
 * Parse the model's scoring response into structured DimensionScores.
 */
export function parseScoringResponse(
  raw: string,
  dimensions: ScoringDimension[] = SCORING_DIMENSIONS,
): DimensionScore[] {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
  const validIds = new Set(dimensions.map((d) => d.id));

  try {
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.dimensions)) {
      return [];
    }

    const scores: DimensionScore[] = [];

    for (const dim of parsed.dimensions) {
      if (!validIds.has(dim.dimensionId)) continue;

      const score = typeof dim.score === "number"
        ? Math.max(1, Math.min(10, Math.round(dim.score)))
        : 6;

      const weaknesses: DimensionScore["weaknesses"] = [];
      if (Array.isArray(dim.weaknesses)) {
        for (const w of dim.weaknesses) {
          if (typeof w.description === "string" && typeof w.evidence === "string") {
            weaknesses.push({
              description: w.description.trim(),
              evidence: w.evidence.trim(),
            });
          }
        }
      }

      scores.push({
        dimensionId: dim.dimensionId,
        score,
        justification: typeof dim.justification === "string"
          ? dim.justification.trim()
          : "",
        weaknesses,
        strengths: Array.isArray(dim.strengths)
          ? dim.strengths.filter((s: unknown) => typeof s === "string")
          : undefined,
      });
    }

    return scores;
  } catch {
    return [];
  }
}

/**
 * Compute weighted overall score from dimension scores.
 * All dimensions are weighted equally by default.
 */
export function computeOverallScore(
  dimensionScores: DimensionScore[],
  weights?: Record<string, number>,
): number {
  if (dimensionScores.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const ds of dimensionScores) {
    const w = weights?.[ds.dimensionId] ?? 1;
    weightedSum += ds.score * w;
    totalWeight += w;
  }

  return totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 10) / 10
    : 0;
}

/**
 * Run a calibrated scoring evaluation of a document.
 *
 * @param document - The document text to evaluate
 * @param documentId - Identifier for the document
 * @param revisionNumber - Which revision is being scored
 * @param callModel - Function to call the judge model
 * @param dimensions - Scoring dimensions (defaults to SCORING_DIMENSIONS)
 * @returns A complete DocumentScore with all dimension scores
 */
export async function scoreDocument(
  document: string,
  documentId: string,
  revisionNumber: number,
  callModel: (prompt: string) => Promise<string>,
  options?: {
    dimensions?: ScoringDimension[];
    weights?: Record<string, number>;
    model?: string;
  },
): Promise<DocumentScore> {
  const dimensions = options?.dimensions ?? SCORING_DIMENSIONS;
  const prompt = buildScoringPrompt(document, dimensions);
  const raw = await callModel(prompt);
  const dimensionScores = parseScoringResponse(raw, dimensions);
  const overallScore = computeOverallScore(dimensionScores, options?.weights);

  return {
    id: `score_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    documentId,
    revisionNumber,
    dimensions: dimensionScores,
    overallScore,
    model: options?.model ?? "unknown",
    createdAt: new Date().toISOString(),
  };
}
