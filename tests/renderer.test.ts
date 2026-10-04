import { describe, it, expect } from "vitest";
import { formatTerminalCard, generateShareUrl } from "../src/renderer.js";
import { MetricSummary } from "../src/types.js";

describe("Card Renderer", () => {
  it("formats terminal card with archetype and score", () => {
    const summary: MetricSummary = {
      totalLinesAdded: 1500,
      aiLinesAdded: 800,
      totalCommits: 20,
      aiCommits: 10,
      testSkips: [
        {
          type: "test-skip",
          file: "tests/auth.test.ts",
          lineSnippet: "it.skip('login')",
          commitHash: "abc1234",
          commitDate: "2026-10-04T12:00:00Z",
          reason: "skipped test",
        },
      ],
      typeEscapes: [],
      swallowedErrors: [],
      panicLoops: [],
      rawScore: 15,
      score: 81,
      isSufficientData: true,
      archetype: "The Silent Vandal",
      archetypeDescription: "Skips tests when they fail.",
    };

    const card = formatTerminalCard(summary, { repoName: "test-repo", verbose: false });
    expect(card).toContain("AGENT ROAST");
    expect(card).toContain("The Silent Vandal");
    expect(card).toContain("81 / 100");
    expect(card).toContain("Skipped tests");
  });

  it("generates valid Twitter share URL with pre-filled text", () => {
    const summary: MetricSummary = {
      totalLinesAdded: 1200,
      aiLinesAdded: 900,
      totalCommits: 15,
      aiCommits: 8,
      testSkips: [],
      typeEscapes: [],
      swallowedErrors: [],
      panicLoops: [],
      rawScore: 0,
      score: 95,
      isSufficientData: true,
      archetype: "The Clean Coder",
      archetypeDescription: "Clean code.",
    };

    const url = generateShareUrl(summary);
    expect(url).toContain("https://twitter.com/intent/tweet");
    expect(url).toContain("The%20Clean%20Coder");
    expect(url).toContain("95");
  });

  it("renders insufficient data warning when isSufficientData=false", () => {
    const summary: MetricSummary = {
      totalLinesAdded: 50,
      aiLinesAdded: 50,
      totalCommits: 2,
      aiCommits: 1,
      testSkips: [],
      typeEscapes: [],
      swallowedErrors: [],
      panicLoops: [],
      rawScore: 0,
      score: 100,
      isSufficientData: false,
      archetype: "Unknown",
      archetypeDescription: "Too few commits.",
    };

    const card = formatTerminalCard(summary, { repoName: "tiny-repo", verbose: false });
    expect(card).toContain("INSUFFICIENT DATA");
  });
});
