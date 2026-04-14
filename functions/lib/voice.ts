import type { Env, VoiceProfile, VoiceSample } from "./types";
import { json, error } from "./shared";

const VOICE_DIMENSIONS = [
  "Sentence structure and length patterns",
  "Vocabulary level and word choice",
  "Tone and register (formal, conversational, etc.)",
  "Paragraph rhythm and transitions",
  "Use of figurative language and imagery",
  "Perspective and point of view tendencies",
  "Hedging vs. assertiveness",
  "Abstract vs. concrete language ratio",
  "Active vs. passive voice preference",
  "Rhythm and cadence patterns",
  "Signature phrases and verbal habits",
];

function buildVoiceAnalysisPrompt(sampleText: string): string {
  return `You are a writing voice analyst. Analyze the following writing sample and extract actionable style rules that capture this author's unique voice.

Analyze across these 11 dimensions:
${VOICE_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join("\n")}

For each dimension, provide:
- A concise observation about the author's pattern
- A concrete, actionable rule an AI reviewer could use to check if new writing matches this voice

IMPORTANT: Generate rules as instructions, not literary analysis. Each rule should be something a reviewer can evaluate objectively.

Respond with a JSON object in this exact format (no markdown fences):
{
  "dimensions": [
    {
      "name": "Dimension name",
      "observation": "What you observed about this dimension",
      "rule": "Actionable instruction for maintaining this voice aspect"
    }
  ],
  "summary": "2-3 sentence overall voice characterization",
  "escape_clause": "Situations where deviating from these rules is acceptable"
}

---

Writing sample:

${sampleText}`;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export async function handleGetVoiceProfiles(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, name, profile_data, created_at, updated_at FROM voice_profiles WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<VoiceProfile>();
  return json({ profiles: results });
}

export async function handleGetVoiceProfile(
  env: Env,
  profileId: string,
  userId: string,
): Promise<Response> {
  const profile = await env.DB.prepare(
    "SELECT id, user_id, name, profile_data, created_at, updated_at FROM voice_profiles WHERE id = ? AND user_id = ?",
  )
    .bind(profileId, userId)
    .first<VoiceProfile>();

  if (!profile) {
    return error("Voice profile not found", 404);
  }

  // Also fetch associated samples
  const { results: samples } = await env.DB.prepare(
    "SELECT id, sample_text, source_url, word_count, created_at FROM voice_samples WHERE voice_profile_id = ? AND user_id = ?",
  )
    .bind(profileId, userId)
    .all<VoiceSample>();

  return json({ profile, samples });
}

export async function handleDeleteVoiceProfile(
  env: Env,
  profileId: string,
  userId: string,
): Promise<Response> {
  const existing = await env.DB.prepare(
    "SELECT id FROM voice_profiles WHERE id = ? AND user_id = ?",
  )
    .bind(profileId, userId)
    .first();

  if (!existing) {
    return error("Voice profile not found", 404);
  }

  await env.DB.prepare("DELETE FROM voice_profiles WHERE id = ? AND user_id = ?")
    .bind(profileId, userId)
    .run();

  return json({ success: true });
}

export async function handleAnalyzeVoice(env: Env, request: Request, userId: string): Promise<Response> {
  const body = (await request.json()) as {
    samples: Array<{ text: string; source_url?: string }>;
    name?: string;
  };

  if (!body.samples || !Array.isArray(body.samples) || body.samples.length === 0) {
    return error("At least one writing sample is required");
  }

  // Validate samples
  const combinedText: string[] = [];
  for (const sample of body.samples) {
    if (!sample.text || typeof sample.text !== "string") {
      return error("Each sample must have a 'text' field");
    }
    const wc = countWords(sample.text);
    if (wc < 50) {
      return error("Each writing sample must be at least 50 words");
    }
    combinedText.push(sample.text);
  }

  const allText = combinedText.join("\n\n---\n\n");
  const totalWords = countWords(allText);

  if (totalWords < 100) {
    return error("Combined writing samples must be at least 100 words");
  }

  // Call Workers AI to analyze the voice
  const prompt = buildVoiceAnalysisPrompt(allText);

  let profileDataRaw: string;
  try {
    const aiResponse = await env.AI.run(
      "@cf/meta/llama-3.1-70b-instruct" as BaseAiTextGenerationModels,
      {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
      },
    );

    if (typeof aiResponse === "object" && aiResponse !== null && "response" in aiResponse) {
      profileDataRaw = (aiResponse as { response: string }).response;
    } else {
      throw new Error("Unexpected AI response format");
    }
  } catch (e) {
    console.error("AI analysis error:", e);
    return error("Failed to analyze writing voice. Please try again.", 500);
  }

  // Parse and validate the AI response
  let profileData: unknown;
  try {
    const cleaned = profileDataRaw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    profileData = JSON.parse(cleaned);
  } catch {
    return error("Failed to parse voice analysis results. Please try again.", 500);
  }

  // Store the profile
  const profileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const profileName = body.name || "Default";

  await env.DB.prepare(
    "INSERT INTO voice_profiles (id, user_id, name, profile_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(profileId, userId, profileName, JSON.stringify(profileData), now, now)
    .run();

  // Store the samples and link them to the profile
  for (const sample of body.samples) {
    const sampleId = crypto.randomUUID();
    const wc = countWords(sample.text);
    const sampleText = wc <= 5000 ? sample.text : null;
    let r2Key: string | null = null;

    // For large samples, store in R2
    if (wc > 5000) {
      r2Key = `users/${userId}/voice-samples/${sampleId}.txt`;
      await env.CONTENT_BUCKET.put(r2Key, sample.text);
    }

    await env.DB.prepare(
      "INSERT INTO voice_samples (id, user_id, voice_profile_id, sample_text, r2_key, source_url, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(sampleId, userId, profileId, sampleText, r2Key, sample.source_url || null, wc, now)
      .run();
  }

  return json(
    {
      profile: {
        id: profileId,
        user_id: userId,
        name: profileName,
        profile_data: JSON.stringify(profileData),
        created_at: now,
        updated_at: now,
      },
    },
    201,
  );
}
