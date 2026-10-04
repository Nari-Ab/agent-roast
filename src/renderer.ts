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
        const fileLoc = inf.file ? `${inf.file}` : "commit history";
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
