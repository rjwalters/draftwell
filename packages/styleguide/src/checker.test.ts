import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { check } from "./checker.js";
import { defaultStyleguide } from "./rules/index.js";

describe("check", () => {
  it("returns clean report for non-AI text", () => {
    const doc = "The cat sat on the mat. It was a cold Tuesday morning.";
    const report = check(doc, defaultStyleguide);
    assert.equal(report.counts.error, 0);
    assert.ok(report.score < 1, `Score ${report.score} should be < 1`);
  });

  it("detects kill-on-sight words", () => {
    const doc = "We must delve into the tapestry of this multifaceted issue.";
    const report = check(doc, defaultStyleguide);
    const errorIds = report.results
      .filter((r) => r.severity === "error")
      .map((r) => r.ruleId);
    assert.ok(errorIds.includes("word-delve"), "Should detect 'delve'");
    assert.ok(errorIds.includes("word-tapestry"), "Should detect 'tapestry'");
    assert.ok(errorIds.includes("word-multifaceted"), "Should detect 'multifaceted'");
  });

  it("detects banned phrases", () => {
    const doc =
      "It's important to note that this cannot be overstated. Let's dive into the details.";
    const report = check(doc, defaultStyleguide);
    const errorIds = report.results
      .filter((r) => r.severity === "error")
      .map((r) => r.ruleId);
    assert.ok(
      errorIds.includes("phrase-important-to-note"),
      "Should detect 'it's important to note'",
    );
    assert.ok(
      errorIds.includes("phrase-cannot-be-overstated"),
      "Should detect 'cannot be overstated'",
    );
    assert.ok(
      errorIds.includes("phrase-dive-into"),
      "Should detect 'let's dive into'",
    );
  });

  it("detects chatbot artifacts", () => {
    const doc =
      "As an AI language model, I'm happy to help. Hope this helps! Feel free to ask more. Great question!";
    const report = check(doc, defaultStyleguide);
    const errorIds = report.results
      .filter((r) => r.severity === "error")
      .map((r) => r.ruleId);
    assert.ok(errorIds.includes("phrase-as-an-ai"), "Should detect 'as an AI'");
    assert.ok(
      errorIds.includes("phrase-happy-to-help"),
      "Should detect 'happy to help'",
    );
    assert.ok(
      errorIds.includes("phrase-hope-this-helps"),
      "Should detect 'hope this helps'",
    );
    assert.ok(
      errorIds.includes("phrase-feel-free-to"),
      "Should detect 'feel free to'",
    );
    assert.ok(
      errorIds.includes("phrase-great-question"),
      "Should detect 'great question'",
    );
  });

  it("returns correct location info", () => {
    const doc = "First line is fine.\nSecond line has delve in it.\nThird line.";
    const report = check(doc, defaultStyleguide);
    const delveResult = report.results.find((r) => r.ruleId === "word-delve");
    assert.ok(delveResult, "Should find delve");
    assert.equal(delveResult!.line, 2, "Should be on line 2");
    assert.equal(delveResult!.match, "delve");
  });

  it("includes suggestions", () => {
    const doc = "We need to leverage this robust framework to streamline operations.";
    const report = check(doc, defaultStyleguide);
    for (const result of report.results) {
      assert.ok(
        result.suggestion,
        `Result for ${result.ruleId} should have a suggestion`,
      );
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

    assert.ok(cleanReport.score >= 0, "Clean score >= 0");
    assert.ok(cleanReport.score <= 10, "Clean score <= 10");
    assert.ok(slopReport.score >= 0, "Slop score >= 0");
    assert.ok(slopReport.score <= 10, "Slop score <= 10");
    assert.ok(
      slopReport.score > cleanReport.score,
      `Slop score (${slopReport.score}) should exceed clean score (${cleanReport.score})`,
    );
  });

  it("separates counts by severity", () => {
    const doc =
      "We must delve into how to leverage this. Furthermore, it's important to note the nuanced approach.";
    const report = check(doc, defaultStyleguide);
    assert.ok(report.counts.error > 0, "Should have errors");
    assert.ok(report.counts.warning > 0, "Should have warnings");
    assert.ok(
      report.totalIssues === report.counts.error + report.counts.warning + report.counts.info,
      "Total should equal sum of counts",
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
    assert.ok(emDashResult, "Should detect excessive em-dash density");
    assert.ok(emDashResult!.value > 5, `Density ${emDashResult!.value} should exceed threshold`);
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
    assert.equal(emDashResult, undefined, "Should not flag normal em-dash usage");
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
    assert.ok(uniformResult, "Should detect sentence uniformity");
  });
});
