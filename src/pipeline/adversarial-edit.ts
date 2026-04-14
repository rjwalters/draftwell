/**
 * Adversarial editing pass for the Draftwell revision pipeline.
 *
 * Implements autonovel's technique: ask the LLM to identify what to *remove*
 * from a document, classified by cut type. The cut list IS the revision plan.
 *
 * Key insight: Asking "cut N words" produces more actionable feedback than
 * "improve this document." The cut classifications map directly to revision
 * actions.
 */

import type {
  AdversarialEditConfig,
  AdversarialEditResult,
  CutDistribution,
  CutType,
  ProposedCut,
} from "./types";

const CUT_TYPES: CutType[] = [
  "OVER-EXPLAIN",
  "REDUNDANT",
  "FAT",
  "TELL",
  "STRUCTURAL",
  "GENERIC",
];

const DEFAULT_CONFIG: Omit<AdversarialEditConfig, "apiKey"> = {
  targetCuts: 15,
  targetWordsCut: 500,
  model: "claude-sonnet-4-20250514",
  baseUrl: "https://api.anthropic.com",
};

function buildPrompt(document: string, config: AdversarialEditConfig): string {
  return `You are a ruthless editor. Your job is to identify passages that should be CUT from this document. You are not rewriting — you are identifying what to remove.

Propose exactly ${config.targetCuts} passages to cut, targeting approximately ${config.targetWordsCut} words total. For each cut, classify it as one of these types:

- **OVER-EXPLAIN**: The passage explains something the reader already understands or restates what was just said in different words. (~32% of typical cuts)
- **REDUNDANT**: The same idea appears elsewhere in the document. This passage adds nothing new. (~26% of typical cuts)
- **FAT**: Unnecessary words, filler phrases, or verbose constructions that can be trimmed without losing meaning.
- **TELL**: The passage tells the reader something instead of showing it. Assertions without evidence or illustration.
- **STRUCTURAL**: Organizational problems — sections in the wrong order, unnecessary transitions, headers that don't earn their keep.
- **GENERIC**: This passage could appear in any document on this topic. It contains no specific insight, data, or original thought.

For each proposed cut, respond with this exact format:

CUT <number>
TYPE: <one of: OVER-EXPLAIN, REDUNDANT, FAT, TELL, STRUCTURAL, GENERIC>
SECTION: <the heading or location where this passage appears>
PASSAGE: """<exact quoted text to cut>"""
REASON: <one sentence explaining why this should be cut>
WORDS: <word count of the passage>

---

Here is the document to edit:

${document}`;
}

function generateCutId(): string {
  return `cut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Parse the LLM response into structured ProposedCut objects. */
export function parseAdversarialResponse(response: string): ProposedCut[] {
  const cuts: ProposedCut[] = [];
  const cutBlocks = response.split(/^CUT\s+\d+/m).filter((b) => b.trim());

  for (const block of cutBlocks) {
    const typeMatch = block.match(/^TYPE:\s*(.+)$/m);
    const sectionMatch = block.match(/^SECTION:\s*(.+)$/m);
    const passageMatch = block.match(/PASSAGE:\s*"""([\s\S]*?)"""/);
    const reasonMatch = block.match(/^REASON:\s*(.+)$/m);
    const wordsMatch = block.match(/^WORDS:\s*(\d+)/m);

    if (!typeMatch || !passageMatch) continue;

    const rawType = typeMatch[1].trim().toUpperCase() as CutType;
    if (!CUT_TYPES.includes(rawType)) continue;

    const passage = passageMatch[1].trim();

    cuts.push({
      id: generateCutId(),
      type: rawType,
      passage,
      reason: reasonMatch?.[1]?.trim() ?? "",
      section: sectionMatch?.[1]?.trim() ?? "",
      wordCount: wordsMatch ? parseInt(wordsMatch[1], 10) : countWords(passage),
      status: "pending",
    });
  }

  return cuts;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Compute cut type distribution from a list of cuts. */
export function computeDistribution(cuts: ProposedCut[]): CutDistribution {
  const dist: CutDistribution = {
    "OVER-EXPLAIN": 0,
    REDUNDANT: 0,
    FAT: 0,
    TELL: 0,
    STRUCTURAL: 0,
    GENERIC: 0,
  };

  for (const cut of cuts) {
    dist[cut.type]++;
  }

  return dist;
}

/** Call the Claude API to perform the adversarial edit pass. */
async function callClaude(
  prompt: string,
  config: AdversarialEditConfig,
): Promise<string> {
  const baseUrl = config.baseUrl ?? DEFAULT_CONFIG.baseUrl;
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("No text content in Claude API response");
  }

  return textBlock.text;
}

/**
 * Run the adversarial edit pass on a document.
 *
 * This is the main entry point. It sends the document to Claude with
 * instructions to identify passages to cut, parses the response into
 * structured cuts, and computes the quality distribution.
 */
export async function adversarialEdit(
  document: string,
  documentId: string,
  config: Partial<AdversarialEditConfig> & { apiKey: string },
): Promise<AdversarialEditResult> {
  const fullConfig: AdversarialEditConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const prompt = buildPrompt(document, fullConfig);
  const response = await callClaude(prompt, fullConfig);
  const cuts = parseAdversarialResponse(response);
  const distribution = computeDistribution(cuts);
  const totalWordsProposed = cuts.reduce((sum, c) => sum + c.wordCount, 0);

  return {
    documentId,
    cuts,
    distribution,
    totalWordsProposed,
    model: fullConfig.model,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Apply accepted cuts to a document by removing the accepted passages.
 * Returns the modified document text.
 */
export function applyCuts(
  document: string,
  cuts: ProposedCut[],
): string {
  const accepted = cuts.filter((c) => c.status === "accepted");

  // Sort by passage length descending to avoid offset issues
  // when removing longer passages that might contain shorter ones
  const sorted = [...accepted].sort(
    (a, b) => b.passage.length - a.passage.length,
  );

  let result = document;
  for (const cut of sorted) {
    result = result.replace(cut.passage, "");
  }

  // Clean up double blank lines left by removals
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/**
 * Format the adversarial edit result as a human-readable report.
 */
export function formatReport(result: AdversarialEditResult): string {
  const lines: string[] = [];

  lines.push("# Adversarial Edit Report");
  lines.push("");
  lines.push(
    `**${result.cuts.length} passages identified** | ~${result.totalWordsProposed} words proposed for cutting`,
  );
  lines.push("");

  // Distribution summary
  lines.push("## Cut Type Distribution");
  lines.push("");
  const total = result.cuts.length || 1;
  for (const type of CUT_TYPES) {
    const count = result.distribution[type];
    const pct = Math.round((count / total) * 100);
    lines.push(`- **${type}**: ${count} (${pct}%)`);
  }
  lines.push("");

  // Individual cuts
  lines.push("## Proposed Cuts");
  lines.push("");
  for (let i = 0; i < result.cuts.length; i++) {
    const cut = result.cuts[i];
    lines.push(`### Cut ${i + 1}: ${cut.type}`);
    lines.push("");
    lines.push(`**Section**: ${cut.section}`);
    lines.push(`**Words**: ${cut.wordCount}`);
    lines.push(`**Status**: ${cut.status}`);
    lines.push("");
    lines.push(`> ${cut.passage.replace(/\n/g, "\n> ")}`);
    lines.push("");
    lines.push(`*${cut.reason}*`);
    lines.push("");
  }

  return lines.join("\n");
}
