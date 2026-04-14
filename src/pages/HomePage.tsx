import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export function HomePage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-12">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Draftwell</h1>
        <p className="max-w-[600px] text-lg text-muted-foreground">
          Iterative document refinement with AI-powered critical review. Treat revision as a
          first-class workflow.
        </p>
      </div>

      <div className="flex gap-4">
        {user ? (
          <Button asChild size="lg">
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link to="/login">Get Started</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 mt-12">
        <Card>
          <CardHeader>
            <CardTitle>Critical Review</CardTitle>
            <CardDescription>Structured AI critique with tracked issues</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              AI generates structured critique categorized by severity. Each issue is tracked
              through the revision process.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Iterative Revision</CardTitle>
            <CardDescription>Refine your writing across multiple passes</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Each revision addresses review items, marking them as addressed, partial, or
              dismissed. Iterate until satisfied.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Styleguide Enforcement</CardTitle>
            <CardDescription>Your voice, not the AI's</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Configurable styleguide validates tone, bans cliche phrases, and enforces structural
              rules so your writing stays yours.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
