import { ParsedCommit, ParsedFileDiff } from "./git.js";
import { Infraction, MetricSummary } from "./types.js";

const TEST_SKIP_PATTERNS = [
  { regex: /(?:it|test|describe)\.skip\b/, name: "skipped test (it.skip / describe.skip)" },
  { regex: /\b(?:xit|xtest)\(/, name: "disabled test (xit / xtest)" },
  { regex: /@pytest\.mark\.skip\b/, name: "skipped pytest (@pytest.mark.skip)" },
  { regex: /\bpytest\.skip\(/, name: "imperative pytest skip (pytest.skip)" },
  { regex: /\btest\.todo\(/, name: "todo placeholder test" },
];

const COMMENT_DIRECTIVE_PATTERNS = [
  { regex: /^\s*\/\/\s*@ts-ignore\b/, name: "compiler ignore (@ts-ignore)" },
  { regex: /^\s*\/\/\s*@ts-expect-error\b/, name: "compiler suppression (@ts-expect-error)" },
  { regex: /(?:^\s*#\s*type:\s*ignore\b|#\s*type:\s*ignore\s*$)/, name: "python type ignore" },
  { regex: /^\s*\/\/\s*eslint-disable(?:-next-line)?\b/, name: "linter suppression (eslint-disable)" },
];

const CODE_TYPE_ESCAPE_PATTERNS = [
  { regex: /\bas\s+any\b/, name: "type bypass (as any)" },
];

const SWALLOWED_ERROR_PATTERNS = [
  { regex: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, name: "empty catch block (catch {})" },
  { regex: /except(?:\s+[^:]*)?:\s*pass\b/, name: "silent python error swallow (except: pass)" },
];

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".vue", ".svelte", ".php", ".rb", ".cs", ".cpp", ".c"
]);

const IGNORED_PATH_REGEX = /(?:^|\/)(?:fixtures|__fixtures__|testdata|mocks|test_data|__snapshots__|sample[s]?)\//i;

export function isCodeFile(filePath: string): boolean {
  if (IGNORED_PATH_REGEX.test(filePath)) {
    return false;
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Audits a collection of file diffs (e.g. for PR mode) against detector rules.
 */
export function auditFileDiffs(
  files: ParsedFileDiff[],
  commitHash: string = "HEAD",
  commitDate: string = new Date().toISOString()
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
    if (!isCodeFile(file.path)) continue;

    hasSupportedChanges = true;
    filesInspected++;
    linesAdded += file.addedLines.length;

    for (const added of file.addedLines) {
      const rawLine = added.line;
      const cleanedLine = stripStringAndRegexLiterals(rawLine);
      const trimmedCleaned = cleanedLine.trim();
      const isComment = isCommentOnlyLine(trimmedCleaned);

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
    }
  }

  return { infractions, hasSupportedChanges, filesInspected, linesAdded };
}

/**
 * Strips quoted string literals and regex literals from a line so that
 * test fixtures and string constants (e.g. { line: "it.skip" }) are not flagged.
 */
export function stripStringAndRegexLiterals(line: string): string {
  return line
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/g, '""')
    .replace(/\/(?=[^\/\s])(?:\\\/|[^\/\r\n])+\/[gimsuy]*/g, '""');
}

function isCommentOnlyLine(trimmedLine: string): boolean {
  return (
    trimmedLine.startsWith("//") ||
    trimmedLine.startsWith("/*") ||
    trimmedLine.startsWith("*") ||
    trimmedLine.startsWith("#")
  );
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

  constructor(options: { all?: boolean } = {}) {
    this.includeAll = options.all ?? false;
  }

  recordSkipped(stats: { skippedLongLines?: number; skippedUnknownFiles?: number }): void {
    if (stats.skippedLongLines) this.skippedLongLines += stats.skippedLongLines;
    if (stats.skippedUnknownFiles) this.skippedUnknownFiles += stats.skippedUnknownFiles;
  }

  private flushPanicChain(): void {
    if (this.activePanicChain && this.activePanicChain.commitCount >= 2) {
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

        if (diffMinutes > 0 && diffMinutes <= 15 && touchedSameFiles) {
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

    // 2. Scan added lines in each file
    let commitSkips = 0;
    let commitEscapes = 0;
    let commitSwallowed = 0;

    for (const file of commit.files) {
      if (!isCodeFile(file.path)) {
        continue;
      }

      for (const added of file.addedLines) {
        const rawLine = added.line;
        const cleanedLine = stripStringAndRegexLiterals(rawLine);
        const trimmedCleaned = cleanedLine.trim();
        const isComment = isCommentOnlyLine(trimmedCleaned);

        // A. Test Skips (only on non-comment executable code)
        if (!isComment && commitSkips < MAX_INFRACTIONS_PER_COMMIT) {
          for (const rule of TEST_SKIP_PATTERNS) {
            if (rule.regex.test(cleanedLine)) {
              this.testSkips.push({
                type: "test-skip",
                file: file.path,
                lineNumber: added.lineNumber,
                lineSnippet: rawLine.trim(),
                commitHash: commit.hash,
                commitDate: commit.date,
                reason: rule.name,
              });
              commitSkips++;
              break;
            }
          }
        }

        // B. Type Escapes
        if (commitEscapes < MAX_INFRACTIONS_PER_COMMIT) {
          // B1: Comment directives (e.g. // @ts-ignore, // eslint-disable, # type: ignore)
          for (const rule of COMMENT_DIRECTIVE_PATTERNS) {
            if (rule.regex.test(cleanedLine)) {
              this.typeEscapes.push({
                type: "type-escape",
                file: file.path,
                lineNumber: added.lineNumber,
                lineSnippet: rawLine.trim(),
                commitHash: commit.hash,
                commitDate: commit.date,
                reason: rule.name,
              });
              commitEscapes++;
              break;
            }
          }

          // B2: Code type bypasses (e.g. as any) — ONLY when not inside a comment
          if (!isComment && commitEscapes < MAX_INFRACTIONS_PER_COMMIT) {
            for (const rule of CODE_TYPE_ESCAPE_PATTERNS) {
              if (rule.regex.test(cleanedLine)) {
                this.typeEscapes.push({
                  type: "type-escape",
                  file: file.path,
                  lineNumber: added.lineNumber,
                  lineSnippet: rawLine.trim(),
                  commitHash: commit.hash,
                  commitDate: commit.date,
                  reason: rule.name,
                });
                commitEscapes++;
                break;
              }
            }
          }
        }

        // C. Swallowed Errors (only in executable code, not comments)
        if (!isComment && commitSwallowed < MAX_INFRACTIONS_PER_COMMIT) {
          for (const rule of SWALLOWED_ERROR_PATTERNS) {
            if (rule.regex.test(cleanedLine)) {
              this.swallowedErrors.push({
                type: "swallowed-error",
                file: file.path,
                lineNumber: added.lineNumber,
                lineSnippet: rawLine.trim(),
                commitHash: commit.hash,
                commitDate: commit.date,
                reason: rule.name,
              });
              commitSwallowed++;
              break;
            }
          }
        }
      }
    }
  }

  getSummary(): MetricSummary {
    this.flushPanicChain();

    const linesSample = this.includeAll ? this.totalLinesAdded : this.aiLinesAdded;
    const isSufficientData = linesSample >= MIN_SAMPLE_LOC;

    // Penalty calculations:
    // Test skip penalty: 15 pts
    // Swallowed error penalty: 10 pts
    // Panic loop penalty: 8 pts
    // Type escape penalty: 3 pts
    const totalInfractionPoints =
      this.testSkips.length * 15 +
      this.swallowedErrors.length * 10 +
      this.panicLoops.length * 8 +
      this.typeEscapes.length * 3;

    // Sub-linear volume factor: prevents infinite dilution on large repos
    // For repos < 1k LOC: scales smoothly from 0.7 to 1.0
    // For repos >= 1k LOC: logarithmic dampening: 1 + 1.2 * ln(kLoc)
    const normalizedKLoc = linesSample / 1000;
    const factor = normalizedKLoc < 1
      ? Math.max(0.5, 0.7 + 0.3 * normalizedKLoc)
      : 1 + 1.2 * Math.log(normalizedKLoc);

    const normalizedPenalty = Math.round(totalInfractionPoints / factor);
    const score = isSufficientData ? Math.max(0, Math.min(100, 100 - normalizedPenalty)) : 100;

    // Determine Archetype
    let archetype = "The Clean Coder";
    let archetypeDescription = "Spotless discipline. No skipped tests, zero panic loops, and clean type safety.";

    if (isSufficientData) {
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
        const panicPoints = this.panicLoops.length * 8;
        const escapePoints = this.typeEscapes.length * 3;
        const swallowPoints = this.swallowedErrors.length * 10;

        const maxPoints = Math.max(testSkipPoints, panicPoints, escapePoints, swallowPoints);

        if (maxPoints === panicPoints && this.panicLoops.length >= 2) {
          archetype = "The Panic Looper";
          archetypeDescription = "Prone to rapid-fire fix and revert thrashing cycles when wrestling stubborn bugs.";
        } else if (maxPoints === testSkipPoints && this.testSkips.length >= 3) {
          archetype = "The Silent Vandal";
          archetypeDescription = "When test suites push back, tends to disable or skip tests to keep pipelines green.";
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
