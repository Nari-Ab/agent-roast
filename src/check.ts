import { applyExceptions } from "./exceptions.js";
import { formatSarif } from "./sarif.js";
import * as fs from "fs/promises";
import { constants } from "fs";
import path from "path";
import { auditFileDiffs, isCodeFile } from "./metrics.js";
import { readGit } from "./snapshot.js";
import { gitOutputPath } from "./git.js";
import { ConfigError, loadConfig } from "./config.js";
import { applyBaseline, loadBaseline, findingFingerprint } from "./baseline.js";
import { VALID_DETECTORS } from "./types.js";
import type { CheckOptions, CheckResult, DetectorType, Infraction } from "./types.js";
import { formatCheckTerminal, formatCheckMarkdown, formatGithubAnnotations } from "./renderer.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_BYTES = 50 * 1024 * 1024;
const GENERATED_PATHS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js", "**/*.map"];

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readGit(cwd, args, signal, 16 * 1024 * 1024));
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ConfigError("Project check cancelled; no complete result was produced.");
}

function insideRoot(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

async function readSource(root: string, file: string, signal?: AbortSignal): Promise<Buffer | null> {
  const filename = path.resolve(root, file);
  if (!insideRoot(root, filename)) throw new Error("File escapes the repository.");
  let stat;
  try { stat = await fs.lstat(filename); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; // working-tree deletion
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Symlinks and special files are not scanned.");
  const real = await fs.realpath(filename);
  if (!insideRoot(root, real)) throw new Error("File resolves outside the repository.");
  if (stat.size > MAX_FILE_BYTES) throw new Error("File exceeds the 2 MiB scan limit.");
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || !opened.isFile()) throw new Error("File changed while opening.");
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      checkAborted(signal);
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_FILE_BYTES) throw new Error("File exceeds the 2 MiB scan limit.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || size !== after.size) throw new Error("File changed while reading; rerun the check.");
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

/** Read current tracked and non-ignored untracked source; never run project code. */
export async function checkProject(options: CheckOptions = {}): Promise<CheckResult> {
  checkAborted(options.signal);
  const cwd = path.resolve(options.cwd || process.cwd());
  const root = await fs.realpath(gitOutputPath(await git(cwd, ["rev-parse", "--show-toplevel"], options.signal)));
  const config = loadConfig(root);
  const failOn = options.failOn ?? config.failOn ?? ["test-skip", "trivial-assert", "test-focus"];
  for (const rule of failOn) if (!VALID_DETECTORS.includes(rule as DetectorType)) throw new ConfigError(`Unknown rule '${rule}'.`);
  const format = options.format || "terminal";
  if (!["terminal", "json", "github", "markdown", "sarif"].includes(format)) throw new ConfigError("Unsupported check output format.");
  const baseline = options.baseline ? loadBaseline(path.resolve(cwd, options.baseline)) : undefined;
  const filenames = [...new Set((await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], options.signal)).split("\0").filter(Boolean))].sort();
  const infractions: Infraction[] = [];
  const skippedFiles: CheckResult["skippedFiles"] = [];
  let filesInspected = 0;
  let linesInspected = 0;
  let totalBytes = 0;
  for (const file of filenames) {
    checkAborted(options.signal);
    if (!isCodeFile(file, [...GENERATED_PATHS, ...(config.ignorePaths || [])])) continue;
    try {
      const content = await readSource(root, file, options.signal);
      if (content === null) continue;
      totalBytes += content.length;
      if (totalBytes > MAX_SCAN_BYTES) throw new Error("Project exceeds the 50 MiB scan limit.");
      if (content.includes(0)) throw new Error("Binary content in a source file.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      const lines = text.split(/\r?\n/);
      if (lines[lines.length - 1] === "") lines.pop();
      const audit = auditFileDiffs([{ path: file, addedLines: lines.map((line, index) => ({ line, lineNumber: index + 1 })) }], "WORKTREE", "", { rules: config.rules });
      infractions.push(...audit.infractions);
      filesInspected++;
      linesInspected += lines.length;
    } catch (error) {
      checkAborted(options.signal);
      skippedFiles.push({ file, reason: error instanceof Error ? error.message : String(error) });
      if (totalBytes > MAX_SCAN_BYTES) break;
    }
  }
  checkAborted(options.signal);
  const applied = baseline ? applyBaseline(infractions, baseline) : { findings: infractions, baselineCount: 0, staleBaselineCount: 0 };
  const notInBaseline = new Set(applied.findings);
  const acceptedCounts = new Map<string, number>();
  for (const finding of infractions) {
    if (notInBaseline.has(finding)) continue;
    const fingerprint = findingFingerprint(finding);
    acceptedCounts.set(fingerprint, (acceptedCounts.get(fingerprint) ?? 0) + 1);
  }
  const exceptions = applyExceptions(applied.findings, options.ignoreExceptions ? [] : config.exceptions, new Date(), acceptedCounts);
  const findings = exceptions.findings;
  const failedRules = [...new Set(findings.filter(finding => failOn.includes(finding.type)).map(finding => finding.type))];
  const complete = skippedFiles.length === 0;
  const passed = complete && failedRules.length === 0;
  const result: CheckResult = {
    schemaVersion: "1.0.0", mode: "check", filesInspected, linesInspected,
    totalFindings: infractions.length, infractions: findings,
    baselineCount: applied.baselineCount, staleBaselineCount: applied.staleBaselineCount,
    suppressedFindings: exceptions.suppressedFindings, expiredExceptionCount: exceptions.expiredExceptionCount,
    skippedFiles, complete, failedRules, passed, exitCode: complete ? (passed ? 0 : 1) : 2, output: "",
  };
  if (format === "json") result.output = JSON.stringify(result, null, 2);
  else if (format === "sarif") result.output = formatSarif(result);
  else if (format === "markdown") result.output = formatCheckMarkdown(result);
  else if (format === "github") {
    result.output = formatGithubAnnotations(result) + (complete ? "" : "\n::error::Project scan incomplete. See the JSON or terminal report for skipped files.");
  } else result.output = formatCheckTerminal(result);
  return result;
}
