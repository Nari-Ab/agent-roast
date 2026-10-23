import { spawnSync } from "child_process";
import * as fs from "fs/promises";
import { constants } from "fs";
import path from "path";
import { auditFileDiffs, isCodeFile } from "./metrics.js";
import { getHermeticGitEnv, HERMETIC_GIT_FLAGS, GitError } from "./git.js";
import { ConfigError, loadConfig } from "./config.js";
import { applyBaseline, loadBaseline } from "./baseline.js";
import { VALID_DETECTORS } from "./types.js";
import type { CheckOptions, CheckResult, DetectorType, Infraction } from "./types.js";
import { formatCheckTerminal, formatCheckMarkdown, formatGithubAnnotations } from "./renderer.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_BYTES = 50 * 1024 * 1024;
const GENERATED_PATHS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js", "**/*.map"];

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", [...HERMETIC_GIT_FLAGS, ...args], {
    cwd, env: getHermeticGitEnv(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new GitError(result.error?.message || result.stderr, result.status);
  return result.stdout;
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
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
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
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || size !== after.size) throw new Error("File changed while reading; rerun the check.");
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

/** Read current tracked and non-ignored untracked source; never run project code. */
export async function checkProject(options: CheckOptions = {}): Promise<CheckResult> {
  checkAborted(options.signal);
  const cwd = path.resolve(options.cwd || process.cwd());
  const root = await fs.realpath(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  const config = loadConfig(root);
  const failOn = options.failOn ?? config.failOn ?? ["test-skip", "trivial-assert"];
  for (const rule of failOn) if (!VALID_DETECTORS.includes(rule as DetectorType)) throw new ConfigError(`Unknown rule '${rule}'.`);
  const format = options.format || "terminal";
  if (!["terminal", "json", "github", "markdown"].includes(format)) throw new ConfigError("Unsupported check output format.");
  const baseline = options.baseline ? loadBaseline(path.resolve(cwd, options.baseline)) : undefined;
  const filenames = [...new Set(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))].sort();
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
  const findings = applied.findings;
  const failedRules = [...new Set(findings.filter(finding => failOn.includes(finding.type)).map(finding => finding.type))];
  const complete = skippedFiles.length === 0;
  const passed = complete && failedRules.length === 0;
  const result: CheckResult = {
    schemaVersion: "1.0.0", mode: "check", filesInspected, linesInspected,
    totalFindings: infractions.length, infractions: findings,
    baselineCount: applied.baselineCount, staleBaselineCount: applied.staleBaselineCount,
    skippedFiles, complete, failedRules, passed, exitCode: complete ? (passed ? 0 : 1) : 2, output: "",
  };
  if (format === "json") result.output = JSON.stringify(result, null, 2);
  else if (format === "markdown") result.output = formatCheckMarkdown(result);
  else if (format === "github") {
    result.output = formatGithubAnnotations(result) + (complete ? "" : "\n::error::Project scan incomplete. See the JSON or terminal report for skipped files.");
  } else result.output = formatCheckTerminal(result);
  return result;
}
