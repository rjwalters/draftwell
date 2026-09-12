import { Download, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { ReviewPanel, type RevisionProposal } from "@/components/ReviewPanel";
import { RevisionDiff } from "@/components/RevisionDiff";
import { Button } from "@/components/ui/button";
import { useAutoSave } from "@/hooks/use-auto-save";

interface LoadedDocument {
  content: string;
  document: { title: string; current_revision: number; voice_profile_id?: string | null };
}
interface Finding {
  message: string;
  line: number | null;
}
interface WritingCheck {
  revision: number;
  rhetoric: { findings: Finding[] };
  numeric: { findings: Finding[] };
}

export function DocumentEditPage() {
  const { projectId, documentId } = useParams();
  if (!projectId || !documentId) return null;
  return (
    <DocumentLoader
      key={`${projectId}/${documentId}`}
      projectId={projectId}
      documentId={documentId}
    />
  );
}

function DocumentLoader({ projectId, documentId }: { projectId: string; documentId: string }) {
  const [data, setData] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/documents/${documentId}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load document");
        setData(await response.json());
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Failed to load document");
      }
    })();
    return () => controller.abort();
  }, [projectId, documentId]);
  if (error)
    return (
      <div className="p-8">
        <p role="alert">{error}</p>
        <Link to={`/projects/${projectId}`}>Back to project</Link>
      </div>
    );
  if (!data)
    return (
      <p className="p-8" role="status">
        Loading document…
      </p>
    );
  return <DocumentWorkspace projectId={projectId} documentId={documentId} initial={data} />;
}

function DocumentWorkspace({
  projectId,
  documentId,
  initial,
}: {
  projectId: string;
  documentId: string;
  initial: LoadedDocument;
}) {
  const basePath = `/api/projects/${projectId}/documents/${documentId}`;
  const draftKey = `draftwell:unsaved:${projectId}:${documentId}`;
  const revision = useRef(initial.document.current_revision);
  const [content, setContent] = useState(initial.content);
  const [title, setTitle] = useState(initial.document.title);
  const [titleInput, setTitleInput] = useState(initial.document.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleSaved, setTitleSaved] = useState(false);
  const [showWriter, setShowWriter] = useState(!initial.content.trim());
  const [writingPrompt, setWritingPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<"edit" | "split" | "preview">("split");
  const [showReview, setShowReview] = useState(false);
  const [proposal, setProposal] = useState<RevisionProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [voiceId, setVoiceId] = useState(initial.document.voice_profile_id || "");
  const [checks, setChecks] = useState<WritingCheck | null>(null);
  const [recovery, setRecovery] = useState<string | null>(() => {
    try {
      const draft = localStorage.getItem(draftKey);
      return draft && draft !== initial.content ? draft : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/voice/profiles", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load voice profiles");
        const data = await response.json();
        if (active) setProfiles(data.profiles);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSave = useCallback(
    async (value: string) => {
      const response = await fetch(basePath, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value, baseRevision: revision.current }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your changes. Please retry.");
      revision.current = data.document.current_revision;
      try {
        if (localStorage.getItem(draftKey) === value) localStorage.removeItem(draftKey);
      } catch {
        /* storage may be unavailable */
      }
    },
    [basePath, draftKey],
  );
  const autosave = useAutoSave(content, handleSave);
  const beforeAction = useCallback(async () => {
    await autosave.flush();
    return revision.current;
  }, [autosave.flush]);
  const changeContent = (value: string) => {
    try {
      localStorage.setItem(draftKey, value);
    } catch {
      /* beforeunload still guards unsaved changes */
    }
    setContent(value);
    setChecks(null);
  };
  const accept = async () => {
    if (!proposal || accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await autosave.flush();
      if (revision.current !== proposal.baseRevision || content !== proposal.previousContent)
        throw new Error(
          "The draft changed after this proposal was generated. Keep your edits and generate a new proposal.",
        );
      const response = await fetch(`${basePath}/candidates/${proposal.candidateId}/accept`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not accept revision");
      revision.current = data.revision;
      autosave.markSaved(data.content);
      setContent(data.content);
      setProposal(null);
      setChecks(null);
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept revision");
    } finally {
      setAccepting(false);
    }
  };
  const saveTitle = async () => {
    if (!titleInput.trim() || savingTitle) return;
    setSavingTitle(true);
    setError(null);
    try {
      const response = await fetch(basePath, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleInput.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not rename document");
      setTitle(data.document.title);
      setTitleInput(data.document.title);
      setTitleSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename document");
    } finally {
      setSavingTitle(false);
    }
  };
  const generateDraft = async () => {
    if (busy || accepting || proposal || !writingPrompt.trim()) return;
    setGenerating(true);
    setBusy(true);
    setError(null);
    try {
      const baseRevision = await beforeAction();
      const response = await fetch(`${basePath}/ai/draft`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: writingPrompt.trim(), baseRevision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate a draft");
      setProposal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a draft");
    } finally {
      setGenerating(false);
      setBusy(false);
    }
  };
  const updateVoice = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(basePath, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceProfileId: id || null }),
      });
      if (!response.ok) throw new Error("Could not update the voice profile");
      setVoiceId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update voice");
    } finally {
      setBusy(false);
    }
  };
  const checkWriting = async () => {
    setBusy(true);
    setError(null);
    try {
      const baseRevision = await beforeAction();
      const response = await fetch(`${basePath}/writing-check`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Writing checks are unavailable");
      setChecks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Writing checks failed");
    } finally {
      setBusy(false);
    }
  };
  const stale =
    proposal &&
    (proposal.baseRevision !== revision.current || proposal.previousContent !== content);
  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to={`/projects/${projectId}`}>Project</Link>
          <span>/</span>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTitle();
            }}
          >
            <input
              aria-label="Document title"
              className="w-48 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-foreground hover:border-input focus:border-input"
              value={titleInput}
              disabled={savingTitle || busy || accepting}
              onChange={(event) => {
                setTitleInput(event.target.value);
                setTitleSaved(false);
              }}
            />
            {titleInput !== title && (
              <Button
                size="sm"
                type="submit"
                disabled={!titleInput.trim() || savingTitle || busy || accepting}
              >
                {savingTitle ? "Saving title…" : "Save title"}
              </Button>
            )}
            {titleSaved && <span role="status">Title saved</span>}
          </form>
          <span role="status">
            {autosave.status === "saving"
              ? "Saving…"
              : autosave.status === "saved"
                ? "Saved"
                : "Unsaved"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" disabled={busy || accepting} onClick={() => setShowWriter(!showWriter)}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Write with AI
          </Button>
          <select
            aria-label="Author voice"
            value={voiceId}
            onChange={(e) => void updateVoice(e.target.value)}
            disabled={busy || accepting}
            className="max-w-40 rounded border bg-background p-1 text-xs"
          >
            <option value="">Default voice</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          {(["edit", "split", "preview"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={view === mode ? "secondary" : "ghost"}
              onClick={() => setView(mode)}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </Button>
          ))}
          <Button
            size="sm"
            disabled={busy || accepting}
            variant={showReview ? "default" : "ghost"}
            onClick={() => setShowReview(!showReview)}
          >
            Review
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || accepting}
            onClick={() => void checkWriting()}
          >
            Check writing
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void import("@/lib/pdf-export")
                .then(({ exportToPdf }) => exportToPdf(content, title))
                .catch(() => setError("Could not export PDF"));
            }}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Export PDF
          </Button>
        </div>
      </div>
      {showWriter && (
        <form
          className="space-y-3 border-b bg-muted/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void generateDraft();
          }}
        >
          <label htmlFor="writing-prompt" className="block text-sm font-medium">
            What would you like to write?
          </label>
          <textarea
            id="writing-prompt"
            className="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
            placeholder="Describe the topic, audience, tone, and key points. You can also ask for changes to the current draft."
            value={writingPrompt}
            onChange={(event) => setWritingPrompt(event.target.value)}
            maxLength={6000}
            disabled={busy || accepting}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!writingPrompt.trim() || busy || accepting || !!proposal}
            >
              {generating ? "Writing…" : "Generate draft"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Preview the proposed text, then accept it when you’re ready.
            </p>
          </div>
          {generating && (
            <p role="status" className="text-sm">
              Writing your draft. This may take a minute…
            </p>
          )}
        </form>
      )}
      {recovery && (
        <div className="flex items-center gap-3 border-b p-3 text-sm">
          <p>A locally saved draft is available. Restoring it replaces the text shown here.</p>
          <Button
            size="sm"
            onClick={() => {
              changeContent(recovery);
              setRecovery(null);
            }}
          >
            Restore draft
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              localStorage.removeItem(draftKey);
              setRecovery(null);
            }}
          >
            Discard local draft
          </Button>
        </div>
      )}
      {(error || autosave.error) && (
        <div className="flex items-center gap-3 border-b p-3 text-sm text-destructive" role="alert">
          <p>{error || autosave.error}</p>
          {autosave.error && (
            <Button size="sm" onClick={() => void autosave.flush().catch(() => {})}>
              Retry save
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const blob = new Blob([content], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "draft.md";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download draft
          </Button>
        </div>
      )}
      {checks && (
        <div className="max-h-48 overflow-auto border-b p-3 text-sm">
          <p className="font-medium">
            Writing checks · revision {checks.revision}
            {checks.revision !== revision.current || autosave.isDirty ? " (draft has changed)" : ""}
          </p>
          {[...checks.rhetoric.findings, ...checks.numeric.findings].length ? (
            [...checks.rhetoric.findings, ...checks.numeric.findings].map((finding) => (
              <p key={`${finding.line}-${finding.message}`}>
                {finding.line ? `Line ${finding.line}` : "Document"}: {finding.message}
              </p>
            ))
          ) : (
            <p>No issues found by these checks.</p>
          )}
        </div>
      )}
      {proposal && (
        <div className="max-h-[45vh] overflow-auto border-b bg-muted/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Proposed revision</p>
              <p className="text-sm">{proposal.summary}</p>
              {stale && (
                <p className="text-sm text-destructive">
                  Your draft changed. Generate a new proposal to include your edits.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!!stale || accepting || busy}
                onClick={() => void accept()}
              >
                {accepting ? "Accepting…" : "Accept revision"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={accepting}
                onClick={() => setProposal(null)}
              >
                Discard proposal
              </Button>
            </div>
          </div>
          <RevisionDiff before={proposal.previousContent} after={proposal.revisedContent} />
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className={`flex min-h-0 ${showReview ? "w-2/3" : "w-full"}`}>
          {view !== "preview" && (
            <div className={`min-h-0 ${view === "split" ? "w-1/2 border-r" : "w-full"}`}>
              <MarkdownEditor value={content} onChange={changeContent} readOnly={accepting} />
            </div>
          )}
          {view !== "edit" && (
            <div className={`min-h-0 overflow-auto ${view === "split" ? "w-1/2" : "w-full"}`}>
              <MarkdownPreview content={content} />
            </div>
          )}
        </div>
        {showReview && (
          <div className="w-1/3 border-l">
            <ReviewPanel
              projectId={projectId}
              documentId={documentId}
              beforeAction={beforeAction}
              onRevision={setProposal}
              onBusyChange={setBusy}
              disabled={busy || accepting || !!proposal}
              refreshKey={refreshKey}
            />
          </div>
        )}
      </div>
    </div>
  );
}
