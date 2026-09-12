import { callClaudeAPI } from "./pipeline";
import { RequestError } from "./revisions";
import type { Env } from "./types";

export const WRITING_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Use a supplied Claude key when configured; otherwise use our Workers AI binding. */
export async function callWritingModel(
  env: Env,
  request: Request,
  prompt: string,
  maxTokens = 4096,
): Promise<string> {
  const key = request.headers.get("x-anthropic-key") || env.ANTHROPIC_API_KEY;
  if (!key && !env.AI) throw new RequestError("AI writing is temporarily unavailable.", 503);
  if (!key && prompt.length > 48000)
    throw new RequestError(
      "This document is too long for AI writing. Try a shorter document.",
      413,
    );
  try {
    if (key)
      return await callClaudeAPI(prompt, key, {
        maxTokens,
        gatewayUrl: env.AI_GATEWAY
          ? `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY}`
          : undefined,
        gatewayToken: env.AI_GATEWAY_TOKEN,
      });
    const result = await env.AI.run(WRITING_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    if (!result || typeof result !== "object" || !("response" in result))
      throw new Error("Missing model response");
    // Workers AI can decode JSON completions into objects even without JSON mode.
    const output: unknown = result.response;
    const text =
      typeof output === "string"
        ? output
        : output && typeof output === "object"
          ? JSON.stringify(output)
          : "";
    if (!text.trim()) throw new Error("Empty model response");
    return text;
  } catch {
    throw new RequestError("AI writing could not finish. Please try again in a moment.", 503);
  }
}
