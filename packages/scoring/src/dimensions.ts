import type { DimensionId, ScoringDimension } from "./types.js";

/**
 * Default scoring dimensions for document review.
 *
 * Each dimension includes calibrated anchor points so evaluators
 * produce consistent, spread-out scores rather than collapsing
 * to a narrow band.
 */
export const DEFAULT_DIMENSIONS: readonly ScoringDimension[] = [
  {
    id: "clarity",
    name: "Clarity",
    description:
      "How clearly ideas are expressed. Sentences parse on first read without ambiguity.",
    anchors: {
      2: "Multiple sentences per paragraph are ambiguous or require re-reading.",
      4: "Most ideas are understandable but several passages are muddled or jargon-heavy without definition.",
      6: "The median AI-written document. Generally clear with occasional vague or overloaded sentences.",
      8: "A human editor would flag only minor phrasing issues. Exceptional clarity throughout.",
      10: "Does not exist for a first draft. Reserved for final publication quality.",
    },
    weight: 0.2,
  },
  {
    id: "structure",
    name: "Structure",
    description:
      "Logical organization: sections flow naturally, hierarchy is consistent, transitions connect ideas.",
    anchors: {
      2: "No discernible organization. Sections seem randomly ordered.",
      4: "Some structure exists but sections overlap or are missing logical transitions.",
      6: "Adequate structure with clear sections. Some transitions feel mechanical or abrupt.",
      8: "Well-organized with purposeful section ordering and smooth transitions.",
      10: "Does not exist for a first draft.",
    },
    weight: 0.15,
  },
  {
    id: "voice",
    name: "Voice & Tone",
    description:
      "Consistent authorial voice. Free of LLM-isms ('delve into', 'it's important to note', 'leverage').",
    anchors: {
      2: "Reads like unedited LLM output. Multiple AI cliches per paragraph.",
      4: "Voice is inconsistent — shifts between formal and casual, or contains several LLM-isms.",
      6: "Mostly consistent voice with occasional lapses. A few detectable AI patterns.",
      8: "Distinctive, consistent voice. A reader would not suspect AI involvement.",
      10: "Does not exist for a first draft.",
    },
    weight: 0.15,
  },
  {
    id: "completeness",
    name: "Completeness",
    description:
      "All claims are supported, all sections promised are delivered, no obvious gaps in coverage.",
    anchors: {
      2: "Major sections are missing or contain only placeholders.",
      4: "Several claims lack support, or promised sections are skeletal.",
      6: "Most topics are covered but some areas lack depth or supporting detail.",
      8: "Thorough coverage. Every claim is backed and every section substantive.",
      10: "Does not exist for a first draft.",
    },
    weight: 0.2,
  },
  {
    id: "accuracy",
    name: "Accuracy",
    description:
      "Factual claims are correct, terminology is used precisely, no contradictions within the document.",
    anchors: {
      2: "Contains multiple factual errors or internal contradictions.",
      4: "Some claims are unverifiable or terminology is misused in places.",
      6: "Generally accurate but a few claims would benefit from verification or precision.",
      8: "All verifiable claims check out. Terminology is precise and consistent.",
      10: "Does not exist for a first draft.",
    },
    weight: 0.15,
  },
  {
    id: "conciseness",
    name: "Conciseness",
    description:
      "No filler, no redundancy. Every sentence advances the document's purpose.",
    anchors: {
      2: "Heavily padded. Many sentences could be removed without losing meaning.",
      4: "Noticeable redundancy — the same point is made multiple ways or filler phrases are common.",
      6: "Some filler or repetition but the document isn't bloated overall.",
      8: "Tight writing. Removing any sentence would lose information.",
      10: "Does not exist for a first draft.",
    },
    weight: 0.05,
  },
  {
    id: "audience-fit",
    name: "Audience Fit",
    description:
      "Content is pitched at the right level for the intended audience — not too basic, not too advanced.",
    anchors: {
      2: "The audience would struggle to follow, or find the content patronizingly basic.",
      4: "Audience mismatch in several sections — jargon without explanation, or over-explanation of basics.",
      6: "Generally appropriate for the audience with occasional misjudgments in depth or tone.",
      8: "Precisely calibrated to the audience. Expert topics are accessible; basics are not belabored.",
      10: "Does not exist for a first draft.",
    },
    weight: 0.1,
  },
] as const;

export function getDimension(id: DimensionId): ScoringDimension | undefined {
  return DEFAULT_DIMENSIONS.find((d) => d.id === id);
}

export function validateWeights(dimensions: readonly ScoringDimension[]): boolean {
  const sum = dimensions.reduce((acc, d) => acc + d.weight, 0);
  return Math.abs(sum - 1.0) < 0.001;
}
