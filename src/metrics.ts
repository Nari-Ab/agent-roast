import { ParsedCommit } from "./git.js";
import { Infraction, MetricSummary } from "./types.js";

const TEST_SKIP_PATTERNS = [
  { regex: /(?:it|test|describe)\.skip\b/, name: "skipped test (it.skip / describe.skip)" },
  { regex: /\b(?:xit|xtest)\(/, name: "disabled test (xit / xtest)" },
  { regex: /@pytest\.mark\.skip/, name: "skipped pytest" },
  { regex: /\btest\.todo\(/, name: "todo placeholder test" },
];

const TYPE_ESCAPE_PATTERNS = [
  { regex: /\bas\s+any\b/, name: "type bypass (as any)" },
  { regex: /\/\/\s*@ts-ignore\b/, name: "compiler ignore (@ts-ignore)" },
  { regex: /\/\/\s*@ts-expect-error\b/, name: "compiler suppression (@ts-expect-error)" },
  { regex: /#\s*type:\s*ignore\b/, name: "python type ignore" },
  { regex: /\/\/\s*eslint-disable(?:-next-line)?\b/, name: "linter suppression (eslint-disable)" },
];

const SWALLOWED_ERROR_PATTERNS = [
  { regex: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, name: "empty catch block (catch {})" },
  { regex: /except(?:\s+[^:]*)?:\s*pass\b/, name: "silent python error swallow (except: pass)" },
];

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".vue", ".svelte", ".php", ".rb", ".cs", ".cpp", ".c"
]);

function isCodeFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
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

  private lastFixCommit: { hash: string; date: number; message: string; author: string } | null = null;
  private includeAll: boolean;

  constructor(options: { all?: boolean } = {}) {
    this.includeAll = options.all ?? false;
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

    // 1. Check Panic Loops (consecutive fix/revert commits within 15 minutes)
    const commitDateMs = Date.parse(commit.date);
    if (PANIC_COMMIT_REGEX.test(commit.message)) {
      if (
        this.lastFixCommit &&
        !isNaN(commitDateMs) &&
        !isNaN(this.lastFixCommit.date)
      ) {
        const diffMinutes = Math.abs(commitDateMs - this.lastFixCommit.date) / (1000 * 60);
        if (diffMinutes <= 15) {
          this.panicLoops.push({
            type: "panic-loop",
            commitHash: commit.hash,
            commitDate: commit.date,
            reason: `Panic loop: consecutive quick fix within ${Math.round(diffMinutes)}m (${this.lastFixCommit.hash.slice(0, 7)} -> ${commit.hash.slice(0, 7)})`,
          });
        }
      }
      this.lastFixCommit = {
        hash: commit.hash,
        date: commitDateMs,
        message: commit.message,
        author: commit.authorEmail,
      };
    } else {
      this.lastFixCommit = null;
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
        const line = added.line;

        // A. Test Skips
        if (commitSkips < MAX_INFRACTIONS_PER_COMMIT) {
          for (const rule of TEST_SKIP_PATTERNS) {
            if (rule.regex.test(line)) {
              this.testSkips.push({
                type: "test-skip",
                file: file.path,
                lineSnippet: line.trim(),
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
          for (const rule of TYPE_ESCAPE_PATTERNS) {
            if (rule.regex.test(line)) {
              this.typeEscapes.push({
                type: "type-escape",
                file: file.path,
                lineSnippet: line.trim(),
                commitHash: commit.hash,
                commitDate: commit.date,
                reason: rule.name,
              });
              commitEscapes++;
              break;
            }
          }
        }

        // C. Swallowed Errors
        if (commitSwallowed < MAX_INFRACTIONS_PER_COMMIT) {
          for (const rule of SWALLOWED_ERROR_PATTERNS) {
            if (rule.regex.test(line)) {
              this.swallowedErrors.push({
                type: "swallowed-error",
                file: file.path,
                lineSnippet: line.trim(),
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
    const linesSample = this.includeAll ? this.totalLinesAdded : this.aiLinesAdded;
    const isSufficientData = linesSample >= MIN_SAMPLE_LOC;

    // Penalty calculations normalized per 1,000 LOC
    // Base score = 100
    // Test skip penalty: 15 pts per instance
    // Swallowed error penalty: 10 pts per instance
    // Panic loop penalty: 8 pts per instance
    // Type escape penalty: 3 pts per instance
    const totalInfractionPoints =
      this.testSkips.length * 15 +
      this.swallowedErrors.length * 10 +
      this.panicLoops.length * 8 +
      this.typeEscapes.length * 3;

    // Normalization factor (relative to 1000 LOC, minimum factor 0.5)
    const factor = Math.max(0.5, linesSample / 1000);
    const normalizedPenalty = Math.round(totalInfractionPoints / factor);
    const score = isSufficientData ? Math.max(0, Math.min(100, 100 - normalizedPenalty)) : 100;

    // Determine Archetype
    let archetype = "The Clean Coder";
    let archetypeDescription = "Disciplined and structured. Rarely cheats with skips or type escapes.";

    if (isSufficientData) {
      if (this.testSkips.length >= 3) {
        archetype = "The Silent Vandal";
        archetypeDescription = "When tests break, this agent doesn't fix the bug — it just deletes or skips the test.";
      } else if (this.panicLoops.length >= 2) {
        archetype = "The Panic Looper";
        archetypeDescription = "Spams rapid 'fix', 'try again', and revert commits like a developer on their 5th espresso.";
      } else if (this.typeEscapes.length >= 6) {
        archetype = "The Any Architect";
        archetypeDescription = "TypeScript compiler yelling? Slap 'as any' and '@ts-ignore' everywhere until it shuts up.";
      } else if (this.swallowedErrors.length >= 3) {
        archetype = "The Secret Keeper";
        archetypeDescription = "Swallows exceptions into empty catch blocks. If no error is logged, did the bug really happen?";
      } else if (score < 60) {
        archetype = "The Chaos Gremlin";
        archetypeDescription = "A jack-of-all-shortcuts: skips tests, casts to any, and prays it runs in production.";
      }
    }

    return {
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
    };
  }
}
