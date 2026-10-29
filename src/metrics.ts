import { ParsedCommit, ParsedFileDiff } from "./git.js";
import { Infraction, MetricSummary } from "./types.js";
import { SourceMasker } from "./source.js";
import { RULE_GUIDES } from "./rules.js";

const PYTHON_TEST_SKIP_PATTERNS = [
  { regex: /@pytest\s*\.\s*mark\s*\.\s*skip\b/, name: "skipped pytest (@pytest.mark.skip)" },
  { regex: /(?<![\w.])pytest\s*\.\s*skip\s*\(/, name: "imperative pytest skip (pytest.skip)" },
  { regex: /@unittest\s*\.\s*skip\s*\(/, name: "skipped unittest (@unittest.skip)" },
  { regex: /\bself\s*\.\s*skipTest\s*\(/, name: "imperative unittest skip (self.skipTest)" },
];

// Familiar test APIs only; this does not resolve imports or custom aliases.
// Contiguous full-source/diff runs share one matcher. NUL marks hunk gaps;
// SOH marks a real template opener, so .each`...` is distinguished from a reference.
const JS_TEST_API = /(?<![\w$.])(?:(?:it|test|describe|suite)(?:\s*\.\s*(?:concurrent|serial|parallel|describe|failing|sequential))*\s*\.\s*(skip|todo|only)|((?:xit|xtest|xdescribe|fit|fdescribe)))\b((?:\s*\.\s*(?:each|failing|concurrent|serial|parallel|sequential))*)\s*(?=\(|\u0001)/g;

const JS_COMMENT_DIRECTIVE_PATTERNS = [
  { regex: /^\s*\/\/\s*@ts-ignore\b/, name: "compiler ignore (@ts-ignore)" },
  { regex: /^\s*\/\/\s*@ts-expect-error\b/, name: "compiler suppression (@ts-expect-error)" },
  { regex: /^\s*\/\/\s*@ts-nocheck\b/, name: "compiler check disable (@ts-nocheck)" },
  { regex: /^\s*\/\/\s*eslint-disable(?:-next-line|-line)?\b/, name: "linter suppression (eslint-disable)" },
];
const PYTHON_COMMENT_DIRECTIVE_PATTERNS = [
  { regex: /#\s*type:\s*ignore\b/, name: "python type ignore" },
  { regex: /#\s*noqa\b/, name: "python linter suppression (# noqa)" },
];
const CODE_TYPE_ESCAPE_PATTERNS = [
  { regex: /\bas\s+any\b/, name: "type bypass (as any)" },
  { regex: /\bas\s+unknown\s+as\b/, name: "double assertion bypass (as unknown as)" },
  { regex: /\bas\s+never\b/, name: "type escape (as never)" },
];
const JS_TRIVIAL_ASSERT_PATTERNS = [
  { regex: /(?<![\w$.])expect\s*\(\s*(true|false|1|0|null|undefined)\s*\)\s*\.\s*toBe\s*\(\s*\1\s*\)/, name: "trivial assertion (expect(val).toBe(val))" },
  { regex: /(?<![\w$.])expect\s*\(\s*(true|false|1|0|null|undefined)\s*\)\s*\.\s*toEqual\s*\(\s*\1\s*\)/, name: "trivial assertion (expect(val).toEqual(val))" },
  { regex: /(?<![\w$.])assert\s*\.\s*(?:strictEqual|equal)\s*\(\s*(?:true\s*,\s*true|1\s*,\s*1)\s*\)/, name: "trivial assert (assert.equal(1, 1))" },
];
const PYTHON_TRIVIAL_ASSERT_PATTERNS = [
  { regex: /\bassert\s+(?:True|1\s*==\s*1)\s*(?=$|#|,)/, name: "trivial python assert (assert True / 1 == 1)" },
  { regex: /\bself\s*\.\s*assertTrue\s*\(\s*(?:True|1)\s*\)/, name: "trivial assert (self.assertTrue(True))" },
  { regex: /\bself\s*\.\s*assertEqual\s*\(\s*(?:1\s*,\s*1|True\s*,\s*True)\s*\)/, name: "trivial assert (self.assertEqual(1, 1))" },
];
const JS_STUB_PATTERNS = [
  { regex: /\bthrow\s+new\s+Error\s*\(\s*["'`](?:TODO(?=\s*(?:["'`:]|implement\b))|Not implemented\b|to be implemented\b|stub\b|implement me\b)/i, name: "unimplemented stub (throw new Error('Not implemented'))" },
];
const PYTHON_STUB_PATTERNS = [
  { regex: /\braise\s+NotImplementedError\b/, name: "unimplemented stub (raise NotImplementedError)" },
  { regex: /\braise\s+NotImplemented\b/, name: "unimplemented stub (raise NotImplemented)" },
];
const RUST_STUB_PATTERNS = [
  { regex: /\btodo!\s*\(/, name: "unimplemented rust stub (todo!())" },
  { regex: /\bunimplemented!\s*\(/, name: "unimplemented rust stub (unimplemented!())" },
];

import { matchIgnorePath } from "./config.js";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
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

    const javascript = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(file.path);
    const typescript = /\.(?:[cm]?tsx?|vue|svelte)$/i.test(file.path);
    const python = /\.py$/i.test(file.path);
    const rust = /\.rs$/i.test(file.path);
    const braceCatches = javascript || /\.(?:java|kt|php|cs|cpp)$/i.test(file.path);
    const directives = javascript ? JS_COMMENT_DIRECTIVE_PATTERNS : python ? PYTHON_COMMENT_DIRECTIVE_PATTERNS : [];
    const stubs = javascript ? JS_STUB_PATTERNS : python ? PYTHON_STUB_PATTERNS : rust ? RUST_STUB_PATTERNS : [];
    const firstFinding = infractions.length;
    const masker = new SourceMasker(file.path);
    const maskedLines: { code: string; testCode: string; raw: string; number: number }[] = [];
    for (const added of file.addedLines) {
      const rawLine = added.line;
      const masked = masker.mask(rawLine, added.lineNumber);
      const cleanedLine = masked.code;
      const testCode = cleanedLine.split("");
      for (const start of masked.templateStarts) testCode[start] = "\u0001";
      maskedLines.push({ code: cleanedLine, testCode: testCode.join(""), raw: rawLine, number: added.lineNumber });
      const isComment = !cleanedLine.trim();

      // A. Test Skips
      if (python && !isComment) {
        for (const rule of PYTHON_TEST_SKIP_PATTERNS) {
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
      for (const rule of directives) {
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

      if (javascript && !foundEscape && masked.blockStarts.some(start => /^\/\*\s*eslint-disable(?:-next-line|-line)?\b/.test(rawLine.slice(start)))) {
        infractions.push({ type: "type-escape", file: file.path, lineNumber: added.lineNumber, lineSnippet: rawLine.trim(), commitHash, commitDate, reason: "linter suppression (eslint-disable)" });
        foundEscape = true;
      }

      // D. Trivial Assertions (only in test files)
      if (python && !isComment && isTestFile(file.path)) {
        for (const rule of PYTHON_TRIVIAL_ASSERT_PATTERNS) {
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

    }

    let source = "";
    let code = "";
    let raw = "";
    const offsets: number[] = [];
    for (let i = 0; i < maskedLines.length; i++) {
      const separator = i ? (maskedLines[i].number === maskedLines[i - 1].number + 1 ? "\n" : "\0") : "";
      source += separator;
      code += separator;
      raw += separator;
      offsets.push(source.length);
      source += maskedLines[i].testCode;
      code += maskedLines[i].code;
      raw += maskedLines[i].raw;
    }
    const evidence = (index: number, length: number) => {
      let low = 0;
      let high = offsets.length;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (offsets[middle] <= index) low = middle;
        else high = middle;
      }
      let end = low;
      while (end + 1 < offsets.length && offsets[end + 1] < index + length) end++;
      return { lineNumber: maskedLines[low].number, lineSnippet: maskedLines.slice(low, end + 1).map(line => line.raw.trim()).join(" ") };
    };

    const reportedStubs = new Set<number>();
    for (const rule of stubs) {
      for (const match of raw.matchAll(new RegExp(rule.regex.source, rule.regex.flags + "g"))) {
        // The literal message is needed, but its throw/raise/macro must be code.
        if (code[match.index] !== raw[match.index]) continue;
        const location = evidence(match.index, match[0].length);
        if (reportedStubs.has(location.lineNumber)) continue;
        reportedStubs.add(location.lineNumber);
        infractions.push({ type: "stub-abandonment", file: file.path, ...location, commitHash, commitDate, reason: rule.name });
      }
    }

    if (typescript) {
      // Cast syntax can span comments/newlines. Keep one type warning per start
      // line, as before, and never match through a missing diff hunk (NUL).
      const reported = new Set(infractions.slice(firstFinding).filter(f => f.type === "type-escape").map(f => f.lineNumber));
      for (const rule of CODE_TYPE_ESCAPE_PATTERNS) {
        for (const match of code.matchAll(new RegExp(rule.regex.source, "g"))) {
          const location = evidence(match.index, match[0].length);
          if (reported.has(location.lineNumber)) continue;
          reported.add(location.lineNumber);
          infractions.push({ type: "type-escape", file: file.path, ...location, commitHash, commitDate, reason: rule.name });
        }
      }
    }

    if (javascript) {
      for (const match of source.matchAll(JS_TEST_API)) {
        let previous = match.index - 1;
        while (previous >= 0 && /\s/.test(source[previous])) previous--;
        if (source[previous] === ".") continue;
        if (match[2] && !isTestFile(file.path)) continue;
        if (/\bfunction$/.test(source.slice(Math.max(0, previous - 8), previous + 1))) continue;
        if (source[match.index + match[0].length] === "\u0001" && !/\.\s*each\s*$/.test(match[3])) continue;
        const focus = match[1] === "only" || match[2] === "fit" || match[2] === "fdescribe";
        infractions.push({ type: focus ? "test-focus" : "test-skip", file: file.path, ...evidence(match.index, match[0].length),
          commitHash, commitDate, reason: focus ? "focused test or suite excludes other tests from the run" : `skipped, disabled or placeholder test registration (${match[0].replace(/\s/g, "")})`,
        });
      }
      if (isTestFile(file.path)) {
        for (const rule of JS_TRIVIAL_ASSERT_PATTERNS) {
          for (const match of source.matchAll(new RegExp(rule.regex.source, "g"))) {
            infractions.push({ type: "trivial-assert", file: file.path, ...evidence(match.index, match[0].length), commitHash, commitDate, reason: rule.name });
          }
        }
      }
    }

    // Empty handlers frequently span several lines. Only contiguous added code
    // can prove emptiness; hunk gaps must not be joined into a fabricated block.
    if (braceCatches) {
      for (const match of code.matchAll(/(?<![\w$.])catch\s*(?:\(\s*[^()\s\0][^()\0]*\))?\s*\{\s*\}/g)) {
        infractions.push({ type: "swallowed-error", file: file.path, ...evidence(match.index, match[0].length),
          commitHash, commitDate, reason: match[0].includes("\n") ? "empty multi-line catch block" : "empty catch block (catch {})" });
      }
    }
    for (let index = 0; index < maskedLines.length; index++) {
      const start = maskedLines[index];
      const inlineExcept = python && /^\s*except(?:\*?\s+[^:]+)?:\s*pass\s*;?\s*$/.test(start.code);
      if (inlineExcept) infractions.push({ type: "swallowed-error", file: file.path, lineNumber: start.number, lineSnippet: start.raw.trim(), commitHash, commitDate, reason: "silent python error swallow (except: pass)" });
      const isExcept = python && /^\s*except(?:\*?\s+[^:]+)?:\s*$/.test(start.code);
      if (!isExcept) continue;
      let next = index + 1;
      while (next < maskedLines.length && maskedLines[next].number === maskedLines[next - 1].number + 1 && !maskedLines[next].code.trim()) next++;
      const end = maskedLines[next];
      if (!end || end.number !== maskedLines[next - 1].number + 1) continue;
      let closesExcept = isExcept && /^\s*pass\s*;?\s*$/.test(end.code);
      if (closesExcept) {
        const indent = start.raw.search(/\S/);
        if (end.raw.search(/\S/) <= indent) closesExcept = false;
        let after = next + 1;
        while (after < maskedLines.length && maskedLines[after].number === maskedLines[after - 1].number + 1 && !maskedLines[after].code.trim()) after++;
        if (after < maskedLines.length && maskedLines[after].number === maskedLines[after - 1].number + 1 && maskedLines[after].raw.search(/\S/) > indent) closesExcept = false;
      }
      if (closesExcept) infractions.push({
        type: "swallowed-error", file: file.path, lineNumber: start.number,
        lineSnippet: maskedLines.slice(index, next + 1).map(line => line.raw.trim()).join(" "),
        commitHash, commitDate, reason: "silent multi-line python error swallow",
      });
    }
    // Detection passes share source context; preserve source order in reports.
    const ordered = infractions.splice(firstFinding).sort((left, right) => (left.lineNumber || 0) - (right.lineNumber || 0));
    for (const finding of ordered) infractions.push(finding);
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
  private focusedTests: Infraction[] = [];
  private typeEscapes: Infraction[] = [];
  private swallowedErrors: Infraction[] = [];
  private panicLoops: Infraction[] = [];
  private trivialAsserts: Infraction[] = [];
  private stubAbandonments: Infraction[] = [];

  private skippedLongLines = 0;
  private skippedUnknownFiles = 0;
  private skippedBinaryFiles = 0;

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

    this.skippedBinaryFiles += commit.files.filter(file => file.binary && isCodeFile(file.path, this.ignorePaths)).length;

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
      "test-focus": this.focusedTests,
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
    const complete = !this.skippedLongLines && !this.skippedUnknownFiles && !this.skippedBinaryFiles;
    const isSufficientData = complete && linesSample >= MIN_SAMPLE_LOC;

    // Code infractions penalty
    const codeInfractionPoints =
      this.testSkips.length * 15 +
      this.focusedTests.length * 15 +
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

    if (!complete) {
      archetype = "Incomplete audit";
      archetypeDescription = "Source was skipped; findings are partial and no complete score can be issued.";
    }

    return {
      complete,
      schemaVersion: "1.0.0",
      totalLinesAdded: this.totalLinesAdded,
      aiLinesAdded: this.aiLinesAdded,
      totalCommits: this.totalCommits,
      aiCommits: this.aiCommits,
      testSkips: this.testSkips,
      focusedTests: this.focusedTests,
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
      skippedBinaryFiles: this.skippedBinaryFiles,
    };
  }
}
