import { createHash } from "crypto";
import { isTestFile } from "./metrics.js";
import { RULE_GUIDES } from "./rules.js";
import type { DetectorType, Infraction } from "./types.js";

/** Diff-aware detection of changes that make a project easier to pass without
 * making it more correct: fewer or weaker assertions, deleted tests, edited
 * expectations, and weakened CI/compiler/linter guards. Everything here compares
 * the full before/after text of a changed file; it never runs project code. */

type Language = "js" | "py" | "go";

interface TestInfo {
  key: string;
  /** Python @parametrize: one function now covers several cases, so counts are not comparable. */
  parametrized: boolean;
  name: string;
  line: number;
  assertions: string[];
  /** Same statements as written, for evidence and weak-check detection. */
  raw: string[];
  /** Non-assertion body lines, whitespace-normalized: the "arrange/act" part. */
  setup: string;
  /** Body hash that ignores the test title, so a rename or move is not a removal. */
  bodyHash: string;
  /** Body text with whole-line comments blanked. */
  text: string;
}

export interface RemovedTest { finding: Infraction; bodyHash: string }

export interface FileTampering {
  immediate: Infraction[];
  removedTests: RemovedTest[];
  addedHashes: string[];
  /** Reported only when production code changed in the same review. */
  rewritten: Infraction[];
}

const EMPTY: FileTampering = { immediate: [], removedTests: [], addedHashes: [], rewritten: [] };

function languageOf(file: string): Language | null {
  if (/\.(?:[cm]?[jt]sx?)$/i.test(file)) return "js";
  if (/\.py$/i.test(file)) return "py";
  if (/_test\.go$/i.test(file)) return "go";
  return null;
}

/** Blank whole-line comments so a commented-out test counts as removed. */
function codeLines(text: string, language: Language): string[] {
  let block = false;
  return text.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (language !== "py") {
      if (block) { if (trimmed.includes("*/")) block = false; return ""; }
      if (trimmed.startsWith("/*")) { if (!trimmed.includes("*/")) block = true; return ""; }
      if (trimmed.startsWith("//")) return "";
    } else if (trimmed.startsWith("#")) return "";
    return line;
  });
}

const JS_TEST_START = /(?<![\w$.])(?:it|test)(?:\s*\.\s*(?:only|skip|concurrent|serial))*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/;
const PY_TEST_START = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/;
const GO_TEST_START = /^func\s+(Test\w+)\s*\(/;

const JS_ASSERTION = /(?<![\w$.])(?:expect|assert|expectTypeOf)\b(?!\s*\.\s*(?:assertions|hasAssertions|extend|anything|any|objectContaining|arrayContaining|stringContaining|stringMatching)\b)(?:\s*\.\s*\w+)*\s*\(|\.should\b/;
const PY_ASSERTION = /^\s*assert\b|\bself\s*\.\s*assert\w*\s*\(|\bpytest\s*\.\s*raises\b|\bassertRaises\b|(?<!\w)assert_\w+\s*\(/;
const GO_ASSERTION = /\bt\s*\.\s*(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\b(?:assert|require)\s*\.\s*\w+\s*\(/;

/** End offset of the call whose opening parenthesis precedes `from`, never past `limit`.
 * Skips string literals and trailing line comments; ' and " end with the line. */
function callEnd(text: string, from: number, limit: number): number {
  let depth = 1, quote = "";
  for (let i = from; i < limit; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote || (char === "\n" && quote !== "`")) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "/" && text[i + 1] === "/" && (i === from || /\s/.test(text[i - 1]))) {
      const newline = text.indexOf("\n", i);
      i = newline < 0 || newline > limit ? limit : newline;
    } else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return i;
  }
  return limit;
}

interface TestBody { name: string; line: number; body: string; parametrized: boolean }

/** Bodies are bounded by syntax and by the next test's start, so a test's hash does not
 * depend on what follows it and total work stays linear even for malformed input. */
function testBodies(text: string, language: Language): TestBody[] {
  const lines = codeLines(text, language);
  if (language === "js") {
    const code = lines.join("\n");
    const matches = [...code.matchAll(new RegExp(JS_TEST_START.source, "g"))];
    let line = 1, cursor = 0;
    return matches.map((match, i) => {
      const at = match.index ?? 0;
      for (; cursor < at; cursor++) if (code.charCodeAt(cursor) === 10) line++;
      const from = at + match[0].length;
      const limit = i + 1 < matches.length ? (matches[i + 1].index ?? code.length) : code.length;
      return { name: match[2], line, body: code.slice(from, Math.min(callEnd(code, from, limit) + 1, limit)), parametrized: false };
    });
  }
  const startPattern = language === "py" ? PY_TEST_START : GO_TEST_START;
  const starts: { index: number; name: string; length: number }[] = [];
  lines.forEach((line, index) => {
    const match = startPattern.exec(line);
    if (match) starts.push({ index, name: match[1], length: match[0].length });
  });
  const indentOf = (line: string) => /^\s*/.exec(line)![0].length;
  return starts.map((start, n) => {
    const limit = n + 1 < starts.length ? starts[n + 1].index : lines.length;
    const header = lines[start.index], indent = indentOf(header);
    let end = start.index + 1, depth = balance(header);
    while (depth > 0 && end < limit) depth += balance(lines[end++]);
    while (end < limit && (language === "go" ? lines[end - 1] !== "}" : !lines[end].trim() || indentOf(lines[end]) > indent)) end++;
    let top = start.index;
    // Decorators sit directly above `def`, however long their arguments are.
    while (top > 0 && start.index - top < 200 && lines[top - 1].trim() && !/^\s*(?:async\s+)?(?:def|class)\b/.test(lines[top - 1])) top--;
    return {
      name: start.name, line: start.index + 1, body: [header.slice(start.length), ...lines.slice(start.index + 1, end)].join("\n"),
      parametrized: /parametrize/.test(lines.slice(top, start.index).join("\n")),
    };
  });
}

/** Net open brackets on a line, ignoring string contents. */
function balance(line: string): number {
  const bare = line.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "");
  let net = 0;
  for (const char of bare) net += "([{".includes(char) ? 1 : ")]}".includes(char) ? -1 : 0;
  return net;
}

/** Whitespace, quote style and trailing commas are formatter choices, not behavior. */
function normalize(statement: string): string {
  return statement.replace(/\s+/g, "").replace(/'/g, '"').replace(/,([)\]}])/g, "$1").replace(/;$/, "");
}

/** Split on `;` outside string literals, so `expect(a); expect(b);` is two statements. */
function splitStatements(text: string): string[] {
  const pieces: string[] = [];
  let quote = "", start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === ";") { pieces.push(text.slice(start, i)); start = i + 1; }
  }
  pieces.push(text.slice(start));
  return pieces.map(piece => piece.trim()).filter(Boolean);
}

/** `, () => { expect(a)` on a one-line test: drop the callback header from the statement. */
const CALLBACK_HEADER = /^[,\s]*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*\{\s*|^[,\s]*(?:async\s+)?function\s*\w*\s*\([^)]*\)\s*\{\s*/;

function parseTests(text: string, language: Language): TestInfo[] {
  const assertionPattern = language === "js" ? JS_ASSERTION : language === "py" ? PY_ASSERTION : GO_ASSERTION;
  const seen = new Map<string, number>();
  return testBodies(text, language).map(test => {
    const body = test.body.split("\n");
    const assertions: string[] = [], raw: string[] = [], setupLines: string[] = [];
    for (let i = 0; i < body.length; i++) {
      if (!assertionPattern.test(body[i])) { setupLines.push(body[i]); continue; }
      // A statement can span lines after formatting; keep it whole.
      let statement = body[i].trim(), depth = balance(body[i]);
      while (depth > 0 && i + 1 < body.length) { i++; statement += " " + body[i].trim(); depth += balance(body[i]); }
      for (const piece of language === "js" ? splitStatements(statement) : [statement]) {
        const clean = piece.replace(CALLBACK_HEADER, "");
        if (assertionPattern.test(clean)) { raw.push(clean); assertions.push(normalize(clean)); }
        else setupLines.push(clean);
      }
    }
    const setup = setupLines.join("\n").replace(/\s+/g, "");
    const bodyHash = createHash("sha1").update(test.body.replace(/\s+/g, "")).digest("hex");
    const count = (seen.get(test.name) ?? 0) + 1;
    seen.set(test.name, count);
    return { key: `${test.name}#${count}`, parametrized: test.parametrized, name: test.name, line: test.line, assertions, raw, setup, bodyHash, text: test.body };
  });
}

/** Replace literal values with placeholders: equal skeletons mean only values changed. */
function skeleton(assertion: string): string {
  return assertion
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "S")
    .replace(/\b\d+(?:\.\d+)?\b/g, "N")
    .replace(/\b(?:true|false|null|undefined|None|True|False|nil)\b/g, "V")
    .replace(/\s+/g, "");
}

const WEAK_JS = /\.(?:toBeDefined|toBeTruthy|toBeFalsy|toBeUndefined)\s*\(|\.not\s*\.\s*(?:toBeNull|toBeUndefined|toThrow)\s*\(|\.toBeGreaterThanOrEqual\s*\(\s*0\s*\)/;
// A bare name, attribute, `is not None` or `True` only says "something exists". A call such as
// `assert caps.has_any([...])` is a real check, so it is never the weaker side.
const WEAK_PY = /^\s*assert\s+[\w.\[\]]+\s*(?:,.*)?$|^\s*assert\s+.+\bis\s+not\s+None\s*(?:,.*)?$|^\s*assert\s+True\b/;
const PY_SPECIFIC = /==|!=|<=|>=|\bin\b|\bis\b|\bisinstance\s*\(|\.startswith\s*\(|\.endswith\s*\(|\bcallable\s*\(/;

function isWeaker(oldAssertion: string, newAssertion: string, language: Language): boolean {
  if (language === "js") return WEAK_JS.test(newAssertion) && !WEAK_JS.test(oldAssertion);
  if (language === "py") return WEAK_PY.test(newAssertion) && !WEAK_PY.test(oldAssertion) && PY_SPECIFIC.test(oldAssertion);
  return false;
}

/** Words from string and regexp literals in an assertion: the data it pinned down. */
const GENERIC_ARGUMENT = /^(?:not\.)?(?:be|have|contain|include|exist|match|eq|equal|length|text|value|attr|class|css|visible|checked|disabled|enabled|selected|focus|empty|true|false|null|undefined|deep)(?:\.\w+)*$/;
function literalTokens(statement: string): string[] {
  const tokens = new Set<string>();
  const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1|(?<=[(,]\s*)\/((?:\\.|[^/\\\n])+)\/[a-z]*/g;
  for (const match of statement.matchAll(literal)) {
    for (const token of (match[2] ?? match[3] ?? "").match(/[A-Za-z0-9_:.=@#%-]{4,}/g) ?? []) {
      if (!GENERIC_ARGUMENT.test(token)) tokens.add(token);
    }
  }
  return [...tokens];
}

function finding(type: DetectorType, file: string, line: number, snippet: string, reason: string, commit: string): Infraction {
  return { type, file, lineNumber: Math.max(1, line), lineSnippet: snippet, commitHash: commit, commitDate: "", reason, suggestion: RULE_GUIDES[type].suggestion };
}

/** Compare a test file's behavior-checking surface before and after a change. */
export function analyzeTestFile(oldPath: string, newPath: string, oldText: string | null, newText: string | null, commit: string): FileTampering {
  const language = languageOf(newText === null ? oldPath : newPath);
  if (!language || !(isTestFile(newPath) || isTestFile(oldPath))) return EMPTY;
  const before = oldText === null ? [] : parseTests(oldText, language);
  const after = newText === null ? [] : parseTests(newText, language);
  const afterByKey = new Map(after.map(test => [test.key, test]));
  const newCode = newText === null ? "" : codeLines(newText, language).join("\n");
  const tally = (tests: TestInfo[]) => {
    const totals = new Map<string, number>();
    for (const test of tests) for (const assertion of test.assertions) totals.set(assertion, (totals.get(assertion) ?? 0) + 1);
    return totals;
  };
  const oldTotals = tally(before), newTotals = tally(after);
  const beforeKeys = new Set(before.map(test => test.key));
  const addedText = after.filter(test => !beforeKeys.has(test.key)).map(test => test.text).join("\n");
  const result: FileTampering = { immediate: [], removedTests: [], addedHashes: [], rewritten: [] };
  for (const test of after) if (!beforeKeys.has(test.key)) result.addedHashes.push(test.bodyHash);
  for (const old of before) {
    const current = afterByKey.get(old.key);
    if (!current) {
      // The exact title still present as a string means the test moved into a table (it.each, subTest), not away.
      if (newCode && ['"', "'", "`"].some(quote => newCode.includes(quote + old.name + quote))) continue;
      result.removedTests.push({
        bodyHash: old.bodyHash,
        finding: finding("test-removed", newPath, 1, `${old.name}: test no longer present`,
          newText === null ? "Test file deleted" : "Test removed", commit),
      });
      continue;
    }
    if (current.parametrized && !old.parametrized) continue;
    // Folding several checks into one snapshot of the whole result is a stronger check, not a weaker one.
    const snapshot = (test: TestInfo) => test.raw.some(statement => /\.toMatch(?:Inline)?Snapshot\b|\.matchSnapshot\b|\bsnapshot\s*\(/.test(statement));
    if (snapshot(current) && !snapshot(old)) continue;
    if (current.assertions.length < old.assertions.length) {
      // A check that left this test is not lost when the same text was added elsewhere in the file, or when
      // every literal it pinned down (a title, a path, a message) is still asserted in this test or in a new one.
      const budget = tally([current]);
      const lost: { normalized: string; raw: string }[] = [];
      old.assertions.forEach((assertion, i) => {
        const left = budget.get(assertion) ?? 0;
        if (left > 0) budget.set(assertion, left - 1);
        else lost.push({ normalized: assertion, raw: old.raw[i] });
      });
      const introduced = `${current.text}\n${addedText}`;
      const accounted = (item: { normalized: string; raw: string }) => {
        if ((newTotals.get(item.normalized) ?? 0) >= (oldTotals.get(item.normalized) ?? 0)) return true;
        const tokens = literalTokens(item.raw);
        return tokens.length > 0 && tokens.every(token => introduced.includes(token));
      };
      if (lost.every(accounted)) continue;
      result.immediate.push(finding("assertion-weakened", newPath, current.line,
        `${old.name}: ${old.assertions.length} → ${current.assertions.length} assertions`,
        "Test checks less than before", commit));
      continue;
    }
    if (current.assertions.length === old.assertions.length && old.assertions.length > 0) {
      const changed = old.assertions.map((assertion, i) => ({ before: assertion, after: current.assertions[i], rawBefore: old.raw[i], rawAfter: current.raw[i] }))
        .filter(pair => pair.before !== pair.after);
      const weaker = changed.find(pair => isWeaker(pair.rawBefore, pair.rawAfter, language));
      if (weaker) {
        result.immediate.push(finding("assertion-weakened", newPath, current.line,
          `${old.name}: ${weaker.rawBefore.slice(0, 80)} → ${weaker.rawAfter.slice(0, 80)}`, "Assertion replaced by a weaker check", commit));
      } else if (changed.length && old.setup === current.setup && changed.every(pair => skeleton(pair.before) === skeleton(pair.after))) {
        result.rewritten.push(finding("expectation-rewritten", newPath, current.line,
          `${old.name}: ${changed[0].rawBefore.slice(0, 80)} → ${changed[0].rawAfter.slice(0, 80)}`,
          "Expected value edited while the test inputs stayed the same", commit));
      }
    }
  }
  return result;
}

/** Merge per-file results. A removed test is dismissed when an identical body was
 * added anywhere in the review (rename or move); edited expectations are reported
 * only when production code changed too, which is the "fix the test, not the code" shape. */
export function resolveTampering(files: FileTampering[], productionChanged: boolean): Infraction[] {
  const added = new Set(files.flatMap(file => file.addedHashes));
  return [
    ...files.flatMap(file => file.immediate),
    ...files.flatMap(file => file.removedTests).filter(removed => !added.has(removed.bodyHash)).map(removed => removed.finding),
    ...(productionChanged ? files.flatMap(file => file.rewritten) : []),
  ];
}

// ---- Guards: configuration that decides whether bad code can pass ----

const GUARD_FILE = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|jsconfig\.json|(?:jest|vitest|vite)\.config\.[cm]?[jt]s|\.eslintrc(?:\.[a-z]+)?|eslint\.config\.[cm]?[jt]s|pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|\.coveragerc|codecov\.ya?ml|\.gitlab-ci\.ya?ml|\.github\/workflows\/[^/]+\.ya?ml)$/i;

export function isGuardFile(file: string): boolean { return GUARD_FILE.test(file); }

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function numbers(text: string, pattern: RegExp): { key: string; value: number; index: number }[] {
  const seen = new Map<string, number>();
  return [...text.matchAll(pattern)].map(match => {
    const label = match[1] ?? "value";
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return { key: `${label}#${count}`, value: Number(match[match.length - 1]), index: match.index ?? 0 };
  });
}

const THRESHOLD_PATTERNS: RegExp[] = [
  /\b(lines|branches|functions|statements)\b["']?\s*[:=]\s*(\d+(?:\.\d+)?)/g,
  /\b(fail_under)\s*[:=]\s*(\d+(?:\.\d+)?)/g,
  /(--cov-fail-under)[= ](\d+(?:\.\d+)?)/g,
];

const SWITCHES = ["strict", "noImplicitAny", "strictNullChecks", "noImplicitReturns", "useUnknownInCatchVariables"];

// A run step that mentions a test/unit target (not merely a path such as `.test/src/`), a bare test runner, or a
// call to a shared workflow: a split, a package-manager swap or a move to a reusable workflow keeps the count.
const TESTISH = String.raw`(?<![\w./])(?:tests?|unit|e2e|pytest|vitest|jest|mocha|ava|tap|tox|nox|spec)(?![\w/])`;
const TEST_COMMAND = new RegExp(
  String.raw`\brun:.*${TESTISH}|^\s*-?\s*(?:npm|yarn|pnpm|bun|go|cargo|mvn|gradle|make)\s+(?:run\s+)?(?:\w+\s+)?tests?\b` +
  String.raw`|^\s*-?\s*(?:python\s+-m\s+)?(?:pytest|vitest|jest|mocha|tox|nox)\b|^\s*-?\s*uses:\s*\S*\.github/workflows/\S+`);
const LENIENT = /continue-on-error:\s*true|allow_failure:\s*true/;

/** Tolerated-failure markers per enclosing step or job, keyed by that step's own line. */
function lenientSteps(text: string): Map<string, { count: number; line: number }> {
  const lines = text.split(/\r?\n/);
  const indentOf = (line: string) => line.length - line.trimStart().length;
  const found = new Map<string, { count: number; line: number }>();
  lines.forEach((line, i) => {
    if (line.trim().startsWith("#") || !LENIENT.test(line)) return;
    let j = i - 1;
    while (j >= 0 && (!lines[j].trim() || lines[j].trim().startsWith("#") || indentOf(lines[j]) >= indentOf(line))) j--;
    const identity = j >= 0 ? lines[j].trim() : "";
    const entry = found.get(identity);
    if (entry) entry.count++; else found.set(identity, { count: 1, line: i + 1 });
  });
  return found;
}

function severityOf(value: string): number {
  return /^(?:error|2)$/.test(value) ? 2 : /^(?:warn|1)$/.test(value) ? 1 : 0;
}

/** Report places where a guard got easier to pass between two versions of a config file. */
export function analyzeGuardFile(file: string, oldText: string | null, newText: string | null, commit: string): Infraction[] {
  if (oldText === null || newText === null) return [];
  const out: Infraction[] = [];
  const add = (index: number, snippet: string, reason: string) =>
    out.push(finding("guard-weakened", file, lineOf(newText, index), snippet, reason, commit));
  if (/threshold|fail_under|cov-fail-under|coverage/i.test(newText)) {
    for (const pattern of THRESHOLD_PATTERNS) {
      const old = new Map(numbers(oldText, pattern).map(item => [item.key, item.value]));
      for (const item of numbers(newText, pattern)) {
        const previous = old.get(item.key);
        if (previous !== undefined && item.value < previous) {
          add(item.index, `${item.key.split("#")[0]}: ${previous} → ${item.value}`, "Coverage threshold lowered");
        }
      }
    }
  }
  if (/(?:^|\/)(?:tsconfig|jsconfig)[^/]*\.json$/i.test(file)) {
    for (const name of SWITCHES) {
      const pattern = new RegExp(`"${name}"\\s*:\\s*(true|false)`);
      const before = pattern.exec(oldText), after = pattern.exec(newText);
      if (before?.[1] === "true" && after?.[1] === "false") add(after.index, `${name}: true → false`, "Compiler strictness switched off");
    }
  }
  if (/eslint/i.test(file)) {
    const rules = (text: string) => new Map([...text.matchAll(/["']([@\w/.-]+)["']\s*:\s*(?:\[\s*)?["']?(error|warn|off|[012])["']?/g)]
      .map(match => [match[1], { level: severityOf(match[2]), index: match.index ?? 0 }] as const));
    const before = rules(oldText);
    for (const [name, now] of rules(newText)) {
      const previous = before.get(name);
      if (previous && previous.level === 2 && now.level < 2) add(now.index, `${name}: error → ${now.level ? "warn" : "off"}`, "Lint rule downgraded");
    }
  }
  if (/(?:\.github\/workflows\/|\.gitlab-ci)/.test(file)) {
    const count = (text: string, pattern: RegExp) => text.split(/\r?\n/).filter(line => !line.trim().startsWith("#") && pattern.test(line)).length;
    // Tolerating failure on a step that already existed makes a gate easier to pass. A step or job added in the
    // same change is a new best-effort check, not a weakened one.
    const before = lenientSteps(oldText), existing = new Set(oldText.split(/\r?\n/).map(line => line.trim()));
    for (const [identity, now] of lenientSteps(newText)) {
      if (identity && existing.has(identity) && now.count > (before.get(identity)?.count ?? 0)) {
        out.push(finding("guard-weakened", file, now.line, "continue-on-error: true", "CI step is now allowed to fail", commit));
        break;
      }
    }
    if (count(newText, TEST_COMMAND) < count(oldText, TEST_COMMAND)) {
      add(0, "test command no longer runs in CI", "Test step removed from CI");
    }
  }
  if (/(?:^|\/)package\.json$/i.test(file)) {
    try {
      const before = JSON.parse(oldText)?.scripts?.test, after = JSON.parse(newText)?.scripts?.test;
      if (typeof before === "string" && typeof after === "string" && before !== after &&
          (/^\s*(?:echo\b|true\b|exit\s+0|:)/.test(after) || /\|\|\s*(?:true|exit\s+0)\b/.test(after) ||
           (/--passWithNoTests/.test(after) && !/--passWithNoTests/.test(before)))) {
        add(Math.max(0, newText.indexOf('"test"')), `test: ${after}`, "Test script can no longer fail");
      }
    } catch { /* invalid JSON is reported by other tooling; nothing to compare */ }
  }
  return out;
}
