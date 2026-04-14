/**
 * Document parsing, section extraction, chunking, and token estimation
 * for the AI review pipeline.
 */

export interface Section {
  heading: string;
  level: number;
  content: string;
  startLine: number;
}

export interface Chunk {
  sections: Section[];
  text: string;
  estimatedTokens: number;
}

/**
 * Rough token estimation: ~4 characters per token for English text.
 * This is a conservative estimate that works well enough for chunking decisions.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Parse a markdown document into sections based on heading structure.
 * Returns sections with their heading, level, and content.
 */
export function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  const contentLines: string[] = [];

  function flushSection() {
    if (currentSection) {
      currentSection.content = contentLines.join("\n").trim();
      if (currentSection.content || currentSection.heading) {
        sections.push(currentSection);
      }
      contentLines.length = 0;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      flushSection();
      currentSection = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        content: "",
        startLine: i + 1,
      };
    } else {
      if (!currentSection) {
        // Content before any heading goes into an implicit top-level section
        currentSection = {
          heading: "",
          level: 0,
          content: "",
          startLine: 1,
        };
      }
      contentLines.push(line);
    }
  }

  flushSection();
  return sections;
}

/**
 * Chunk sections into groups that fit within a token budget.
 * Each chunk contains one or more consecutive sections.
 */
export function chunkSections(sections: Section[], maxTokensPerChunk: number = 6000): Chunk[] {
  if (sections.length === 0) return [];

  const chunks: Chunk[] = [];
  let currentSections: Section[] = [];
  let currentText = "";
  let currentTokens = 0;

  for (const section of sections) {
    const sectionText = section.heading
      ? `${"#".repeat(section.level)} ${section.heading}\n\n${section.content}`
      : section.content;
    const sectionTokens = estimateTokens(sectionText);

    // If a single section exceeds the budget, it gets its own chunk
    if (sectionTokens > maxTokensPerChunk) {
      // Flush current chunk if any
      if (currentSections.length > 0) {
        chunks.push({
          sections: currentSections,
          text: currentText.trim(),
          estimatedTokens: currentTokens,
        });
      }
      chunks.push({
        sections: [section],
        text: sectionText.trim(),
        estimatedTokens: sectionTokens,
      });
      currentSections = [];
      currentText = "";
      currentTokens = 0;
      continue;
    }

    // Check if adding this section would exceed the budget
    if (currentTokens + sectionTokens > maxTokensPerChunk && currentSections.length > 0) {
      chunks.push({
        sections: currentSections,
        text: currentText.trim(),
        estimatedTokens: currentTokens,
      });
      currentSections = [];
      currentText = "";
      currentTokens = 0;
    }

    currentSections.push(section);
    currentText += `\n\n${sectionText}`;
    currentTokens += sectionTokens;
  }

  // Flush remaining
  if (currentSections.length > 0) {
    chunks.push({
      sections: currentSections,
      text: currentText.trim(),
      estimatedTokens: currentTokens,
    });
  }

  return chunks;
}

/** Severity levels matching the review_items DB schema */
export type ReviewSeverity = "error" | "warning" | "suggestion";

/** A structured review item from the AI */
export interface ReviewItemResult {
  category: string;
  description: string;
  severity: ReviewSeverity;
  location: string | null;
  suggestion: string | null;
}

/** Result from a review generation call */
export interface ReviewResult {
  summary: string;
  items: ReviewItemResult[];
}

const VALID_SEVERITIES = new Set(["error", "warning", "suggestion"]);

/**
 * Build the system prompt for critical review.
 */
export function buildReviewPrompt(
  documentChunk: string,
  chunkIndex: number,
  totalChunks: number,
): string {
  const chunkContext =
    totalChunks > 1
      ? `\n\nThis is chunk ${chunkIndex + 1} of ${totalChunks}. Focus your review on this section.`
      : "";

  return `You are a rigorous critical reviewer. Analyze the following document and produce a structured critique.

For each issue found, classify it with:
- **category**: one of: structure, clarity, accuracy, completeness, readability, consistency, terminology, tone, style, flow, engagement, other
- **severity**: one of: error (factual/logical mistakes), warning (significant issues), suggestion (improvements)
- **location**: the section heading or line reference where the issue occurs
- **description**: clear explanation of the issue
- **suggestion**: how to fix it

Respond with a JSON object (no markdown fences):
{
  "summary": "Overall assessment in 2-3 sentences",
  "items": [
    {
      "category": "clarity",
      "severity": "warning",
      "location": "Section name",
      "description": "What the issue is",
      "suggestion": "How to fix it"
    }
  ]
}${chunkContext}

---

${documentChunk}`;
}

/**
 * Parse the AI response into structured review items.
 */
export function parseReviewResponse(raw: string): ReviewResult {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

  try {
    const parsed = JSON.parse(cleaned);
    const summary = typeof parsed.summary === "string" ? parsed.summary : "Review completed.";
    const items: ReviewItemResult[] = [];

    if (Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        if (typeof item.description !== "string" || !item.description.trim()) continue;
        items.push({
          category: typeof item.category === "string" ? item.category : "other",
          description: item.description.trim(),
          severity: VALID_SEVERITIES.has(item.severity)
            ? (item.severity as ReviewSeverity)
            : "suggestion",
          location: typeof item.location === "string" ? item.location : null,
          suggestion: typeof item.suggestion === "string" ? item.suggestion : null,
        });
      }
    }

    return { summary, items };
  } catch {
    return {
      summary: "Review completed (unstructured response).",
      items: [
        {
          category: "other",
          description: raw.trim(),
          severity: "suggestion",
          location: null,
          suggestion: null,
        },
      ],
    };
  }
}

/**
 * Build the prompt for generating a revision.
 */
export function buildRevisionPrompt(
  document: string,
  reviewItems: Array<{
    id: string;
    category: string;
    description: string;
    severity: string;
    location: string | null;
  }>,
): string {
  const itemList = reviewItems
    .map(
      (item, i) =>
        `${i + 1}. [${item.severity}] ${item.category}: ${item.description}${item.location ? ` (at: ${item.location})` : ""}`,
    )
    .join("\n");

  return `You are a skilled editor. Revise the following document to address the review items listed below.

For each review item, either:
- Address it fully (make the fix)
- Partially address it (if a full fix would compromise other aspects)
- Leave it unaddressed (if you disagree or it's not actionable)

After the revised document, provide a JSON change summary.

Respond in this exact format:

REVISED_DOCUMENT_START
[your revised document here]
REVISED_DOCUMENT_END

CHANGE_SUMMARY_START
{
  "changes": [
    {
      "reviewItemIndex": 1,
      "status": "addressed|partial|not_addressed",
      "explanation": "What you changed and why"
    }
  ],
  "overallSummary": "Brief description of key changes made"
}
CHANGE_SUMMARY_END

Review items to address:
${itemList}

---

Document to revise:

${document}`;
}

/** Result of a revision */
export interface RevisionResult {
  revisedDocument: string;
  changes: Array<{
    reviewItemIndex: number;
    status: "addressed" | "partial" | "not_addressed";
    explanation: string;
  }>;
  overallSummary: string;
}

/**
 * Parse the revision response into structured output.
 */
export function parseRevisionResponse(raw: string): RevisionResult {
  const docMatch = raw.match(/REVISED_DOCUMENT_START\s*\n([\s\S]*?)\nREVISED_DOCUMENT_END/);
  const summaryMatch = raw.match(/CHANGE_SUMMARY_START\s*\n([\s\S]*?)\nCHANGE_SUMMARY_END/);

  const revisedDocument = docMatch ? docMatch[1].trim() : raw.trim();
  let changes: RevisionResult["changes"] = [];
  let overallSummary = "Revision completed.";

  if (summaryMatch) {
    try {
      const parsed = JSON.parse(summaryMatch[1].trim());
      if (Array.isArray(parsed.changes)) {
        changes = parsed.changes.map((c: Record<string, unknown>) => ({
          reviewItemIndex: typeof c.reviewItemIndex === "number" ? c.reviewItemIndex : 0,
          status: ["addressed", "partial", "not_addressed"].includes(c.status as string)
            ? (c.status as "addressed" | "partial" | "not_addressed")
            : "not_addressed",
          explanation: typeof c.explanation === "string" ? c.explanation : "",
        }));
      }
      if (typeof parsed.overallSummary === "string") {
        overallSummary = parsed.overallSummary;
      }
    } catch {
      // If JSON parsing fails, use defaults
    }
  }

  return { revisedDocument, changes, overallSummary };
}

/**
 * Build the refinement prompt (focuses on remaining open/partial items).
 */
export function buildRefinementPrompt(
  document: string,
  openItems: Array<{
    id: string;
    category: string;
    description: string;
    severity: string;
    location: string | null;
    status: string;
  }>,
): string {
  const itemList = openItems
    .map(
      (item, i) =>
        `${i + 1}. [${item.severity}] [${item.status}] ${item.category}: ${item.description}${item.location ? ` (at: ${item.location})` : ""}`,
    )
    .join("\n");

  return `You are a skilled editor performing a refinement pass. The document below has already been revised once, but some review items remain open or only partially addressed.

Focus specifically on resolving these remaining items. Do not make changes unrelated to these items.

Respond in the same format:

REVISED_DOCUMENT_START
[your refined document here]
REVISED_DOCUMENT_END

CHANGE_SUMMARY_START
{
  "changes": [
    {
      "reviewItemIndex": 1,
      "status": "addressed|partial|not_addressed",
      "explanation": "What you changed and why"
    }
  ],
  "overallSummary": "Brief description of refinement changes"
}
CHANGE_SUMMARY_END

Remaining items to address:
${itemList}

---

Document to refine:

${document}`;
}

/**
 * Call Claude API using raw fetch (Workers-compatible, no Node.js SDK).
 */
export async function callClaudeAPI(
  prompt: string,
  apiKey: string,
  options: {
    model?: string;
    maxTokens?: number;
    gatewayUrl?: string;
    gatewayToken?: string;
  } = {},
): Promise<string> {
  const model = options.model ?? "claude-sonnet-4-20250514";
  const maxTokens = options.maxTokens ?? 4096;

  // Use AI Gateway URL if provided, otherwise direct API
  const baseUrl = options.gatewayUrl
    ? `${options.gatewayUrl}/anthropic`
    : "https://api.anthropic.com";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  // Authenticate with Cloudflare AI Gateway when using gateway routing
  if (options.gatewayUrl && options.gatewayToken) {
    headers["cf-aig-authorization"] = `Bearer ${options.gatewayToken}`;
  }

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
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
