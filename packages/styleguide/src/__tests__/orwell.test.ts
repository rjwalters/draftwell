import { describe, expect, it } from "vitest";
import {
  deadMetaphorRule,
  inflatedPhraseRule,
  shortWordRule,
  activeVoiceRule,
  cutFillerRule,
} from "../rules/orwell.js";
import { inflatedPhrases } from "../phrase-table.js";

describe("deadMetaphorRule", () => {
  it("flags dead metaphors", () => {
    const findings = deadMetaphorRule.check(
      "We need to think outside the box to move the needle.",
    );
    expect(findings).toHaveLength(2);
    expect(findings[0].matched.toLowerCase()).toBe("think outside the box");
    expect(findings[1].matched.toLowerCase()).toBe("move the needle");
  });

  it("returns nothing for clean text", () => {
    const findings = deadMetaphorRule.check(
      "The system processes requests through a queue.",
    );
    expect(findings).toHaveLength(0);
  });

  it("is case insensitive", () => {
    const findings = deadMetaphorRule.check("A Level Playing Field is needed.");
    expect(findings).toHaveLength(1);
  });
});

describe("inflatedPhraseRule", () => {
  it("flags inflated phrases with replacements", () => {
    const findings = inflatedPhraseRule.check(
      "We need to make contact with the team in order to take into consideration their needs.",
    );
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const callFinding = findings.find((f) =>
      f.matched.toLowerCase() === "make contact with",
    );
    expect(callFinding).toBeDefined();
    expect(callFinding!.replacement).toBe("call");
  });

  it("flags jargon words", () => {
    const findings = inflatedPhraseRule.check(
      "We should leverage this opportunity and utilize the framework.",
    );
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.replacement === "use")).toBe(true);
  });

  it("returns nothing for clean text", () => {
    const findings = inflatedPhraseRule.check("Call the team about their needs.");
    expect(findings).toHaveLength(0);
  });
});

describe("inflatedPhrases table", () => {
  it("has entries", () => {
    expect(inflatedPhrases.size).toBeGreaterThan(50);
  });

  it("maps inflated to plain", () => {
    expect(inflatedPhrases.get("make contact with")).toBe("call");
    expect(inflatedPhrases.get("utilize")).toBe("use");
    expect(inflatedPhrases.get("due to the fact that")).toBe("because");
  });
});

describe("shortWordRule", () => {
  it("suggests shorter alternatives", () => {
    const findings = shortWordRule.check(
      "We need to demonstrate approximately numerous improvements.",
    );
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.replacement === "show")).toBe(true);
    expect(findings.some((f) => f.replacement === "about")).toBe(true);
  });
});

describe("activeVoiceRule", () => {
  it("flags passive constructions", () => {
    const findings = activeVoiceRule.check(
      "The report was submitted by the team.",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].matched).toBe("was submitted");
  });

  it("skips adjective exceptions", () => {
    const findings = activeVoiceRule.check("She is interested in the project.");
    expect(findings).toHaveLength(0);
  });
});

describe("cutFillerRule", () => {
  it("flags filler words", () => {
    const findings = cutFillerRule.check(
      "It is very important to note that this is basically just a test.",
    );
    expect(findings.length).toBeGreaterThanOrEqual(3); // very, basically, just
  });

  it("flags filler phrases", () => {
    const findings = cutFillerRule.check(
      "Needless to say, it goes without saying that this matters.",
    );
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});
