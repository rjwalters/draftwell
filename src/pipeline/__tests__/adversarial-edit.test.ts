import { describe, expect, it } from "vitest";
import {
  applyCuts,
  computeDistribution,
  formatReport,
  parseAdversarialResponse,
} from "../adversarial-edit";
import type { AdversarialEditResult, ProposedCut } from "../types";

const SAMPLE_RESPONSE = `CUT 1
TYPE: OVER-EXPLAIN
SECTION: Introduction
PASSAGE: """This section explains the basic concepts that any reader familiar with the topic would already know. It covers ground that was already established in the abstract."""
REASON: Readers of this document already understand these basics.
WORDS: 28

CUT 2
TYPE: REDUNDANT
SECTION: Methods
PASSAGE: """As mentioned earlier, the approach uses a transformer-based architecture. The transformer architecture, which we described in the introduction, forms the basis of our method."""
REASON: This restates information from the introduction without adding anything new.
WORDS: 31

CUT 3
TYPE: FAT
SECTION: Results
PASSAGE: """It is important to note that the results clearly demonstrate"""
REASON: Filler phrase that adds no meaning.
WORDS: 10

CUT 4
TYPE: TELL
SECTION: Discussion
PASSAGE: """The results are impressive and show great promise for the field."""
REASON: Assertion without evidence or specific data to support it.
WORDS: 12

CUT 5
TYPE: STRUCTURAL
SECTION: Background
PASSAGE: """Before we proceed to the next section, let us briefly summarize what we have covered so far in this paper."""
REASON: Unnecessary transition that interrupts flow.
WORDS: 22

CUT 6
TYPE: GENERIC
SECTION: Conclusion
PASSAGE: """Future work will explore additional applications and improvements to the proposed method."""
REASON: Could appear in any paper; contains no specific plans.
WORDS: 13`;

describe("parseAdversarialResponse", () => {
  it("parses all cuts from a well-formed response", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    expect(cuts).toHaveLength(6);
  });

  it("extracts cut types correctly", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    const types = cuts.map((c) => c.type);
    expect(types).toEqual([
      "OVER-EXPLAIN",
      "REDUNDANT",
      "FAT",
      "TELL",
      "STRUCTURAL",
      "GENERIC",
    ]);
  });

  it("extracts passages correctly", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    expect(cuts[2].passage).toBe(
      "It is important to note that the results clearly demonstrate",
    );
  });

  it("extracts sections correctly", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    expect(cuts[0].section).toBe("Introduction");
    expect(cuts[1].section).toBe("Methods");
  });

  it("extracts word counts", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    expect(cuts[2].wordCount).toBe(10);
    expect(cuts[3].wordCount).toBe(12);
  });

  it("extracts reasons", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    expect(cuts[0].reason).toBe(
      "Readers of this document already understand these basics.",
    );
  });

  it("sets all cuts to pending status", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    expect(cuts.every((c) => c.status === "pending")).toBe(true);
  });

  it("assigns unique IDs to each cut", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    const ids = new Set(cuts.map((c) => c.id));
    expect(ids.size).toBe(cuts.length);
  });

  it("handles empty response", () => {
    expect(parseAdversarialResponse("")).toEqual([]);
  });

  it("skips malformed cut blocks", () => {
    const partial = `CUT 1
TYPE: OVER-EXPLAIN
SECTION: Intro
PASSAGE: """Some text here"""
REASON: Good reason
WORDS: 3

CUT 2
This block is malformed and has no proper fields`;

    const cuts = parseAdversarialResponse(partial);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].type).toBe("OVER-EXPLAIN");
  });

  it("skips cuts with invalid types", () => {
    const badType = `CUT 1
TYPE: INVALID_TYPE
SECTION: Intro
PASSAGE: """Some text"""
REASON: A reason
WORDS: 2`;

    const cuts = parseAdversarialResponse(badType);
    expect(cuts).toHaveLength(0);
  });

  it("computes word count from passage when WORDS field is missing", () => {
    const noWords = `CUT 1
TYPE: FAT
SECTION: Intro
PASSAGE: """one two three four five"""
REASON: Too many words`;

    const cuts = parseAdversarialResponse(noWords);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].wordCount).toBe(5);
  });
});

describe("computeDistribution", () => {
  it("counts each cut type", () => {
    const cuts = parseAdversarialResponse(SAMPLE_RESPONSE);
    const dist = computeDistribution(cuts);
    expect(dist["OVER-EXPLAIN"]).toBe(1);
    expect(dist["REDUNDANT"]).toBe(1);
    expect(dist["FAT"]).toBe(1);
    expect(dist["TELL"]).toBe(1);
    expect(dist["STRUCTURAL"]).toBe(1);
    expect(dist["GENERIC"]).toBe(1);
  });

  it("handles empty cuts list", () => {
    const dist = computeDistribution([]);
    expect(dist["OVER-EXPLAIN"]).toBe(0);
    expect(dist["REDUNDANT"]).toBe(0);
  });

  it("handles multiple cuts of same type", () => {
    const cuts: ProposedCut[] = [
      makeCut("OVER-EXPLAIN"),
      makeCut("OVER-EXPLAIN"),
      makeCut("REDUNDANT"),
    ];
    const dist = computeDistribution(cuts);
    expect(dist["OVER-EXPLAIN"]).toBe(2);
    expect(dist["REDUNDANT"]).toBe(1);
    expect(dist["FAT"]).toBe(0);
  });
});

describe("applyCuts", () => {
  const document = `# Introduction

This is the introduction with important content.

It is important to note that we should proceed carefully.

# Methods

The methods section describes our approach.`;

  it("removes accepted passages", () => {
    const cuts: ProposedCut[] = [
      {
        ...makeCut("FAT"),
        passage: "It is important to note that we should proceed carefully.",
        status: "accepted",
      },
    ];

    const result = applyCuts(document, cuts);
    expect(result).not.toContain("It is important to note");
    expect(result).toContain("This is the introduction");
    expect(result).toContain("The methods section");
  });

  it("leaves rejected passages in place", () => {
    const cuts: ProposedCut[] = [
      {
        ...makeCut("FAT"),
        passage: "It is important to note that we should proceed carefully.",
        status: "rejected",
      },
    ];

    const result = applyCuts(document, cuts);
    expect(result).toContain("It is important to note");
  });

  it("leaves pending passages in place", () => {
    const cuts: ProposedCut[] = [
      {
        ...makeCut("FAT"),
        passage: "It is important to note that we should proceed carefully.",
        status: "pending",
      },
    ];

    const result = applyCuts(document, cuts);
    expect(result).toContain("It is important to note");
  });

  it("cleans up extra blank lines after removal", () => {
    const doc = "Line one.\n\nRemove me.\n\nLine three.";
    const cuts: ProposedCut[] = [
      { ...makeCut("FAT"), passage: "Remove me.", status: "accepted" },
    ];

    const result = applyCuts(doc, cuts);
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("formatReport", () => {
  it("produces a markdown report", () => {
    const result: AdversarialEditResult = {
      documentId: "doc-1",
      cuts: parseAdversarialResponse(SAMPLE_RESPONSE),
      distribution: computeDistribution(
        parseAdversarialResponse(SAMPLE_RESPONSE),
      ),
      totalWordsProposed: 116,
      model: "claude-sonnet-4-20250514",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const report = formatReport(result);
    expect(report).toContain("# Adversarial Edit Report");
    expect(report).toContain("6 passages identified");
    expect(report).toContain("## Cut Type Distribution");
    expect(report).toContain("## Proposed Cuts");
    expect(report).toContain("OVER-EXPLAIN");
  });

  it("shows percentage distribution", () => {
    const result: AdversarialEditResult = {
      documentId: "doc-1",
      cuts: [makeCut("OVER-EXPLAIN"), makeCut("OVER-EXPLAIN"), makeCut("FAT")],
      distribution: computeDistribution([
        makeCut("OVER-EXPLAIN"),
        makeCut("OVER-EXPLAIN"),
        makeCut("FAT"),
      ]),
      totalWordsProposed: 30,
      model: "claude-sonnet-4-20250514",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const report = formatReport(result);
    expect(report).toContain("OVER-EXPLAIN**: 2 (67%)");
    expect(report).toContain("FAT**: 1 (33%)");
  });
});

function makeCut(type: ProposedCut["type"]): ProposedCut {
  return {
    id: `test_${Math.random().toString(36).slice(2, 8)}`,
    type,
    passage: "Test passage with some words in it.",
    reason: "Test reason",
    section: "Test Section",
    wordCount: 7,
    status: "pending",
  };
}
