/**
 * Token estimation, revision prompts, and Claude API client
 * for the AI review pipeline.
 */

/**
 * Rough token estimation: ~4 characters per token for English text.
 * This is a conservative estimate that works well enough for chunking decisions.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
