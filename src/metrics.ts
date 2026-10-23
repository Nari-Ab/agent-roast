import { ParsedCommit, ParsedFileDiff } from "./git.js";
import { Infraction, MetricSummary } from "./types.js";
import { SourceMasker } from "./source.js";
import { RULE_GUIDES } from "./rules.js";

const TEST_SKIP_PATTERNS = [
  { regex: /\b(?:it|test|describe)\.skip\b/, name: "skipped test (it.skip / describe.skip)" },
  { regex: /\b(?:xit|xtest)\(/, name: "disabled test (xit / xtest)" },
  { regex: /@pytest\.mark\.skip\b/, name: "skipped pytest (@pytest.mark.skip)" },
  { regex: /\bpytest\.skip\(/, name: "imperative pytest skip (pytest.skip)" },
  { regex: /\btest\.todo\(/, name: "todo placeholder test" },
];

const COMMENT_DIRECTIVE_PATTERNS = [
  { regex: /^\s*\/\/\s*@ts-ignore\b/, name: "compiler ignore (@ts-ignore)" },
  { regex: /^\s*\/\/\s*@ts-expect-error\b/, name: "compiler suppression (@ts-expect-error)" },
  { regex: /^\s*\/\/\s*@ts-nocheck\b/, name: "compiler check disable (@ts-nocheck)" },
  { regex: /(?:^\s*#\s*type:\s*ignore\b|#\s*type:\s*ignore\s*$)/, name: "python type ignore" },
  { regex: /(?:^\s*#\s*noqa\b|#\s*noqa\s*$)/, name: "python linter suppression (# noqa)" },
  { regex: /^\s*\/\/\s*eslint-disable(?:-next-line)?\b/, name: "linter suppression (eslint-disable)" },
];

const CODE_TYPE_ESCAPE_PATTERNS = [
  { regex: /\bas\s+any\b/, name: "type bypass (as any)" },
  { regex: /\bas\s+unknown\s+as\b/, name: "double assertion bypass (as unknown as)" },
  { regex: /\bas\s+never\b/, name: "type escape (as never)" },
];

const SWALLOWED_ERROR_PATTERNS = [
  { regex: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, name: "empty catch block (catch {})" },
  { regex: /except(?:\s+[^:]*)?:\s*pass\b/, name: "silent python error swallow (except: pass)" },
];

const TRIVIAL_ASSERT_PATTERNS = [
  { regex: /expect\s*\(\s*(true|false|1|0|null|undefined)\s*\)\.toBe\s*\(\s*\1\s*\)/, name: "trivial assertion (expect(val).toBe(val))" },
  { regex: /expect\s*\(\s*(true|false|1|0|null|undefined)\s*\)\.toEqual\s*\(\s*\1\s*\)/, name: "trivial assertion (expect(val).toEqual(val))" },
  { regex: /\bassert\s+(?:True|1\s*==\s*1)\s*(?=$|#|,)/, name: "trivial python assert (assert True / 1 == 1)" },
  { regex: /self\.assertTrue\s*\(\s*(?:True|1)\s*\)/, name: "trivial assert (self.assertTrue(True))" },
  { regex: /self\.assertEqual\s*\(\s*(?:1\s*,\s*1|True\s*,\s*True)\s*\)/, name: "trivial assert (self.assertEqual(1, 1))" },
  { regex: /assert\.(?:strictEqual|equal)\s*\(\s*(?:true\s*,\s*true|1\s*,\s*1)\s*\)/, name: "trivial assert (assert.equal(1, 1))" },
];

const STUB_ABANDONMENT_PATTERNS = [
  { regex: /\bthrow\s+new\s+Error\s*\(\s*["'](?:TODO|Not implemented|to be implemented|stub|implement me)/i, name: "unimplemented stub (throw new Error('Not implemented'))" },
  { regex: /\braise\s+NotImplementedError\b/, name: "unimplemented stub (raise NotImplementedError)" },
  { regex: /\braise\s+NotImplemented\b/, name: "unimplemented stub (raise NotImplemented)" },
  { regex: /\btodo!\s*\(\s*\)/, name: "unimplemented rust stub (todo!())" },
  { regex: /\bunimplemented!\s*\(\s*\)/, name: "unimplemented rust stub (unimplemented!())" },
];

import { matchIgnorePath } from "./config.js";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".vue", ".svelte", ".php", ".rb", ".cs", ".cpp", ".c"
]);

const IGNORED_PATH_REGEX = /(?:^|\/)(?:fixtures|__fixtures__|testdata|mocks|test_data|__snapshots__|sample[s]?)\//i;
const TEST_PATH_REGEX = /(?:^|\/)test_[^/]+\.py$|(?:^|\/)(?:tests?|__tests__|specs?)\/|[._-](?:test|spec)\.[a-z0-9]+$/i;

export function isCodeFile(filePath: string, customIgnorePaths?: string[]): boolean {
  if (IGNORED_PATH_REGEX.test(filePath)) {
    return false;
  }
  if (customIgnorePaths && matchIgnorePath(filePath, customIgnorePaths)) {
    return false;
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

export function isTestFile(filePath: string): boolean {
  return TEST_PATH_REGEX.test(filePath);
}

/**
 * Audits a collection of file diffs (e.g. for PR mode) against detector rules.
 */
export function auditFileDiffs(
  files: ParsedFileDiff[],
  commitHash: string = "HEAD",
  commitDate: string = new Date().toISOString(),
  options: { ignorePaths?: string[]; rules?: Record<string, "error" | "warn" | "off"> } = {}
): {
  infractions: Infraction[];
  hasSupportedChanges: boolean;
  filesInspected: number;
  linesAdded: number;
} {
  const infractions: Infraction[] = [];
  let hasSupportedChanges = false;
  let filesInspected = 0;
  let linesAdded = 0;

  for (const file of files) {
    if (file.deleted || file.path === "unknown") continue;
    if (!isCodeFile(file.path, options.ignorePaths)) continue;

    hasSupportedChanges = true;
    filesInspected++;
    linesAdded += file.addedLines.length;

    const masker = new SourceMasker(file.path);
    const maskedLines: { code: string; raw: string; number: number }[] = [];
    for (const added of file.addedLines) {
      const rawLine = added.line;
      const masked = masker.mask(rawLine, added.lineNumber);
      const cleanedLine = masked.code;
      maskedLines.push({ code: cleanedLine, raw: rawLine, number: added.lineNumber });
      const isComment = !cleanedLine.trim();

      // A. Test Skips
      if (!isComment) {
        for (const rule of TEST_SKIP_PATTERNS) {
          if (rule.regex.test(cleanedLine)) {
            infractions.push({
              type: "test-skip",
              file: file.path,
              lineNumber: added.lineNumber,
              lineSnippet: rawLine.trim(),
              commitHash,
              commitDate,
              reason: rule.name,
            });
            break;
          }
        }
      }

      // B. Type Escapes
      let foundEscape = false;
      for (const rule of COMMENT_DIRECTIVE_PATTERNS) {
        if (rule.regex.test(masked.comments)) {
          infractions.push({
            type: "type-escape",
            file: file.path,
            lineNumber: added.lineNumber,
            lineSnippet: rawLine.trim(),
            commitHash,
            commitDate,
            reason: rule.name,
          });
          foundEscape = true;
          break;
        }
      }

      if (!foundEscape && !isComment) {
        for (const rule of CODE_TYPE_ESCAPE_PATTERNS) {
          if (rule.regex.test(cleanedLine)) {
            infractions.push({
              type: "type-escape",
              file: file.path,
              lineNumber: added.lineNumber,
              lineSnippet: rawLine.trim(),
              commitHash,
              commitDate,
              reason: rule.name,
            });
            break;
          }
        }
      }

      // C. Swallowed Errors
      if (!isComment) {
        for (const rule of SWALLOWED_ERROR_PATTERNS) {
          if (rule.regex.test(cleanedLine)) {
            infractions.push({
              type: "swallowed-error",
              file: file.path,
              lineNumber: added.lineNumber,
              lineSnippet: rawLine.trim(),
              commitHash,
              commitDate,
              reason: rule.name,
            });
            break;
          }
        }
      }

      // D. Trivial Assertions (only in test files)
      if (!isComment && isTestFile(file.path)) {
        for (const rule of TRIVIAL_ASSERT_PATTERNS) {
          if (rule.regex.test(cleanedLine)) {
            infractions.push({
              type: "trivial-assert",
              file: file.path,
              lineNumber: added.lineNumber,
              lineSnippet: rawLine.trim(),
              commitHash,
              commitDate,
              reason: rule.name,
            });
            break;
          }
        }
      }

      // E. Stub Abandonment
      if (!isComment) {
        for (const rule of STUB_ABANDONMENT_PATTERNS) {
          const match = rule.regex.exec(rawLine);
          if (match && cleanedLine[match.index] === rawLine[match.index]) {
            infractions.push({
              type: "stub-abandonment",
              file: file.path,
              lineNumber: added.lineNumber,
              lineSnippet: rawLine.trim(),
              commitHash,
              commitDate,
              reason: rule.name,
            });
            break;
          }
        }
      }
    }

    // Empty handlers frequently span several lines. Only contiguous added code
    // can prove emptiness; hunk gaps must not be joined into a fabricated block.
    for (let index = 0; index < maskedLines.length; index++) {
      const start = maskedLines[index];
      const isCatch = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/.test(start.code);
      const isExcept = /\bexcept(?:\s+[^:]*)?:\s*$/.test(start.code);
      if (!isCatch && !isExcept) continue;
      let next = index + 1;
      while (next < maskedLines.length && maskedLines[next].number === maskedLines[next - 1].number + 1 && !maskedLines[next].code.trim()) next++;
      const end = maskedLines[next];
      if (!end || end.number !== maskedLines[next - 1].number + 1) continue;
      const closesCatch = isCatch && /^\s*}/.test(end.code);
      let closesExcept = isExcept && /^\s*pass\s*$/.test(end.code);
      if (closesExcept) {
        const indent = start.raw.search(/\S/);
        if (end.raw.search(/\S/) <= indent) closesExcept = false;
        let after = next + 1;
        while (after < maskedLines.length && maskedLines[after].number === maskedLines[after - 1].number + 1 && !maskedLines[after].code.trim()) after++;
        if (after < maskedLines.length && maskedLines[after].number === maskedLines[after - 1].number + 1 && maskedLines[after].raw.search(/\S/) > indent) closesExcept = false;
      }
      if (closesCatch || closesExcept) infractions.push({
        type: "swallowed-error", file: file.path, lineNumber: start.number,
        lineSnippet: maskedLines.slice(index, next + 1).map(line => line.raw.trim()).join(" "),
        commitHash, commitDate, reason: closesCatch ? "empty multi-line catch block" : "silent multi-line python error swallow",
      });
    }
  }

  return { infractions: infractions.filter(inf => options.rules?.[inf.type] !== "off").map(inf => ({ ...inf, suggestion: RULE_GUIDES[inf.type].suggestion })), hasSupportedChanges, filesInspected, linesAdded };
}

/**
 * Strips quoted string literals and regex literals from a line so that
 * test fixtures and string constants (e.g. { line: "it.skip" }) are not flagged.
 */
export function stripStringAndRegexLiterals(line: string): string {
  return new SourceMasker("source.ts").mask(line, 1).code;
}

const PANIC_COMMIT_REGEX = /\b(?:fix|quickfix|revert|hotfix|retry|patch|undo|workaround)\b/i;

const MAX_INFRACTIONS_PER_COMMIT = 10;
const MIN_SAMPLE_LOC = 200;

export class MetricsCollector {
  private totalLinesAdded = 0;
  private aiLinesAdded = 0;
  private totalCommits = 0;
  private aiCommits = 0;

  private testSkips: Infraction[] = [];
  private typeEscapes: Infraction[] = [];
  private swallowedErrors: Infraction[] = [];
  private panicLoops: Infraction[] = [];
  private trivialAsserts: Infraction[] = [];
  private stubAbandonments: Infraction[] = [];

  private skippedLongLines = 0;
  private skippedUnknownFiles = 0;

  private activePanicChain: {
    firstHash: string;
    latestHash: string;
    firstDate: number;
    latestDate: number;
    commitCount: number;
    author: string;
    activeFiles: Set<string>;
    isAiAttributed: boolean;
  } | null = null;

  private includeAll: boolean;
  private ignorePaths?: string[];
  private rules?: Record<string, "error" | "warn" | "off">;
  private panicLoopWindowMinutes: number;

  constructor(options: { all?: boolean; ignorePaths?: string[]; rules?: Record<string, "error" | "warn" | "off">; panicLoopWindowMinutes?: number } = {}) {
    this.includeAll = options.all ?? false;
    this.ignorePaths = options.ignorePaths;
    this.rules = options.rules;
    this.panicLoopWindowMinutes = options.panicLoopWindowMinutes ?? 15;
  }

  recordSkipped(stats: { skippedLongLines?: number; skippedUnknownFiles?: number }): void {
    if (stats.skippedLongLines) this.skippedLongLines += stats.skippedLongLines;
    if (stats.skippedUnknownFiles) this.skippedUnknownFiles += stats.skippedUnknownFiles;
  }

  private flushPanicChain(): void {
    if (this.rules?.["panic-loop"] !== "off" && this.activePanicChain && this.activePanicChain.commitCount >= 2) {
      const chain = this.activePanicChain;
      const durationMinutes = Math.max(
        1,
        Math.round(Math.abs(chain.latestDate - chain.firstDate) / (1000 * 60))
      );
      const attributionTag = chain.isAiAttributed
        ? "AI panic loop"
        : "Panic loop (unverified / --all mode)";
      this.panicLoops.push({
        type: "panic-loop",
        commitHash: chain.latestHash,
        commitDate: new Date(chain.latestDate).toISOString(),
        reason: `${attributionTag}: chain of ${chain.commitCount} quick fixes across ${durationMinutes}m (${chain.firstHash.slice(0, 7)} -> ${chain.latestHash.slice(0, 7)})`,
      });
    }
    this.activePanicChain = null;
  }

  processCommit(commit: ParsedCommit): void {
    this.totalCommits++;
    this.totalLinesAdded += commit.totalAddedCount;

    const isTarget = this.includeAll || commit.isAiAttributed;
    if (commit.isAiAttributed) {
      this.aiCommits++;
      this.aiLinesAdded += commit.totalAddedCount;
    }

    if (!isTarget) {
      this.flushPanicChain();
      return;
    }

    // 1. Check Panic Loops (chained fix/revert commits within 15 minutes by same author touching same files)
    const subject = commit.message.split("\n")[0];
    const commitDateMs = Date.parse(commit.date);
    const isFixCommit = PANIC_COMMIT_REGEX.test(subject);
    const currentActiveFiles = new Set(
      commit.files
        .filter((f) => !f.deleted && f.path !== "unknown")
        .map((f) => f.path)
    );

    if (isFixCommit && !isNaN(commitDateMs)) {
      if (
        this.activePanicChain &&
        this.activePanicChain.author.toLowerCase() === commit.authorEmail.toLowerCase()
      ) {
        const diffMinutes = Math.abs(commitDateMs - this.activePanicChain.latestDate) / (1000 * 60);
        const touchedSameFiles =
          currentActiveFiles.size > 0 &&
          [...currentActiveFiles].some((p) => this.activePanicChain!.activeFiles.has(p));

        if (diffMinutes > 0 && diffMinutes <= this.panicLoopWindowMinutes && touchedSameFiles) {
          // Extend existing panic chain
          this.activePanicChain.commitCount++;
          this.activePanicChain.latestHash = commit.hash;
          this.activePanicChain.latestDate = commitDateMs;
          for (const p of currentActiveFiles) {
            this.activePanicChain.activeFiles.add(p);
          }
          if (commit.isAiAttributed) {
            this.activePanicChain.isAiAttributed = true;
          }
        } else {
          // Break chain, flush existing if valid, start new
          this.flushPanicChain();
          this.activePanicChain = {
            firstHash: commit.hash,
            latestHash: commit.hash,
            firstDate: commitDateMs,
            latestDate: commitDateMs,
            commitCount: 1,
            author: commit.authorEmail,
            activeFiles: currentActiveFiles,
            isAiAttributed: commit.isAiAttributed,
          };
        }
      } else {
        this.flushPanicChain();
        this.activePanicChain = {
          firstHash: commit.hash,
          latestHash: commit.hash,
          firstDate: commitDateMs,
          latestDate: commitDateMs,
          commitCount: 1,
          author: commit.authorEmail,
          activeFiles: currentActiveFiles,
          isAiAttributed: commit.isAiAttributed,
        };
      }
    } else {
      this.flushPanicChain();
    }

    // One detector implementation for history, PRs and staged changes.
    const audit = auditFileDiffs(commit.files, commit.hash, commit.date, {
      ignorePaths: this.ignorePaths,
      rules: this.rules,
    });
    const buckets = {
      "test-skip": this.testSkips,
      "type-escape": this.typeEscapes,
      "swallowed-error": this.swallowedErrors,
      "trivial-assert": this.trivialAsserts,
      "stub-abandonment": this.stubAbandonments,
      "panic-loop": this.panicLoops,
    };
    const counts: Record<string, number> = {};
    for (const infraction of audit.infractions) {
      const count = counts[infraction.type] || 0;
      if (count < MAX_INFRACTIONS_PER_COMMIT) buckets[infraction.type].push(infraction);
      counts[infraction.type] = count + 1;
    }
  }

  getSummary(): MetricSummary {
    this.flushPanicChain();

    const linesSample = this.includeAll ? this.totalLinesAdded : this.aiLinesAdded;
    const isSufficientData = linesSample >= MIN_SAMPLE_LOC;

    // Code infractions penalty
    const codeInfractionPoints =
      this.testSkips.length * 15 +
      this.trivialAsserts.length * 15 +
      this.swallowedErrors.length * 10 +
      this.stubAbandonments.length * 8 +
      this.typeEscapes.length * 3;

    // Panic loops penalty: logarithmic weighting by chain length
    let panicInfractionPoints = 0;
    for (const loop of this.panicLoops) {
      const countMatch = loop.reason.match(/chain of (\d+) quick fixes/);
      const chainLen = countMatch ? parseInt(countMatch[1], 10) : 2;
      panicInfractionPoints += Math.round(8 * (1 + Math.log(chainLen)));
    }
    panicInfractionPoints = Math.min(panicInfractionPoints, 40);

    const totalInfractionPoints = codeInfractionPoints + panicInfractionPoints;

    // Size-invariant exponential defect density formula:
    // Density = points / (kLoc + L0), where L0 = 0.5 (500 LOC smoothing floor)
    const kLoc = linesSample / 1000;
    const effectiveKLoc = kLoc + 0.5;

    const codeDensity = codeInfractionPoints / effectiveKLoc;
    const panicDensity = panicInfractionPoints / effectiveKLoc;

    const R0 = 15.0;
    const R1 = 10.0;

    const score = isSufficientData
      ? Math.max(0, Math.min(100, Math.round(100 * Math.exp(-(codeDensity / R0 + panicDensity / R1)))))
      : null;

    // Determine Archetype
    let archetype = "The Clean Coder";
    let archetypeDescription = "Spotless discipline. No skipped tests, zero panic loops, and clean type safety.";

    if (score !== null) {
      if (score >= 90) {
        if (totalInfractionPoints === 0) {
          archetype = "The Clean Coder";
          archetypeDescription = "Spotless discipline. No skipped tests, zero panic loops, and clean type safety.";
        } else {
          archetype = "The Pragmatic Builder";
          archetypeDescription = "Overwhelmingly disciplined. Only rare, isolated shortcuts across thousands of lines.";
        }
      } else {
        // Score is < 90: infractions are statistically notable and warrant a roast
        const testSkipPoints = this.testSkips.length * 15;
        const trivialPoints = this.trivialAsserts.length * 15;
        const panicPoints = this.panicLoops.length * 8;
        const stubPoints = this.stubAbandonments.length * 8;
        const escapePoints = this.typeEscapes.length * 3;
        const swallowPoints = this.swallowedErrors.length * 10;

        const maxPoints = Math.max(testSkipPoints, trivialPoints, panicPoints, stubPoints, escapePoints, swallowPoints);

        if (maxPoints === panicPoints && this.panicLoops.length >= 2) {
          archetype = "The Panic Looper";
          archetypeDescription = "Prone to rapid-fire fix and revert thrashing cycles when wrestling stubborn bugs.";
        } else if (maxPoints === testSkipPoints && this.testSkips.length >= 3) {
          archetype = "The Silent Vandal";
          archetypeDescription = "When test suites push back, tends to disable or skip tests to keep pipelines green.";
        } else if (maxPoints === trivialPoints && this.trivialAsserts.length >= 2) {
          archetype = "The Fake Asserter";
          archetypeDescription = "Masks broken tests by replacing real assertions with trivial expect(true).toBe(true) or assert True.";
        } else if (maxPoints === stubPoints && this.stubAbandonments.length >= 2) {
          archetype = "The Stub Abandoner";
          archetypeDescription = "Rushes through implementations by leaving unimplemented placeholders and TODO throws.";
        } else if (maxPoints === escapePoints && this.typeEscapes.length >= 5) {
          archetype = "The Any Architect";
          archetypeDescription = "Leans on compiler bypasses (`as any`, `@ts-ignore`) rather than strict type modeling.";
        } else if (maxPoints === swallowPoints && this.swallowedErrors.length >= 2) {
          archetype = "The Secret Keeper";
          archetypeDescription = "Tends to silence errors with empty catch blocks, obscuring runtime failures.";
        } else if (score < 50) {
          archetype = "The Chaos Gremlin";
          archetypeDescription = "Mixes multiple shortcuts: skipped tests, type bypasses, and quick patches under pressure.";
        } else {
          archetype = "The Shortcut Specialist";
          archetypeDescription = "Frequently cuts corners on edge cases, prioritizing delivery speed over rigour.";
        }
      }
    }

    return {
      schemaVersion: "1.0.0",
      totalLinesAdded: this.totalLinesAdded,
      aiLinesAdded: this.aiLinesAdded,
      totalCommits: this.totalCommits,
      aiCommits: this.aiCommits,
      testSkips: this.testSkips,
      typeEscapes: this.typeEscapes,
      swallowedErrors: this.swallowedErrors,
      panicLoops: this.panicLoops,
      trivialAsserts: this.trivialAsserts,
      stubAbandonments: this.stubAbandonments,
      rawScore: totalInfractionPoints,
      score,
      isSufficientData,
      archetype,
      archetypeDescription,
      skippedLongLines: this.skippedLongLines,
      skippedUnknownFiles: this.skippedUnknownFiles,
    };
  }
}
