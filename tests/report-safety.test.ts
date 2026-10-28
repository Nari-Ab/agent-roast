import { describe, expect, it } from "vitest";
import { formatTerminalCard, formatPrTerminalCard, formatGithubStepSummary, formatPrMarkdownComment, formatCheckMarkdown, formatReviewMarkdown, generateShareUrl, terminalText } from "../src/renderer.js";
import { MetricsCollector } from "../src/metrics.js";
import type { PrAuditResult, CheckResult, ReviewResult, Infraction } from "../src/types.js";

const hostile = "bad\u001b]52;c;payload\u0007\u202e`\n![image](https://evil.invalid) <img src=x> | @someone";
const finding: Infraction = { type: "test-skip", file: hostile + ".ts", lineNumber: 2, lineSnippet: hostile,
  reason: hostile, suggestion: hostile, commitHash: "abcdef0", commitDate: "" };
const pr: PrAuditResult = { schemaVersion: "1", baseSha: "abcdef0", headSha: "abcdef1", mergeBaseSha: "abcdef0", hasSupportedChanges: true,
  filesInspected: 1, linesAdded: 1, defectDensityPer100Lines: 1, infractions: [finding], failedRules: ["test-skip"], passed: false,
  skippedLongLines: 0, skippedUnknownFiles: 0, output: "", exitCode: 1 };

describe("untrusted report evidence", () => {
  it("renders Git filenames/source/repo names as inert terminal text in historical mode", () => {
    const summary = new MetricsCollector().getSummary();
    summary.testSkips = [finding]; summary.panicLoops = [{ ...finding, type: "panic-loop" }];
    const rendered = formatTerminalCard(summary, { repoName: hostile, verbose: true });
    expect(rendered).not.toContain("\u001b]52"); expect(rendered).not.toContain("\u0007"); expect(rendered).not.toContain("\u202e");
    expect(rendered).toContain("\\u001b]52"); expect(rendered).toContain("\\u202e");
  });
  it("does the same for legacy PR terminal evidence, reason and suggestion", () => {
    const rendered = formatPrTerminalCard(pr);
    expect(rendered).not.toContain("\u001b]52"); expect(rendered).not.toContain("\u202e");
    expect(rendered).toContain("\\u001b]52");
  });
  it.each([formatGithubStepSummary, formatPrMarkdownComment])("keeps legacy Markdown source from creating images/HTML or new rows", format => {
    const rendered = format(pr);
    expect(rendered).not.toContain("![image]"); expect(rendered).not.toContain("<img"); expect(rendered).not.toContain("\u202e");
    expect(rendered).toContain("&lt;img"); expect(rendered).toContain("&#64;someone"); expect(rendered).toContain("&#96;");
    expect(rendered).not.toContain("\n![image]");
  });
  it("keeps modern Markdown evidence equally inert", () => {
    const check: CheckResult = { schemaVersion: "1", mode: "check", filesInspected: 1, linesInspected: 1, totalFindings: 1,
      infractions: [finding], baselineCount: 0, staleBaselineCount: 0, skippedFiles: [], complete: true, failedRules: ["test-skip"], passed: false, exitCode: 1, output: "" };
    const review: ReviewResult = { ...pr, schemaVersion: "1", mode: "review", source: "commits", policySha: "abcdef0", policyFile: null, policyChanges: [],
      filesChanged: 1, filesInspected: 1, unsupportedFiles: 0, excludedFiles: 0, renamedFiles: 0, linesInspected: 1,
      beforeFindings: 0, afterFindings: 1, unchangedCount: 0, removedFindings: [], skippedFiles: [], complete: true };
    for (const rendered of [formatCheckMarkdown(check), formatReviewMarkdown(review)]) {
      expect(rendered).not.toContain("![image]"); expect(rendered).not.toContain("<img"); expect(rendered).not.toContain("\u202e");
      expect(rendered).toContain("&lt;img"); expect(rendered).toContain("&#64;someone");
    }
  });
});

describe("honest report states", () => {
  it("never presents incomplete legacy scans as passed or clean", () => {
    const incomplete = { ...pr, complete: false, passed: false, infractions: [], failedRules: [], exitCode: 2 };
    for (const rendered of [formatPrTerminalCard(incomplete), formatGithubStepSummary(incomplete), formatPrMarkdownComment(incomplete)]) {
      expect(rendered).toContain("INCOMPLETE");
      expect(rendered).not.toMatch(/\bPASSED\b|\bPASS\b|Clean pull request/);
    }
  });
  it("reports reasoned exceptions as accepted source findings, with expiry and safe evidence", async () => {
    const { formatCheckTerminal, formatReviewTerminal } = await import("../src/renderer.js");
    const suppressed = { ...finding, suppression: { reason: hostile, expires: "2026-12-31" } };
    const check: CheckResult = { schemaVersion: "1", mode: "check", filesInspected: 1, linesInspected: 1, totalFindings: 1,
      infractions: [], baselineCount: 0, staleBaselineCount: 0, skippedFiles: [], complete: true, failedRules: [], passed: true, exitCode: 0, output: "",
      suppressedFindings: [suppressed], expiredExceptionCount: 1 };
    const review: ReviewResult = { ...pr, schemaVersion: "1", mode: "review", source: "commits", policySha: "abcdef0", policyFile: null, policyChanges: [],
      filesChanged: 1, filesInspected: 1, unsupportedFiles: 0, excludedFiles: 0, renamedFiles: 0, linesInspected: 1,
      beforeFindings: 0, afterFindings: 1, unchangedCount: 0, removedFindings: [], skippedFiles: [], complete: true,
      infractions: [], passed: true, failedRules: [], exitCode: 0, suppressedFindings: [suppressed], expiredExceptionCount: 1 };
    for (const rendered of [formatCheckTerminal(check), formatReviewTerminal(review)]) {
      expect(rendered).toContain("accepted by explicit exceptions (not fixed)");
      expect(rendered).toContain("expires 2026-12-31"); expect(rendered).toContain("1 expired exceptions were not applied");
      expect(rendered).not.toContain("\u001b]52"); expect(rendered).not.toContain("\u202e");
    }
    for (const rendered of [formatCheckMarkdown(check), formatReviewMarkdown(review)]) {
      expect(rendered).toContain("Accepted exceptions (1)"); expect(rendered).toContain("were not fixed");
      expect(rendered).toContain("2026-12-31"); expect(rendered).toContain("&lt;img"); expect(rendered).not.toContain("![image]");
    }
  });
});


describe("incomplete historical coverage", () => {
  it.each(["skippedLongLines", "skippedUnknownFiles", "skippedBinaryFiles"] as const)("does not present %s as a clean score even outside verbose mode", key => {
    const summary = new MetricsCollector().getSummary();
    summary.score = 100; summary.isSufficientData = true;
    summary.archetype = "The Clean Coder"; summary.archetypeDescription = "Spotless discipline";
    summary[key] = 1;
    for (const verbose of [false, true]) {
      const rendered = formatTerminalCard(summary, { repoName: "partial", verbose });
      expect(rendered).toContain("INCOMPLETE"); expect(rendered).toContain("binary source");
      expect(rendered).not.toContain("100 / 100"); expect(rendered).not.toContain("The Clean Coder");
      expect(rendered).not.toContain("zero infractions detected across all"); expect(rendered).not.toContain("Share score");
    }
    const share = decodeURIComponent(generateShareUrl(summary));
    expect(share).toContain("incomplete"); expect(share).not.toContain("100/100"); expect(share).not.toContain("The Clean Coder");
  });
  it("normalizes Unicode line and paragraph separators as visible text", () => {
    expect(terminalText("a\u2028b\u2029c")).toBe("a\\u2028b\\u2029c");
  });
});

it.each(["skippedLongLines", "skippedUnknownFiles", "skippedBinaryFiles"] as const)("never issues a clean history score when %s is nonzero", async field => {
  const { generateShareUrl, terminalText } = await import("../src/renderer.js");
  const summary = new MetricsCollector().getSummary();
  summary[field] = 1; summary.score = 100; summary.isSufficientData = true;
  const report = formatTerminalCard(summary, { repoName: "partial", verbose: true });
  expect(report).toContain("INCOMPLETE"); expect(report).not.toContain("SCORE:");
  expect(decodeURIComponent(generateShareUrl(summary))).toContain("incomplete");
  expect(terminalText("line\u2028next\u2029end")).toBe("line\\u2028next\\u2029end");
});
