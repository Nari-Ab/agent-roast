import pc from "picocolors";
import { MetricSummary } from "./types.js";

export function generateShareUrl(summary: MetricSummary): string {
  const text = `My AI coding agent scored ${summary.score}/100 on @agent_roast! 🤖🔥\n\nArchetype: "${summary.archetype}"\n\nInfractions:\n• ${summary.testSkips.length} skipped tests\n• ${summary.typeEscapes.length} type escapes\n• ${summary.panicLoops.length} panic revert loops\n\nAudit your repo with: npx agent-roast`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export function formatTerminalCard(
  summary: MetricSummary,
  options: { repoName: string; verbose?: boolean }
): string {
  const lines: string[] = [];

  const boxW = 60;
  const hLine = "═".repeat(boxW - 2);

  // Top header
  lines.push(pc.cyan(`╔${hLine}╗`));
  lines.push(
    pc.cyan("║") +
      pc.bold(pc.white("                 🤖 AGENT ROAST DOSSIER                    ")) +
      pc.cyan("║")
  );
  lines.push(pc.cyan(`╚${hLine}╝`));

  lines.push("");
  lines.push(`  ${pc.dim("Repository:")}  ${pc.bold(pc.white(options.repoName))}`);
  lines.push(
    `  ${pc.dim("Commits:")}     ${pc.yellow(summary.aiCommits)} AI-attributed / ${summary.totalCommits} total`
  );
  lines.push(
    `  ${pc.dim("Code Added:")}  ${pc.green(summary.aiLinesAdded)} lines (AI) / ${summary.totalLinesAdded} lines (total)`
  );
  lines.push("");

  if (!summary.isSufficientData) {
    lines.push(pc.yellow(`  ⚠  INSUFFICIENT DATA TO ROAST (< 200 lines added)`));
    lines.push(pc.dim("     Commit more AI code and run `npx agent-roast` again."));
    lines.push("");
    return lines.join("\n");
  }

  // Score Color
  let scoreColor = pc.green;
  if (summary.score < 60) scoreColor = pc.red;
  else if (summary.score < 80) scoreColor = pc.yellow;

  lines.push(`  ${pc.bold("AGENT ARCHETYPE:")}  ${pc.magenta(pc.bold(summary.archetype))}`);
  lines.push(`  ${pc.italic(summary.archetypeDescription)}`);
  lines.push("");
  lines.push(`  ${pc.bold("DISCIPLINE SCORE:")} ${scoreColor(pc.bold(`${summary.score} / 100`))}`);
  lines.push(
    pc.dim("  (100 = spotless discipline, 0 = complete shortcut addiction)")
  );
  lines.push("");

  // Infractions breakdown
  lines.push(pc.bold("  📊 INFRACTIONS BREAKDOWN:"));
  lines.push(pc.dim("  ───────────────────────────────────────────────────────"));

  // Test Skips
  const skipIcon = summary.testSkips.length > 0 ? pc.red("✖") : pc.green("✔");
  lines.push(
    `  ${skipIcon}  ${pc.bold("Skipped tests:")}       ${summary.testSkips.length} ${pc.dim("(it.skip, describe.skip, xit)")}`
  );

  // Type Escapes
  const escapeIcon = summary.typeEscapes.length > 0 ? pc.yellow("▲") : pc.green("✔");
  lines.push(
    `  ${escapeIcon}  ${pc.bold("Type escapes:")}        ${summary.typeEscapes.length} ${pc.dim("(as any, @ts-ignore, eslint-disable)")}`
  );

  // Swallowed Errors
  const errorIcon = summary.swallowedErrors.length > 0 ? pc.red("✖") : pc.green("✔");
  lines.push(
    `  ${errorIcon}  ${pc.bold("Swallowed errors:")}    ${summary.swallowedErrors.length} ${pc.dim("(empty catch {}, except: pass)")}`
  );

  // Panic Loops
  const panicIcon = summary.panicLoops.length > 0 ? pc.magenta("↻") : pc.green("✔");
  lines.push(
    `  ${panicIcon}  ${pc.bold("Panic fix loops:")}     ${summary.panicLoops.length} ${pc.dim("(quick fixes < 15m apart)")}`
  );

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
      lines.push(pc.bold("  🔍 VERBOSE PROOFS (First 10 items):"));
      lines.push(pc.dim("  ───────────────────────────────────────────────────────"));
      for (const inf of allInfractions.slice(0, 10)) {
        const fileLoc = inf.file ? `${inf.file}` : "git commit";
        lines.push(
          `  • ${pc.cyan(inf.commitHash.slice(0, 7))} [${inf.type}] ${pc.white(fileLoc)}`
        );
        if (inf.lineSnippet) {
          lines.push(`    ${pc.dim(inf.lineSnippet)}`);
        }
      }
      lines.push("");
    }
  }

  // Share intent
  const shareUrl = generateShareUrl(summary);
  lines.push(pc.dim("  ───────────────────────────────────────────────────────"));
  lines.push(
    `  ${pc.cyan("📢 Share your score on X:")} ${pc.underline(pc.cyan(shareUrl))}`
  );
  lines.push(
    `  ${pc.dim("Tip: Run with --verbose to see exact commit SHAs and lines")}`
  );
  lines.push("");

  return lines.join("\n");
}
