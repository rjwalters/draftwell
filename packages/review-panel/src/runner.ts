import type {
  Persona,
  PersonaReview,
  ReviewItem,
  Category,
  Severity,
  VoiceProfileRules,
} from "./types.js";

const VALID_CATEGORIES: Set<string> = new Set([
  "structure", "clarity", "accuracy", "completeness", "readability",
  "consistency", "terminology", "tone", "style", "flow", "engagement", "other",
]);

const VALID_SEVERITIES: Set<string> = new Set([
  "critical", "major", "minor", "suggestion",
]);

/**
 * Format voice profile rules into a prompt section for the Style Reviewer.
 */
function formatVoiceProfileSection(voiceProfile: VoiceProfileRules): string {
  const rules = voiceProfile.dimensions
    .map((d) => `- **${d.name}**: ${d.rule}`)
    .join("\n");

  return `
IMPORTANT: The author has a defined voice profile. Evaluate this document against these personalized voice rules:

Voice summary: ${voiceProfile.summary}

Voice rules:
${rules}

Note: ${voiceProfile.escape_clause}

Flag any passages that diverge from the author's established voice, but respect the escape clause above — not every deviation is a problem.
`;
}

/**
 * Build the prompt for a persona by filling in template placeholders.
 */
export function buildPrompt(
  persona: Persona,
  document: string,
  voiceProfile?: VoiceProfileRules,
): string {
  let voiceSection = "";
  if (voiceProfile && persona.id === "style-reviewer") {
    voiceSection = formatVoiceProfileSection(voiceProfile);
  }

  return persona.promptTemplate
    .replace("{{perspective}}", persona.perspective)
    .replace("{{dimensions}}", persona.dimensions.map((d) => `- ${d}`).join("\n"))
    .replace("{{voiceProfile}}", voiceSection)
    .replace("{{document}}", document);
}

/**
 * Parse the model response into structured review items.
 * Handles JSON responses, with fallback for malformed output.
 */
export function parseReviewResponse(
  personaId: string,
  raw: string,
): { summary: string; items: ReviewItem[] } {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

  try {
    const parsed = JSON.parse(cleaned);

    const summary =
      typeof parsed.summary === "string" ? parsed.summary : "No summary provided.";

    const items: ReviewItem[] = [];
    if (Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        if (typeof item.description !== "string" || !item.description.trim()) {
          continue;
        }
        items.push({
          personaId,
          category: VALID_CATEGORIES.has(item.category)
            ? (item.category as Category)
            : "other",
          severity: VALID_SEVERITIES.has(item.severity)
            ? (item.severity as Severity)
            : "suggestion",
          location: typeof item.location === "string" ? item.location : undefined,
          description: item.description.trim(),
          suggestion:
            typeof item.suggestion === "string" ? item.suggestion.trim() : undefined,
        });
      }
    }

    return { summary, items };
  } catch {
    // If JSON parsing fails, treat the entire response as a single finding
    return {
      summary: "Review completed (unstructured response).",
      items: [
        {
          personaId,
          category: "other",
          severity: "suggestion",
          description: raw.trim(),
        },
      ],
    };
  }
}

/**
 * Run a single persona review against a document.
 */
export async function runPersonaReview(
  persona: Persona,
  document: string,
  callModel: (prompt: string) => Promise<string>,
  voiceProfile?: VoiceProfileRules,
): Promise<PersonaReview> {
  const prompt = buildPrompt(persona, document, voiceProfile);
  const raw = await callModel(prompt);
  const { summary, items } = parseReviewResponse(persona.id, raw);

  return {
    personaId: persona.id,
    personaName: persona.name,
    items,
    summary,
  };
}

/**
 * Run all personas independently against the same document.
 * Executes all persona reviews in parallel.
 */
export async function runAllPersonas(
  personas: Persona[],
  document: string,
  callModel: (prompt: string) => Promise<string>,
  voiceProfile?: VoiceProfileRules,
): Promise<PersonaReview[]> {
  const reviews = await Promise.all(
    personas.map((persona) => runPersonaReview(persona, document, callModel, voiceProfile)),
  );
  return reviews;
}
