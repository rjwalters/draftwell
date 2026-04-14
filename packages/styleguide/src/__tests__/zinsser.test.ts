import { describe, expect, it } from "vitest";
import {
  clutterRule,
  humanizeRule,
  sentenceLengthRule,
  zinsserPasses,
} from "../rules/zinsser.js";

describe("clutterRule", () => {
  it("flags redundant pairs", () => {
    const findings = clutterRule.check("Each and every student must attend.");
    expect(findings).toHaveLength(1);
    expect(findings[0].replacement).toBe("each");
  });

  it("flags wordy qualifiers", () => {
    const findings = clutterRule.check(
      "The system is kind of slow in terms of throughput.",
    );
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("humanizeRule", () => {
  it("flags stiff constructions", () => {
    const findings = humanizeRule.check(
      "It is widely recognized that the aforementioned approach works.",
    );
    expect(findings).toHaveLength(2);
  });

  it("flags archaic words", () => {
    const findings = humanizeRule.check(
      "The values defined herein are thereby applied.",
    );
    expect(findings).toHaveLength(2);
  });
});

describe("sentenceLengthRule", () => {
  it("flags sentences over 35 words", () => {
    const longSentence = Array(40).fill("word").join(" ") + ".";
    const findings = sentenceLengthRule.check(longSentence);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("40 words");
  });

  it("allows sentences under 35 words", () => {
    const findings = sentenceLengthRule.check("This is fine.");
    expect(findings).toHaveLength(0);
  });
});

describe("zinsserPasses", () => {
  it("defines three passes", () => {
    expect(zinsserPasses).toHaveLength(3);
  });

  it("pass 1 is Cut filler", () => {
    expect(zinsserPasses[0].name).toBe("Cut filler");
    expect(zinsserPasses[0].ruleIds.length).toBeGreaterThan(0);
  });

  it("pass 2 is Clarify and humanize", () => {
    expect(zinsserPasses[1].name).toBe("Clarify and humanize");
  });

  it("pass 3 is Reader test", () => {
    expect(zinsserPasses[2].name).toBe("Reader test");
  });
});
