import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

interface ReviewItem {
  id: string;
  review_id: string;
  category: string;
  description: string;
  severity: "error" | "warning" | "suggestion";
  location: string | null;
  status: "open" | "addressed" | "partial" | "dismissed";
  source?: "styleguide" | "persona";
  suggestion?: string | null;
  consensusStrength?: number;
  consensusCount?: number;
  totalPersonas?: number;
}

interface StyleguideStats {
  score: number;
  totalIssues: number;
  counts: Record<string, number>;
}

interface ReviewStats {
  totalFindings: number;
  totalClusters: number;
  consensusCount: number;
  disagreementCount: number;
  personaCount: number;
}

interface Review {
  id: string;
  document_id: string;
  revision_number: number;
  summary: string;
  created_at: string;
}

interface RevisionResult {
  revision: {
    id: string;
    revision_number: number;
  };
  changes: Array<{
    reviewItemIndex: number;
    status: string;
    explanation: string;
  }>;
  summary: string;
  previousContent: string;
  revisedContent: string;
}

interface ReviewPanelProps {
  projectId: string;
  documentId: string;
  onContentUpdate: (content: string) => void;
  onRevision: (result: RevisionResult) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  suggestion: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  addressed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  partial: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  dismissed: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

export function ReviewPanel({
  projectId,
  documentId,
  onContentUpdate,
  onRevision,
}: ReviewPanelProps) {
  const [review, setReview] = useState<Review | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [styleguideStats, setStyleguideStats] = useState<StyleguideStats | null>(null);
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState<string | null>(null);

  const basePath = `/api/projects/${projectId}/documents/${documentId}`;

  const generateReview = useCallback(async () => {
    setIsReviewing(true);
    setError(null);
    setChangeSummary(null);
    try {
      const response = await fetch(`${basePath}/ai/review`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate review");
      }
      const data = await response.json();
      setReview(data.review);
      setItems(data.items);
      setStyleguideStats(data.styleguide ?? null);
      setReviewStats(data.stats ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate review");
    } finally {
      setIsReviewing(false);
    }
  }, [basePath]);

  const generateRevision = useCallback(async () => {
    if (!review) return;
    setIsRevising(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/ai/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reviewId: review.id }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate revision");
      }
      const data = (await response.json()) as RevisionResult;
      setChangeSummary(data.summary);
      onRevision(data);
      onContentUpdate(data.revisedContent);

      // Refresh review items to get updated statuses
      const reviewResponse = await fetch(`${basePath}/reviews/${review.id}`, {
        credentials: "include",
      });
      if (reviewResponse.ok) {
        const reviewData = await reviewResponse.json();
        setItems(reviewData.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate revision");
    } finally {
      setIsRevising(false);
    }
  }, [basePath, review, onContentUpdate, onRevision]);

  const generateRefinement = useCallback(async () => {
    if (!review) return;
    setIsRefining(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/ai/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reviewId: review.id }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to refine");
      }
      const data = await response.json();
      if (data.message) {
        setChangeSummary(data.message);
      } else {
        setChangeSummary(data.summary);
        onRevision(data);
        onContentUpdate(data.revisedContent);
      }

      // Refresh review items
      const reviewResponse = await fetch(`${basePath}/reviews/${review.id}`, {
        credentials: "include",
      });
      if (reviewResponse.ok) {
        const reviewData = await reviewResponse.json();
        setItems(reviewData.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refine");
    } finally {
      setIsRefining(false);
    }
  }, [basePath, review, onContentUpdate, onRevision]);

  const updateItemStatus = useCallback(
    async (itemId: string, status: string) => {
      if (!review) return;
      try {
        const response = await fetch(`${basePath}/reviews/${review.id}/items/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status }),
        });
        if (response.ok) {
          setItems((prev) =>
            prev.map((item) =>
              item.id === itemId ? { ...item, status: status as ReviewItem["status"] } : item,
            ),
          );
        }
      } catch {
        // Silently fail for status updates
      }
    },
    [basePath, review],
  );

  const openCount = items.filter((i) => i.status === "open").length;
  const partialCount = items.filter((i) => i.status === "partial").length;
  const addressedCount = items.filter((i) => i.status === "addressed").length;
  const dismissedCount = items.filter((i) => i.status === "dismissed").length;
  const hasOpenItems = openCount > 0 || partialCount > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Review</h3>
        <div className="flex items-center gap-2">
          {review && hasOpenItems && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={generateRefinement}
                disabled={isRefining}
              >
                {isRefining ? "Refining..." : "Refine"}
              </Button>
              <Button size="sm" onClick={generateRevision} disabled={isRevising}>
                {isRevising ? "Revising..." : "Revise"}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant={review ? "outline" : "default"}
            onClick={generateReview}
            disabled={isReviewing}
          >
            {isReviewing ? "Reviewing..." : review ? "Re-Review" : "Review"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {error && (
          <div className="mb-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {isReviewing && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Generating critical review...</p>
          </div>
        )}

        {!review && !isReviewing && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Click "Review" to generate an AI-powered critical review of your document.
            </p>
          </div>
        )}

        {review && !isReviewing && (
          <>
            {/* Summary */}
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">{review.summary}</p>
            </div>

            {/* Styleguide Score */}
            {styleguideStats && (
              <div className="mb-4 rounded-md border p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-muted-foreground">Styleguide Score</p>
                  <span
                    className={`text-sm font-semibold ${
                      styleguideStats.score <= 2
                        ? "text-green-600 dark:text-green-400"
                        : styleguideStats.score <= 5
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {(10 - styleguideStats.score).toFixed(1)}/10
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-1.5 rounded-full ${
                      styleguideStats.score <= 2
                        ? "bg-green-500"
                        : styleguideStats.score <= 5
                          ? "bg-yellow-500"
                          : "bg-red-500"
                    }`}
                    style={{ width: `${Math.max(0, (10 - styleguideStats.score) * 10)}%` }}
                  />
                </div>
                {styleguideStats.totalIssues > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {styleguideStats.totalIssues} styleguide{" "}
                    {styleguideStats.totalIssues === 1 ? "issue" : "issues"} found
                  </p>
                )}
              </div>
            )}

            {/* Persona Stats */}
            {reviewStats && (
              <div className="mb-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {reviewStats.personaCount} personas
                </span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {reviewStats.consensusCount} consensus
                </span>
                {reviewStats.disagreementCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {reviewStats.disagreementCount} split
                  </span>
                )}
              </div>
            )}

            {/* Progress */}
            <div className="mb-4 flex items-center gap-3 text-xs">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
                {items.length} items
              </span>
              {openCount > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {openCount} open
                </span>
              )}
              {partialCount > 0 && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  {partialCount} partial
                </span>
              )}
              {addressedCount > 0 && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                  {addressedCount} addressed
                </span>
              )}
              {dismissedCount > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 dark:bg-gray-800 dark:text-gray-500">
                  {dismissedCount} dismissed
                </span>
              )}
            </div>

            {/* Change Summary */}
            {changeSummary && (
              <div className="mb-4 rounded-md border bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Latest Change</p>
                <p className="text-sm">{changeSummary}</p>
              </div>
            )}

            {/* Items */}
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-md border p-3 ${item.status === "dismissed" ? "opacity-50" : ""}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_COLORS[item.severity]}`}
                    >
                      {item.severity}
                    </span>
                    {item.source && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          item.source === "styleguide"
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                            : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                        }`}
                      >
                        {item.source === "styleguide" ? "style" : "persona"}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{item.category}</span>
                    {item.location && (
                      <span className="text-xs text-muted-foreground">@ {item.location}</span>
                    )}
                    {item.consensusCount != null && item.totalPersonas != null && (
                      <span className="text-xs text-muted-foreground">
                        {item.consensusCount}/{item.totalPersonas}
                      </span>
                    )}
                    <span
                      className={`ml-auto rounded px-1.5 py-0.5 text-xs ${STATUS_COLORS[item.status]}`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="text-sm">{item.description}</p>
                  {item.suggestion && (
                    <p className="mt-1 text-xs text-muted-foreground italic">{item.suggestion}</p>
                  )}
                  {item.status !== "dismissed" && item.status !== "addressed" && (
                    <div className="mt-2 flex gap-1">
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => updateItemStatus(item.id, "dismissed")}
                      >
                        Dismiss
                      </button>
                      {item.status === "open" && (
                        <button
                          type="button"
                          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                          onClick={() => updateItemStatus(item.id, "addressed")}
                        >
                          Mark Addressed
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
