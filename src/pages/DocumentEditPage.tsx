import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { Button } from "@/components/ui/button";
import { useAutoSave } from "@/hooks/use-auto-save";

type ViewMode = "edit" | "preview" | "split";

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

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-3rem)] flex-col items-center justify-center gap-4">
        <p className="text-destructive">{error}</p>
        <Button asChild variant="ghost">
          <Link to={`/projects/${projectId}`}>Back to Project</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* Toolbar — minimal chrome */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to={`/projects/${projectId}`} className="hover:text-foreground transition-colors">
            Project
          </Link>
          <span className="text-border">/</span>
          <span>Document</span>
          <span className="ml-1 text-muted-foreground/60">
            {saveStatus === "saving" && "Saving..."}
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "unsaved" && "Unsaved"}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant={viewMode === "edit" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setViewMode("edit")}
          >
            Edit
          </Button>
          <Button
            variant={viewMode === "split" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setViewMode("split")}
          >
            Split
          </Button>
          <Button
            variant={viewMode === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setViewMode("preview")}
          >
            Preview
          </Button>
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="flex min-h-0 flex-1">
        {viewMode !== "preview" && (
          <div className={`min-h-0 ${viewMode === "split" ? "w-1/2 border-r border-border/50" : "w-full"}`}>
            <MarkdownEditor value={content} onChange={handleChange} />
          </div>
        )}
        {viewMode !== "edit" && (
          <div className={`min-h-0 overflow-auto ${viewMode === "split" ? "w-1/2" : "w-full"}`}>
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
