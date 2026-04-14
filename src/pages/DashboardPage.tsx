import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

interface Document {
  id: string;
  project_id: string;
  title: string;
  current_revision: number;
  created_at: string;
  updated_at: string;
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [documentCount, setDocumentCount] = useState(0);
  const [recentActivity, setRecentActivity] = useState<{ action: string; time: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    if (!user) return;

    try {
      const projectsRes = await fetch("/api/projects", { credentials: "include" });
      if (!projectsRes.ok) return;
      const projectsData = await projectsRes.json();
      const allProjects: Project[] = projectsData.projects || [];
      setProjects(allProjects);

      // Fetch documents for each project to get total count and recent activity
      let totalDocs = 0;
      const allDocs: (Document & { projectName: string })[] = [];

      for (const project of allProjects) {
        const docsRes = await fetch(`/api/projects/${project.id}/documents`, {
          credentials: "include",
        });
        if (docsRes.ok) {
          const docsData = await docsRes.json();
          const docs: Document[] = docsData.documents || [];
          totalDocs += docs.length;
          for (const doc of docs) {
            allDocs.push({ ...doc, projectName: project.name });
          }
        }
      }
      setDocumentCount(totalDocs);

      // Build recent activity from projects and documents, sorted by most recent
      const activities: { action: string; time: string; date: Date }[] = [];

      for (const project of allProjects) {
        activities.push({
          action: `Created project "${project.name}"`,
          time: formatRelativeTime(new Date(project.created_at)),
          date: new Date(project.created_at),
        });
      }

      for (const doc of allDocs) {
        activities.push({
          action: `Added "${doc.title}" to ${doc.projectName}`,
          time: formatRelativeTime(new Date(doc.created_at)),
          date: new Date(doc.created_at),
        });
      }

      activities.sort((a, b) => b.date.getTime() - a.date.getTime());
      setRecentActivity(activities.slice(0, 5).map(({ action, time }) => ({ action, time })));
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const activeProjects = projects.filter((p) => p.status === "active").length;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {user?.name}!</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projects.length}</div>
            <p className="text-xs text-muted-foreground">
              {activeProjects} active
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documentCount}</div>
            <p className="text-xs text-muted-foreground">
              Across all projects
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate">{user?.email}</div>
            <p className="text-xs text-muted-foreground">{user?.name}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your recent project activity</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length > 0 ? (
              <div className="space-y-4">
                {recentActivity.map((item) => (
                  <div key={`${item.action}-${item.time}`} className="flex items-center">
                    <div className="h-2 w-2 rounded-full bg-primary mr-3" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.action}</p>
                      <p className="text-xs text-muted-foreground">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No activity yet. Create a project to get started.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <button
              type="button"
              className="w-full text-left px-4 py-2 rounded-md hover:bg-accent transition-colors"
              onClick={() => navigate("/projects")}
            >
              View projects
            </button>
            <button
              type="button"
              className="w-full text-left px-4 py-2 rounded-md hover:bg-accent transition-colors"
              onClick={() => navigate("/voice")}
            >
              Voice profile
            </button>
            <button
              type="button"
              className="w-full text-left px-4 py-2 rounded-md hover:bg-accent transition-colors"
              onClick={() => navigate("/profile")}
            >
              Edit profile
            </button>
            <button
              type="button"
              className="w-full text-left px-4 py-2 rounded-md hover:bg-accent transition-colors"
              onClick={() => navigate("/settings")}
            >
              Settings
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}
