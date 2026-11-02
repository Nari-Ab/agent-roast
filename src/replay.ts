import path from "path";
import { ConfigError } from "./config.js";
import { isCheckRule, mostImportantFirst, terminalText } from "./renderer.js";
import { reviewChanges } from "./review.js";
import { assertNotAborted, readGit } from "./snapshot.js";
import type { Infraction } from "./types.js";

export type ReplayStatus = "blocked" | "warned" | "noted" | "clean" | "untouched" | "incomplete" | "failed";

export interface ReplayCommit {
  sha: string;
  date: string;
  subject: string;
  /** blocked: a rule that blocks by default fired; warned: a check rule fired without blocking; noted: only line patterns. */
  status: ReplayStatus;
  failedRules: string[];
  findings: Infraction[];
  filesInspected: number;
  skipped: { file: string; reason: string }[];
  error?: string;
}

export interface ReplayOptions {
  cwd?: string;
  /** How many of the newest commits to review (default 50). */
  last?: number;
  /** List the line-pattern findings (type-escape, swallowed-error, ...) as well as the check rules. */
  allRules?: boolean;
  format?: "terminal" | "json";
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface ReplayResult {
  schemaVersion: string;
  mode: "replay";
  head: string;
  requested: number;
  /** Commits without a parent (the first commit, or the edge of a shallow clone) have nothing to compare with. */
  commitsWithoutParent: number;
  /** A shallow clone holds only part of the history, so fewer commits than requested may have been replayed. */
  shallow: boolean;
  summary: Record<ReplayStatus | "commits", number> & { findingsByRule: Record<string, number> };
  commits: ReplayCommit[];
  exitCode: number;
  output: string;
}

const MAX_COMMITS = 1000;
const CONCURRENCY = 4;
const LISTED_COMMITS = 15;
const LISTED_PER_RULE = 2;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Clips long evidence, keeping both sides of a "before → after" line, since the after side is the informative one. */
function clipEvidence(text: string, limit = 200): string {
  if (text.length <= limit) return text;
  const arrow = text.indexOf(" → ");
  const clip = (part: string, size: number) => part.length > size ? `${part.slice(0, size - 1)}…` : part;
  if (arrow < 0) return clip(text, limit);
  const side = Math.floor((limit - 3) / 2);
  return `${clip(text.slice(0, arrow), side)} → ${clip(text.slice(arrow + 3), side)}`;
}

/**
 * Reviews each of the newest commits of the first-parent history on its own against its parent, which is what a
 * pull-request check would have seen: one change per squash, merge or direct commit. Reads Git objects only.
 */
export async function replayHistory(options: ReplayOptions = {}): Promise<ReplayResult> {
  assertNotAborted(options.signal);
  const cwd = path.resolve(options.cwd || process.cwd());
  const last = options.last ?? 50;
  if (!Number.isInteger(last) || last < 1 || last > MAX_COMMITS) throw new ConfigError(`Replay needs a whole number of commits between 1 and ${MAX_COMMITS}.`);
  const format = options.format ?? "terminal";
  if (format !== "terminal" && format !== "json") throw new ConfigError("Replay supports the terminal and json formats.");
  let log: string;
  try {
    log = (await readGit(cwd, ["log", "--first-parent", "-n", String(last), "--format=%H%x1f%P%x1f%cI%x1f%s"], options.signal)).toString("utf8");
  } catch (error) {
    assertNotAborted(options.signal);
    throw new ConfigError(`Cannot read the commit history. ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries = log.split("\n").filter(Boolean).map(line => {
    const [sha, parents, date, ...subject] = line.split("\x1f");
    return { sha, base: parents.split(" ")[0], date, subject: subject.join(" ") };
  });
  if (!entries.length) throw new ConfigError("The repository has no commits to replay.");
  const reviewable = entries.filter(entry => entry.base);
  const commits: ReplayCommit[] = new Array(reviewable.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, reviewable.length) }, async () => {
    while (next < reviewable.length) {
      const index = next++;
      commits[index] = await replayCommit(cwd, reviewable[index], options.signal);
      options.onProgress?.(++done, reviewable.length);
    }
  }));
  if (commits.length && commits.every(commit => commit.status === "failed")) throw new ConfigError(`No commit could be reviewed. ${commits[0].error}`);
  const summary: ReplayResult["summary"] = { commits: commits.length, blocked: 0, warned: 0, noted: 0, clean: 0, untouched: 0, incomplete: 0, failed: 0, findingsByRule: {} };
  for (const commit of commits) {
    summary[commit.status]++;
    for (const finding of commit.findings) summary.findingsByRule[finding.type] = (summary.findingsByRule[finding.type] ?? 0) + 1;
  }
  const shallow = (await readGit(cwd, ["rev-parse", "--is-shallow-repository"], options.signal, 64).catch(() => Buffer.from(""))).toString().trim() === "true";
  const result: ReplayResult = { schemaVersion: "1.0.0", mode: "replay", head: entries[0].sha, requested: last, commitsWithoutParent: entries.length - reviewable.length, shallow, summary, commits, exitCode: 0, output: "" };
  result.output = format === "json" ? JSON.stringify({ ...result, output: undefined }, null, 2) : formatReplayTerminal(result, options.allRules);
  return result;
}

async function replayCommit(cwd: string, entry: { sha: string; base: string; date: string; subject: string }, signal?: AbortSignal): Promise<ReplayCommit> {
  const identity = { sha: entry.sha, date: entry.date, subject: entry.subject };
  try {
    const review = await reviewChanges({ cwd, base: entry.base, head: entry.sha, format: "json", signal });
    const status: ReplayStatus = review.failedRules.length ? "blocked" : !review.complete ? "incomplete"
      : review.infractions.some(finding => isCheckRule(finding.type)) ? "warned" : review.infractions.length ? "noted"
      : review.filesInspected ? "clean" : "untouched";
    return { ...identity, status, failedRules: review.failedRules, findings: mostImportantFirst(review.infractions, review.failedRules), filesInspected: review.filesInspected, skipped: review.skippedFiles };
  } catch (error) {
    assertNotAborted(signal);
    return { ...identity, status: "failed", failedRules: [], findings: [], filesInspected: 0, skipped: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function formatReplayTerminal(result: ReplayResult, allRules = false): string {
  const { summary } = result;
  const lines = ["", `agent-roast — replay of the last ${plural(summary.commits, "commit")} (up to ${result.head.slice(0, 7)})`,
    "  Each commit is reviewed on its own against its parent, as a pull-request check would have seen it."];
  const shallowHint = result.shallow ? ["  This clone is shallow, so only the commits it holds were replayed. Run 'git fetch --unshallow' to replay more."] : [];
  if (!summary.commits) return [...lines, "  There is no earlier commit to compare with, so nothing was reviewed.", ...shallowHint, ""].join("\n");
  lines.push(...shallowHint);
  lines.push(`  ${plural(summary.commits - summary.untouched - summary.failed, "commit")} changed source, tests or CI config · ${summary.untouched} did not`,
    `  Would have blocked: ${plural(summary.blocked, "commit")} · warnings on ${summary.warned} · line patterns only on ${summary.noted} · nothing to report on ${summary.clean}`);
  if (summary.incomplete + summary.failed) lines.push(`  Not reviewed in full: ${plural(summary.incomplete + summary.failed, "commit")}`);
  const listed = result.commits.filter(commit => commit.status === "blocked" || commit.status === "warned" || (allRules && commit.status === "noted"));
  const ordered = [...listed.filter(commit => commit.status === "blocked"), ...listed.filter(commit => commit.status !== "blocked")];
  for (const commit of ordered.slice(0, LISTED_COMMITS)) {
    lines.push("", `  ${commit.status === "blocked" ? "BLOCK" : "WARN "} ${commit.sha.slice(0, 7)} ${commit.date.slice(0, 10)} ${terminalText(commit.subject).slice(0, 80)}`);
    const shown = commit.findings.filter(finding => allRules || isCheckRule(finding.type));
    for (const rule of new Set(shown.map(finding => finding.type))) {
      const group = shown.filter(finding => finding.type === rule);
      for (const finding of group.slice(0, LISTED_PER_RULE)) {
        lines.push(`    ${commit.failedRules.includes(rule) ? "FAIL" : "WARN"} [${rule}] ${terminalText(finding.file || "unknown")}:${finding.lineNumber}`,
          `      ${clipEvidence(terminalText(finding.lineSnippet || finding.reason))}`);
      }
      if (group.length > LISTED_PER_RULE) lines.push(`    … and ${group.length - LISTED_PER_RULE} more [${rule}] in this commit`);
    }
  }
  if (ordered.length > LISTED_COMMITS) lines.push("", `  … ${plural(ordered.length - LISTED_COMMITS, "more commit")} with findings; use --json for all of them.`);
  if (!ordered.length) lines.push("", "  Nothing to report on these commits.");
  if (!allRules) {
    const hidden = result.commits.flatMap(commit => commit.findings.filter(finding => !isCheckRule(finding.type)));
    if (hidden.length) {
      const byRule = Object.entries(hidden.reduce<Record<string, number>>((counts, finding) => ({ ...counts, [finding.type]: (counts[finding.type] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
      lines.push("", `  Line patterns not listed: ${plural(hidden.length, "finding")} (${byRule.slice(0, 3).map(([rule, count]) => `${rule} ${count}`).join(", ")}). Add --all-rules to list them.`);
    }
  }
  for (const commit of result.commits.filter(commit => commit.status === "incomplete" || commit.status === "failed").slice(0, 5)) {
    lines.push(`  Not reviewed in full: ${commit.sha.slice(0, 7)} ${terminalText(commit.subject).slice(0, 60)} — ${terminalText(commit.error ?? `${plural(commit.skipped.length, "changed file")} could not be compared`)}`);
  }
  lines.push("", "  Findings are review candidates, not verdicts: `agent-roast explain <rule>` says what a rule means.",
    "  To run this on every pull request: `agent-roast init --ci`.", "");
  return lines.join("\n");
}
