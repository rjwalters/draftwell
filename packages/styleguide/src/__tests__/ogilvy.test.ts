import { describe, expect, it } from "vitest";
import {
  paragraphLengthRule,
  clarityRule,
  conversationalRule,
} from "../rules/ogilvy.js";

describe("paragraphLengthRule", () => {
  it("flags paragraphs over 150 words", () => {
    const longPara = Array(160).fill("word").join(" ");
    const findings = paragraphLengthRule.check(longPara);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("160 words");
  });

  it("allows short paragraphs", () => {
    const findings = paragraphLengthRule.check("Short and sweet.\n\nAnother one.");
    expect(findings).toHaveLength(0);
  });

  it("checks each paragraph independently", () => {
    const short = "This is fine.";
    const long = Array(160).fill("word").join(" ");
    const findings = paragraphLengthRule.check(`${short}\n\n${long}\n\n${short}`);
    expect(findings).toHaveLength(1);
  });
});

describe("clarityRule", () => {
  it("flags hedging phrases", () => {
    const findings = clarityRule.check(
      "Perhaps you could update the config. You might want to restart.",
    );
    expect(findings).toHaveLength(2);
  });

  it("returns nothing for direct writing", () => {
    const findings = clarityRule.check("Update the config. Then restart.");
    expect(findings).toHaveLength(0);
  });
});

describe("conversationalRule", () => {
  it("flags unnatural constructions", () => {
    const findings = conversationalRule.check(
      "With respect to the matter of performance, at this juncture we must act.",
    );
    expect(findings).toHaveLength(2);
  });

  it("suggests plain replacements", () => {
    const findings = conversationalRule.check(
      "The question as to whether this works is open.",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].replacement).toBe("whether");
  });
});
