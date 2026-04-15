import { compareDocuments, EloRanking } from "../../packages/review-panel/src/comparison";
import { reviewDocument } from "../../packages/review-panel/src/index";
import { scoreDocument } from "../../packages/review-panel/src/scoring";
import { check, defaultStyleguide } from "../../packages/styleguide/src/index";
import {
  buildRefinementPrompt,
  buildRevisionPrompt,
  callClaudeAPI,
  estimateTokens,
  parseRevisionResponse,
} from "./pipeline";
import { verifyProjectOwnership } from "./projects";
import { error, json } from "./shared";
import type { Document, Env } from "./types";

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

/** Map review-panel severity to DB severity */
function mapSeverity(severity: string): "error" | "warning" | "suggestion" {
  switch (severity) {
    case "critical":
      return "error";
    case "major":
      return "warning";
    default:
      return "suggestion";
  }
}

/** Map styleguide severity to DB severity */
function mapStyleguideSeverity(severity: string): "error" | "warning" | "suggestion" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "suggestion";
  }
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

  // Phase 1: Run styleguide check (pure regex, no AI calls)
  const styleguideReport = check(content, defaultStyleguide);

  // Phase 2: Run multi-persona review
  const gatewayUrl = getGatewayUrl(env);
  const callModel = (prompt: string) =>
    callClaudeAPI(prompt, apiKey, {
      maxTokens: 4096,
      gatewayUrl,
      gatewayToken: env.AI_GATEWAY_TOKEN,
    });

  const aggregatedReview = await reviewDocument(content, { callModel });

  // Build combined summary
  const personaSummaries = aggregatedReview.personaReviews.map((pr) => pr.summary).join(" ");
  const combinedSummary = personaSummaries || "Review completed.";

  // Create review record
  const reviewId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `users/${userId}/projects/${projectId}/documents/${docId}/reviews/${reviewId}.json`;

  // Store full review data in R2 (includes styleguide and persona details)
  const reviewData = {
    summary: combinedSummary,
    styleguide: {
      score: styleguideReport.score,
      totalIssues: styleguideReport.totalIssues,
      counts: styleguideReport.counts,
      results: styleguideReport.results,
      structuralResults: styleguideReport.structuralResults,
    },
    personaReviews: aggregatedReview.personaReviews,
    clusters: aggregatedReview.clusters,
    stats: aggregatedReview.stats,
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

  // Create review_items from styleguide violations
  const itemRecords = [];

  for (const result of styleguideReport.results) {
    const itemId = crypto.randomUUID();
    const severity = mapStyleguideSeverity(result.severity);
    const location = `Line ${result.line}, Col ${result.column}`;
    await env.DB.prepare(
      "INSERT INTO review_items (id, review_id, category, description, severity, location, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
    )
      .bind(itemId, reviewId, result.category, result.description, severity, location)
      .run();
    itemRecords.push({
      id: itemId,
      review_id: reviewId,
      category: result.category,
      description: result.description,
      severity,
      location,
      suggestion: result.suggestion ?? null,
      status: "open" as const,
      source: "styleguide" as const,
    });
  }

  // Create review_items from multi-persona consensus clusters
  for (const cluster of aggregatedReview.clusters) {
    const itemId = crypto.randomUUID();
    const severity = mapSeverity(cluster.severity);
    // Use location from the first item that has one
    const location = cluster.items.find((i) => i.location)?.location ?? null;
    const suggestion = cluster.items.find((i) => i.suggestion)?.suggestion ?? null;
    await env.DB.prepare(
      "INSERT INTO review_items (id, review_id, category, description, severity, location, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
    )
      .bind(
        itemId,
        reviewId,
        cluster.category,
        cluster.representativeDescription,
        severity,
        location,
      )
      .run();
    itemRecords.push({
      id: itemId,
      review_id: reviewId,
      category: cluster.category,
      description: cluster.representativeDescription,
      severity,
      location,
      suggestion,
      status: "open" as const,
      source: "persona" as const,
      consensusStrength: cluster.strength,
      consensusCount: cluster.consensusCount,
      totalPersonas: cluster.totalPersonas,
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
      styleguide: {
        score: styleguideReport.score,
        totalIssues: styleguideReport.totalIssues,
        counts: styleguideReport.counts,
      },
      stats: aggregatedReview.stats,
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

export async function handleScoreDocument(
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

  const docObject = await env.CONTENT_BUCKET.get(doc.r2_key);
  const content = docObject ? await docObject.text() : "";
  if (!content.trim()) return error("Document is empty", 400);

  const gatewayUrl = getGatewayUrl(env);
  const callModel = (prompt: string) =>
    callClaudeAPI(prompt, apiKey, {
      maxTokens: 4096,
      gatewayUrl,
      gatewayToken: env.AI_GATEWAY_TOKEN,
    });

  const score = await scoreDocument(content, docId, doc.current_revision, callModel);

  // Persist to document_scores
  await env.DB.prepare(
    "INSERT INTO document_scores (id, document_id, revision_number, overall_score, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      score.id,
      score.documentId,
      score.revisionNumber,
      score.overallScore,
      score.model,
      score.createdAt,
    )
    .run();

  // Persist dimension scores
  for (const dim of score.dimensions) {
    const dimScoreId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO dimension_scores (id, document_score_id, dimension_id, score, justification) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(dimScoreId, score.id, dim.dimensionId, dim.score, dim.justification)
      .run();

    // Persist weaknesses
    for (const weakness of dim.weaknesses) {
      const weaknessId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO dimension_weaknesses (id, dimension_score_id, description, evidence) VALUES (?, ?, ?, ?)",
      )
        .bind(weaknessId, dimScoreId, weakness.description, weakness.evidence)
        .run();
    }
  }

  return json({ score }, 201);
}

export async function handleCompareDocuments(
  env: Env,
  request: Request,
  projectId: string,
  docId: string,
  userId: string,
): Promise<Response> {
  if (!(await verifyProjectOwnership(env, projectId, userId))) {
    return error("Project not found", 404);
  }

  const body = (await request.json()) as { revisionA: number; revisionB: number };
  if (body.revisionA == null || body.revisionB == null) {
    return error("revisionA and revisionB are required");
  }

  const apiKey = getApiKey(env, request);
  if (!apiKey)
    return error("API key required. Set ANTHROPIC_API_KEY or pass x-anthropic-key header.", 400);

  // Fetch both revisions
  const revA = await env.DB.prepare(
    "SELECT r2_key FROM revisions WHERE document_id = ? AND revision_number = ?",
  )
    .bind(docId, body.revisionA)
    .first<{ r2_key: string }>();

  const revB = await env.DB.prepare(
    "SELECT r2_key FROM revisions WHERE document_id = ? AND revision_number = ?",
  )
    .bind(docId, body.revisionB)
    .first<{ r2_key: string }>();

  // Fall back to document's current r2_key for the initial revision
  const doc = await env.DB.prepare(
    "SELECT id, r2_key, current_revision FROM documents WHERE id = ? AND project_id = ?",
  )
    .bind(docId, projectId)
    .first<Document>();

  if (!doc) return error("Document not found", 404);

  const r2KeyA = revA?.r2_key ?? (body.revisionA === doc.current_revision ? doc.r2_key : null);
  const r2KeyB = revB?.r2_key ?? (body.revisionB === doc.current_revision ? doc.r2_key : null);

  if (!r2KeyA || !r2KeyB) return error("One or both revisions not found", 404);

  const [objA, objB] = await Promise.all([
    env.CONTENT_BUCKET.get(r2KeyA),
    env.CONTENT_BUCKET.get(r2KeyB),
  ]);
  const contentA = objA ? await objA.text() : "";
  const contentB = objB ? await objB.text() : "";

  if (!contentA.trim() || !contentB.trim()) return error("One or both revisions are empty", 400);

  const gatewayUrl = getGatewayUrl(env);
  const callModel = (prompt: string) =>
    callClaudeAPI(prompt, apiKey, {
      maxTokens: 4096,
      gatewayUrl,
      gatewayToken: env.AI_GATEWAY_TOKEN,
    });

  const comparison = await compareDocuments(
    { documentId: docId, revisionNumber: body.revisionA, content: contentA },
    { documentId: docId, revisionNumber: body.revisionB, content: contentB },
    callModel,
  );

  // Persist comparison
  await env.DB.prepare(
    "INSERT INTO comparisons (id, version_a_document_id, version_a_revision, version_b_document_id, version_b_revision, winner, reasoning, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      docId,
      body.revisionA,
      docId,
      body.revisionB,
      comparison.winner,
      comparison.reasoning,
      comparison.model,
      comparison.createdAt,
    )
    .run();

  // Update Elo ratings
  const elo = new EloRanking();

  // Load existing ratings
  const { results: existingRatings } = await env.DB.prepare(
    "SELECT document_id, revision_number, rating, matches_played FROM elo_ratings WHERE document_id = ?",
  )
    .bind(docId)
    .all<{
      document_id: string;
      revision_number: number;
      rating: number;
      matches_played: number;
    }>();

  if (existingRatings.length > 0) {
    elo.importRatings(
      existingRatings.map((r) => ({
        documentId: r.document_id,
        revisionNumber: r.revision_number,
        rating: r.rating,
        matchesPlayed: r.matches_played,
      })),
    );
  }

  const { ratingA, ratingB } = elo.recordResult(comparison);

  // Upsert Elo ratings
  for (const rating of [ratingA, ratingB]) {
    await env.DB.prepare(
      `INSERT INTO elo_ratings (document_id, revision_number, rating, matches_played, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(document_id, revision_number)
       DO UPDATE SET rating = ?, matches_played = ?, updated_at = datetime('now')`,
    )
      .bind(
        rating.documentId,
        rating.revisionNumber,
        rating.rating,
        rating.matchesPlayed,
        rating.rating,
        rating.matchesPlayed,
      )
      .run();
  }

  return json({ comparison, ratings: { a: ratingA, b: ratingB } }, 201);
}
