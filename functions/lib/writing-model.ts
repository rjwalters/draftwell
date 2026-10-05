import { errorDetails, logStage } from "./diagnostics";
import { callClaudeAPI, parseRevisionResponse } from "./pipeline";
import { RequestError } from "./revisions";
import type { Env } from "./types";

export const WRITING_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Use a supplied Claude key when configured; otherwise use our Workers AI binding. */
export async function callWritingModel(
  env: Env,
  request: Request,
  prompt: string,
  maxTokens = 4096,
  attempt = 1,
): Promise<string> {
  const key = request.headers.get("x-anthropic-key") || env.ANTHROPIC_API_KEY;
  if (!key && !env.AI)
    throw new RequestError("AI writing is temporarily unavailable.", 503, "model_unconfigured");
  if (!key && prompt.length > 48000)
    throw new RequestError(
      "This document is too long for AI writing. Try a shorter document.",
      413,
      "model_input_too_long",
    );
  const started = Date.now();
  const details = {
    provider: key ? ("claude" as const) : ("workers-ai" as const),
    model: key ? "claude-sonnet-4-20250514" : WRITING_MODEL,
    inputChars: prompt.length,
    maxTokens,
    attempt,
  };
  logStage(request, "model", "started", details);
  try {
    if (key) {
      const text = await callClaudeAPI(prompt, key, {
        maxTokens,
        gatewayUrl: env.AI_GATEWAY
          ? `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY}`
          : undefined,
        gatewayToken: env.AI_GATEWAY_TOKEN,
      });
      logStage(
        request,
        "model",
        "succeeded",
        { ...details, outputChars: text.length, outputType: "text" },
        Date.now() - started,
      );
      return text;
    }
    const result = await env.AI.run(WRITING_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    if (!result || typeof result !== "object" || !("response" in result))
      throw new Error("Missing model response");
    // Workers AI can decode JSON completions into objects even without JSON mode.
    const finish = (result as { choices?: { finish_reason?: unknown }[] }).choices?.[0]
      ?.finish_reason;
    const finishReason =
      finish === undefined
        ? undefined
        : finish === "stop"
          ? "stop"
          : finish === "length"
            ? "length"
            : "other";
    const output: unknown = result.response;
    const text =
      typeof output === "string"
        ? output
        : output && typeof output === "object"
          ? JSON.stringify(output)
          : "";
    if (!text.trim()) throw new Error("Empty model response");
    logStage(
      request,
      "model",
      "succeeded",
      {
        ...details,
        outputChars: text.length,
        finishReason,
        outputType: typeof output === "string" ? "text" : "json",
      },
      Date.now() - started,
    );
    return text;
  } catch (cause) {
    logStage(
      request,
      "model",
      "failed",
      { ...details, ...errorDetails(cause) },
      Date.now() - started,
    );
    throw new RequestError(
      "AI writing could not finish. Please try again in a moment.",
      503,
      "model_failed",
    );
  }
}

/** A malformed completion gets one fresh attempt; neither attempt writes document content. */
export async function generateWritingRevision(env: Env, request: Request, prompt: string) {
  for (let attempt = 0; ; attempt++) {
    const raw = await callWritingModel(
      env,
      request,
      attempt === 0
        ? prompt
        : `${prompt}

Output reminder: return the complete document between REVISED_DOCUMENT_START and REVISED_DOCUMENT_END on separate lines, then valid JSON between CHANGE_SUMMARY_START and CHANGE_SUMMARY_END. Include both closing markers.`,
      8192,
      attempt + 1,
    );
    const parsedAt = Date.now();
    const details = {
      attempt: attempt + 1,
      outputChars: raw.length,
      documentMarkers:
        raw.includes("REVISED_DOCUMENT_START") && raw.includes("REVISED_DOCUMENT_END"),
      summaryMarkers: raw.includes("CHANGE_SUMMARY_START") && raw.includes("CHANGE_SUMMARY_END"),
    };
    try {
      const result = parseRevisionResponse(raw);
      logStage(request, "output.parse", "succeeded", details, Date.now() - parsedAt);
      return result;
    } catch (error) {
      logStage(
        request,
        "output.parse",
        "failed",
        { ...details, ...errorDetails(error) },
        Date.now() - parsedAt,
      );
      if (!(error instanceof RequestError) || error.status !== 502 || attempt >= 1) throw error;
      logStage(request, "output.parse", "retry", details);
    }
  }
}
