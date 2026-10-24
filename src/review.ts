import path from "path";
import { auditFileDiffs, isCodeFile } from "./metrics.js";
import { findingFingerprint } from "./baseline.js";
import { ConfigError, CONFIG_FILENAMES } from "./config.js";
import { assertNotAborted, changedTreeFiles, readBlob, reviewPolicy, reviewRefs } from "./snapshot.js";
import { formatReviewMarkdown, formatReviewTerminal, formatGithubAnnotations } from "./renderer.js";
import { formatSarif } from "./sarif.js";
import { VALID_DETECTORS } from "./types.js";
import type { DetectorType, Infraction, ReviewOptions, ReviewResult } from "./types.js";

const GENERATED_PATHS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js", "**/*.map"];
const MAX_SCAN_BYTES = 50 * 1024 * 1024;

/** Match only within the same changed-file pair; Git renames remap old paths.
 * Counts matter: an identical second shortcut is still a new finding. */
export function compareFindings(before: Infraction[], after: Infraction[], newPath: string): {
  introduced: Infraction[]; removed: Infraction[]; unchanged: number;
} {
  const old = new Map<string, { findings: Infraction[]; matched: number }>();
  for (const finding of before) {
    const key = findingFingerprint({ ...finding, file: newPath });
    const bucket = old.get(key) || { findings: [], matched: 0 };
    bucket.findings.push(finding);
    old.set(key, bucket);
  }
  const introduced: Infraction[] = [];
  let unchanged = 0;
  for (const finding of after) {
    const bucket = old.get(findingFingerprint(finding));
    if (bucket && bucket.matched < bucket.findings.length) { bucket.matched++; unchanged++; }
    else introduced.push(finding);
  }
  return { introduced, removed: [...old.values()].flatMap(bucket => bucket.findings.slice(bucket.matched)), unchanged };
}

/** Compare full source blobs in changed files without executing or checking out the candidate. */
export async function reviewChanges(options: ReviewOptions): Promise<ReviewResult> {
  assertNotAborted(options.signal);
  const cwd = path.resolve(options.cwd || process.cwd());
  const refs = await reviewRefs(cwd, options.base, options.head ?? "HEAD", options.signal);
  const policy = await reviewPolicy(cwd, refs.baseSha, options.signal);
  const format = options.format ?? "terminal";
  if (!["terminal", "json", "github", "markdown", "sarif"].includes(format)) throw new ConfigError("Unsupported review format.");
  const failOn = options.failOn ?? policy.config.failOn ?? ["test-skip", "trivial-assert"];
  for (const rule of failOn) if (!VALID_DETECTORS.includes(rule as DetectorType)) throw new ConfigError(`Unknown review rule '${rule}'.`);
  const changes = await changedTreeFiles(cwd, refs.mergeBaseSha, refs.headSha, options.signal);
  const policyChanges = changes.filter(change => CONFIG_FILENAMES.includes(change.oldPath) || CONFIG_FILENAMES.includes(change.newPath)).map(change => change.newPath);
  const ignores = [...GENERATED_PATHS, ...(policy.config.ignorePaths || [])];
  const result: ReviewResult = {
    schemaVersion: "1.0.0", mode: "review", ...refs,
    policySha: refs.baseSha, policyFile: policy.filename, policyChanges,
    filesChanged: changes.length, filesInspected: 0, unsupportedFiles: 0, excludedFiles: 0,
    renamedFiles: changes.filter(change => change.status.startsWith("R")).length,
    linesInspected: 0, beforeFindings: 0, afterFindings: 0, unchangedCount: 0,
    infractions: [], removedFindings: [], skippedFiles: [], complete: true,
    failedRules: [], passed: false, exitCode: 2, output: "",
  };
  let totalBytes = 0;
  for (const change of changes) {
    assertNotAborted(options.signal);
    const oldSupported = change.oldMode !== "000000" && isCodeFile(change.oldPath);
    const newSupported = change.newMode !== "000000" && isCodeFile(change.newPath);
    if (!oldSupported && !newSupported) { result.unsupportedFiles++; continue; }
    // A rename into an excluded/unsupported path is not evidence of a fix. Keep
    // old/new findings in scope if either corresponding source path is in scope.
    const oldInScope = oldSupported && isCodeFile(change.oldPath, ignores);
    const newInScope = newSupported && isCodeFile(change.newPath, ignores);
    if (!oldInScope && !newInScope) { result.excludedFiles++; continue; }
    try {
      let inspectedLines = 0;
      const scan = async (mode: string, oid: string, filename: string, commit: string) => {
        if (mode === "000000") return [];
        if (!["100644", "100755"].includes(mode)) throw new ConfigError("Changed source is a symlink, submodule or unsupported Git mode; comparison is incomplete.");
        const content = await readBlob(cwd, oid, options.signal);
        totalBytes += content.length;
        if (totalBytes > MAX_SCAN_BYTES) throw new ConfigError("Review exceeds the 50 MiB source comparison limit.");
        if (content.includes(0)) throw new ConfigError("Binary content in a source comparison.");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        const lines = text.split(/\r?\n/);
        if (lines.at(-1) === "") lines.pop();
        inspectedLines += lines.length;
        return auditFileDiffs([{ path: filename, addedLines: lines.map((line, index) => ({ line, lineNumber: index + 1 })) }], commit, "", { rules: policy.config.rules }).infractions;
      };
      if (oldSupported && !newSupported && change.newMode !== "000000") {
        throw new ConfigError("Source moved to an unsupported extension; cannot claim its findings were resolved.");
      }
      const before = await scan(change.oldMode, change.oldOid, change.oldPath, refs.mergeBaseSha);
      const after = await scan(change.newMode, change.newOid, change.newPath, refs.headSha);
      const compared = compareFindings(before, after, change.newPath);
      result.infractions.push(...compared.introduced);
      result.removedFindings.push(...compared.removed);
      result.unchangedCount += compared.unchanged;
      result.beforeFindings += before.length;
      result.afterFindings += after.length;
      result.filesInspected++;
      result.linesInspected += inspectedLines;
    } catch (error) {
      assertNotAborted(options.signal);
      result.skippedFiles.push({ file: change.newPath, reason: error instanceof Error ? error.message : String(error) });
      if (totalBytes > MAX_SCAN_BYTES) break;
    }
  }
  assertNotAborted(options.signal);
  result.complete = result.skippedFiles.length === 0;
  result.failedRules = [...new Set(result.infractions.filter(finding => failOn.includes(finding.type)).map(finding => finding.type))];
  result.passed = result.complete && result.failedRules.length === 0;
  result.exitCode = !result.complete ? 2 : result.passed ? 0 : 1;
  if (format === "json") result.output = JSON.stringify(result, null, 2);
  else if (format === "markdown") result.output = formatReviewMarkdown(result);
  else if (format === "sarif") result.output = formatSarif(result);
  else if (format === "github") result.output = formatGithubAnnotations(result) + (!result.complete ? "\n::error::Context review incomplete. Inspect skipped source files in the JSON report." : "") + (policyChanges.length ? "\n::notice::Candidate policy changes were ignored; review uses policy from the supplied base commit." : "");
  else result.output = formatReviewTerminal(result);
  return result;
}
