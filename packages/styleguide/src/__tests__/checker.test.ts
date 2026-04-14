import { describe, expect, it } from "vitest";
import { check } from "../checker.js";
import { defaultStyleguide } from "../rules/index.js";

describe("check", () => {
  it("returns clean report for non-AI text", () => {
    const doc = "The cat sat on the mat. It was a cold Tuesday morning.";
    const report = check(doc, defaultStyleguide);
    expect(report.counts.error).toBe(0);
    expect(report.score).toBeLessThan(1);
  });

  it("detects kill-on-sight words", () => {
    const doc = "We must delve into the tapestry of this multifaceted issue.";
    const report = check(doc, defaultStyleguide);
    const errorIds = report.results
      .filter((r) => r.severity === "error")
      .map((r) => r.ruleId);
    expect(errorIds).toContain("word-delve");
    expect(errorIds).toContain("word-tapestry");
    expect(errorIds).toContain("word-multifaceted");
  });

  it("detects banned phrases", () => {
    const doc =
      "It's important to note that this cannot be overstated. Let's dive into the details.";
    const report = check(doc, defaultStyleguide);
    const errorIds = report.results
      .filter((r) => r.severity === "error")
      .map((r) => r.ruleId);
    expect(errorIds).toContain("phrase-important-to-note");
    expect(errorIds).toContain("phrase-cannot-be-overstated");
    expect(errorIds).toContain("phrase-dive-into");
  });

  it("detects chatbot artifacts", () => {
    const doc =
      "As an AI language model, I'm happy to help. Hope this helps! Feel free to ask more. Great question!";
    const report = check(doc, defaultStyleguide);
    const errorIds = report.results
      .filter((r) => r.severity === "error")
      .map((r) => r.ruleId);
    expect(errorIds).toContain("phrase-as-an-ai");
    expect(errorIds).toContain("phrase-happy-to-help");
    expect(errorIds).toContain("phrase-hope-this-helps");
    expect(errorIds).toContain("phrase-feel-free-to");
    expect(errorIds).toContain("phrase-great-question");
  });

  it("returns correct location info", () => {
    const doc = "First line is fine.\nSecond line has delve in it.\nThird line.";
    const report = check(doc, defaultStyleguide);
    const delveResult = report.results.find((r) => r.ruleId === "word-delve");
    expect(delveResult).toBeDefined();
    expect(delveResult!.line).toBe(2);
    expect(delveResult!.match).toBe("delve");
  });

  it("includes suggestions", () => {
    const doc = "We need to leverage this robust framework to streamline operations.";
    const report = check(doc, defaultStyleguide);
    for (const result of report.results) {
      expect(result.suggestion).toBeTruthy();
    }
  });

  it("computes a score between 0 and 10", () => {
    const cleanDoc = "The rain fell steadily on the old tin roof.";
    const slopDoc = `
      It's important to note that we must delve into this multifaceted tapestry.
      This groundbreaking, cutting-edge paradigm shift cannot be overstated.
      Many experts believe this is a game-changer that will revolutionize the landscape.
      Let's dive into how this pivotal development fosters robust, comprehensive solutions.
      As an AI, I'm happy to help you navigate this intricate interplay.
    `;

    const cleanReport = check(cleanDoc, defaultStyleguide);
    const slopReport = check(slopDoc, defaultStyleguide);

    expect(cleanReport.score).toBeGreaterThanOrEqual(0);
    expect(cleanReport.score).toBeLessThanOrEqual(10);
    expect(slopReport.score).toBeGreaterThanOrEqual(0);
    expect(slopReport.score).toBeLessThanOrEqual(10);
    expect(slopReport.score).toBeGreaterThan(cleanReport.score);
  });

  it("separates counts by severity", () => {
    const doc =
      "We must delve into how to leverage this. Furthermore, it's important to note the nuanced approach.";
    const report = check(doc, defaultStyleguide);
    expect(report.counts.error).toBeGreaterThan(0);
    expect(report.counts.warning).toBeGreaterThan(0);
    expect(report.totalIssues).toBe(
      report.counts.error + report.counts.warning + report.counts.info + report.counts.suggestion,
    );
  });
});

describe("structural checks", () => {
  it("detects excessive em-dash density", () => {
    // 10 em dashes in ~50 words = 200 per 1000 words (way over threshold of 5)
    const doc = Array(10)
      .fill("The result\u2014surprising as it was\u2014showed improvement.")
      .join(" ");
    const report = check(doc, defaultStyleguide);
    const emDashResult = report.structuralResults.find(
      (r) => r.ruleId === "structural-em-dash-density",
    );
    expect(emDashResult).toBeDefined();
    expect(emDashResult!.value).toBeGreaterThan(5);
  });

  it("does not flag normal em-dash usage", () => {
    // 2 em dashes in ~250 words = ~8 per 1000. Need enough words to dilute below 5/1000.
    const padding = Array(25)
      .fill("The team worked hard on the project for several months and delivered the final product on time.")
      .join(" ");
    const doc =
      "The result\u2014surprising as it was\u2014showed improvement. " + padding;
    const report = check(doc, defaultStyleguide);
    const emDashResult = report.structuralResults.find(
      (r) => r.ruleId === "structural-em-dash-density",
    );
    expect(emDashResult).toBeUndefined();
  });

  it("detects sentence length uniformity", () => {
    // All sentences are exactly 8 words long - very uniform
    const sentences = [
      "The team worked hard on the project today.",
      "They delivered their final product on time here.",
      "The client was pleased with the good outcome.",
      "Everyone celebrated the launch at the office party.",
      "The next quarter brought us new growth challenges.",
      "Management approved the budget for the expansion plan.",
      "New members joined and quickly got up here.",
      "The roadmap updated to reflect our changing goals.",
      "Quality metrics improved across all departments last year.",
      "The company grew rapidly in the first quarter.",
    ];
    const doc = sentences.join(" ");
    const report = check(doc, defaultStyleguide);
    const uniformResult = report.structuralResults.find(
      (r) => r.ruleId === "structural-sentence-uniformity",
    );
    expect(uniformResult).toBeDefined();
  });
});
