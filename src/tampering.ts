import { createHash } from "crypto";
import { isTestFile } from "./metrics.js";
import { analyzePythonConfig } from "./pyconfig.js";
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

/** Drop a trailing `# note` or `// note`, so adding or removing a remark does not change the assertion. */
function stripTrailingComment(line: string, language: Language): string {
  const marker = language === "py" ? "#" : "//";
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (line.startsWith(marker, i) && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
}

/** `, () => { expect(a)` on a one-line test: drop the callback header from the statement. */
const CALLBACK_HEADER = /^[,\s]*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*\{\s*|^[,\s]*(?:async\s+)?function\s*\w*\s*\([^)]*\)\s*\{\s*/;

function parseTests(text: string, language: Language): TestInfo[] {
  const assertionPattern = language === "js" ? JS_ASSERTION : language === "py" ? PY_ASSERTION : GO_ASSERTION;
  const seen = new Map<string, number>();
  return testBodies(text, language).map(test => {
    const body = test.body.split("\n").map(line => language === "go" ? line : stripTrailingComment(line, language));
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

// `toHaveBeenCalled()` says a function ran, not with what; `toEqual(expect.anything())` accepts any value that exists.
const WEAK_JS = /\.(?:toBeDefined|toBeTruthy|toBeFalsy|toBeUndefined)\s*\(|\.not\s*\.\s*(?:toBeNull|toBeUndefined|toThrow)\s*\(|\.toBeGreaterThanOrEqual\s*\(\s*0\s*\)|\.(?:toHaveBeenCalled|toBeCalled)\s*\(\s*\)|\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*expect\s*\.\s*(?:anything\s*\(\s*\)|any\s*\(\s*\w+\s*\))\s*\)/;
// "Not zero" in place of an exact count: weaker than `toHaveLength(3)`, but the reverse of `toHaveLength(0)`.
const BOUND_JS = /\.toBeGreaterThan\s*\(\s*(?:0|-1)\s*\)|\.toBeGreaterThanOrEqual\s*\(\s*[01]\s*\)/;
const ZERO_JS = /\.(?:toBe|toEqual|toStrictEqual|toHaveLength|toHaveBeenCalledTimes)\s*\(\s*(?:0|\[\s*\]|\{\s*\}|null|undefined|false|"")\s*\)/;
// A bare name, attribute, `is not None` or `True` only says "something exists". A call such as
// `assert caps.has_any([...])` is a real check, so it is never the weaker side.
const WEAK_PY = /^\s*assert\s+[\w.\[\]]+\s*(?:,.*)?$|^\s*assert\s+.+\bis\s+not\s+None\s*(?:,.*)?$|^\s*assert\s+True\b/;
// `assert len(rows) > 0` in place of `assert len(rows) == 3`; not when the old check expected nothing (`== 0`, `is None`, `not x`).
const BOUND_PY = /^\s*assert\s+.+(?:>\s*0|>=\s*[01])\s*(?:,.*)?$/;
const EMPTY_PY = /==\s*(?:0|\[\s*\]|\{\s*\}|""|''|None|False)\b|\bis\s+None\b|\bnot\b|!=\s*(?:0|None)\b/;
const PY_SPECIFIC = /==|!=|<=|>=|\bin\b|\bis\b|\bisinstance\s*\(|\.startswith\s*\(|\.endswith\s*\(|\bcallable\s*\(/;

// Only an exact check can be weakened: `toBeNull()` becoming `toBeTruthy()` is a flipped expectation, not a looser one.
const JS_SPECIFIC = /\.(?:toBe|toEqual|toStrictEqual|toHaveLength|toContain|toContainEqual|toMatch|toMatchObject|toHaveProperty|toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalledWith|toHaveBeenCalledTimes|toHaveBeenCalledOnce|toHaveTextContent|toHaveAttribute|toHaveValue|toThrow\w*|toBeGreaterThan\w*|toBeLessThan\w*)\s*\(/;

// Testing Library's getBy*/findBy* queries throw when nothing matches, so `toBeTruthy()` on one is still a presence check.
const THROWING_QUERY = /\b(?:get|find)(?:All)?By\w*\s*\(/;

/** The same kind of check with less pinned down: `toThrow("bad input")` → `toThrow()`, `raises(ValueError, match="x")` →
 * `raises(Exception)`, `assertRaisesRegex(ValueError, "x")` → `assertRaises(ValueError)`. */
function pinsLess(oldAssertion: string, newAssertion: string, language: Language): boolean {
  if (language === "js") {
    const was = /\.toThrow(?:Error)?\s*\(\s*([^)\s][^)]*)\)/.exec(oldAssertion);
    const now = /\.toThrow(?:Error)?\s*\(\s*([^)]*)\)/.exec(newAssertion);
    return !!was && !!now && (now[1].trim() === "" || (now[1].trim() === "Error" && was[1].trim() !== "Error"));
  }
  if (language === "py") {
    const raised = (text: string) => {
      const marker = /\bpytest\s*\.\s*raises\s*\(\s*([\w.]+|\([^)]*\))([^)]*)\)/.exec(text);
      if (marker) return { type: marker[1], message: /\bmatch\s*=/.test(marker[2]) };
      const unit = /\bassertRaises(Regex)?\s*\(\s*([\w.]+|\([^)]*\))/.exec(text);
      return unit ? { type: unit[2], message: !!unit[1] } : null;
    };
    const was = raised(oldAssertion), now = raised(newAssertion);
    const broad = (type: string) => /^(?:builtins\.)?(?:Base)?Exception$/.test(type);
    return !!was && !!now && ((was.message && !now.message) || (!broad(was.type) && broad(now.type)));
  }
  return false;
}

function isWeaker(oldAssertion: string, newAssertion: string, language: Language): boolean {
  if (pinsLess(oldAssertion, newAssertion, language)) return true;
  if (language === "js") {
    if (THROWING_QUERY.test(newAssertion) || !JS_SPECIFIC.test(oldAssertion) || WEAK_JS.test(oldAssertion) || BOUND_JS.test(oldAssertion)) return false;
    return WEAK_JS.test(newAssertion) || (BOUND_JS.test(newAssertion) && !ZERO_JS.test(oldAssertion));
  }
  if (language === "py") {
    if (WEAK_PY.test(oldAssertion) || BOUND_PY.test(oldAssertion) || !PY_SPECIFIC.test(oldAssertion)) return false;
    return WEAK_PY.test(newAssertion) || (BOUND_PY.test(newAssertion) && !EMPTY_PY.test(oldAssertion));
  }
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

/** A call to an assertion helper: `expectCheckout(...)`, `assertShape(...)`, `_assert_ok(...)`, `requireBody(...)`. */
const HELPER_CALL = /(?<![\w$])((?:expect|assert|verify|check|require)[A-Z]\w*|_{0,2}(?:assert|check|verify|expect|require)_\w+)\s*\(/g;

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
      // The checks moved into an assertion helper that this change introduces: they are still made, just not here.
      if ([...current.text.matchAll(HELPER_CALL)].some(call => !(oldText ?? "").includes(call[1]))) continue;
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
      result.immediate.push(finding("assertion-removed", newPath, current.line,
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

/** A marker that says a test is expected to fail (`xfail`, `it.fails`, `test.failing`, `test.fixme`, `expectedFailure`),
 * as opposed to a plain skip. */
export function isKnownFailureMarker(finding: Infraction): boolean {
  return finding.type === "test-skip" && /\bxfail\b|\bexpectedFailure\b|\bfixme\b|expected to fail/i.test(finding.reason);
}

/** The test a known-failure marker applies to: the `def` below a decorator or a `marks=` argument, the `def` around a
 * `pytest.xfail()`, the title of a JavaScript registration. Null when it applies to more than one test (`pytestmark`), to
 * a test with no title on the line, or to a parametrized table. */
function markedTest(finding: Infraction, lines: string[]): { key: string; title: string } | null {
  const snippet = finding.lineSnippet ?? "";
  const index = (finding.lineNumber ?? 1) - 1;
  if (/\.py$/i.test(finding.file ?? "")) {
    if (/^\s*pytestmark\b/.test(snippet)) return null;
    if (/imperative/.test(finding.reason)) {
      // `pytest.xfail()` sits inside the test: its `def` is the nearest line above with a smaller indent.
      const indent = (lines[index] ?? "").search(/\S/);
      for (let i = index - 1; i >= 0 && i > index - 200; i--) {
        const def = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
        if (def && def[1].length < indent) return { key: `py:${def[2]}`, title: def[2] };
      }
      return null;
    }
    // A marker, its arguments and any further decorators come before the `def` they belong to.
    for (let i = index; i < lines.length && i < index + 80; i++) {
      const def = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
      if (def) return { key: `py:${def[1]}`, title: def[1] };
    }
    return null;
  }
  if (/\.each\b/.test(snippet)) return null;
  const title = /(['"`])((?:\\.|(?!\1)[^\\\n])+)\1/.exec(snippet);
  return title ? { key: `js:${title[0]}`, title: title[0] } : null;
}

/** Known-failure markers a change put on tests that were already there. A marker on a test the change added documents a bug its
 * author knows about (public history is full of them: a new test for a reported issue, marked xfail); the same marker on a test
 * that was running is how a failure gets hidden. Markers are compared per test rather than per line of text, because the
 * lines of one file's markers are often identical and the review cannot tell which of them is the new one. A marker that
 * names no single test (`pytestmark = ...`) counts when the file has more of them than before. `before` and `after` are the
 * findings of the two versions of the file; `oldText` is null for a new file. */
export function newKnownFailureMarkers(before: Infraction[], after: Infraction[], oldText: string | null, newText: string | null): Infraction[] {
  const markers = after.filter(isKnownFailureMarker);
  if (!markers.length || oldText === null) return [];
  const oldLines = oldText.split(/\r?\n/), newLines = (newText ?? "").split(/\r?\n/);
  const existed = (test: { key: string; title: string }) => test.key.startsWith("py:")
    ? new RegExp(`^\\s*(?:async\\s+)?def\\s+${test.title}\\s*\\(`, "m").test(oldText)
    : oldText.includes(test.title);
  const markedBefore = new Set<string>();
  let unnamedBefore = 0;
  for (const finding of before.filter(isKnownFailureMarker)) {
    const test = markedTest(finding, oldLines);
    if (test) markedBefore.add(test.key); else unnamedBefore++;
  }
  const found: Infraction[] = [], unnamed: Infraction[] = [], seen = new Set<string>();
  for (const finding of markers) {
    const test = markedTest(finding, newLines);
    if (!test) { unnamed.push(finding); continue; }
    if (markedBefore.has(test.key) || seen.has(test.key) || !existed(test)) continue;
    seen.add(test.key);
    found.push(finding);
  }
  return [...found, ...unnamed.slice(unnamedBefore)];
}

// ---- Guards: configuration that decides whether bad code can pass ----

const GUARD_FILE = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|jsconfig\.json|(?:jest|vitest|vite)\.config\.[cm]?[jt]s|\.eslintrc(?:\.[a-z]+)?|eslint\.config\.[cm]?[jt]s|pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|\.?ruff\.toml|\.flake8|\.?mypy\.ini|\.?pylintrc|\.coveragerc|codecov\.ya?ml|\.gitlab-ci\.ya?ml|\.github\/workflows\/[^/]+\.ya?ml)$/i;

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
  // `coverage report --fail-under=90` on a command line, and pylint's `fail-under=9.5` in its own config (a lint score).
  /(?<![\w-])(--fail-under)[= ](\d+(?:\.\d+)?)/g,
  /(?<![\w-])(fail-under)\s*[:=]\s*(\d+(?:\.\d+)?)/g,
];

const SWITCHES = ["strict", "noImplicitAny", "strictNullChecks", "noImplicitReturns", "useUnknownInCatchVariables"];

// npm scripts whose success the project (or its CI) takes as "the code is fine".
const GATE_SCRIPT = /^(?:pre|post)?(?:test|lint|typecheck|type-check|check|ci|verify|validate)(?::[\w:.-]+)?$/;

// A line that runs a known test runner, wherever it sits in the step (single-line `run:` or a multi-line block),
// or a `run:` that names a test/unit/e2e target. Paths such as `.test/src/` are not test steps.
const CI_RUNNER = new RegExp(
  String.raw`(?<![\w./-])(?:pytest|vitest|jest|mocha|tox|nox)(?![\w/-])` +
  String.raw`|(?<![\w./-])(?:npm|yarn|pnpm|bun|go|cargo|mvn|gradle|make|dotnet|flutter)\s+(?:run\s+)?(?:-\S+\s+)*test(?![\w/])` +
  String.raw`|\brun:.*(?<=\s)(?:tests?|unit|e2e)(?![\w/.-])`);
const CI_FILE = /(?:\.github\/workflows\/|\.gitlab-ci)/;
// A call to a shared workflow may run the tests there. It offsets a removed step but is never itself "a test step".
const CI_REUSABLE = /^\s*-?\s*uses:\s*\S*\.github\/workflows\/\S+/;

export interface CiTestCount { file: string; before: number; after: number; reusableAfter: number; ungatedAfter: number }

// A workflow only gates a change when it runs on push or pull requests; a scheduled or manually dispatched one does not.
const CI_GATE = /^\s*(?:pull_request|pull_request_target|push|merge_group)\s*:|^\s*on\s*:\s*(?:\[[^\]]*\b(?:push|pull_request|pull_request_target|merge_group)\b[^\]]*\]|(?:push|pull_request|pull_request_target|merge_group)\s*$)|^\s*-\s*(?:push|pull_request|pull_request_target|merge_group)\s*$/m;

function gatingTestLines(file: string, text: string): number {
  return /\.gitlab-ci/.test(file) || CI_GATE.test(text) ? matchingLines(text, CI_RUNNER) : 0;
}

function matchingLines(text: string, pattern: RegExp): number {
  return text.split(/\r?\n/).filter(line => !line.trim().startsWith("#") && pattern.test(line)).length;
}

/** Test-step counts for one changed CI file; null when it is not a CI file. */
export function ciTestSteps(file: string, oldText: string | null, newText: string | null): CiTestCount | null {
  if (!CI_FILE.test(file) || (oldText === null && newText === null)) return null;
  const was = oldText ?? "", now = newText ?? ""; // a deleted workflow runs no tests; a new one may take over another's
  const after = gatingTestLines(file, now);
  return { file, before: gatingTestLines(file, was), after, reusableAfter: matchingLines(now, CI_REUSABLE), ungatedAfter: after === 0 ? matchingLines(now, CI_RUNNER) : 0 };
}

/** A workflow that stopped running any tests is reported only when the review as a whole lost test steps:
 * moving them to another workflow, or to a shared one, is not removal. */
export function resolveCiTestSteps(counts: CiTestCount[], commit: string): Infraction[] {
  const before = counts.reduce((sum, item) => sum + item.before, 0);
  const after = counts.reduce((sum, item) => sum + item.after + item.reusableAfter, 0);
  if (after >= before) return [];
  return counts.filter(item => item.before > 0 && item.after === 0 && item.reusableAfter === 0)
    .map(item => item.ungatedAfter > 0
      ? finding("guard-weakened", item.file, 1, "tests no longer run on push or pull_request", "Workflow keeps its tests but no longer runs on pushes or pull requests", commit)
      : finding("guard-weakened", item.file, 1, "test command no longer runs in CI", "Test step removed from CI", commit));
}

// A step that tolerates failure, or that `if: false` switches off: either way the gate stops gating.
const LENIENT = /continue-on-error:\s*true|allow_failure:\s*true|^\s*(?:-\s+)?if:\s*(?:\$\{\{\s*)?false\s*(?:\}\})?\s*(?:#.*)?$/;
// `npm test || true` ends the step with success whatever the tests did: `continue-on-error` written in shell.
const SHELL_SWALLOW = /\|\|\s*(?:true|exit\s+0|:|echo\b)|;\s*(?:true|exit\s+0)\b/;

/** Tolerated-failure markers per enclosing step or job, keyed by that step's own line. */
function lenientSteps(text: string): Map<string, { count: number; line: number }> {
  const lines = text.split(/\r?\n/);
  const indentOf = (line: string) => line.length - line.trimStart().length;
  const found = new Map<string, { count: number; line: number }>();
  lines.forEach((line, i) => {
    if (line.trim().startsWith("#") || !LENIENT.test(line)) return;
    let j = i - 1;
    let identity: string;
    if (/^\s*-\s+if:/.test(line)) {
      // `- if: false` opens its own step: the next line (`run: npm test`, `name: Test`) names it.
      j = i + 1;
      while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith("#"))) j++;
      identity = j < lines.length ? lines[j].trim() : "";
    } else {
      while (j >= 0 && (!lines[j].trim() || lines[j].trim().startsWith("#") || indentOf(lines[j]) >= indentOf(line))) j--;
      identity = j >= 0 ? lines[j].trim() : "";
    }
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
  if (/threshold|fail[_-]under|coverage/i.test(newText)) {
    for (const pattern of THRESHOLD_PATTERNS) {
      const old = new Map(numbers(oldText, pattern).map(item => [item.key, item.value]));
      for (const item of numbers(newText, pattern)) {
        const previous = old.get(item.key);
        if (previous !== undefined && item.value < previous) {
          add(item.index, `${item.key.split("#")[0]}: ${previous} → ${item.value}`, item.key.startsWith("fail-under#") ? "Lint score threshold lowered" : "Coverage threshold lowered");
        }
      }
    }
  }
  if (/(?:^|\/)(?:tsconfig|jsconfig)[^/]*\.json$/i.test(file)) {
    const setting = (text: string, name: string) => new RegExp(`"${name}"\\s*:\\s*(true|false)`).exec(text);
    const strictBefore = setting(oldText, "strict")?.[1] === "true";
    for (const name of SWITCHES) {
      const before = setting(oldText, name), after = setting(newText, name);
      // `"noImplicitAny": false` added under `"strict": true` switches one check off without touching strict itself.
      if (after?.[1] === "false" && (before?.[1] === "true" || (before === null && strictBefore && name !== "strict"))) {
        add(after.index, `${name}: ${before ? "true → false" : "false (strict stays on)"}`, "Compiler strictness switched off");
      }
    }
  }
  if (/eslint/i.test(file)) {
    // Highest level per rule: an override that switches a rule off for some files does not downgrade it.
    const rules = (text: string) => {
      const found = new Map<string, { level: number; index: number }>();
      for (const match of text.matchAll(/["']([@\w/.-]+)["']\s*:\s*(?:\[\s*)?["']?(error|warn|off|[012])["']?/g)) {
        const level = severityOf(match[2]);
        const known = found.get(match[1]);
        if (!known || level > known.level) found.set(match[1], { level, index: match.index ?? 0 });
      }
      return found;
    };
    const before = rules(oldText), after = rules(newText);
    for (const [name, now] of after) {
      const previous = before.get(name);
      // `no-restricted-imports` handed over to `@typescript-eslint/no-restricted-imports` is still enforced.
      const replaced = [...after].some(([other, setting]) => other !== name && other.endsWith(`/${name}`) && setting.level === 2);
      if (previous && previous.level === 2 && now.level < 2 && !replaced) add(now.index, `${name}: error → ${now.level ? "warn" : "off"}`, "Lint rule downgraded");
    }
  }
  if (/(?:^|\/)(?:pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml)$/i.test(file)) {
    // `xfail_strict` turns a test that is expected to fail but passes into a failure. Switched off, tests marked xfail pass
    // or fail without the run noticing either way.
    const strictness = (text: string) => /^[ \t]*xfail_strict[ \t]*=[ \t]*(true|false|1|0|yes|no|on|off)\b/im.exec(text);
    const before = strictness(oldText), after = strictness(newText);
    if (before && after && /^(?:true|1|yes|on)$/i.test(before[1]) && /^(?:false|0|no|off)$/i.test(after[1])) {
      add(after.index, "xfail_strict: true → false", "Strict xfail switched off");
    }
  }
  if (/(?:^|\/)(?:pyproject\.toml|setup\.cfg|tox\.ini|\.?ruff\.toml|\.flake8|\.?mypy\.ini|\.?pylintrc)$/i.test(file)) {
    analyzePythonConfig(file, oldText, newText, (line, snippet, reason) => { out.push(finding("guard-weakened", file, line, snippet, reason, commit)); });
  }
  if (CI_FILE.test(file)) {
    // Tolerating failure on a step that already existed makes a gate easier to pass. A step or job added in the
    // same change is a new best-effort check, not a weakened one.
    // A step written as `- run: npm test` is the same step as `run: npm test` under a new `- if: false` item.
    const before = lenientSteps(oldText), existing = new Set(oldText.split(/\r?\n/).flatMap(line => [line.trim(), line.trim().replace(/^-\s+/, "")]));
    const newLines = newText.split(/\r?\n/);
    for (const [identity, now] of lenientSteps(newText)) {
      if (identity && existing.has(identity) && now.count > (before.get(identity)?.count ?? 0)) {
        const marker = (newLines[now.line - 1] ?? "").trim();
        out.push(finding("guard-weakened", file, now.line, marker, /^(?:-\s+)?if:/.test(marker) ? "CI step is now switched off" : "CI step is now allowed to fail", commit));
        break;
      }
    }
    const swallowing = (text: string) => text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index }))
      .filter(item => !item.line.startsWith("#") && CI_RUNNER.test(item.line) && SHELL_SWALLOW.test(item.line));
    const was = swallowing(oldText), now = swallowing(newText);
    if (now.length > was.length) {
      const known = new Set(was.map(item => item.line));
      const fresh = now.find(item => !known.has(item.line)) ?? now[0];
      out.push(finding("guard-weakened", file, fresh.index + 1, fresh.line.slice(0, 80), "Test command can no longer fail the CI step", commit));
    }
  }
  if (/(?:^|\/)package\.json$/i.test(file)) {
    try {
      const before = JSON.parse(oldText)?.scripts, after = JSON.parse(newText)?.scripts;
      // A script the project relies on to say "this is fine" that was changed into one that always does.
      const noop = (script: string) => /^\s*(?:echo\b|true\b|exit\s+0|:)/.test(script) || /\|\|\s*(?:true|exit\s+0)\b/.test(script);
      if (before && after) for (const name of Object.keys(after)) {
        const was = before[name], now = after[name];
        if (!GATE_SCRIPT.test(name) || typeof was !== "string" || typeof now !== "string" || was === now) continue;
        const tests = /^(?:pre|post)?test(?::|$)/.test(name);
        if ((noop(now) && !noop(was)) || (tests && /--passWithNoTests/.test(now) && !/--passWithNoTests/.test(was))) {
          add(Math.max(0, newText.indexOf(`"${name}"`)), `${name}: ${now}`, tests ? "Test script can no longer fail" : `The ${name} script can no longer fail`);
          break;
        }
      }
    } catch { /* invalid JSON is reported by other tooling; nothing to compare */ }
  }
  return out;
}
