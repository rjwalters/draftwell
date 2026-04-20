import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import type { Project } from "@/components/ProjectCard";
import { ProjectForm } from "@/components/ProjectForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

interface Document {
  id: string;
  project_id: string;
  title: string;
  current_revision: number;
  r2_key: string;
  created_at: string;
  updated_at: string;
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreatingDoc, setIsCreatingDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!id || !user) return;

    try {
      const response = await fetch(`/api/projects/${id}`, {
        credentials: "include",
      });
      if (response.status === 404) {
        setError("Project not found");
        return;
      }
      if (!response.ok) throw new Error("Failed to fetch project");
      const data = await response.json();
      setProject(data.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setIsLoading(false);
    }
  }, [id, user]);

  const fetchDocuments = useCallback(async () => {
    if (!id || !user) return;

    try {
      const response = await fetch(`/api/projects/${id}/documents`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch documents");
      const data = await response.json();
      setDocuments(data.documents);
    } catch {
      // Document loading failure is non-fatal
    } finally {
      setIsLoadingDocs(false);
    }
  }, [id, user]);

  useEffect(() => {
    fetchProject();
    fetchDocuments();
  }, [fetchProject, fetchDocuments]);

  const handleUpdate = async (data: { name: string; description: string }) => {
    if (!id || !user) return;

    const response = await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Failed to update project");
    }

    const { project: updated } = await response.json();
    setProject(updated);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!id || !user) return;

    const response = await fetch(`/api/projects/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to delete project");
    navigate("/projects");
  };

  const handleCreateDocument = async () => {
    if (!id || !user) return;

    setIsCreatingDoc(true);
    try {
      const response = await fetch(`/api/projects/${id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: "Untitled Document" }),
      });
      if (!response.ok) throw new Error("Failed to create document");
      const data = await response.json();
      navigate(`/projects/${id}/documents/${data.document.id}/edit`);
    } catch {
      // Creation failure handled by the UI remaining on current page
    } finally {
      setIsCreatingDoc(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!id || !user) return;

    const response = await fetch(`/api/projects/${id}/documents/${docId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to delete document");
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="text-lg font-semibold">Error</h2>
            <p className="mt-2 text-muted-foreground">{error}</p>
            <Button className="mt-4" asChild>
              <Link to="/projects">Back to Projects</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/projects" className="hover:text-foreground">
          Projects
        </Link>
        <span>/</span>
        <span>{project.name}</span>
      </div>

      {isEditing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit Project</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectForm
              project={project}
              onSubmit={handleUpdate}
              onCancel={() => setIsEditing(false)}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {project.name}
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      project.status === "archived"
                        ? "bg-muted text-muted-foreground"
                        : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                    }`}
                  >
                    {project.status}
                  </span>
                </CardTitle>
                <CardDescription>
                  Created {new Date(project.created_at).toLocaleDateString()}
                  {project.updated_at !== project.created_at && (
                    <> • Updated {new Date(project.updated_at).toLocaleDateString()}</>
                  )}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  Edit
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="destructive" size="sm">
                      Delete
                    </Button>
                  }
                  title="Delete Project"
                  description={`Are you sure you want to delete "${project.name}"? This action cannot be undone.`}
                  confirmLabel="Delete"
                  variant="destructive"
                  onConfirm={handleDelete}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
                <p className="mt-1">{project.description || "No description provided"}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Project ID</h3>
                <code className="mt-1 text-xs">{project.id}</code>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documents Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Documents</CardTitle>
            <Button size="sm" onClick={handleCreateDocument} disabled={isCreatingDoc}>
              {isCreatingDoc ? "Creating..." : "New Document"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingDocs ? (
            <div className="space-y-3">
              <div className="h-12 animate-pulse rounded bg-muted" />
              <div className="h-12 animate-pulse rounded bg-muted" />
            </div>
          ) : documents.length === 0 ? (
            <EmptyState
              title="No documents yet"
              description="Create your first document to start writing."
              action={{
                label: "New Document",
                onClick: handleCreateDocument,
              }}
            />
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <Link
                    to={`/projects/${id}/documents/${doc.id}/edit`}
                    className="flex-1 hover:underline"
                  >
                    <div className="font-medium">{doc.title}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(doc.created_at).toLocaleDateString()}
                      {doc.updated_at !== doc.created_at && (
                        <> • Updated {new Date(doc.updated_at).toLocaleDateString()}</>
                      )}
                      {doc.current_revision > 0 && <> • Rev {doc.current_revision}</>}
                    </div>
                  </Link>
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" className="text-destructive">
                        Delete
                      </Button>
                    }
                    title="Delete Document"
                    description={`Are you sure you want to delete "${doc.title}"? This action cannot be undone.`}
                    confirmLabel="Delete"
                    variant="destructive"
                    onConfirm={() => handleDeleteDocument(doc.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
