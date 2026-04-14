/**
 * Writer/Judge model separation configuration.
 *
 * Key insight from autonovel: Using the same model for generation and evaluation
 * creates self-congratulatory feedback loops where the model rates its own output
 * highly. The intentional separation — different models or at least different
 * temperature settings — produces more honest evaluation.
 *
 * Defaults: Sonnet (temp=0.8) for writing, Opus (temp=0.3) for judging.
 */

import type { ModelConfig, ModelRoleConfig } from "./types.js";

/**
 * Default model configuration following autonovel's proven pattern:
 * - Writer: Sonnet at higher temperature for creative generation
 * - Judge: Opus at lower temperature for deterministic evaluation
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  writer: {
    model: "claude-sonnet-4-20250514",
    temperature: 0.8,
    maxTokens: 4096,
  },
  judge: {
    model: "claude-opus-4-20250514",
    temperature: 0.3,
    maxTokens: 4096,
  },
};

/**
 * Create a model configuration, merging overrides with defaults.
 */
export function createModelConfig(
  overrides?: Partial<{
    writer: Partial<ModelRoleConfig>;
    judge: Partial<ModelRoleConfig>;
  }>,
): ModelConfig {
  return {
    writer: {
      ...DEFAULT_MODEL_CONFIG.writer,
      ...overrides?.writer,
    },
    judge: {
      ...DEFAULT_MODEL_CONFIG.judge,
      ...overrides?.judge,
    },
  };
}

/**
 * Create a callModel function for a specific role using the Anthropic Messages API.
 *
 * This is a convenience factory that produces the `(prompt: string) => Promise<string>`
 * callback expected by the review panel, scoring, and comparison modules.
 *
 * @param roleConfig - Model configuration for this role (writer or judge)
 * @param apiKey - Anthropic API key
 * @param baseUrl - API base URL (defaults to Anthropic's API)
 * @returns A callModel function bound to the role's model and temperature
 */
export function createCallModel(
  roleConfig: ModelRoleConfig,
  apiKey: string,
  baseUrl: string = "https://api.anthropic.com",
): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: roleConfig.model,
        max_tokens: roleConfig.maxTokens,
        temperature: roleConfig.temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlock = data.content.find((b) => b.type === "text");
    if (!textBlock) {
      throw new Error("No text content in Claude API response");
    }

    return textBlock.text;
  };
}
