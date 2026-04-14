import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  DEFAULT_MODEL_CONFIG,
  createModelConfig,
} from "../model-config.js";

describe("DEFAULT_MODEL_CONFIG", () => {
  it("uses Sonnet for writer with higher temperature", () => {
    assert.ok(DEFAULT_MODEL_CONFIG.writer.model.includes("sonnet"));
    assert.equal(DEFAULT_MODEL_CONFIG.writer.temperature, 0.8);
  });

  it("uses Opus for judge with lower temperature", () => {
    assert.ok(DEFAULT_MODEL_CONFIG.judge.model.includes("opus"));
    assert.equal(DEFAULT_MODEL_CONFIG.judge.temperature, 0.3);
  });

  it("judge model is more capable than writer model", () => {
    // Opus is more capable than Sonnet — verified by model name
    assert.ok(DEFAULT_MODEL_CONFIG.judge.model.includes("opus"));
    assert.ok(DEFAULT_MODEL_CONFIG.writer.model.includes("sonnet"));
  });

  it("judge temperature is lower than writer temperature", () => {
    assert.ok(
      DEFAULT_MODEL_CONFIG.judge.temperature < DEFAULT_MODEL_CONFIG.writer.temperature,
      "Judge should use lower temperature for more deterministic evaluation",
    );
  });
});

describe("createModelConfig", () => {
  it("returns defaults when no overrides", () => {
    const config = createModelConfig();
    assert.deepEqual(config, DEFAULT_MODEL_CONFIG);
  });

  it("merges writer overrides", () => {
    const config = createModelConfig({
      writer: { model: "custom-writer", temperature: 0.5 },
    });
    assert.equal(config.writer.model, "custom-writer");
    assert.equal(config.writer.temperature, 0.5);
    assert.equal(config.writer.maxTokens, DEFAULT_MODEL_CONFIG.writer.maxTokens);
    // Judge should be unchanged
    assert.deepEqual(config.judge, DEFAULT_MODEL_CONFIG.judge);
  });

  it("merges judge overrides", () => {
    const config = createModelConfig({
      judge: { temperature: 0.1 },
    });
    assert.equal(config.judge.temperature, 0.1);
    assert.equal(config.judge.model, DEFAULT_MODEL_CONFIG.judge.model);
    // Writer should be unchanged
    assert.deepEqual(config.writer, DEFAULT_MODEL_CONFIG.writer);
  });

  it("allows both overrides simultaneously", () => {
    const config = createModelConfig({
      writer: { model: "fast-writer" },
      judge: { model: "careful-judge" },
    });
    assert.equal(config.writer.model, "fast-writer");
    assert.equal(config.judge.model, "careful-judge");
  });
});
