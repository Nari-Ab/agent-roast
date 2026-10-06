import pc from "picocolors";
import { MetricSummary } from "./types.js";

export function generateShareUrl(summary: MetricSummary): string {
  const text = `My AI coding agent scored ${summary.score}/100 on agent-roast.\n\nArchetype: ${summary.archetype}\nInfractions:\n• ${summary.testSkips.length} skipped tests\n• ${summary.typeEscapes.length} type escapes\n• ${summary.panicLoops.length} panic revert loops\n\nAudit your repo: npx agent-roast`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export function formatTerminalCard(
  summary: MetricSummary,
  options: { repoName: string; verbose?: boolean }
): string {
  const lines: string[] = [];

  // Header line
  lines.push("");
  lines.push(
    `${pc.bold(pc.cyan("agent-roast"))} ${pc.dim("— git discipline audit")} ${pc.white(options.repoName)}`
  );
  lines.push(
    `  ${pc.dim("commits:")} ${pc.yellow(summary.aiCommits)} AI / ${summary.totalCommits} total   ${pc.dim("lines added:")} ${pc.green(summary.aiLinesAdded)} AI / ${summary.totalLinesAdded} total`
  );
  lines.push("");

  if (!summary.isSufficientData) {
    lines.push(pc.yellow(`  insufficient data (< 200 lines added by AI)`));
    lines.push(pc.dim("  commit more code and run `npx agent-roast` again."));
    lines.push("");
    return lines.join("\n");
  }

  // Score Color
  let scoreColor = pc.green;
  if (summary.score < 60) scoreColor = pc.red;
  else if (summary.score < 80) scoreColor = pc.yellow;

  lines.push(
    `  ${pc.bold("SCORE:")} ${scoreColor(pc.bold(`${summary.score} / 100`))}  ${pc.dim("·")}  ${pc.magenta(pc.bold(summary.archetype))}`
  );
  lines.push(`  ${pc.dim(summary.archetypeDescription)}`);
  lines.push("");

  const totalInfractions =
    summary.testSkips.length +
    summary.typeEscapes.length +
    summary.swallowedErrors.length +
    summary.panicLoops.length;

  lines.push(pc.bold(`  INFRACTIONS (${totalInfractions})`));
  lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));

  if (summary.panicLoops.length > 0) {
    lines.push(
      `  ${pc.magenta("●")} ${pc.bold("panic-loop")} (${summary.panicLoops.length})  ${pc.dim("consecutive quick fixes < 15m apart")}`
    );
    const sample = summary.panicLoops[0];
    lines.push(`      ${pc.dim(sample.reason)}`);
  }

  if (summary.typeEscapes.length > 0) {
    lines.push(
      `  ${pc.yellow("●")} ${pc.bold("type-escape")} (${summary.typeEscapes.length})  ${pc.dim("compiler bypasses (as any, @ts-ignore)")}`
    );
    const sample = summary.typeEscapes[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${sample.file}: ${sample.lineSnippet || ""}`)}`);
    }
  }

  if (summary.testSkips.length > 0) {
    lines.push(
      `  ${pc.red("●")} ${pc.bold("test-skip")} (${summary.testSkips.length})  ${pc.dim("skipped or disabled tests")}`
    );
    const sample = summary.testSkips[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${sample.file}: ${sample.lineSnippet || ""}`)}`);
    }
  }

  if (summary.swallowedErrors.length > 0) {
    lines.push(
      `  ${pc.red("●")} ${pc.bold("swallowed-error")} (${summary.swallowedErrors.length})  ${pc.dim("empty catch blocks or except: pass")}`
    );
    const sample = summary.swallowedErrors[0];
    if (sample.file) {
      lines.push(`      ${pc.dim(`${sample.file}: ${sample.lineSnippet || ""}`)}`);
    }
  }

  if (totalInfractions === 0) {
    lines.push(`  ${pc.green("●")} ${pc.dim("zero infractions detected across all inspected lines.")}`);
  }

  lines.push("");

  // Verbose section (if requested)
  if (options.verbose) {
    if (summary.skippedLongLines || summary.skippedUnknownFiles) {
      lines.push(pc.bold("  PARSER AUDIT STATS:"));
      lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));
      if (summary.skippedLongLines) {
        lines.push(`  ${pc.dim("skipped long lines (> 4096 chars):")} ${pc.yellow(summary.skippedLongLines)}`);
      }
      if (summary.skippedUnknownFiles) {
        lines.push(`  ${pc.dim("skipped files with unparseable path:")} ${pc.yellow(summary.skippedUnknownFiles)}`);
      }
      lines.push("");
    }

    const allInfractions = [
      ...summary.testSkips,
      ...summary.typeEscapes,
      ...summary.swallowedErrors,
      ...summary.panicLoops,
    ];

    if (allInfractions.length > 0) {
      lines.push(pc.bold("  EVIDENCE (First 10 occurrences):"));
      lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));
      for (const inf of allInfractions.slice(0, 10)) {
        const fileLoc = inf.file ? `${inf.file}${inf.lineNumber ? `:${inf.lineNumber}` : ""}` : "commit history";
        lines.push(
          `  ● ${pc.cyan(inf.commitHash.slice(0, 7))} [${inf.type}] ${pc.white(fileLoc)}`
        );
        if (inf.lineSnippet) {
          lines.push(`      ${pc.dim(`└─ ${inf.lineSnippet}`)}`);
        }
      }
      lines.push("");
    }
  }

  lines.push(
    `  ${pc.dim("Share score:")} ${pc.cyan(generateShareUrl(summary))}`
  );
  lines.push("");

  return lines.join("\n");
}

export function formatPrTerminalCard(result: import("./types.js").PrAuditResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `${pc.bold(pc.cyan("agent-roast"))} ${pc.dim("— pull request audit")} ${pc.white(`${result.baseSha.slice(0, 7)}...${result.headSha.slice(0, 7)}`)}`
  );

  if (!result.hasSupportedChanges) {
    lines.push(`  ${pc.dim("no supported source changes detected in pull request.")}`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `  ${pc.dim("files inspected:")} ${result.filesInspected}   ${pc.dim("lines added:")} ${result.linesAdded}`
  );
  lines.push("");

  if (result.infractions.length === 0) {
    lines.push(`  ${pc.green("PASS")} ${pc.dim("zero infractions detected across all pull request changes.")}`);
  } else {
    lines.push(pc.bold(`  INFRACTIONS DETECTED (${result.infractions.length})`));
    lines.push(pc.dim("  ──────────────────────────────────────────────────────────"));

    for (const inf of result.infractions) {
      const isFailedRule = result.failedRules.includes(inf.type);
      const badge = isFailedRule ? pc.red("FAIL") : pc.yellow("WARN");
      const loc = `${inf.file || "unknown"}:${inf.lineNumber || 1}`;
      lines.push(`  ${badge} [${inf.type}] ${pc.white(loc)} — ${pc.dim(inf.reason)}`);
      if (inf.lineSnippet) {
        lines.push(`      ${pc.dim(`└─ ${inf.lineSnippet}`)}`);
      }
    }
  }

  lines.push("");
  if (result.failedRules.length > 0) {
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
    return type === "test-skip" || type === "swallowed-error" ? 0 : 1;
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
export function formatGithubAnnotations(result: import("./types.js").PrAuditResult): string {
  const outputLines: string[] = [];
  const sorted = sortInfractionsDeterministic(result.infractions);

  const MAX_PER_LEVEL = 10;
  let errorCount = 0;
  let warnCount = 0;
  let omittedCount = 0;

  for (const inf of sorted) {
    if (!inf.file || inf.file === "unknown") continue;

    const isError = result.failedRules.includes(inf.type) || inf.type === "test-skip" || inf.type === "swallowed-error";
    const line = inf.lineNumber || 1;
    const title = inf.reason.replace(/[\r\n]/g, " ");
    const msg = (inf.lineSnippet || inf.reason).replace(/[\r\n]/g, " ");

    if (isError) {
      if (errorCount < MAX_PER_LEVEL) {
        outputLines.push(`::error file=${inf.file},line=${line},title=${title}::${msg}`);
        errorCount++;
      } else {
        omittedCount++;
      }
    } else {
      if (warnCount < MAX_PER_LEVEL) {
        outputLines.push(`::warning file=${inf.file},line=${line},title=${title}::${msg}`);
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

  lines.push("### agent-roast Pull Request Audit");
  lines.push("");

  if (!result.hasSupportedChanges) {
    lines.push("No supported source file changes detected in this pull request.");
    return lines.join("\n");
  }

  const statusBadge = result.passed
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
      const loc = inf.file ? `\`${inf.file}:${inf.lineNumber || 1}\`` : "*history*";
      const snippet = inf.lineSnippet ? `\`${inf.lineSnippet.replace(/\|/g, "\\|")}\`` : "-";
      lines.push(`| \`${inf.type}\` | ${loc} | ${inf.reason} | ${snippet} |`);
    }
    lines.push("");
  } else {
    lines.push("Clean pull request: zero shortcuts or bypassed checks detected.");
    lines.push("");
  }

  return lines.join("\n");
}

