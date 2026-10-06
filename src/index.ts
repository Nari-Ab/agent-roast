import path from "path";
import {
  streamGitLog,
  parseGitLogStream,
  streamGitDiff,
  parseDiff,
  resolveCommitSha,
  findMergeBase,
  GitResolutionError,
} from "./git.js";
import { MetricsCollector, auditFileDiffs } from "./metrics.js";
import {
  formatTerminalCard,
  formatPrTerminalCard,
  formatGithubAnnotations,
} from "./renderer.js";
import {
  MetricSummary,
  RoastOptions,
  PrAuditOptions,
  PrAuditResult,
  VALID_DETECTORS,
  DetectorType,
} from "./types.js";

export * from "./types.js";
export * from "./detector.js";
export * from "./git.js";
export * from "./metrics.js";
export * from "./renderer.js";

export class InvalidDetectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDetectorError";
  }
}

export async function roastRepository(
  options: RoastOptions = {}
): Promise<{ summary: MetricSummary; output: string }> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const since = options.since || "90 days ago";
  const repoName = path.basename(cwd);

  const collector = new MetricsCollector({ all: options.all });
  const gitStream = streamGitLog(cwd, since);

  await parseGitLogStream(gitStream, (commit, stats) => {
    collector.processCommit(commit);
    collector.recordSkipped(stats);
  });

  const summary = collector.getSummary();
  const output = formatTerminalCard(summary, {
    repoName,
    verbose: options.verbose,
  });

  return { summary, output };
}

export async function auditPullRequest(
  options: PrAuditOptions
): Promise<PrAuditResult> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const format = options.format || "terminal";
  const failOn = (options.failOn || ["test-skip"]).map((s) => s.trim()).filter(Boolean);

  // Validate detector names in failOn
  for (const det of failOn) {
    if (!VALID_DETECTORS.includes(det as DetectorType)) {
      throw new InvalidDetectorError(
        `Unknown detector '${det}' in --fail-on. Valid options: ${VALID_DETECTORS.join(", ")}`
      );
    }
  }

  // 1. Resolve base and head refs to SHA safely
  const baseSha = resolveCommitSha(cwd, options.base, "Base ref");
  const headSha = resolveCommitSha(cwd, options.head, "Head ref");

  // 2. Find merge base
  const mergeBaseSha = findMergeBase(cwd, baseSha, headSha);

  // 3. Diff from mergeBaseSha to headSha
  const diffStream = streamGitDiff(cwd, mergeBaseSha, headSha);
  let rawDiff = "";
  await new Promise<void>((resolve, reject) => {
    diffStream.on("data", (chunk) => {
      rawDiff += chunk.toString();
    });
    diffStream.on("end", () => resolve());
    diffStream.on("error", reject);
  });

  // 4. Parse diff
  const { files, skippedLongLines, skippedUnknownFiles } = parseDiff(rawDiff);

  // 5. Audit files
  const audit = auditFileDiffs(files, headSha);
  const infractions = audit.infractions;

  const defectDensityPer100Lines = audit.linesAdded > 0
    ? Math.round((infractions.length / audit.linesAdded) * 100 * 100) / 100
    : 0;

  const failedRules = [...new Set(
    infractions
      .filter((inf) => failOn.includes(inf.type))
      .map((inf) => inf.type)
  )];

  const passed = failedRules.length === 0;
  const exitCode = passed ? 0 : 1;

  const result: PrAuditResult = {
    schemaVersion: "1.0.0",
    baseSha,
    headSha,
    mergeBaseSha,
    hasSupportedChanges: audit.hasSupportedChanges,
    filesInspected: audit.filesInspected,
    linesAdded: audit.linesAdded,
    defectDensityPer100Lines,
    infractions,
    failedRules,
    passed,
    skippedLongLines,
    skippedUnknownFiles,
    output: "",
    exitCode,
  };

  if (format === "json") {
    result.output = JSON.stringify(result, null, 2);
  } else if (format === "github") {
    result.output = formatGithubAnnotations(result);
  } else {
    result.output = formatPrTerminalCard(result);
  }

  return result;
}

