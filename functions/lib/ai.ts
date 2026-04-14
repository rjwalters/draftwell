import type { Env, Document } from "./types";
import { json, error } from "./shared";
import { verifyProjectOwnership } from "./projects";
import {
  buildReviewPrompt,
  buildRevisionPrompt,
  buildRefinementPrompt,
  callClaudeAPI,
  chunkSections,
  estimateTokens,
  parseReviewResponse,
  parseRevisionResponse,
  parseSections,
  type ReviewItemResult,
} from "./pipeline";

/** Get the Claude API key from request header or environment */
function getApiKey(env: Env, request: Request): string | null {
  // Allow client to pass their own API key, fall back to platform key
  const headerKey = request.headers.get("x-anthropic-key");
  return headerKey || env.ANTHROPIC_API_KEY || null;
}

/** Get the AI Gateway URL for routing through Cloudflare AI Gateway */
function getGatewayUrl(env: Env): string | undefined {
  if (env.AI_GATEWAY) {
    return `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY}`;
  }
  return undefined;
}

export async function handleGenerateReview(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) return error("Document not found", 404);

  const apiKey = getApiKey(env, request);
  if (!apiKey)
    return error("API key required. Set ANTHROPIC_API_KEY or pass x-anthropic-key header.", 400);

  // Fetch document content from R2
  const object = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = object ? await object.text() : "";
  if (!content.trim()) return error("Document is empty", 400);

  // Parse and chunk the document
  const sections = parseSections(content);
  const chunks = chunkSections(sections);

  // Generate review for each chunk
  const allItems: ReviewItemResult[] = [];
  const summaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildReviewPrompt(chunks[i].text, i, chunks.length);
    const response = await callClaudeAPI(prompt, apiKey, {
      maxTokens: 4096,
      gatewayUrl: getGatewayUrl(env),
      gatewayToken: env.AI_GATEWAY_TOKEN,
    });
    const result = parseReviewResponse(response);
    allItems.push(...result.items);
    summaries.push(result.summary);
  }

  const combinedSummary = summaries.join(" ");

  // Create review record
  const reviewId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `users/${userId}/projects/${projectId}/documents/${docId}/reviews/${reviewId}.json`;

  // Store full review data in R2
  const reviewData = {
    summary: combinedSummary,
    items: allItems,
    chunks: chunks.length,
    estimatedTokens: estimateTokens(content),
    generatedAt: now,
  };
  await env.CONTENT_BUCKET.put(r2Key, JSON.stringify(reviewData));

  // Create review record in D1
  await env.DB.prepare(
    "INSERT INTO reviews (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(reviewId, docId, doc.current_revision, r2Key, now)
    .run();

  // Create review_items records in D1
  const itemRecords = [];
  for (const item of allItems) {
    const itemId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO review_items (id, review_id, category, description, severity, location, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
    )
      .bind(itemId, reviewId, item.category, item.description, item.severity, item.location)
      .run();
    itemRecords.push({
      id: itemId,
      review_id: reviewId,
      category: item.category,
      description: item.description,
      severity: item.severity,
      location: item.location,
      suggestion: item.suggestion,
      status: "open",
    });
  }

  return json(
    {
      review: {
        id: reviewId,
        document_id: docId,
        revision_number: doc.current_revision,
        summary: combinedSummary,
        created_at: now,
      },
      items: itemRecords,
    },
    201,
  );
}

export async function handleGetReviews(
  env: Env,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const { results: reviews } = await env.DB.prepare(
    "SELECT r.id, r.document_id, r.revision_number, r.r2_key, r.created_at FROM reviews r JOIN documents d ON r.document_id = d.id WHERE d.id = ? AND d.project_id = ? ORDER BY r.created_at DESC",
  )
    .bind(docId, projectId)
    .all<{
      id: string;
      document_id: string;
      revision_number: number;
      r2_key: string;
      created_at: string;
    }>();

  // Fetch summaries from R2 for each review
  const reviewsWithSummaries = await Promise.all(
    reviews.map(async (review) => {
      const object = await env.CONTENT_BUCKET.get(review.r2_key);
      let summary = "";
      if (object) {
        try {
          const data = JSON.parse(await object.text());
          summary = data.summary || "";
        } catch {
          /* ignore parse errors */
        }
      }
      return { ...review, summary };
    }),
  );

  return json({ reviews: reviewsWithSummaries });
}

export async function handleGetReview(
  env: Env,
  projectId: string,
  docId: string,
  reviewId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const review = await env.DB.prepare(
    "SELECT r.id, r.document_id, r.revision_number, r.r2_key, r.created_at FROM reviews r JOIN documents d ON r.document_id = d.id WHERE r.id = ? AND d.id = ? AND d.project_id = ?",
  )
    .bind(reviewId, docId, projectId)
    .first<{
      id: string;
      document_id: string;
      revision_number: number;
      r2_key: string;
      created_at: string;
    }>();

  if (!review) return error("Review not found", 404);

  // Fetch items from D1
  const { results: items } = await env.DB.prepare(
    "SELECT id, review_id, category, description, severity, location, status FROM review_items WHERE review_id = ?",
  )
    .bind(reviewId)
    .all();

  // Fetch summary from R2
  const object = await env.CONTENT_BUCKET.get(review.r2_key);
  let summary = "";
  if (object) {
    try {
      const data = JSON.parse(await object.text());
      summary = data.summary || "";
    } catch {
      /* ignore parse errors */
    }
  }

  return json({ review: { ...review, summary }, items });
}

export async function handleUpdateReviewItem(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  reviewId: string,
  itemId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { status?: string };
  if (!body.status || !["open", "addressed", "partial", "dismissed"].includes(body.status)) {
    return error("Invalid status. Must be: open, addressed, partial, dismissed");
  }

  // Verify the item belongs to the review which belongs to the document
  const item = await env.DB.prepare(
    `SELECT ri.id FROM review_items ri
     JOIN reviews r ON ri.review_id = r.id
     JOIN documents d ON r.document_id = d.id
     WHERE ri.id = ? AND r.id = ? AND d.id = ? AND d.project_id = ?`,
  )
    .bind(itemId, reviewId, docId, projectId)
    .first();

  if (!item) return error("Review item not found", 404);

  await env.DB.prepare("UPDATE review_items SET status = ? WHERE id = ?")
    .bind(body.status, itemId)
    .run();

  return json({ success: true, status: body.status });
}

export async function handleGenerateRevision(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { reviewId: string };
  if (!body.reviewId) return error("reviewId is required");

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) return error("Document not found", 404);

  const apiKey = getApiKey(env, request);
  if (!apiKey)
    return error("API key required. Set ANTHROPIC_API_KEY or pass x-anthropic-key header.", 400);

  // Fetch document content
  const docObject = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = docObject ? await docObject.text() : "";

  // Fetch open review items
  const { results: openItems } = await env.DB.prepare(
    "SELECT id, category, description, severity, location, status FROM review_items WHERE review_id = ? AND status IN ('open', 'partial')",
  )
    .bind(body.reviewId)
    .all<{
      id: string;
      category: string;
      description: string;
      severity: string;
      location: string | null;
      status: string;
    }>();

  if (openItems.length === 0) return error("No open review items to address", 400);

  // Generate revision
  const prompt = buildRevisionPrompt(content, openItems);
  const response = await callClaudeAPI(prompt, apiKey, {
    maxTokens: 8192,
    gatewayUrl: getGatewayUrl(env),
    gatewayToken: env.AI_GATEWAY_TOKEN,
  });
  const result = parseRevisionResponse(response);

  // Store revised document as new revision
  const newRevision = doc.current_revision + 1;
  const newR2Key = `users/${userId}/projects/${projectId}/documents/${docId}/rev_${newRevision}.md`;
  await env.CONTENT_BUCKET.put(newR2Key, result.revisedDocument);

  const now = new Date().toISOString();

  // Create revision record
  const revisionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO revisions (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(revisionId, docId, newRevision, newR2Key, now)
    .run();

  // Update document to point to new revision
  await env.DB.prepare(
    "UPDATE documents SET current_revision = ?, r2_key = ?, updated_at = ? WHERE id = ?",
  )
    .bind(newRevision, newR2Key, now, docId)
    .run();

  // Update review item statuses based on AI's change tracking
  for (const change of result.changes) {
    const itemIndex = change.reviewItemIndex - 1; // 1-indexed from AI
    if (itemIndex >= 0 && itemIndex < openItems.length) {
      const newStatus =
        change.status === "addressed"
          ? "addressed"
          : change.status === "partial"
            ? "partial"
            : "open";
      await env.DB.prepare("UPDATE review_items SET status = ? WHERE id = ?")
        .bind(newStatus, openItems[itemIndex].id)
        .run();
    }
  }

  return json(
    {
      revision: {
        id: revisionId,
        document_id: docId,
        revision_number: newRevision,
        created_at: now,
      },
      changes: result.changes,
      summary: result.overallSummary,
      previousContent: content,
      revisedContent: result.revisedDocument,
    },
    201,
  );
}

export async function handleGenerateRefinement(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { reviewId: string };
  if (!body.reviewId) return error("reviewId is required");

  const doc = await env.DB.prepare(
    "SELECT id, project_id, title, current_revision, r2_key FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) return error("Document not found", 404);

  const apiKey = getApiKey(env, request);
  if (!apiKey)
    return error("API key required. Set ANTHROPIC_API_KEY or pass x-anthropic-key header.", 400);

  // Fetch current document content
  const docObject = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = docObject ? await docObject.text() : "";

  // Fetch remaining open/partial items
  const { results: remainingItems } = await env.DB.prepare(
    "SELECT id, category, description, severity, location, status FROM review_items WHERE review_id = ? AND status IN ('open', 'partial')",
  )
    .bind(body.reviewId)
    .all<{
      id: string;
      category: string;
      description: string;
      severity: string;
      location: string | null;
      status: string;
    }>();

  if (remainingItems.length === 0) {
    return json({ message: "All review items have been addressed. No refinement needed." });
  }

  // Generate refinement
  const prompt = buildRefinementPrompt(content, remainingItems);
  const response = await callClaudeAPI(prompt, apiKey, {
    maxTokens: 8192,
    gatewayUrl: getGatewayUrl(env),
    gatewayToken: env.AI_GATEWAY_TOKEN,
  });
  const result = parseRevisionResponse(response);

  // Store refined document as new revision
  const newRevision = doc.current_revision + 1;
  const newR2Key = `users/${userId}/projects/${projectId}/documents/${docId}/rev_${newRevision}.md`;
  await env.CONTENT_BUCKET.put(newR2Key, result.revisedDocument);

  const now = new Date().toISOString();

  const revisionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO revisions (id, document_id, revision_number, r2_key, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(revisionId, docId, newRevision, newR2Key, now)
    .run();

  await env.DB.prepare(
    "UPDATE documents SET current_revision = ?, r2_key = ?, updated_at = ? WHERE id = ?",
  )
    .bind(newRevision, newR2Key, now, docId)
    .run();

  // Update review item statuses
  for (const change of result.changes) {
    const itemIndex = change.reviewItemIndex - 1;
    if (itemIndex >= 0 && itemIndex < remainingItems.length) {
      const newStatus =
        change.status === "addressed"
          ? "addressed"
          : change.status === "partial"
            ? "partial"
            : "open";
      await env.DB.prepare("UPDATE review_items SET status = ? WHERE id = ?")
        .bind(newStatus, remainingItems[itemIndex].id)
        .run();
    }
  }

  return json(
    {
      revision: {
        id: revisionId,
        document_id: docId,
        revision_number: newRevision,
        created_at: now,
      },
      changes: result.changes,
      summary: result.overallSummary,
      previousContent: content,
      revisedContent: result.revisedDocument,
      remainingOpenItems:
        remainingItems.length - result.changes.filter((c) => c.status === "addressed").length,
    },
    201,
  );
}
