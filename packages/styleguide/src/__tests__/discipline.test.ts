import { describe, expect, it } from "vitest";
import { checkDiscipline, checkPass, checkAllPasses, allRules } from "../discipline.js";
import { zinsserPasses } from "../rules/zinsser.js";

describe("checkDiscipline", () => {
  it("returns findings from all frameworks", () => {
    const result = checkDiscipline(
      "We need to leverage synergy to think outside the box. " +
      "Each and every team member should make contact with the client. " +
      "Perhaps you could utilize the aforementioned methodology.",
    );
    const frameworks = new Set(result.findings.map((f) => f.framework));
    expect(frameworks.has("orwell")).toBe(true);
    expect(frameworks.has("zinsser")).toBe(true);
    expect(frameworks.has("ogilvy")).toBe(true);
  });

  it("includes word count", () => {
    const result = checkDiscipline("One two three four five.");
    expect(result.wordCount).toBe(5);
  });

  it("always includes the escape clause", () => {
    const result = checkDiscipline("Clean text.");
    expect(result.escapeClause).toContain("Break any of these rules");
    expect(result.escapeClause).toContain("barbarous");
  });

  it("sorts findings by offset", () => {
    const result = checkDiscipline(
      "We need to leverage this. We should utilize that. We must facilitate it.",
    );
    for (let i = 1; i < result.findings.length; i++) {
      expect(result.findings[i].offset).toBeGreaterThanOrEqual(
        result.findings[i - 1].offset,
      );
    }
  });

  it("returns empty findings for clean text", () => {
    const result = checkDiscipline("The cat sat on the mat.");
    expect(result.findings).toHaveLength(0);
  });
});

describe("checkPass", () => {
  it("runs only rules for the specified pass", () => {
    const pass1 = zinsserPasses[0]; // Cut filler
    const result = checkPass(
      "Each and every person should leverage the methodology herein.",
      pass1,
    );
    // pass1 includes clutter, cut-filler, inflated-phrase rules
    // "herein" is a humanize rule (pass 2), should NOT appear
    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has("zinsser-humanize")).toBe(false);
  });
});

describe("checkAllPasses", () => {
  it("returns results for all three passes", () => {
    const results = checkAllPasses("Some text to analyze.");
    expect(results).toHaveLength(3);
    expect(results[0].pass.name).toBe("Cut filler");
    expect(results[1].pass.name).toBe("Clarify and humanize");
    expect(results[2].pass.name).toBe("Reader test");
  });

  it("each pass result includes escape clause", () => {
    const results = checkAllPasses("Text.");
    for (const { result } of results) {
      expect(result.escapeClause).toContain("barbarous");
    }
  });
});

describe("allRules", () => {
  it("includes rules from all three frameworks", () => {
    const frameworks = new Set(allRules.map((r) => r.framework));
    expect(frameworks).toEqual(new Set(["orwell", "zinsser", "ogilvy"]));
  });

  it("each rule has required fields", () => {
    for (const rule of allRules) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(typeof rule.check).toBe("function");
    }
  });

  it("has no duplicate rule IDs", () => {
    const ids = allRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
