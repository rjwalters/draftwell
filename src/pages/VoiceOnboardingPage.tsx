import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useVoiceProfile,
  type VoiceProfile,
  type VoiceProfileData,
} from "@/hooks/use-voice-profile";

type Step = "input" | "analyzing" | "results";

export function VoiceOnboardingPage() {
  const navigate = useNavigate();
  const { analyzeVoice, error: hookError, parseProfileData } = useVoiceProfile();

  const [step, setStep] = useState<Step>("input");
  const [sampleText, setSampleText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [profileName, setProfileName] = useState("");
  const [generatedProfile, setGeneratedProfile] = useState<VoiceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wordCount = sampleText.trim().split(/\s+/).filter(Boolean).length;

  const handleSubmit = async () => {
    setError(null);

    if (wordCount < 100) {
      setError("Please provide at least 100 words for accurate analysis.");
      return;
    }

    setStep("analyzing");
    const profile = await analyzeVoice(
      [{ text: sampleText, source_url: sourceUrl || undefined }],
      profileName || undefined,
    );

    if (profile) {
      setGeneratedProfile(profile);
      setStep("results");
    } else {
      setStep("input");
      setError(hookError || "Analysis failed. Please try again.");
    }
  };

  const profileData: VoiceProfileData | null = generatedProfile
    ? parseProfileData(generatedProfile)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Voice Profile Setup</h1>
        <p className="text-muted-foreground">
          Paste a sample of your writing so we can learn your unique voice and style.
        </p>
      </div>

      {(error || hookError) && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error || hookError}
        </div>
      )}

      {step === "input" && (
        <Card>
          <CardHeader>
            <CardTitle>Writing Sample</CardTitle>
            <CardDescription>
              Paste 100+ words of your writing. The more text you provide, the more accurate the
              voice profile will be. Blog posts, articles, or essays work best.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="profile-name" className="text-sm font-medium">
                Profile Name (optional)
              </label>
              <Input
                id="profile-name"
                placeholder="e.g., Blog Writing, Technical Docs"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="sample-text" className="text-sm font-medium">
                Your Writing Sample
              </label>
              <textarea
                id="sample-text"
                className="flex min-h-[240px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Paste your writing here..."
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {wordCount} words {wordCount < 100 && "(minimum 100)"}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="source-url" className="text-sm font-medium">
                Source URL (optional)
              </label>
              <Input
                id="source-url"
                placeholder="https://example.com/my-article"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={wordCount < 100}>
                Analyze My Voice
              </Button>
              <Button variant="outline" onClick={() => navigate("/profile")}>
                Skip for Now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "analyzing" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="mt-4 text-muted-foreground">Analyzing your writing voice...</p>
            <p className="text-xs text-muted-foreground">This usually takes 10-30 seconds</p>
          </CardContent>
        </Card>
      )}

      {step === "results" && profileData && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your Voice Profile</CardTitle>
              <CardDescription>{profileData.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {profileData.dimensions.map((dim, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <p className="text-sm font-medium">{dim.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{dim.observation}</p>
                    <p className="mt-1 text-xs">
                      <span className="font-medium">Rule: </span>
                      {dim.rule}
                    </p>
                  </div>
                ))}
              </div>

              {profileData.escape_clause && (
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-sm font-medium">When to break these rules</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {profileData.escape_clause}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button onClick={() => navigate("/profile")}>Done</Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep("input");
                setSampleText("");
                setSourceUrl("");
                setProfileName("");
                setGeneratedProfile(null);
              }}
            >
              Create Another Profile
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
