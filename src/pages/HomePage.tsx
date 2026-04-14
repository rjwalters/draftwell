import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const steps = [
  {
    label: "Draft",
    description: "Write freely without self-editing. Get your ideas down first.",
  },
  {
    label: "Review",
    description: "AI critique surfaces structural, clarity, and style issues.",
  },
  {
    label: "Revise",
    description: "Address each review item. Dismiss what you disagree with.",
  },
  {
    label: "Refine",
    description: "Iterate until every sentence earns its place.",
  },
];

export function HomePage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col items-center px-4">
      {/* Hero */}
      <section className="flex flex-col items-center text-center pt-16 pb-20 max-w-2xl">
        <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-normal tracking-tight leading-tight">
          Write it. Critique it.
          <br />
          <span className="text-primary">Make it better.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-lg leading-relaxed">
          Draftwell turns revision into a structured workflow. AI-powered critical review catches
          what you miss, then stays out of your way while you fix it.
        </p>
        <div className="mt-8">
          {user ? (
            <Button asChild size="lg" className="text-base px-8">
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="text-base px-8">
              <Link to="/login">Get Started</Link>
            </Button>
          )}
        </div>
      </section>

      {/* Workflow visual */}
      <section className="w-full max-w-3xl pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <div key={step.label} className="relative flex flex-col">
              <div className="flex items-baseline gap-3 mb-2">
                <span className="font-serif text-3xl font-normal text-primary/40">{i + 1}</span>
                <h3 className="font-serif text-xl font-normal">{step.label}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature detail */}
      <section className="w-full max-w-2xl pb-20 space-y-12">
        <div className="border-t pt-8">
          <h2 className="font-serif text-2xl font-normal mb-3">Critical Review</h2>
          <p className="text-muted-foreground leading-relaxed">
            Structured AI critique categorized by severity. Each issue is tracked through the
            revision process — addressed, partially fixed, or deliberately dismissed.
          </p>
        </div>

        <div className="border-t pt-8">
          <h2 className="font-serif text-2xl font-normal mb-3">Iterative Revision</h2>
          <p className="text-muted-foreground leading-relaxed">
            Each revision pass addresses review items and generates a new round of critique. You
            decide when it's done — the tool never rewrites for you.
          </p>
        </div>

        <div className="border-t pt-8">
          <h2 className="font-serif text-2xl font-normal mb-3">Styleguide Enforcement</h2>
          <p className="text-muted-foreground leading-relaxed">
            Configurable styleguide validates tone, bans cliche phrases, and enforces structural
            rules so your writing stays yours.
          </p>
        </div>
      </section>
    </div>
  );
}
