import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { ReviewPanel } from "@/components/ReviewPanel";
import { Button } from "@/components/ui/button";
import { useAutoSave } from "@/hooks/use-auto-save";

type ViewMode = "edit" | "preview" | "split";

interface RevisionResult {
  previousContent: string;
  revisedContent: string;
  summary: string;
}

export function DocumentEditPage() {
  const { projectId, documentId } = useParams<{
    projectId: string;
    documentId: string;
  }>();
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [showReview, setShowReview] = useState(false);
  const [diffView, setDiffView] = useState<{
    previous: string;
    revised: string;
    summary: string;
  } | null>(null);

  useEffect(() => {
    async function loadDocument() {
      if (!projectId || !documentId) return;
      try {
        const response = await fetch(`/api/projects/${projectId}/documents/${documentId}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to load document");
        const data = await response.json();
        setContent(data.content ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load document");
      } finally {
        setIsLoading(false);
      }
    }
    loadDocument();
  }, [projectId, documentId]);

  const handleSave = useCallback(
    async (value: string) => {
      if (!projectId || !documentId) return;
      setSaveStatus("saving");
      try {
        const response = await fetch(`/api/projects/${projectId}/documents/${documentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: value }),
        });
        if (!response.ok) throw new Error("Failed to save document");
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [projectId, documentId],
  );

  useAutoSave(content, handleSave);

  const handleChange = (value: string) => {
    setContent(value);
    setSaveStatus("unsaved");
  };

  const handleContentUpdate = useCallback((newContent: string) => {
    setContent(newContent);
    setSaveStatus("saved"); // Revision already saved server-side
  }, []);

  const handleRevision = useCallback((result: RevisionResult) => {
    setDiffView({
      previous: result.previousContent,
      revised: result.revisedContent,
      summary: result.summary,
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4">
        <p className="text-destructive">{error}</p>
        <Button asChild variant="outline">
          <Link to={`/projects/${projectId}`}>Back to Project</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to={`/projects/${projectId}`} className="hover:text-foreground">
            Project
          </Link>
          <span>/</span>
          <span>Edit Document</span>
          <span className="ml-2 text-xs">
            {saveStatus === "saving" && "(Saving...)"}
            {saveStatus === "saved" && "(Saved)"}
            {saveStatus === "unsaved" && "(Unsaved changes)"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={viewMode === "edit" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("edit")}
          >
            Edit
          </Button>
          <Button
            variant={viewMode === "split" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("split")}
          >
            Split
          </Button>
          <Button
            variant={viewMode === "preview" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("preview")}
          >
            Preview
          </Button>
          <div className="mx-2 h-5 w-px bg-border" />
          <Button
            variant={showReview ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setShowReview(!showReview);
              setDiffView(null);
            }}
          >
            Review
          </Button>
        </div>
      </div>

      {/* Diff banner */}
      {diffView && (
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
          <p className="text-sm">
            <span className="font-medium">Revision applied:</span>{" "}
            <span className="text-muted-foreground">{diffView.summary}</span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => setDiffView(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Editor / Preview / Review */}
      <div className="flex min-h-0 flex-1">
        {/* Editor area */}
        <div className={`flex min-h-0 ${showReview ? "w-2/3" : "w-full"}`}>
          {viewMode !== "preview" && (
            <div className={`min-h-0 ${viewMode === "split" ? "w-1/2 border-r" : "w-full"}`}>
              <MarkdownEditor value={content} onChange={handleChange} />
            </div>
          )}
          {viewMode !== "edit" && (
            <div className={`min-h-0 overflow-auto ${viewMode === "split" ? "w-1/2" : "w-full"}`}>
              <MarkdownPreview content={content} />
            </div>
          )}
        </div>

        {/* Review panel */}
        {showReview && projectId && documentId && (
          <div className="w-1/3 border-l">
            <ReviewPanel
              projectId={projectId}
              documentId={documentId}
              onContentUpdate={handleContentUpdate}
              onRevision={handleRevision}
            />
          </div>
        )}
      </div>
    </div>
  );
}
