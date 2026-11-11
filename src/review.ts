import path from "path";
import { applyExceptions } from "./exceptions.js";
import { auditFileDiffs, isCodeFile, isTestFile } from "./metrics.js";
import { analyzeGuardFile, analyzeTestFile, ciTestSteps, isGuardFile, isKnownFailureMarker, newKnownFailureMarkers, resolveCiTestSteps, resolveTampering } from "./tampering.js";
import type { CiTestCount, FileTampering } from "./tampering.js";
import { findingFingerprint } from "./baseline.js";
import { ConfigError, CONFIG_FILENAMES, configFromText } from "./config.js";
import { assertNotAborted, changedTreeFiles, readBlob, reviewPolicy, reviewRefs, stagedSnapshot, worktreeSnapshot } from "./snapshot.js";
import type { TreeChange, WorktreeSnapshot } from "./snapshot.js";
import { formatReviewMarkdown, formatReviewTerminal, formatGithubAnnotations } from "./renderer.js";
import { formatSarif } from "./sarif.js";
import { VALID_DETECTORS } from "./types.js";
import type { DetectorType, Infraction, ReviewOptions, StagedReviewOptions, ReviewResult } from "./types.js";

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
export function reviewChanges(options: ReviewOptions): Promise<ReviewResult> {
  return compareSourceChanges({ ...options, source: "commits" });
}

export function reviewStagedChanges(options: StagedReviewOptions = {}): Promise<ReviewResult> {
  return compareSourceChanges({ ...options, source: "index" });
}

/** Everything uncommitted (staged, unstaged and untracked files) against HEAD, under the policy committed at HEAD. */
export function reviewWorktreeChanges(options: StagedReviewOptions = {}): Promise<ReviewResult> {
  return compareSourceChanges({ ...options, source: "worktree" });
}

type SourceReview = (ReviewOptions & { source: "commits" }) | (StagedReviewOptions & { source: "index" | "worktree" });
type Snapshot = Awaited<ReturnType<typeof stagedSnapshot>> | WorktreeSnapshot;

async function compareSourceChanges(options: SourceReview): Promise<ReviewResult> {
  assertNotAborted(options.signal);
  const cwd = path.resolve(options.cwd || process.cwd());
  const snapshot = options.source === "index" ? await stagedSnapshot(cwd, options.signal)
    : options.source === "worktree" ? await worktreeSnapshot(cwd, options.signal) : undefined;
  try { return await compareSnapshot(options, cwd, snapshot); }
  finally { await (snapshot as Partial<WorktreeSnapshot> | undefined)?.dispose?.(); }
}

async function compareSnapshot(options: SourceReview, cwd: string, snapshot?: Snapshot): Promise<ReviewResult> {
  const refs = options.source === "commits" ? await reviewRefs(cwd, options.base, options.head ?? "HEAD", options.signal)
    : { baseSha: snapshot!.baseSha, headSha: snapshot!.headSha, mergeBaseSha: snapshot!.mergeBaseSha };
  const policy = refs.baseSha === "EMPTY" ? { config: configFromText("{}", "default first-commit policy"), filename: null }
    : await reviewPolicy(cwd, refs.baseSha, options.signal);
  const format = options.format ?? "terminal";
  if (!["terminal", "json", "github", "markdown", "sarif"].includes(format)) throw new ConfigError("Unsupported review format.");
  const failOn = options.failOn ?? policy.config.failOn ?? ["test-skip", "trivial-assert", "test-focus", "assertion-weakened", "guard-weakened"];
  for (const rule of failOn) if (!VALID_DETECTORS.includes(rule as DetectorType)) throw new ConfigError(`Unknown review rule '${rule}'.`);
  const changes = snapshot?.changes ?? await changedTreeFiles(cwd, refs.mergeBaseSha, refs.headSha, options.signal);
  const policyChanges = changes.filter(change => CONFIG_FILENAMES.includes(change.oldPath) || CONFIG_FILENAMES.includes(change.newPath)).map(change => change.newPath);
  const ignores = [...GENERATED_PATHS, ...(policy.config.ignorePaths || [])];
  const result: ReviewResult = {
    schemaVersion: "1.2.0", mode: "review", source: options.source, ...refs,
    policySha: refs.baseSha, policyFile: policy.filename, policyChanges,
    filesChanged: changes.length, filesInspected: 0, unsupportedFiles: 0, excludedFiles: 0,
    renamedFiles: changes.filter(change => change.status.startsWith("R")).length,
    linesInspected: 0, beforeFindings: 0, afterFindings: 0, unchangedCount: 0,
    infractions: [], removedFindings: [], skippedFiles: [], complete: true,
    failedRules: [], passed: false, exitCode: 2, output: "",
  };
  let totalBytes = 0;
  const tamperingFiles: FileTampering[] = [];
  const guardFindings: Infraction[] = [];
  const ciCounts: CiTestCount[] = [];
  let productionChanged = false;
  const decode = (content: Buffer): string => {
    totalBytes += content.length;
    if (totalBytes > MAX_SCAN_BYTES) throw new ConfigError("Review exceeds the 50 MiB source comparison limit.");
    if (content.includes(0)) throw new ConfigError("Binary content in a source comparison.");
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  };
  const regularMode = (mode: string): void => {
    if (!["100644", "100755"].includes(mode)) throw new ConfigError("Changed source is a symlink, submodule or unsupported Git mode; comparison is incomplete.");
  };
  const readText = async (mode: string, oid: string): Promise<string | null> => {
    if (mode === "000000") return null;
    regularMode(mode);
    return decode(await readBlob(cwd, oid, options.signal));
  };
  /** The changed side: a Git object, or the file on disk when reviewing the working tree. */
  const readNew = async (change: TreeChange): Promise<string | null> => {
    if (options.source !== "worktree") return readText(change.newMode, change.newOid);
    if (change.newMode === "000000") return null;
    regularMode(change.newMode);
    return decode(await (snapshot as WorktreeSnapshot).readWorktree(change.newPath));
  };
  const existingCounts = new Map<string, number>();
  for (const change of changes) {
    assertNotAborted(options.signal);
    const oldSupported = change.oldMode !== "000000" && isCodeFile(change.oldPath);
    const newSupported = change.newMode !== "000000" && isCodeFile(change.newPath);
    if (!oldSupported && !newSupported) {
      const guarded = (isGuardFile(change.newPath) || isGuardFile(change.oldPath)) && isCodeFile(change.newPath + ".ts", ignores);
      if (!guarded) { result.unsupportedFiles++; continue; }
      try {
        const oldText = await readText(change.oldMode, change.oldOid);
        const newText = await readNew(change);
        guardFindings.push(...analyzeGuardFile(change.newPath, oldText, newText, refs.headSha));
        const ci = ciTestSteps(change.newPath, oldText, newText);
        if (ci) ciCounts.push(ci);
        result.filesInspected++;
      } catch (error) {
        assertNotAborted(options.signal);
        result.skippedFiles.push({ file: change.newPath, reason: error instanceof Error ? error.message : String(error) });
        if (totalBytes > MAX_SCAN_BYTES) break;
      }
      continue;
    }
    // A rename into an excluded/unsupported path is not evidence of a fix. Keep
    // old/new findings in scope if either corresponding source path is in scope.
    const oldInScope = oldSupported && isCodeFile(change.oldPath, ignores);
    const newInScope = newSupported && isCodeFile(change.newPath, ignores);
    if (!oldInScope && !newInScope) { result.excludedFiles++; continue; }
    try {
      let inspectedLines = 0;
      const scan = (text: string | null, filename: string, commit: string) => {
        if (text === null) return [];
        const lines = text.split(/\r?\n/);
        if (lines.at(-1) === "") lines.pop();
        inspectedLines += lines.length;
        return auditFileDiffs([{ path: filename, addedLines: lines.map((line, index) => ({ line, lineNumber: index + 1 })) }], commit, "", { rules: policy.config.rules }).infractions;
      };
      if (oldSupported && !newSupported && change.newMode !== "000000") {
        throw new ConfigError("Source moved to an unsupported extension; cannot claim its findings were resolved.");
      }
      const oldText = await readText(change.oldMode, change.oldOid);
      const newText = await readNew(change);
      const before = scan(oldText, change.oldPath, refs.mergeBaseSha);
      const after = scan(newText, change.newPath, refs.headSha);
      if (isTestFile(change.oldPath) || isTestFile(change.newPath)) tamperingFiles.push(analyzeTestFile(change.oldPath, change.newPath, oldText, newText, refs.headSha));
      else if (change.oldOid !== change.newOid) productionChanged = true;
      if ((isGuardFile(change.newPath) || isGuardFile(change.oldPath)) && oldText !== null && newText !== null) guardFindings.push(...analyzeGuardFile(change.newPath, oldText, newText, refs.headSha));
      const compared = compareFindings(before, after, change.newPath);
      const introduced = new Set(compared.introduced);
      for (const finding of after) {
        if (introduced.has(finding)) continue;
        const fingerprint = findingFingerprint(finding);
        existingCounts.set(fingerprint, (existingCounts.get(fingerprint) ?? 0) + 1);
      }
      // Known-failure markers are judged per test (see newKnownFailureMarkers), not by whichever identical line the comparison matched.
      result.infractions.push(...compared.introduced.filter(finding => !isKnownFailureMarker(finding)), ...newKnownFailureMarkers(before, after, oldText, newText));
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
  await snapshot?.verify();
  result.complete = result.skippedFiles.length === 0;
  const rules = policy.config.rules ?? {};
  result.infractions.push(...[...resolveTampering(tamperingFiles, productionChanged), ...guardFindings, ...resolveCiTestSteps(ciCounts, refs.headSha)].filter(finding => rules[finding.type] !== "off"));
  const exceptions = applyExceptions(result.infractions, options.ignoreExceptions ? [] : policy.config.exceptions, new Date(), existingCounts);
  result.infractions = exceptions.findings;
  result.suppressedFindings = exceptions.suppressedFindings;
  result.expiredExceptionCount = exceptions.expiredExceptionCount;
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
