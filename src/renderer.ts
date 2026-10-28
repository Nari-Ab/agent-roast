import pc from "picocolors";
import { MetricSummary } from "./types.js";

function historyIncomplete(summary: MetricSummary): boolean {
  return Boolean(summary.skippedLongLines || summary.skippedUnknownFiles || summary.skippedBinaryFiles);
}

export function generateShareUrl(summary: MetricSummary): string {
  if (historyIncomplete(summary)) {
    const text = "My agent-roast history audit was incomplete: some long lines, unparsed paths or binary source were skipped. No complete score was issued.\n\nAudit your repo: npx agent-roast";
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  }
  const scoreDisplay = summary.score !== null ? `${summary.score}/100` : "N/A";
  const text = `My AI coding agent scored ${scoreDisplay} on agent-roast.\n\nArchetype: ${summary.archetype}\nInfractions:\n• ${summary.testSkips.length} skipped tests\n• ${summary.typeEscapes.length} type escapes\n• ${summary.panicLoops.length} panic revert loops\n\nAudit your repo: npx agent-roast`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export function formatTerminalCard(
  summary: MetricSummary,
  options: { repoName: string; verbose?: boolean }
): string {
  const lines: string[] = [];
  const incomplete = historyIncomplete(summary);

  // Header line
  lines.push("");
  lines.push(
    `${pc.bold(pc.cyan("agent-roast"))} ${pc.dim("— git discipline audit")} ${pc.white(terminalText(options.repoName))}`
  );
  lines.push(
    `  ${pc.dim("commits:")} ${pc.yellow(summary.aiCommits)} AI / ${summary.totalCommits} total   ${pc.dim("lines added:")} ${pc.green(summary.aiLinesAdded)} AI / ${summary.totalLinesAdded} total`
  );
  lines.push("");

  if (incomplete) {
    lines.push(pc.yellow("  INCOMPLETE: long lines, unparsed paths or binary source were skipped; no complete score issued."));
    lines.push(pc.dim(`  Skipped: ${summary.skippedLongLines || 0} long lines · ${summary.skippedUnknownFiles || 0} unparsed files · ${summary.skippedBinaryFiles || 0} binary source files.`));
    lines.push("");
  } else if (!summary.isSufficientData || summary.score === null) {
    lines.push(pc.yellow(`  insufficient data (< 200 analyzed lines added)`));
    lines.push(pc.dim("  Findings below remain actionable; a score needs a larger sample."));
    lines.push("");
  }

  // Score Color
  if (!incomplete && summary.isSufficientData && summary.score !== null) {
    let scoreColor = pc.green;
    if (summary.score < 60) scoreColor = pc.red;
    else if (summary.score < 80) scoreColor = pc.yellow;

    lines.push(
      `  ${pc.bold("SCORE:")} ${scoreColor(pc.bold(`${summary.score} / 100`))}  ${pc.dim("·")}  ${pc.magenta(pc.bold(terminalText(summary.archetype)))}`
    );
    lines.push(`  ${pc.dim(terminalText(summary.archetypeDescription))}`);
    lines.push("");
  }

  const totalInfractions =
    (summary.testSkips?.length || 0) +
    (summary.focusedTests?.length || 0) +
    (summary.typeEscapes?.length || 0) +
    (summary.swallowedErrors?.length || 0) +
    (summary.panicLoops?.length || 0) +
    (summary.trivialAsserts?.length || 0) +
    (summary.stubAbandonments?.length || 0);

  lines.push(pc.bold(`  INFRACTIONS (${totalInfractions})`));
  lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));

  if (summary.panicLoops && summary.panicLoops.length > 0) {
    lines.push(
      `  ${pc.magenta("●")} ${pc.bold("panic-loop")} (${summary.panicLoops.length})  ${pc.dim("rapid consecutive fixes touching overlapping files")}`
    );
    const sample = summary.panicLoops[0];
    lines.push(`      ${pc.dim(terminalText(sample.reason))}`);
  }

  if (summary.trivialAsserts && summary.trivialAsserts.length > 0) {
    lines.push(
      `  ${pc.red("●")} ${pc.bold("trivial-assert")} (${summary.trivialAsserts.length})  ${pc.dim("vacuous test assertions (expect(true).toBe(true), assert True)")}`
    );
    const sample = summary.trivialAsserts[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${terminalText(sample.file)}: ${terminalText(sample.lineSnippet || "")}`)}`);
    }
  }

  if (summary.focusedTests?.length) {
    lines.push(`  ${pc.red("●")} ${pc.bold("test-focus")} (${summary.focusedTests.length})  ${pc.dim("exclusive tests narrow the test run")}`);
    const sample = summary.focusedTests[0];
    if (sample.file) lines.push(`      ${pc.dim(`${terminalText(sample.file)}: ${terminalText(sample.lineSnippet || "")}`)}`);
  }

  if (summary.testSkips && summary.testSkips.length > 0) {
    lines.push(
      `  ${pc.red("●")} ${pc.bold("test-skip")} (${summary.testSkips.length})  ${pc.dim("skipped or disabled tests")}`
    );
    const sample = summary.testSkips[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${terminalText(sample.file)}: ${terminalText(sample.lineSnippet || "")}`)}`);
    }
  }

  if (summary.swallowedErrors && summary.swallowedErrors.length > 0) {
    lines.push(
      `  ${pc.red("●")} ${pc.bold("swallowed-error")} (${summary.swallowedErrors.length})  ${pc.dim("empty catch blocks or except: pass")}`
    );
    const sample = summary.swallowedErrors[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${terminalText(sample.file)}: ${terminalText(sample.lineSnippet || "")}`)}`);
    }
  }

  if (summary.stubAbandonments && summary.stubAbandonments.length > 0) {
    lines.push(
      `  ${pc.yellow("●")} ${pc.bold("stub-abandonment")} (${summary.stubAbandonments.length})  ${pc.dim("unimplemented placeholders (throw new Error('TODO'), NotImplementedError)")}`
    );
    const sample = summary.stubAbandonments[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${terminalText(sample.file)}: ${terminalText(sample.lineSnippet || "")}`)}`);
    }
  }

  if (summary.typeEscapes && summary.typeEscapes.length > 0) {
    lines.push(
      `  ${pc.yellow("●")} ${pc.bold("type-escape")} (${summary.typeEscapes.length})  ${pc.dim("compiler bypasses (as any, @ts-ignore)")}`
    );
    const sample = summary.typeEscapes[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${terminalText(sample.file)}: ${terminalText(sample.lineSnippet || "")}`)}`);
    }
  }

  if (totalInfractions === 0) {
    lines.push(incomplete ? "  No findings in the inspected portion; skipped source remains unreviewed."
      : `  ${pc.green("●")} ${pc.dim("zero infractions detected across all inspected lines.")}`);
  }

  lines.push("");

  // Verbose section (if requested)
  if (options.verbose) {
    if (incomplete) {
      lines.push(pc.bold("  PARSER AUDIT STATS:"));
      lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));
      if (summary.skippedLongLines) {
        lines.push(`  ${pc.dim("skipped long lines (> 4096 chars):")} ${pc.yellow(summary.skippedLongLines)}`);
      }
      if (summary.skippedUnknownFiles) {
        lines.push(`  ${pc.dim("skipped files with unparseable path:")} ${pc.yellow(summary.skippedUnknownFiles)}`);
      }
      if (summary.skippedBinaryFiles) {
        lines.push(`  ${pc.dim("skipped binary source files:")} ${pc.yellow(summary.skippedBinaryFiles)}`);
      }
      lines.push("");
    }

    const allInfractions = [
      ...(summary.testSkips || []),
      ...(summary.focusedTests || []),
      ...(summary.trivialAsserts || []),
      ...(summary.swallowedErrors || []),
      ...(summary.stubAbandonments || []),
      ...(summary.typeEscapes || []),
      ...(summary.panicLoops || []),
    ];

    if (allInfractions.length > 0) {
      lines.push(pc.bold("  EVIDENCE (First 10 occurrences):"));
      lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));
      for (const inf of allInfractions.slice(0, 10)) {
        const fileLoc = inf.file ? `${inf.file}${inf.lineNumber ? `:${inf.lineNumber}` : ""}` : "commit history";
        lines.push(
          `  ● ${pc.cyan(terminalText(inf.commitHash.slice(0, 7)))} [${inf.type}] ${pc.white(terminalText(fileLoc))}`
        );
        if (inf.lineSnippet) {
          lines.push(`      ${pc.dim(`└─ ${terminalText(inf.lineSnippet)}`)}`);
        }
      }
      lines.push("");
    }
  }

  if (!incomplete) lines.push(
    `  ${pc.dim("Share score:")} ${pc.cyan(generateShareUrl(summary))}`
  );
  lines.push("");

  return lines.join("\n");
}

export function formatPrTerminalCard(result: import("./types.js").PrAuditResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `${pc.bold(pc.cyan("agent-roast"))} ${pc.dim(result.mode === "staged" ? "— staged changes audit" : "— pull request audit")} ${pc.white(`${result.baseSha.slice(0, 7)}...${result.headSha.slice(0, 7)}`)}`
  );

  if (!result.hasSupportedChanges) {
    if (result.complete === false) lines.push("  INCOMPLETE: some long lines, unparsed paths or binary source could not be inspected; exit 2.");
    lines.push(`  ${pc.dim("no supported source changes detected in the audited diff.")}`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `  ${pc.dim("files inspected:")} ${result.filesInspected}   ${pc.dim("lines added:")} ${result.linesAdded}`
  );
  lines.push("");

  if (result.infractions.length === 0 && result.complete !== false) {
    lines.push(`  ${pc.green("PASS")} ${pc.dim("zero infractions detected across all audited changes.")}`);
  } else {
    lines.push(pc.bold(`  INFRACTIONS DETECTED (${result.infractions.length})`));
    lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));

    for (const inf of result.infractions) {
      const isFailedRule = result.failedRules.includes(inf.type);
      const badge = isFailedRule ? pc.red("FAIL") : pc.yellow("WARN");
      const loc = `${inf.file || "unknown"}:${inf.lineNumber || 1}`;
      lines.push(`  ${badge} [${inf.type}] ${pc.white(terminalText(loc))} — ${pc.dim(terminalText(inf.reason))}`);
      if (inf.lineSnippet) {
        lines.push(`      ${pc.dim(`└─ ${terminalText(inf.lineSnippet)}`)}`);
      }
      if (inf.suggestion) lines.push(`      ${pc.dim(`Next: ${terminalText(inf.suggestion)}`)}`);
    }
  }

  lines.push("");
  if (result.complete === false) {
    lines.push("  INCOMPLETE: some long lines, unparsed paths or binary source could not be inspected; exit 2.");
  } else if (result.failedRules.length > 0) {
    lines.push(
      `  ${pc.red(pc.bold("BLOCKING FAILURE:"))} ${result.failedRules.length} rule(s) violated in --fail-on: ${result.failedRules.join(", ")}`
    );
  } else {
    lines.push(`  ${pc.green(pc.bold("PASSED:"))} no blocking infractions.`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Deterministically sorts infractions:
 * Errors first (test-skip, swallowed-error), then warnings (type-escape, panic-loop),
 * then by file ascending, then by lineNumber ascending.
 */
function sortInfractionsDeterministic(infractions: import("./types.js").Infraction[]): import("./types.js").Infraction[] {
  const getLevelRank = (type: string) => {
    return type === "test-skip" || type === "trivial-assert" || type === "swallowed-error" ? 0 : 1;
  };

  return [...infractions].sort((a, b) => {
    const rankDiff = getLevelRank(a.type) - getLevelRank(b.type);
    if (rankDiff !== 0) return rankDiff;

    const fileA = a.file || "";
    const fileB = b.file || "";
    if (fileA !== fileB) return fileA.localeCompare(fileB);

    return (a.lineNumber || 0) - (b.lineNumber || 0);
  });
}

/**
 * Generates GitHub Actions workflow commands (::error and ::warning)
 * respecting GitHub's limits (max 10 annotations per level per step).
 */
function escapeCommand(value: string, property = false): string {
  const escaped = value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return property ? escaped.replace(/:/g, "%3A").replace(/,/g, "%2C") : escaped;
}

export function formatGithubAnnotations(result: Pick<import("./types.js").PrAuditResult, "infractions" | "failedRules">): string {
  const outputLines: string[] = [];
  const sorted = sortInfractionsDeterministic(result.infractions);

  const MAX_PER_LEVEL = 10;
  let errorCount = 0;
  let warnCount = 0;
  let omittedCount = 0;

  for (const inf of sorted) {
    if (!inf.file || inf.file === "unknown") continue;

    const isError = result.failedRules.includes(inf.type);
    const line = inf.lineNumber || 1;
    const title = escapeCommand(inf.reason, true);
    const msg = escapeCommand(inf.lineSnippet || inf.reason);

    if (isError) {
      if (errorCount < MAX_PER_LEVEL) {
        outputLines.push(`::error file=${escapeCommand(inf.file, true)},line=${line},title=${title}::${msg}`);
        errorCount++;
      } else {
        omittedCount++;
      }
    } else {
      if (warnCount < MAX_PER_LEVEL) {
        outputLines.push(`::warning file=${escapeCommand(inf.file, true)},line=${line},title=${title}::${msg}`);
        warnCount++;
      } else {
        omittedCount++;
      }
    }
  }

  if (omittedCount > 0) {
    outputLines.push(
      `::notice::And ${omittedCount} more infractions omitted from annotations. See step summary for full report.`
    );
  }

  return outputLines.join("\n");
}

/**
 * Generates GitHub Step Summary Markdown
 */
export function formatGithubStepSummary(result: import("./types.js").PrAuditResult): string {
  const lines: string[] = [];

  lines.push(result.mode === "staged" ? "### agent-roast Staged Changes Audit" : "### agent-roast Pull Request Audit");
  lines.push("");

  if (!result.hasSupportedChanges) {
    if (result.complete === false) lines.push("INCOMPLETE: some long lines, unparsed paths or binary source could not be inspected; exit 2.");
    lines.push("No supported source file changes detected in the audited diff.");
    return lines.join("\n");
  }

  const statusBadge = result.complete === false ? "INCOMPLETE" : result.passed
    ? "Passed"
    : `Failed (${result.failedRules.join(", ")})`;

  lines.push(`| Status | Base | Head | Files | Lines Added | Infractions |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  lines.push(
    `| **${statusBadge}** | \`${result.baseSha.slice(0, 7)}\` | \`${result.headSha.slice(0, 7)}\` | ${result.filesInspected} | ${result.linesAdded} | ${result.infractions.length} |`
  );
  lines.push("");

  if (result.infractions.length > 0) {
    lines.push("#### Infractions");
    lines.push("");
    lines.push("| Type | File:Line | Description | Snippet |");
    lines.push("| --- | --- | --- | --- |");

    const sorted = sortInfractionsDeterministic(result.infractions);
    for (const inf of sorted) {
      const loc = inf.file ? markdownCell(`${inf.file}:${inf.lineNumber || 1}`) : "history";
      const snippet = inf.lineSnippet ? markdownCell(inf.lineSnippet) : "-";
      lines.push(`| ${inf.type} | ${loc} | ${markdownCell(inf.reason)} | ${snippet} |`);
    }
    lines.push("");
  } else {
    lines.push(result.complete === false ? "INCOMPLETE: skipped long lines, unparsed paths or binary source prevent a clean result." : "Clean pull request: zero shortcuts or bypassed checks detected.");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generates rich GitHub PR Comment Markdown (for PR comments / sticky bots)
 */
export function formatPrMarkdownComment(result: import("./types.js").PrAuditResult): string {
  const lines: string[] = [];

  const titleEmoji = result.complete === false ? "⚠️" : result.passed ? "✅" : "❌";
  const titleStatus = result.complete === false ? "INCOMPLETE" : result.passed ? "PASSED" : "BLOCKED";

  lines.push(`## 🛡️ agent-roast audit: ${titleStatus} ${titleEmoji}`);
  lines.push("");

  if (!result.hasSupportedChanges) {
    if (result.complete === false) lines.push("INCOMPLETE: some long lines, unparsed paths or binary source could not be inspected; exit 2.");
    lines.push("No supported source file changes detected in the audited diff.");
    lines.push("");
    lines.push("---");
    lines.push("*Audited 100% offline with [agent-roast](https://github.com/Nari-Ab/agent-roast)*");
    return lines.join("\n");
  }

  const statusText = result.complete === false ? "⚠️ INCOMPLETE" : result.passed
    ? "✅ Passed"
    : `❌ Blocked on ${result.failedRules.join(", ")}`;

  lines.push("| Status | Defect Density | Files Inspected | Lines Added | Infractions |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");
  lines.push(
    `| ${statusText} | ${result.defectDensityPer100Lines} / 100 LOC | ${result.filesInspected} | +${result.linesAdded} | ${result.infractions.length} |`
  );
  lines.push("");

  if (result.infractions.length > 0) {
    lines.push("<details>");
    lines.push(`<summary><b>View Detected Infractions (${result.infractions.length})</b></summary>`);
    lines.push("");
    lines.push("| Type | File:Line | Description | Snippet |");
    lines.push("| :--- | :--- | :--- | :--- |");

    const sorted = sortInfractionsDeterministic(result.infractions);
    for (const inf of sorted) {
      const loc = inf.file ? markdownCell(`${inf.file}:${inf.lineNumber || 1}`) : "history";
      const snippet = inf.lineSnippet ? markdownCell(inf.lineSnippet) : "-";
      lines.push(`| ${inf.type} | ${loc} | ${markdownCell(inf.reason)} | ${snippet} |`);
    }

    lines.push("");
    lines.push("</details>");
    lines.push("");
  } else {
    lines.push(result.complete === false ? "INCOMPLETE: skipped long lines, unparsed paths or binary source prevent a clean result." : "✨ **Clean pull request**: Zero AI shortcuts, bypassed tests, or compiler type escapes detected.");
    lines.push("");
  }

  lines.push("---");
  lines.push("*Audited 100% offline with [agent-roast](https://github.com/Nari-Ab/agent-roast)*");

  return lines.join("\n");
}


export function terminalText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function exceptionTerminal(result: { suppressedFindings?: import("./types.js").SuppressedFinding[]; expiredExceptionCount?: number }): string[] {
  const lines: string[] = [];
  const accepted = result.suppressedFindings || [];
  if (accepted.length) {
    lines.push(`  ${accepted.length} findings accepted by explicit exceptions (not fixed)`);
    for (const finding of accepted.slice(0, 20)) lines.push(
      `  ACCEPTED [${finding.type}] ${terminalText(finding.file || "unknown")}:${finding.lineNumber} — ${terminalText(finding.suppression.reason)} (expires ${terminalText(finding.suppression.expires)})`);
    if (accepted.length > 20) lines.push(`  ${accepted.length - 20} more accepted findings; use --format json.`);
  }
  if (result.expiredExceptionCount) lines.push(`  ${result.expiredExceptionCount} expired exceptions were not applied; review their findings.`);
  return lines;
}

function exceptionMarkdown(result: { suppressedFindings?: import("./types.js").SuppressedFinding[]; expiredExceptionCount?: number }): string[] {
  const lines: string[] = [];
  const accepted = result.suppressedFindings || [];
  if (accepted.length) {
    lines.push("", `### Accepted exceptions (${accepted.length})`, "", "These findings remain in the source and were accepted by explicit policy; they were not fixed.", "",
      "| Rule | Location | Reason | Expires |", "| --- | --- | --- | --- |");
    for (const finding of accepted) lines.push(`| ${finding.type} | ${markdownCell(`${finding.file}:${finding.lineNumber}`)} | ${markdownCell(finding.suppression.reason)} | ${markdownCell(finding.suppression.expires)} |`);
  }
  if (result.expiredExceptionCount) lines.push("", `${result.expiredExceptionCount} expired exceptions were not applied; review their findings.`);
  return lines;
}

/** Current-tree report emphasizes next actions and explicitly accounts for baseline debt. */
export function formatCheckTerminal(result: import("./types.js").CheckResult): string {
  const lines = ["", pc.bold("agent-roast — current code check"),
    `  ${result.filesInspected} files · ${result.linesInspected} lines inspected`,
    `  ${result.infractions.length} findings to review · ${result.baselineCount} accepted baseline findings`];
  lines.push(...exceptionTerminal(result));
  if (result.staleBaselineCount) lines.push(`  ${result.staleBaselineCount} baseline findings no longer present (or now disabled/ignored).`);
  for (const inf of result.infractions.slice(0, 20)) {
    lines.push("", `  ${result.failedRules.includes(inf.type) ? pc.red("FAIL") : pc.yellow("WARN")} [${inf.type}] ${terminalText(inf.file || "unknown")}:${inf.lineNumber}`, `    ${terminalText(inf.lineSnippet || inf.reason)}`);
    if (inf.suggestion) lines.push(`    Next: ${terminalText(inf.suggestion)}`);
  }
  if (result.infractions.length > 20) lines.push(`\n  ${result.infractions.length - 20} more findings. Use --format json for the complete report.`);
  for (const skipped of result.skippedFiles) lines.push(`\n  NOT SCANNED ${terminalText(skipped.file)}: ${terminalText(skipped.reason)}`);
  lines.push("", !result.complete ? pc.red("  INCOMPLETE: some source could not be inspected; exit 2.") : result.passed ? pc.green("  PASSED: no new blocking findings.") : pc.red(`  BLOCKED: ${result.failedRules.join(", ")}.`), "");
  if (!result.filesInspected) lines.push("  No supported source files inspected.", "");
  return lines.join("\n");
}

function markdownCell(value: string): string {
  return terminalText(value).replace(/[\\[\]*_!]/g, "\\$&").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|").replace(/`/g, "&#96;").replace(/@/g, "&#64;");
}

export function formatCheckMarkdown(result: import("./types.js").CheckResult): string {
  const status = !result.complete ? "INCOMPLETE" : result.passed ? "PASSED" : "BLOCKED";
  const lines = [`## agent-roast current code check: ${status}`, "",
    `${result.filesInspected} files, ${result.linesInspected} lines inspected. ${result.infractions.length} findings to review; ${result.baselineCount} accepted baseline findings.`, "",
    "| Rule | Location | Finding | Next step |", "| --- | --- | --- | --- |"];
  for (const inf of result.infractions) lines.push(`| ${inf.type} | ${markdownCell(`${inf.file}:${inf.lineNumber}`)} | ${markdownCell(inf.lineSnippet || inf.reason)} | ${markdownCell(inf.suggestion || "Review this occurrence.")} |`);
  lines.push(...exceptionMarkdown(result));
  if (result.staleBaselineCount) lines.push("", `${result.staleBaselineCount} baseline findings no longer present (or now disabled/ignored).`);
  for (const skipped of result.skippedFiles) lines.push("", `Not scanned: ${markdownCell(skipped.file)} — ${markdownCell(skipped.reason)}`);
  return lines.join("\n");
}

export function formatReviewTerminal(result: import("./types.js").ReviewResult): string {
  const status = !result.complete ? "INCOMPLETE" : result.passed ? "PASSED" : "BLOCKED";
  const lines = ["", pc.bold(`agent-roast — ${result.source === "index" ? "staged context review" : "context review"}: ${status}`),
    `  ${result.mergeBaseSha.slice(0, 7)} → ${result.headSha.slice(0, result.source === "index" ? 18 : 7)} · policy: ${result.policySha === "EMPTY" ? "built-in first-commit defaults" : "base " + result.policySha.slice(0, 7)}`,
    `  ${result.filesInspected} changed files compared · ${result.linesInspected} source lines inspected across both versions`,
    `  ${result.infractions.length} new · ${result.unchangedCount} existing · ${result.removedFindings.length} no longer detected`];
  lines.push(...exceptionTerminal(result));
  if (result.policyChanges.length) lines.push("  Candidate policy changes were ignored; adopt them separately after review.");
  if (result.excludedFiles || result.unsupportedFiles) lines.push(`  ${result.excludedFiles} excluded · ${result.unsupportedFiles} unsupported/non-source changes`);
  for (const finding of result.infractions.slice(0, 20)) {
    lines.push("", `  ${result.failedRules.includes(finding.type) ? "FAIL" : "WARN"} [${finding.type}] ${terminalText(finding.file || "unknown")}:${finding.lineNumber}`,
      `    ${terminalText(finding.lineSnippet || finding.reason)}`, `    Next: ${terminalText(finding.suggestion || "Review this occurrence.")}`);
  }
  if (result.infractions.length > 20) lines.push(`  ${result.infractions.length - 20} more new findings; use --format json for all results.`);
  for (const skipped of result.skippedFiles) lines.push(`  NOT COMPARED ${terminalText(skipped.file)}: ${terminalText(skipped.reason)}`);
  lines.push("", !result.complete ? "  INCOMPLETE: some changed source was not compared (exit 2)." : result.passed ? "  PASSED: no new blocking findings." : `  BLOCKED: ${result.failedRules.join(", ")}.`, "");
  if (!result.filesInspected) lines.push("  No supported changed source files compared.", "");
  return lines.join("\n");
}

export function formatReviewMarkdown(result: import("./types.js").ReviewResult): string {
  const status = !result.complete ? "INCOMPLETE" : result.passed ? "PASSED" : "BLOCKED";
  const lines = [`## agent-roast ${result.source === "index" ? "staged context review" : "context review"}: ${status}`, "",
    `Compared ${result.filesInspected} changed files at \`${result.mergeBaseSha.slice(0, 7)}\` → \`${result.headSha.slice(0, result.source === "index" ? 18 : 7)}\`. Policy: \`${result.policySha === "EMPTY" ? "built-in first-commit defaults" : result.policySha.slice(0, 7)}\`.`, "",
    `**${result.infractions.length} new** · ${result.unchangedCount} existing · ${result.removedFindings.length} no longer detected.`, ""];
  if (result.policyChanges.length) lines.push("Candidate policy changes were ignored. This review uses the supplied base commit's policy.", "");
  lines.push("| New finding | Head location | Evidence | Next step |", "| --- | --- | --- | --- |");
  for (const finding of result.infractions) lines.push(`| ${finding.type} | ${markdownCell(`${finding.file}:${finding.lineNumber}`)} | ${markdownCell(finding.lineSnippet || finding.reason)} | ${markdownCell(finding.suggestion || "Review this occurrence.")} |`);
  lines.push(...exceptionMarkdown(result));
  if (result.removedFindings.length) {
    lines.push("", "### No longer detected", "", "These patterns disappeared from the compared source. Deleting code is not proof of a behavioral fix.", "",
      "| Rule | Previous location | Previous evidence |", "| --- | --- | --- |");
    for (const finding of result.removedFindings) lines.push(`| ${finding.type} | ${markdownCell(`${finding.file}:${finding.lineNumber}`)} | ${markdownCell(finding.lineSnippet || finding.reason)} |`);
  }
  for (const skipped of result.skippedFiles) lines.push("", `Not compared: ${markdownCell(skipped.file)} — ${markdownCell(skipped.reason)}`);
  lines.push("", `Scope: changed supported files only; ${result.excludedFiles} excluded and ${result.unsupportedFiles} unsupported/non-source changes.`);
  return lines.join("\n");
}
