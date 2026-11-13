import { createHash } from "crypto";
import { isTestFile } from "./metrics.js";
import { mockedSubjects } from "./mocks.js";
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

/** The text with the inside of each regular expression literal blanked out, same length, so that a quote or a bracket in a pattern
 * (`/'\.github\/(a|b)/`) is not read as code. A `/` opens a literal after an operator or an opening bracket, not after a value. */
function maskRegexLiterals(text: string): string {
  let out = "", quote = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      out += char;
      if (char === "\\" && i + 1 < text.length) out += text[++i];
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; out += char; continue; }
    if (char === "/" && text[i + 1] !== "/" && text[i + 1] !== "*") {
      let p = out.length - 1;
      while (p >= 0 && /\s/.test(out[p])) p--;
      if (p < 0 || /[(,=:[!&|?{};+\-*%~^]/.test(out[p]) || /(?:return|typeof|case)$/.test(out.slice(0, p + 1))) {
        let j = i + 1, inClass = false, closed = false;
        for (; j < text.length; j++) {
          const c = text[j];
          if (c === "\n") break;
          if (c === "\\") { j++; continue; }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) { closed = true; break; }
        }
        if (closed) { out += "/" + "_".repeat(j - i - 1) + "/"; i = j; continue; }
      }
    }
    out += char;
  }
  return out;
}

/** Net open brackets on a line, ignoring string contents, regular expression literals and whatever a backslash escapes. */
function balance(line: string): number {
  const bare = maskRegexLiterals(line).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "").replace(/\\./g, "");
  let net = 0;
  for (const char of bare) net += "([{".includes(char) ? 1 : ")]}".includes(char) ? -1 : 0;
  return net;
}

/** `assert x, ("message")` is `assert x, "message"`: the brackets around the message are a formatter's choice too. */
function withoutMessageParens(statement: string): string {
  let depth = 0, quote = "";
  for (let i = 0; i < statement.length; i++) {
    const char = statement[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      const message = statement.slice(i + 1).trim();
      if (!message.startsWith("(") || !message.endsWith(")")) return statement;
      let inner = 0, q = "";
      for (let j = 0; j < message.length; j++) {
        const c = message[j];
        if (q) { if (c === "\\") j++; else if (c === q) q = ""; }
        else if (c === '"' || c === "'") q = c;
        else if (c === "(") inner++;
        else if (c === ")" && --inner === 0 && j < message.length - 1) return statement;
      }
      return `${statement.slice(0, i + 1)} ${message.slice(1, -1).trim()}`;
    }
  }
  return statement;
}

/** `assert (a == b)` is `assert a == b`, and so is `assert (\n a == b\n), "msg"`: formatters add and drop those brackets. */
function withoutOuterParens(statement: string): string {
  const start = /^\s*assert\s+/.exec(statement);
  if (!start) return statement;
  if (statement[start[0].length] !== "(") return withoutMessageParens(statement);
  let depth = 0, quote = "";
  for (let i = start[0].length; i < statement.length; i++) {
    const char = statement[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) {
      const rest = statement.slice(i + 1);
      return /^\s*(?:,|$)/.test(rest) ? withoutMessageParens(`${statement.slice(0, start[0].length)}${statement.slice(start[0].length + 1, i)}${rest}`) : statement;
    }
  }
  return statement;
}

/** Whitespace, quote style and trailing commas are formatter choices, not behavior. */
function normalize(statement: string): string {
  return statement.replace(/\s+/g, "").replace(/'/g, '"').replace(/,([)\]}])/g, "$1").replace(/;$/, "");
}

/** Split on `;` outside string literals, so `expect(a); expect(b);` is two statements. */
function splitStatements(text: string): string[] {
  const pieces: string[] = [];
  const scanned = maskRegexLiterals(text);
  let quote = "", start = 0;
  for (let i = 0; i < scanned.length; i++) {
    const char = scanned[i];
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
        if (assertionPattern.test(clean)) { raw.push(clean); assertions.push(normalize(language === "py" ? withoutOuterParens(clean) : clean)); }
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
// `toBeUndefined()` is not here: it pins one value, absence, and an exact check turned into it is a flipped expectation (a property that
// was removed), which public history is full of; `.not.toBeUndefined()` says "something is there" and stays.
const WEAK_JS = /\.(?:toBeDefined|toBeTruthy|toBeFalsy)\s*\(|\.not\s*\.\s*(?:toBeNull|toBeUndefined|toThrow)\s*\(\s*\)|\.toBeGreaterThanOrEqual\s*\(\s*0\s*\)|(?<!\.not)\.(?:toHaveBeenCalled|toBeCalled)\s*\(\s*\)|\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*expect\s*\.\s*(?:anything\s*\(\s*\)|any\s*\(\s*\w+\s*\))\s*\)/;
// "Not zero" in place of an exact count: weaker than `toHaveLength(3)`, but the reverse of `toHaveLength(0)`.
const BOUND_JS = /\.toBeGreaterThan\s*\(\s*(?:0|-1)\s*\)|\.toBeGreaterThanOrEqual\s*\(\s*[01]\s*\)/;
const ZERO_JS = /\.(?:toBe|toEqual|toStrictEqual|toHaveLength|toHaveBeenCalledTimes)\s*\(\s*(?:0|\[\s*\]|\{\s*\}|null|undefined|false|"")\s*\)/;
// A bare name, attribute, `is not None` or `True` only says "something exists". A call such as
// `assert caps.has_any([...])` is a real check, so it is never the weaker side.
const WEAK_PY = /^\s*assert\s+[\w.]+(?:\[[^\]]*\])*\s*(?:,.*)?$|^\s*assert\s+.+\bis\s+not\s+None\s*(?:,.*)?$|^\s*assert\s+True\b/;
// `assert len(rows) > 0` in place of `assert len(rows) == 3`; not when the old check expected nothing (`== 0`, `is None`, `not x`).
const BOUND_PY = /^\s*assert\s+.+(?:>\s*0|>=\s*[01])\s*(?:,.*)?$/;
// (`\b` cannot follow `]`, `}` or a quote at the end of the text, so each alternative ends in the way that fits it.)
const EMPTY_PY = /==\s*(?:0(?:\.0+)?(?![\w.])|\[\s*\]|\{\s*\}|""|''|\(\s*\)|(?:set|dict|list|tuple|frozenset)\(\s*\)|None\b|False\b)|\bis\s+None\b|\bnot\b|!=\s*(?:0|None)\b/;
const PY_SPECIFIC = /==|!=|<=|>=|\bin\b|\bis\b|\bisinstance\s*\(|\.startswith\s*\(|\.endswith\s*\(|\bcallable\s*\(/;

// Only an exact check can be weakened: `toBeNull()` becoming `toBeTruthy()` is a flipped expectation, not a looser one.
const JS_SPECIFIC = /\.(?:toBe|toEqual|toStrictEqual|toHaveLength|toContain|toContainEqual|toMatch|toMatchObject|toHaveProperty|toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalledWith|toHaveBeenCalledTimes|toHaveBeenCalledOnce|toHaveTextContent|toHaveAttribute|toHaveValue|toThrow\w*|toBeGreaterThan\w*|toBeLessThan\w*)\s*\(/;

// Testing Library's getBy*/findBy* queries throw when nothing matches, so `toBeTruthy()` on one is still a presence check.
const THROWING_QUERY = /\b(?:get|find)(?:All)?By\w*\s*\(/;

const PRESENCE_PREDICATE = /\.(?:exists|isVisible|isExisting|isDisplayed)\(\)$/;
/** `expect(wrapper.find(".menu").exists()).toBe(true)` and `expect(document.querySelector(".menu")).not.toBeNull()` both say the element is
 * there: a boolean that says so, and a query that finds it (or a predicate that says so again, with `toBeTruthy()`). Written in the other
 * direction, or with anything else as the new subject, it is a different check. */
function samePresence(oldAssertion: string, newAssertion: string): boolean {
  if (!/\.toBe\s*\(\s*true\s*\)\s*;?\s*$/.test(oldAssertion) || !/\.(?:not\s*\.\s*toBeNull|toBeTruthy|toBeDefined|toBeInTheDocument)\s*\(\s*\)\s*;?\s*$/.test(newAssertion)) return false;
  const was = checkedExpression(oldAssertion, "js"), now = checkedExpression(newAssertion, "js");
  return !!was && !!now && PRESENCE_PREDICATE.test(was) && (PRESENCE_PREDICATE.test(now) || /(?:querySelector|queryBy\w*|getBy\w*|findBy\w*|\.find|\.get|\$)\(/.test(now));
}

/** What an assertion checks: the argument of `expect(...)`, the left side of `assert x == 1`, the first argument of
 * `assert.equal(...)`. Whitespace and a trailing `.length` are dropped, so `items`, `items.length` and `len(items)` compare equal. */
function checkedExpression(assertion: string, language: Language): string | null {
  const squash = (text: string) => text.replace(/\s+/g, "").replace(/^len\((.*)\)$/, "$1").replace(/\.length$/, "");
  if (language === "py") {
    const operand = /^\s*assert\s+(?:not\s+)?(.+?)\s*(?:==|!=|>=|<=|>|<|\bin\b|\bis\b)/.exec(assertion)?.[1] ?? /\bself\s*\.\s*assert\w*\s*\(\s*([^,]+?)\s*,/.exec(assertion)?.[1];
    return operand ? squash(operand) : null;
  }
  const start = assertion.search(/(?<![\w$.])expect\s*\(/);
  if (start >= 0) {
    const open = assertion.indexOf("(", start);
    let depth = 0;
    for (let i = open; i < assertion.length; i++) {
      if (assertion[i] === "(") depth++;
      else if (assertion[i] === ")" && --depth === 0) return squash(assertion.slice(open + 1, i));
    }
    return null;
  }
  const node = /assert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual|ok)\s*\(\s*([^,)]+?)\s*(?:,|\)|>=|<=|>|<)/.exec(assertion)?.[1];
  return node ? squash(node) : null;
}

/** The text of the first argument of the matcher `name(...)` in `assertion`, whitespace dropped. */
function matcherArgument(assertion: string, name: string): string | null {
  const open = new RegExp(`\\.\\s*${name}\\s*\\(`).exec(assertion);
  if (!open) return null;
  let depth = 1;
  for (let i = open.index + open[0].length; i < assertion.length; i++) {
    if ("([{".includes(assertion[i])) depth++;
    else if (")]}".includes(assertion[i]) && --depth === 0) return assertion.slice(open.index + open[0].length, i).replace(/\s+/g, "");
  }
  return null;
}

/** An equality with any value: `toBe(x)`, `toEqual(x)`, `toHaveLength(x)`, `assert.equal(a, b)`, `assert a == b`, `self.assertEqual(a, b)`. */
function isExact(assertion: string, language: Language): boolean {
  if (language === "js") {
    return !/\.\s*not\s*\./.test(assertion) && (/\.(?:toBe|toEqual|toStrictEqual|toHaveLength)\s*\(/.test(assertion) || /assert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(/.test(assertion));
  }
  if (language === "py") return /^\s*assert\s+.+?\s*==\s*\S/.test(assertion) || /\bself\s*\.\s*assertEqual\s*\(/.test(assertion);
  return false;
}

/** Whether `value <operator> limit` holds: a bound admits the value the old check pinned only when this is true. */
function admits(value: number, operator: string, limit: number): boolean {
  switch (operator) {
    case ">": return value > limit;
    case ">=": return value >= limit;
    case "<": return value < limit;
    case "<=": return value <= limit;
    default: return true;
  }
}

/** The value an exact check expects, or the one a negated check rules out, as written with the spaces dropped: `expect(x).toBe(2)` → `2`,
 * `expect(x).not.toBe(0)` → `0`, `assert x == 2, "msg"` → `2`, `assert x != 0` → `0`, `self.assertEqual(x, 2)` → `2`. Null when the line has none. */
const EXACT_MATCHERS = ["toBe", "toEqual", "toStrictEqual", "toHaveLength"];
function comparedValue(assertion: string, language: Language, negated: boolean): string | null {
  if (language === "js") {
    for (const matcher of EXACT_MATCHERS) {
      const value = matcherArgument(assertion, negated ? `not\\s*\\.\\s*${matcher}` : matcher);
      if (value !== null) return value;
    }
    return null;
  }
  const call = new RegExp(`\\bself\\s*\\.\\s*assert${negated ? "NotEqual" : "Equal"}\\s*\\(([\\s\\S]*)\\)\\s*;?\\s*$`).exec(assertion);
  if (call) return splitArguments(call[1])[1]?.replace(/\s+/g, "") ?? null;
  const at = assertion.indexOf(negated ? "!=" : "==");
  return at < 0 ? null : splitArguments(assertion.slice(at + 2))[0]?.replace(/\s+/g, "") ?? null;
}

/** A value the old check could not lose by being negated: nothing (zero, empty, null) or a boolean, whose "not the other one" is the same check. */
const NOTHING_OR_BOOLEAN = /^(?:true|false|True|False|null|undefined|None|NaN|0(?:\.0+)?|""|''|``|\[\]|\{\}|\(\))$/;
/** A value written out in the test: a number, a string, null, an empty list or object. A name stands for something else that was computed
 * (`not.toBe(previous)` asks whether it changed, which is another question). */
const LITERAL_VALUE = /^(?:-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|null|undefined|None|\[\]|\{\}|\(\))$/;

/** An exact check turned into a negated one on the same expression: `expect(x).toBe(2)` → `expect(x).not.toBe(0)`, `assert x == 2` →
 * `assert x != 0`. The test pinned one value and now only rules another out, so nearly anything passes. Ruling out the old value itself
 * is a flipped expectation (`toBe(2)` → `not.toBe(2)`), and an old check that expected nothing or a boolean has no value to lose. */
function exactBecameExclusion(oldAssertion: string, newAssertion: string, language: Language): boolean {
  const pinned = comparedValue(oldAssertion, language, false), ruledOut = comparedValue(newAssertion, language, true);
  return pinned !== null && ruledOut !== null && pinned !== "" && !NOTHING_OR_BOOLEAN.test(pinned) && LITERAL_VALUE.test(ruledOut) && pinned !== ruledOut;
}

/** An exact check on an expression turned into a bound on the same expression (`toBe(2)` → `toBeGreaterThanOrEqual(2)`,
 * `assert len(x) == 3` → `assert len(x) >= 3`, `set(a) == set(b)` → `set(a) <= set(b)`), or `toEqual(X)` into `toMatchObject(X)`
 * with the same argument, which lets extra properties through, or into a negated check that rules out some other value (`toBe(2)` →
 * `not.toBe(0)`, `assert x == 2` → `assert x != 0`). An old check that expected nothing (zero, empty, None) was flipped,
 * not loosened, so it is left alone, and so is an old check whose expression is still checked exactly by another assertion that took its
 * place (`siblings`: `assert.equal(calls, 3)` became `assert.equal(calls, after)`, next to a new `assert.ok(calls > before)`): the value was
 * edited, not relaxed. */
function relaxes(oldAssertion: string, newAssertion: string, language: Language, siblings: string[] = []): boolean {
  const subject = checkedExpression(oldAssertion, language);
  if (!subject || subject !== checkedExpression(newAssertion, language)) return false;
  if (siblings.some(other => isExact(other, language) && checkedExpression(other, language) === subject)) return false;
  if (language === "js") {
    // A negated check reads the other way round: `.not.toBe(2)` turned into `.not.toBeLessThan(5)` is stricter, not looser. The one way a
    // negation loosens is an exact check that became a negated one.
    const negated = (text: string) => /\.\s*not\s*\./.test(text);
    if (negated(oldAssertion) || negated(newAssertion)) return !negated(oldAssertion) && exactBecameExclusion(oldAssertion, newAssertion, language);
    const exact = /\.(?:toBe|toEqual|toStrictEqual|toHaveLength)\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(oldAssertion)?.[1] ?? /assert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\([^,]+,\s*(-?\d+(?:\.\d+)?)\s*[,)]/.exec(oldAssertion)?.[1];
    const bound = /\.(?:toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual)\s*\(/.test(newAssertion) || /assert\s*\.\s*ok\s*\([^;]*(?:>=|<=|>|<)/.test(newAssertion);
    if (exact !== undefined && Number(exact) !== 0 && bound) {
      // `toBe(2)` turned into `toBeGreaterThan(2)` or `toBeGreaterThanOrEqual(3)` rejects the value the old check pinned: another expectation.
      const matcherLimit = /\.(toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual)\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(newAssertion);
      const okLimit = /assert\s*\.\s*ok\s*\([^;]*?(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(newAssertion);
      const operators: Record<string, string> = { toBeGreaterThan: ">", toBeGreaterThanOrEqual: ">=", toBeLessThan: "<", toBeLessThanOrEqual: "<=" };
      if (matcherLimit && !admits(Number(exact), operators[matcherLimit[1]], Number(matcherLimit[2]))) return false;
      if (okLimit && !admits(Number(exact), okLimit[1], Number(okLimit[2]))) return false;
      return true;
    }
    const same = matcherArgument(oldAssertion, "toEqual") ?? matcherArgument(oldAssertion, "toStrictEqual");
    return same !== null && same !== "" && same === matcherArgument(newAssertion, "toMatchObject");
  }
  if (language === "py") {
    if (EMPTY_PY.test(oldAssertion)) return false;
    // A compound assertion (`... and a <= b`) holds more than one check; only a plain `x == y` turned into `x >= y` is read.
    const plain = (text: string) => !/\b(?:and|or)\b/.test(text.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, ""));
    const operator = (text: string) => /^\s*assert\s+(?:not\s+)?.+?\s*(==|!=|>=|<=|>|<|\bin\b|\bis\b)/.exec(text)?.[1] ?? "";
    const exact = (operator(oldAssertion) === "==" && plain(oldAssertion)) || /\bself\s*\.\s*assertEqual\s*\(/.test(oldAssertion);
    const bound = ([">=", "<=", ">", "<"].includes(operator(newAssertion)) && plain(newAssertion)) || /\bself\s*\.\s*assert(?:Greater|Less)(?:Equal)?\s*\(/.test(newAssertion);
    const unequal = (operator(newAssertion) === "!=" && plain(newAssertion) && !/^\s*assert\s+not\b/.test(newAssertion)) || /\bself\s*\.\s*assertNotEqual\s*\(/.test(newAssertion);
    if (exact && unequal) return exactBecameExclusion(oldAssertion, newAssertion, language);
    if (!exact || !bound) return false;
    // `assert x == y` turned into `assert x > y` (or `x == 16` into `x > 16`) rejects what the old check accepted: another expectation.
    const value = (text: string) => /==\s*(-?\d+(?:\.\d+)?|[\w.]+(?:\([^)]*\))?)\s*(?:,|$)/.exec(text)?.[1] ?? /\bassertEqual\s*\([^,]+,\s*(-?\d+(?:\.\d+)?|[\w.]+)\s*[,)]/.exec(text)?.[1];
    const limit = (text: string): [string, string] | null => {
      const symbol = /^\s*assert\s+(?:not\s+)?.+?\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?|[\w.]+(?:\([^)]*\))?)\s*(?:,|$)/.exec(text);
      if (symbol) return [symbol[1], symbol[2]];
      const named = /\bassert(Greater|GreaterEqual|Less|LessEqual)\s*\([^,]+,\s*(-?\d+(?:\.\d+)?|[\w.]+)\s*[,)]/.exec(text);
      return named ? [{ Greater: ">", GreaterEqual: ">=", Less: "<", LessEqual: "<=" }[named[1]]!, named[2]] : null;
    };
    const pinned = value(oldAssertion), bounded = limit(newAssertion);
    if (pinned === undefined || !bounded) return true;
    const [operator2, edge] = bounded;
    if (/^-?\d/.test(pinned) && /^-?\d/.test(edge)) return admits(Number(pinned), operator2, Number(edge));
    return !(pinned === edge && (operator2 === ">" || operator2 === "<"));
  }
  return false;
}

/** The arguments of a call as written, split at the commas that are not inside brackets or a string. */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** The pytest form of the unittest assertions whose strength it matters to compare: `self.assertTrue(x)` is `assert x`,
 * `self.assertIsNotNone(x)` is `assert x is not None`, `self.assertGreater(x, 0)` is `assert x > 0`. Null for any other statement. */
function unittestAsAssert(statement: string): string | null {
  const call = /^\s*self\s*\.\s*assert(True|IsNotNone|GreaterEqual|Greater)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(statement);
  if (!call) return null;
  const [first, second] = splitArguments(call[2]);
  if (!first) return null;
  if (call[1] === "True") return `assert ${first}`;
  if (call[1] === "IsNotNone") return `assert ${first} is not None`;
  return second === undefined ? null : `assert ${first} ${call[1] === "Greater" ? ">" : ">="} ${second}`;
}

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
      // `... as info:` keeps the exception, so its message can be checked on the next line instead of through `match=`.
      const captured = /\)\s*as\s+\w+/.test(text);
      const marker = /\bpytest\s*\.\s*raises\s*\(\s*([\w.]+|\([^)]*\))([^)]*)\)/.exec(text);
      if (marker) return { type: marker[1], message: /\bmatch\s*=/.test(marker[2]), captured };
      const unit = /\bassertRaises(Regex)?\s*\(\s*([\w.]+|\([^)]*\))/.exec(text);
      return unit ? { type: unit[2], message: !!unit[1], captured } : null;
    };
    const was = raised(oldAssertion), now = raised(newAssertion);
    const broad = (type: string) => /^(?:builtins\.)?(?:Base)?Exception$/.test(type);
    return !!was && !!now && ((was.message && !now.message && !now.captured) || (!broad(was.type) && broad(now.type)));
  }
  return false;
}

function isWeaker(rawOld: string, rawNew: string, language: Language): boolean {
  // The matchers read the assertion without the brackets a formatter puts around its condition or its message.
  const oldAssertion = language === "py" ? withoutOuterParens(rawOld) : rawOld, newAssertion = language === "py" ? withoutOuterParens(rawNew) : rawNew;
  if (language === "js" && samePresence(oldAssertion, newAssertion)) return false;
  if (pinsLess(oldAssertion, newAssertion, language) || relaxes(oldAssertion, newAssertion, language)) return true;
  if (language === "js") {
    if (THROWING_QUERY.test(newAssertion) || !JS_SPECIFIC.test(oldAssertion) || WEAK_JS.test(oldAssertion) || BOUND_JS.test(oldAssertion)) return false;
    // `toBeGreaterThan(before)` is not an exact check, and moving from it to `toBeGreaterThan(0)` is a refactor unless the old limit was a number.
    const limit = /\.(?:toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual)\s*\(\s*([^)]*)\)/.exec(oldAssertion)?.[1];
    return WEAK_JS.test(newAssertion) || (BOUND_JS.test(newAssertion) && !ZERO_JS.test(oldAssertion) && (limit === undefined || /^-?\d+(?:\.\d+)?$/.test(limit.trim())));
  }
  if (language === "py") {
    // `self.assertTrue(x is not None)` turned into `assert x is not None` is the same check in another style, not a looser one.
    const oldBare = unittestAsAssert(oldAssertion) ?? oldAssertion;
    if (WEAK_PY.test(oldAssertion) || BOUND_PY.test(oldAssertion) || WEAK_PY.test(oldBare) || BOUND_PY.test(oldBare) || !PY_SPECIFIC.test(oldAssertion)) return false;
    // Same for Python: `assert grown > before` to `assert grown > 0`, and a membership test turned into `> 0`, are other checks.
    const limit = /(?:>=|<=|>|<)\s*([^\s,)]+)/.exec(oldAssertion)?.[1];
    // An old check that expected nothing (`is None`, `not x`, `== 0`, `== []`) turned into a weak one (`is not None`, a bare name) is a flipped expectation. A compound check that has a `not` among its clauses
    // (`assert data is not None and not data.pending` turned into `assert data is not None`) expects more than nothing: the clause that was dropped is a check that got weaker.
    // Only an `and` or `or` outside every bracket makes a check compound: `assert not (cap > 0 and used >= cap)` is the negation of one condition.
    const outsideBrackets = oldAssertion.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "").replace(/[([{][^()[\]{}]*[)\]}]/g, " ").replace(/[([{][^()[\]{}]*[)\]}]/g, " ").replace(/[([{][^()[\]{}]*[)\]}]/g, " ");
    const expectsNothing = EMPTY_PY.test(oldAssertion) && !/\b(?:and|or)\b/.test(outsideBrackets);
    return (WEAK_PY.test(newAssertion) && !expectsNothing) || (BOUND_PY.test(newAssertion) && !EMPTY_PY.test(oldAssertion) && /==|[<>]=?/.test(oldAssertion) && (limit === undefined || /^-?\d+(?:\.\d+)?$/.test(limit)));
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

/** The order-preserving pairing of two assertion lists that keeps the most assertions (old index → new index): the ones that stayed, in
 * place. What lies between two of them on one side is what the same stretch of the other side turned into. */
function alignAssertions(before: string[], after: string[]): Map<number, number> {
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const pairs = new Map<number, number>();
  for (let i = 0, j = 0; i < before.length && j < after.length;) {
    if (before[i] === after[j]) { pairs.set(i, j); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Indexes of the assertions in `from` that `against` does not have (by content, counting repeats): what is left once everything that
 * stayed, wherever it moved to, is taken out. */
function unmatchedIndexes(from: string[], against: string[]): number[] {
  const budget = new Map<string, number>();
  for (const assertion of against) budget.set(assertion, (budget.get(assertion) ?? 0) + 1);
  return from.map((assertion, i) => ({ assertion, i })).filter(({ assertion }) => {
    const available = budget.get(assertion) ?? 0;
    if (available > 0) { budget.set(assertion, available - 1); return false; }
    return true;
  }).map(({ i }) => i);
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
  // A test that checks what its own mock returns checks nothing: report each such mock that this change introduced.
  const mockedBefore = new Set((oldText === null ? [] : mockedSubjects(oldText, oldPath)).map(item => item.key));
  for (const item of newText === null ? [] : mockedSubjects(newText, newPath)) {
    if (!mockedBefore.has(item.key)) result.immediate.push(finding("trivial-assert", newPath, item.line, item.snippet, item.reason, commit));
  }
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
    // An assertion edited in place while others were added or removed cannot be paired by position; it is paired by what it checks:
    // the same expression with a looser matcher. Only the relaxations that cannot be a change of scenario are read this way, and
    // an assertion that is still somewhere in the file was moved, not loosened.
    if (old.assertions.length && current.assertions.length && current.assertions.length !== old.assertions.length
      && old.assertions.length * current.assertions.length <= 250_000) {
      const aligned = alignAssertions(old.assertions, current.assertions);
      const fresh = unmatchedIndexes(current.assertions, old.assertions);
      const gone = unmatchedIndexes(old.assertions, current.assertions)
        .filter(index => (newTotals.get(old.assertions[index]) ?? 0) < (oldTotals.get(old.assertions[index]) ?? 0));
      for (const index of gone) {
        const was = checkedExpression(old.raw[index], language);
        if (was === null) continue;
        // What it turned into, if it was edited in place: the new assertions between the ones that stayed on each side of it.
        let low = -1, high = current.assertions.length;
        for (const [from, to] of aligned) {
          if (from < index) low = Math.max(low, to);
          else if (from > index) high = Math.min(high, to);
        }
        const successors = fresh.filter(candidate => candidate > low && candidate < high);
        const siblings = successors.map(candidate => current.raw[candidate]);
        const partner = successors.find(candidate => checkedExpression(current.raw[candidate], language) === was && relaxes(old.raw[index], current.raw[candidate], language, siblings));
        if (partner !== undefined) {
          result.immediate.push(finding("assertion-weakened", newPath, current.line,
            `${old.name}: ${old.raw[index].slice(0, 80)} → ${current.raw[partner].slice(0, 80)}`, "Assertion replaced by a weaker check", commit));
          break;
        }
      }
    }
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
      // An assertion that is still there, wherever it moved to inside the test, is not part of the change: pair what is left.
      const goneIndexes = unmatchedIndexes(old.assertions, current.assertions), freshIndexes = unmatchedIndexes(current.assertions, old.assertions);
      const changed = goneIndexes.map((index, k) => ({ before: old.assertions[index], after: current.assertions[freshIndexes[k]], rawBefore: old.raw[index], rawAfter: current.raw[freshIndexes[k]] }))
        .filter(pair => pair.after !== undefined);
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

/** A marker that switches a test off or says it is expected to fail (`skip`, `xfail`, `it.fails`, `test.fixme`, `#[ignore]`, `t.Skip`), in a
 * language where the test it applies to can be found: Python, JavaScript and TypeScript, Rust and Go. */
export function isTestMarker(finding: Infraction): boolean {
  return finding.type === "test-skip" && /\.(?:py|[cm]?[jt]sx?|rs|go)$/i.test(finding.file ?? "");
}

/** The test a marker applies to: the `def` below a decorator or a `marks=` argument, the `def` around a `pytest.skip()`, the title of a
 * JavaScript registration, the `fn` below a Rust attribute, the `func Test...` around a Go `t.Skip()`. Null when it applies to more than
 * one test (`pytestmark`), to a test with no title on the line, or to a parametrized table. */
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
  if (/\.rs$/i.test(finding.file ?? "")) {
    // The attribute sits above the `fn` it applies to; other attributes and comments may come in between.
    for (let i = index; i < lines.length && i < index + 12; i++) {
      const fn = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*[<(]/.exec(lines[i]);
      if (fn) return { key: `rs:${fn[1]}`, title: fn[1] };
    }
    return null;
  }
  if (/\.go$/i.test(finding.file ?? "")) {
    // `t.Skip()` sits inside the test: the nearest `func TestX` above it.
    for (let i = index; i >= 0 && i > index - 400; i--) {
      const fn = /^func\s+(?:\([^)]*\)\s*)?((?:Test|Benchmark|Fuzz|Example)\w*)\s*\(/.exec(lines[i]);
      if (fn) return { key: `go:${fn[1]}`, title: fn[1] };
    }
    return null;
  }
  if (/\.each\b/.test(snippet)) return null;
  // A registration (`it.skip('title', () => ...)`, `test.fixme('title', { annotation }, async () => ...)`) starts with its title; the string of
  // `test.skip(cond, 'reason')` inside a test is a reason, and the call does not start with one. A formatter wraps a long registration after
  // its opening bracket, so the title may be the first thing on the next line.
  // `it.todo(` has no callback, so its title on the next line is the last thing in the joined text: nothing follows it before the line ends.
  const title = /\b(?:it|test|describe|suite|xit|xtest|xdescribe|fit|fdescribe)\b[\w$.\s]*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])+)\1\s*(?:[,)]|$)/.exec(titleOnNextLine(snippet, lines, index));
  if (title) return { key: `js:${title[1]}${title[2]}${title[1]}`, title: `${title[1]}${title[2]}${title[1]}` };
  // `test.skip(true, "reason")`, `test.fail(cond, ...)` and `test.fixme()` inside a test body belong to the test around them: the nearest line above
  // with a smaller indent that is a registration with a title (a wrapped registration puts its callback on a line of its own, one level in).
  // A `describe` or a `step` around the call is not the test.
  let limit = (lines[index] ?? "").search(/\S/);
  if (limit > 0 && /\b(?:test|it)\s*\.\s*(?:skip|fixme|fail)\s*\(/.test(snippet)) {
    for (let i = index - 1; i >= 0 && i > index - 200 && limit > 0; i--) {
      if (!lines[i].trim() || lines[i].search(/\S/) >= limit) continue;
      limit = lines[i].search(/\S/);
      const owner = /^\s*(?:test|it)(?:\s*\.\s*(?!describe\b|step\b)\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])+)\1/.exec(titleOnNextLine(lines[i], lines, i));
      if (owner) return { key: `js:${owner[1]}${owner[2]}${owner[1]}`, title: `${owner[1]}${owner[2]}${owner[1]}` };
      if (/^\s*(?:await\s+)?(?:test|it)\s*\.\s*describe\b|^\s*(?:describe|suite)\b/.test(lines[i])) return null;
    }
  }
  return null;
}

/** `text` (the line `lines[index]`, or the evidence of a finding that starts on it), with the line after it appended when `text` ends at an
 * opening bracket and that line starts with a string: `test.fixme(` / `'title',` is the registration of the test called "title". */
function titleOnNextLine(text: string, lines: string[], index: number): string {
  if (!/\(\s*$/.test(text)) return text;
  const next = (lines[index + 1] ?? "").trim();
  return /^(['"`])/.test(next) ? `${text} ${next}` : text;
}

/** Skip, ignore and expected-failure markers a change put on tests that were already there. A marker on a test the change added is not a
 * check that got weaker: it is a bug its author knows about (a new test for a reported issue, marked xfail), a test that needs a
 * server, a device or a database and is run on purpose (Rust's `#[ignore = "requires KVM"]`, a `skip(reason="needs a model on
 * localhost")`), or a case deferred to a later change. The same marker on a test that was running is how a failure gets hidden.
 * Markers are compared per test rather than per line of text, because the lines of one file's markers are often identical and
 * the review cannot tell which of them is the new one. A marker that names no single test (`pytestmark = ...`) counts when the
 * file has more of them than before. `before` and `after` are the findings of the two versions of the file; `oldText` is null
 * for a new file, whose tests are all new. */
export function newTestMarkers(before: Infraction[], after: Infraction[], oldText: string | null, newText: string | null): Infraction[] {
  const markers = after.filter(isTestMarker);
  if (!markers.length || oldText === null) return [];
  const oldLines = oldText.split(/\r?\n/), newLines = (newText ?? "").split(/\r?\n/);
  const existed = (test: { key: string; title: string }) => test.key.startsWith("py:")
    ? new RegExp(`^\\s*(?:async\\s+)?def\\s+${test.title}\\s*\\(`, "m").test(oldText)
    : test.key.startsWith("rs:") ? new RegExp(`\\bfn\\s+${test.title}\\s*[<(]`).test(oldText)
    : test.key.startsWith("go:") ? new RegExp(`^func\\s+(?:\\([^)]*\\)\\s*)?${test.title}\\s*\\(`, "m").test(oldText)
    : oldText.includes(test.title);
  const markedBefore = new Map<string, number>();
  let unnamedBefore = 0;
  for (const finding of before.filter(isTestMarker)) {
    const test = markedTest(finding, oldLines);
    if (test) markedBefore.set(test.key, (markedBefore.get(test.key) ?? 0) + 1); else unnamedBefore++;
  }
  const found: Infraction[] = [], unnamed: Infraction[] = [], seen = new Map<string, number>();
  for (const finding of markers) {
    const test = markedTest(finding, newLines);
    if (!test) { unnamed.push(finding); continue; }
    const nth = (seen.get(test.key) ?? 0) + 1, had = markedBefore.get(test.key) ?? 0;
    seen.set(test.key, nth);
    // As many markers on a test as it had before are not new; one more of the same is. A test that has none yet gets one report, except that
    // two registrations with one title are two tests (stacked decorators on one `def` are one).
    if (nth <= had || (had === 0 && ((nth > 1 && !test.key.startsWith("js:")) || !existed(test)))) continue;
    found.push(finding);
  }
  // A registration with a table (`it.skip.each([`) has no title to look up. Its first lines, without the word of the marker, say whether the table was already there:
  // `it.each([` that became `it.skip.each([` is a test that was running; a table that is not in the old file is new (a reproduction written as `it.fails.each`, tests regrouped from single skips).
  const plain = (lines: string[]) => lines.map(line => line.trim().replace(/\.(?:skip|fails|failing|todo|fixme|only)\b/g, ""));
  const oldPlain = plain(oldLines).join("\n"), newPlain = plain(newLines);
  const newTable = (finding: Infraction) => /\.each\b/.test(finding.lineSnippet ?? "") && !oldPlain.includes(newPlain.slice((finding.lineNumber ?? 1) - 1, (finding.lineNumber ?? 1) + 3).join("\n"));
  return [...found, ...unnamed.slice(unnamedBefore).filter(finding => !newTable(finding))];
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
  // A package script that runs the tests with coverage: `yarn coverage`, `npm run coverage`, `npm run cover`.
  String.raw`|(?<![\w./-])(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?cover(?:age)?(?![\w/-])` +
  // Monorepo runners: `nx affected --target=test`, `turbo run test`, `lerna run test`, `bazel test //...`.
  String.raw`|(?<![\w./-])(?:nx|turbo|lerna|rush)\s+(?:run-many|affected|run|test)\b[^\n]*(?<![\w-])(?:test|tests)(?![\w-])` +
  String.raw`|(?<![\w./-])(?:bazel\s+test|ctest|phpunit|rspec|deno\s+test)(?![\w/-])` +
  // Python's own runners and the browser runners: `python3 -m unittest`, `nosetests`, `playwright test`, `cypress run`, `karma start`.
  String.raw`|(?<![\w./-])python[\d.]*\s+-m\s+(?:unittest|pytest|nose2?)(?![\w/-])` +
  String.raw`|(?<![\w./-])(?:nosetests|nose2|py\.test|stestr|behave|jasmine|playwright\s+test|cypress\s+run|karma\s+start|hatch\s+(?:run\s+)?test|swift\s+test)(?![\w/-])` +
  // Task runners: `deno task test`, `just test`, `rake test`, `composer test`, `mix test`, `sbt test`, `./gradlew test`, and Node's own `node --test`.
  String.raw`|(?<![\w./-])(?:deno\s+(?:task|run)|just|task|poe|rake|composer(?:\s+run)?|mix|sbt|lein|stack|cabal|(?:\./)?(?:gradlew|mvnw)(?:\.bat|\.cmd)?)\s+(?:-\S+\s+)*test(?![\w/-])` +
  String.raw`|(?<![\w./-])(?:node|tsx)(?:\s+-\S+)*\s+--test(?![\w-])` +
  // A target of a task runner that has the word as one of its own words and not as the first: `make unit-test`, `just test-asyncio py314`, `pnpm run docs:test`. A target that sets up, installs, builds or type-checks
  // (`make setup-tests`, `pnpm run typecheck:tests`, `pnpm run build:native:test`) runs no tests.
  String.raw`|(?<![\w./-])(?:make|just|task|(?:npm|pnpm|bun)\s+run|yarn(?:\s+run)?|pnpm)\s+(?:-\S+\s+)*(?![\w.:-]*(?:setup|teardown|install|deps|typecheck|lint|build|docker|clean|prepare|publish|deploy|release|format|image|download|data))[\w.:-]*(?<![A-Za-z0-9])tests?(?![A-Za-z0-9])` +
  // A project's own test script, run through its interpreter or by path: `python scripts/run_tests.py`, `./scripts/test.sh`, `python tests/test_cli.py`.
  String.raw`|(?<![\w./-])(?:(?:python[\d.]*|node|bash|sh|zsh|ruby|pwsh|tsx|ts-node)(?:\s+-\S+)*\s+|\./)(?:[\w.-]+/)*(?:(?:run[_-]?)?tests?(?:[_-](?:all|suite|runner|unit|ci))?|test_[\w-]+|[\w-]+_test)\.(?:py|sh|bash|js|mjs|cjs|ts|rb|ps1)(?![\w-])` +
  String.raw`|\brun:.*(?<=\s)(?:tests?|unit|e2e)(?![\w/.-])`);
// The shell builtin `test -f summary.md && cat summary.md` checks a file: it has the word on the line and runs no tests.
const SHELL_TEST = /(?:^|run:\s*|[;&|({]\s*|\b(?:if|then|do|else|elif|while|until)\s+|!\s+)test\s+!?\s*(?:-[bcdefghkLnOGprsStuwxzN](?=\s)|["$'])/g;
// A command that installs or syncs dependencies may name a group or an extra called `test` (`uv sync --group test`, `pip install .[test]`) and runs no tests, and `tox -e lint` or `nox -s docs` runs a tool that is
// not the tests. Only the command itself is taken out, up to the next `&&`, `;` or `|`: what follows it (`pip install -e . && pytest`) is still read.
const NOT_TESTS = new RegExp(
  String.raw`(?<![\w./-])(?:uv\s+(?:sync|add|tool\s+install|pip\s+install)|(?:python[\d.]*\s+-m\s+)?pip[\d.]*\s+install|pipx\s+install|poetry\s+(?:install|add)|pdm\s+(?:install|sync|add)|npm\s+(?:ci|i|install|add)|pnpm\s+(?:i|install|add)|bun\s+(?:i|install|add)|yarn\s+(?:install|add)|bundle\s+install|gem\s+install|cargo\s+install|go\s+(?:install|get)|brew\s+install|apt(?:-get)?\s+install|conda\s+(?:install|create))\b[^&;|\n]*` +
  // The gap before the environment is bounded, so that a line of a hundred thousand characters with `tox` in it again and again is read in linear time.
  String.raw`|(?<![\w./-])(?:tox|nox)\b[^&;|\n]{0,300}?\s(?:-e|-s|--env|--session)[= ]\s*(?:lint|linting|format|fmt|docs?|types?|typing|mypy|pyright|ruff|black|flake8|pylint|style|isort|bandit|build|package|clean)(?![,\w-])[^&;|\n]*`, "g");
/** Whether a line of a CI file runs a test command. A trailing comment is not part of the command: `run: exit 0 # Skip unnecessary test runs for bots`. The name of a step or of an artifact
 * (`- name: Test with tox`, `name: pytest-results`) is not a command either. */
const ciRuns =(line: string): boolean => !/^\s*(?:-\s+)?name\s*:/.test(line) && CI_RUNNER.test(line.replace(SHELL_TEST, " ").replace(NOT_TESTS, " ").replace(/\s#.*$/, ""));
// A key whose value is a block of commands: `run: |`, a folded `run: >-`, or a GitLab `script:` list. Groups: the indent (and `- `) before the key, its name, its block indicator.
const COMMAND_BLOCK = /^(\s*(?:-\s+)?)(run|script|before_script|after_script)\s*:\s*([|>])?[+-]?\d*\s*(?:#.*)?$/;
const indentOf = (line: string): number => line.length - line.trimStart().length;
// A command of a block that only prints (`echo "Running tests"`) runs none, whatever the word after it is.
const PRINTS = /^(?:echo|printf)\b/;
// In a literal block (`run: |`) a line is shell, where the word `test` is as often a directory or a message (`mkdir test`, `echo "ZIP test PASS"`) as a command: only a line that
// runs a tool with `test` as its first argument counts (`hvigorw test`, `terraform test`), after the words that wrap a command, unless the tool only handles files or is a keyword of the
// shell or of a script that sits in the block (`for test in tests:`, `assert test[...]`), and not an argument (`-expect test=1`).
const NOT_A_TOOL = "mkdir|rmdir|cd|rm|ls|cat|cp|mv|touch|chmod|chown|echo|printf|export|source|git|docker|find|tar|zip|unzip|grep|sed|awk|diff|head|tail|wc|stat|du|tree|set|test|curl|wget|ssh|scp|rsync|ping|open|sleep|kill"
  + "|for|while|until|if|elif|else|then|do|done|case|in|assert|return|import|from|def|class|print|raise|yield|with|local|declare|readonly|unset|eval|await|let|const|var|function|new|delete|throw|and|or|not|is|lambda|try|except|finally|pass|del";
const TOOL_TEST = new RegExp(
  String.raw`^(?:(?:sudo|time|exec|command|env)(?:\s+-\S+)*\s+|\w+=(?:"[^"]*"|'[^']*'|[^\s"']*)\s+)*(?!(?:${NOT_A_TOOL})\b)(?!-)[\w./-]+\s+test(?![\w/.=\[(-])`);
/** The commands that a key of COMMAND_BLOCK opens: a folded block is one command, the items of a GitLab `script:` list are one each (a list may stand at the indent of its key), and the lines
 * of a literal block are the ones that run a tool with `test` as its first argument (TOOL_TEST). A `run:` with nothing after it is not a block of commands: it is a job that is called `run`. */
function blockCommands(lines: string[], at: number, key: RegExpExecArray): string[] {
  const keyIndent = key[1].length, found: string[] = [];
  if (key[3] === ">") {
    for (let next = at + 1; next < lines.length; next++) {
      const text = lines[next].trim();
      if (!text) continue;
      if (indentOf(lines[next]) <= keyIndent) break;
      if (!text.startsWith("#")) found.push(text);
    }
    return [found.join(" ")];
  }
  if (key[3] === "|") {
    for (let next = at + 1; next < lines.length; next++) {
      const text = lines[next].trim().replace(/\s*\\$/, "");
      if (!text) continue;
      if (indentOf(lines[next]) <= keyIndent) break;
      if (TOOL_TEST.test(text)) found.push(text);
    }
    return found;
  }
  if (key[3] || key[2] === "run") return [];
  let itemIndent = -1;
  for (let next = at + 1; next < lines.length; next++) {
    const text = lines[next].trim();
    if (!text || text.startsWith("#")) continue;
    const indent = indentOf(lines[next]);
    if (itemIndent < 0) {
      if (!text.startsWith("- ") || indent < keyIndent) break;
      itemIndent = indent;
    }
    if (indent < itemIndent || (indent === itemIndent && !text.startsWith("- "))) break;
    if (indent === itemIndent) found.push(text.slice(2).trim());
  }
  return found;
}
/** The lines of a CI file that run a test command, comments left out. The lines of a folded block (`run: >-`) are one command, and an item of a GitLab `script:` list is one: both are read
 * as if they stood after `run:` (`xvfb-run ... hvigorw test -p module=dimina` is a test run, as it is on one line). The lines of a literal block (`run: |`) are shell, where a word
 * `test` is as often a directory or a message (`mkdir test`, `echo "ZIP test PASS"`), so only a runner that is known by name, or a tool with `test` as its first argument, counts there:
 * the same step is then one test step whether it is written in a folded block or a literal one. Each command comes with the index of the line it stands on (the line of the key, for a command of a block). */
function ciTestEntries(text: string): Array<{ index: number; command: string }> {
  const lines = text.split(/\r?\n/), found: Array<{ index: number; command: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (ciRuns(line)) found.push({ index: i, command: line });
    const key = COMMAND_BLOCK.exec(line);
    if (!key) continue;
    for (const command of blockCommands(lines, i, key)) if (command && !PRINTS.test(command) && !ciRuns(command) && ciRuns(`run: ${command}`)) found.push({ index: i, command });
  }
  return found;
}
const ciTestLines = (text: string): string[] => ciTestEntries(text).map(entry => entry.command);
const CI_FILE = /(?:\.github\/workflows\/|\.gitlab-ci)/;
// A call to a shared workflow may run the tests there. It offsets a removed step but is never itself "a test step".
const CI_REUSABLE = /^\s*-?\s*uses:\s*\S*\.github\/workflows\/\S+/;

export interface CiTestCount { file: string; before: number; after: number; reusableAfter: number; ungatedAfter: number; commandsBefore?: string[]; commandsAfter?: string[] }

// A workflow only gates a change when it runs on push or pull requests; a scheduled or manually dispatched one does not.
const CI_GATE = /^\s*(?:pull_request|pull_request_target|push|merge_group)\s*:|^\s*on\s*:\s*(?:\[[^\]]*\b(?:push|pull_request|pull_request_target|merge_group)\b[^\]]*\]|(?:push|pull_request|pull_request_target|merge_group)\s*$)|^\s*-\s*(?:push|pull_request|pull_request_target|merge_group)\s*$/m;

// A workflow whose triggers are all of the kinds that run without a change to judge: a schedule, a release, a manual or API dispatch, or the
// completion of another workflow (a job that posts a comment or a discussion after a release, a nightly run).
const CI_NON_GATE = /^\s*(?:schedule|release|workflow_dispatch|workflow_run|repository_dispatch)\s*:/m;

/** Whether a workflow gates changes: it runs on pushes or pull requests, or is a reusable workflow (`workflow_call`) that one of those may call.
 * One whose triggers are all of the kinds in CI_NON_GATE gates nothing, so a step there that is switched off or allowed to fail loosens no gate.
 * A trigger section that cannot be read, and every GitLab CI file, count as gating. */
function gatesChanges(file: string, text: string): boolean {
  const section = triggerSection(text), triggers = gatingTriggers(text) ?? text;
  if (/\.gitlab-ci/.test(file) || CI_GATE.test(triggers) || /\bworkflow_call\b/.test(triggers)) return true;
  // A workflow whose only push trigger is a version tag (`push: tags: ['v*']`) is a release pipeline: it judges no change.
  return section !== null && triggers !== section ? false : !CI_NON_GATE.test(triggers);
}

/** The trigger section of a workflow without its `push:` blocks that fire on tags alone: `push: tags: ['v*']` runs when a version is released,
 * not when a change is pushed or reviewed. A `push:` with `branches` (or `branches-ignore`) stays, and so does one with no filter at all. */
function gatingTriggers(text: string): string | null {
  const section = triggerSection(text);
  if (section === null) return null;
  const lines = section.split(/\r?\n/), kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)push\s*:\s*(?:#.*)?$/.exec(lines[i]);
    if (!head) { kept.push(lines[i]); continue; }
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > head[1].length)) end++;
    const block = lines.slice(i + 1, end).join("\n");
    if (!(/^\s*tags\s*:/m.test(block) && !/^\s*branches(?:-ignore)?\s*:/m.test(block))) kept.push(...lines.slice(i, end));
    i = end - 1;
  }
  return kept.join("\n");
}

/** The trigger section of a workflow: the lines under a top-level `on:` up to the next top-level key, so that `push: true` in the `with:` of a
 * Docker build step is not read as a trigger. Null when the file has no such section (a GitLab pipeline, an unreadable file). */
function triggerSection(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^["']?on["']?\s*:/.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^[\s#-]/.test(lines[end]))) end++;
  return lines.slice(start, end).join("\n");
}

/** The test commands a workflow runs when changes are pushed or reviewed, one per line that runs one, as `npm test` rather than `- run: npm  test # x`,
 * each followed by the directories the workflow says it works in (`working-directory: web`): the same command in two services of a monorepo is
 * two checks. Empty for a workflow that gates nothing. `skip` leaves out the commands that stand on the lines (counted from 0) it says yes to. */
export function gatingTestCommands(file: string, text: string, skip?: (line: number) => boolean): string[] {
  if (!(/\.gitlab-ci/.test(file) || CI_GATE.test(gatingTriggers(text) ?? text))) return [];
  const directories = [...new Set([...text.matchAll(/^\s*(?:-\s+)?working-directory\s*:\s*["']?([^\s"'#]+)/gm)].map(match => match[1]))].sort().join(",");
  return ciTestEntries(text).filter(entry => !skip?.(entry.index))
    .map(entry => `${entry.command.replace(/\s#.*$/, "").replace(/^\s*-?\s*(?:run\s*:\s*)?/, "").replace(/\s+/g, " ").trim()} @${directories}`);
}

/** The test commands of a workflow that check something: the ones that stand in a step or a job that is allowed to fail (`continue-on-error`, `allow_failure`) or switched off (`if: false`) checked nothing,
 * so they are no check that is lost when they go, and no check that is still run when another workflow loses its tests. They are left out by the line they stand on, not by their text: the same command in
 * a step that gates (a stable job next to a nightly one that may fail) is still counted. */
export function enforcedTestCommands(file: string, text: string): string[] {
  const tolerated = [...lenientSteps(text).values()].filter(step => step.runsChecks).flatMap(step => step.ranges);
  return gatingTestCommands(file, text, line => tolerated.some(([from, to]) => line >= from && line < to));
}

function matchingLines(text: string, pattern: RegExp | ((line: string) => boolean)): number {
  const matches = typeof pattern === "function" ? pattern : (line: string) => pattern.test(line);
  return text.split(/\r?\n/).filter(line => !line.trim().startsWith("#") && matches(line)).length;
}

/** Test-step counts for one changed CI file; null when it is not a CI file. */
export function ciTestSteps(file: string, oldText: string | null, newText: string | null): CiTestCount | null {
  if (!CI_FILE.test(file) || (oldText === null && newText === null)) return null;
  const was = oldText ?? "", now = newText ?? ""; // a deleted workflow runs no tests; a new one may take over another's
  // A test step that was already allowed to fail or switched off checked nothing, so it is no check that is lost when it goes. One that is made so by this change is the other rule's finding, not this one's.
  const commandsBefore = enforcedTestCommands(file, was), commandsAfter = gatingTestCommands(file, now);
  const after = commandsAfter.length;
  return { file, before: commandsBefore.length, after, reusableAfter: matchingLines(now, CI_REUSABLE), ungatedAfter: after === 0 ? ciTestLines(now).length : 0, commandsBefore, commandsAfter };
}

/** The workflows that a workflow which gates calls (`uses: ./.github/workflows/sdk.yml`), as repository paths: their jobs run on every change that the caller runs on, whatever their own triggers are. */
export function gatingCalls(file: string, text: string): string[] {
  if (!(/\.gitlab-ci/.test(file) || CI_GATE.test(gatingTriggers(text) ?? text))) return [];
  return [...text.matchAll(/^\s*-?\s*uses:\s*["']?\.\/(\.github\/workflows\/[^\s"'#@]+\.ya?ml)/gm)].map(match => match[1]);
}

/** The reusable workflows (local paths) that this one change stops calling: present in `gatingCalls` of the old text and not of the new (empty when the file
 * is deleted). A caller that was never gating lost nothing that mattered: `gatingCalls` is already empty for it on both sides. */
export function lostCalls(file: string, oldText: string | null, newText: string | null): string[] {
  if (!CI_FILE.test(file)) return [];
  const before = gatingCalls(file, oldText ?? "");
  if (!before.length) return [];
  const after = new Set(gatingCalls(file, newText ?? ""));
  return before.filter(workflow => !after.has(workflow));
}

/** The test commands a workflow runs, read without regard to its own trigger: a workflow called only by `uses:` from one that gates (`workflow_call`,
 * or one with no trigger section of its own) gates through its caller, not through an `on:` section of CI_GATE's own kinds. */
export function calledTestCommands(text: string): string[] {
  const directories = [...new Set([...text.matchAll(/^\s*(?:-\s+)?working-directory\s*:\s*["']?([^\s"'#]+)/gm)].map(match => match[1]))].sort().join(",");
  return ciTestEntries(text).map(entry => `${entry.command.replace(/\s#.*$/, "").replace(/^\s*-?\s*(?:run\s*:\s*)?/, "").replace(/\s+/g, " ").trim()} @${directories}`);
}

/** A reusable workflow whose only caller disappeared: `content` is its text (from the diff if the workflow itself was touched, or read from the tree
 * otherwise) and `stillCalled` says whether some workflow that gates still calls it, in this diff or not. Skipped when the workflow already gates on its
 * own trigger (`gatingTestCommands` is then non-empty on its own, callers aside) or has no test command to lose. */
export function resolveLostCallers(lost: ReadonlyMap<string, { content: string; stillCalled: boolean }>, commit: string): Infraction[] {
  const out: Infraction[] = [];
  for (const [file, { content, stillCalled }] of lost) {
    if (stillCalled || gatingTestCommands(file, content).length > 0 || calledTestCommands(content).length === 0) continue;
    out.push(finding("guard-weakened", file, 1, "nothing calls this workflow on a push or pull request any more",
      "Workflow keeps its tests, but the workflow that called it is gone", commit));
  }
  return out;
}

/** A workflow that stopped running any tests is reported only when the review as a whole lost test steps:
 * moving them to another workflow, or to a shared one, is not removal, and neither is dropping a duplicate: every test command it ran is still run
 * by a workflow that gates changes, one of the others in this review or (`elsewhere`) one this change did not touch. A workflow that lost its own triggers
 * because another workflow that this change did not touch calls it (`called`) still runs on every change. */
export function resolveCiTestSteps(counts: CiTestCount[], commit: string, elsewhere: ReadonlySet<string> = new Set(), called: ReadonlySet<string> = new Set()): Infraction[] {
  const before = counts.reduce((sum, item) => sum + item.before, 0);
  const after = counts.reduce((sum, item) => sum + item.after + item.reusableAfter, 0);
  if (after >= before) return [];
  const running = new Set([...counts.flatMap(item => item.commandsAfter ?? []), ...elsewhere]);
  return counts.filter(item => item.before > 0 && item.after === 0 && item.reusableAfter === 0)
    .filter(item => !(item.ungatedAfter > 0 && called.has(item.file)))
    .filter(item => item.commandsBefore === undefined || item.commandsBefore.some(command => !running.has(command)))
    .map(item => item.ungatedAfter > 0
      ? finding("guard-weakened", item.file, 1, "tests no longer run on push or pull_request", "Workflow keeps its tests but no longer runs on pushes or pull requests", commit)
      : finding("guard-weakened", item.file, 1, "test command no longer runs in CI", "Test step removed from CI", commit));
}

// A step that tolerates failure, or that `if: false` switches off: either way the gate stops gating.
const LENIENT = /continue-on-error:\s*true|allow_failure:\s*true|^\s*(?:-\s+)?if:\s*(?:\$\{\{\s*)?false\s*(?:\}\})?\s*(?:#.*)?$/;
// `npm test || true` ends the step with success whatever the tests did: `continue-on-error` written in shell.
const SHELL_SWALLOW = /\|\|\s*(?:true|exit\s+0|:|echo\b)|;\s*(?:true|exit\s+0)\b/;

// A step that only moves files, signs in, publishes, comments or reports coverage checks nothing: letting it fail (a flaky upload, a login that
// is not configured on a fork, a release attachment that GitHub refuses) loosens no gate. Anything not listed here may be a check.
const NON_CHECK_ACTION = new RegExp(String.raw`^\s*(?:-\s+)?uses:\s*["']?(?:` + [
  String.raw`actions/(?:upload-artifact|download-artifact|upload-pages-artifact|deploy-pages|cache|attest[\w-]*|checkout|setup-[\w-]+)`,
  String.raw`docker/(?:login-action|metadata-action|build-push-action|setup-[\w-]+)`,
  String.raw`azure/login`, String.raw`aws-actions/(?:configure-aws-credentials|amazon-ecr-login)`, String.raw`google-github-actions/(?:auth|setup-gcloud)`,
  String.raw`softprops/action-gh-release`, String.raw`ncipollo/release-action`, String.raw`pypa/gh-action-pypi-publish`, String.raw`JS-DevTools/npm-publish`, String.raw`peaceiris/actions-gh-pages`,
  String.raw`peter-evans/[\w-]+`, String.raw`marocchino/sticky-pull-request-comment`, String.raw`slackapi/slack-github-action`,
  String.raw`codecov/codecov-action`, String.raw`coverallsapp/github-action`,
].join("|") + String.raw`)(?:/[\w./-]+)?@`, "i");

/** `ranges` are the lines (from 0, the end not included) of each step or job that carries the marker. */
interface LenientStep { count: number; line: number; runsChecks: boolean; nonCheck: boolean; commands: string[]; ranges: Array<[number, number]> }

/** The commands of a step or job as written, one per `run:` or `uses:` and one per line of a `run: |` block, with the spaces collapsed. */
function scopeCommands(scope: string[]): string[] {
  const found: string[] = [];
  scope.forEach((line, index) => {
    const head = /^(\s*(?:-\s+)?)(?:run|uses)\s*:\s*(.*)$/.exec(line);
    if (!head || line.trim().startsWith("#")) return;
    const text = head[2].replace(/\s#.*$/, "").trim();
    if (text && !/^[|>][+-]?$/.test(text)) { found.push(text.replace(/\s+/g, " ")); return; }
    const keyAt = head[1].length;
    for (let next = index + 1; next < scope.length; next++) {
      if (!scope[next].trim()) continue;
      if (scope[next].length - scope[next].trimStart().length <= keyAt) break;
      if (!scope[next].trim().startsWith("#")) found.push(scope[next].trim().replace(/\s+/g, " "));
    }
  });
  return found;
}

/** Tolerated-failure markers per enclosing step or job, keyed by that step's own line; `runsChecks` says whether that step or job runs a
 * test command anywhere in it, and `nonCheck` that it is one step that uses an action from NON_CHECK_ACTION and runs nothing. */
function lenientSteps(text: string): Map<string, LenientStep> {
  const lines = text.split(/\r?\n/);
  const found = new Map<string, LenientStep>();
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
    // The step or job it belongs to: its own first line down to the line before the next one at the same level or above.
    const start = /^\s*-\s+if:/.test(line) ? i : Math.max(j, 0), level = indentOf(lines[start]);
    let end = start + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].trim().startsWith("#") || indentOf(lines[end]) > level)) end++;
    const scope = lines.slice(start, end), runsChecks = ciTestLines(scope.join("\n")).length > 0;
    const uses = scope.filter(item => /^\s*(?:-\s+)?uses:/.test(item));
    const nonCheck = !runsChecks && uses.length === 1 && NON_CHECK_ACTION.test(uses[0]) && !scope.some(item => /^\s*(?:-\s+)?run:/.test(item));
    const commands = scopeCommands(scope);
    const entry = found.get(identity);
    if (entry) { entry.count++; entry.runsChecks ||= runsChecks; entry.nonCheck &&= nonCheck; entry.commands.push(...commands); entry.ranges.push([start, end]); } else found.set(identity, { count: 1, line: i + 1, runsChecks, nonCheck, commands, ranges: [[start, end]] });
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
    // same change is a new best-effort check, not a weakened one. In a workflow that gates nothing (see gatesChanges) only a step or job
    // that runs tests counts: a job that posts a comment after a release is not a check, a nightly test run is.
    const gating = gatesChanges(file, oldText) || gatesChanges(file, newText);
    // A step written as `- run: npm test` is the same step as `run: npm test` under a new `- if: false` item.
    const before = lenientSteps(oldText), existing = new Set(oldText.split(/\r?\n/).flatMap(line => [line.trim(), line.trim().replace(/^-\s+/, "")]));
    const newLines = newText.split(/\r?\n/);
    // A tolerance that was already there for the same commands and only moved is not new: a report job that was allowed to fail, merged into a job whose
    // step is allowed to fail. It counts as moved while the number of tolerated places did not grow.
    const toleratedPlaces = (text: string) => text.split(/\r?\n/).filter(line => !line.trim().startsWith("#") && /continue-on-error:\s*true|allow_failure:\s*true/.test(line)).length;
    const toleratedBefore = new Set([...before.values()].flatMap(step => step.commands));
    const moved = toleratedPlaces(newText) <= toleratedPlaces(oldText);
    for (const [identity, now] of lenientSteps(newText)) {
      if (now.nonCheck || (!gating && !now.runsChecks)) continue;
      if (moved && now.commands.length > 0 && now.commands.every(command => toleratedBefore.has(command))) continue;
      if (identity && existing.has(identity) && now.count > (before.get(identity)?.count ?? 0)) {
        const marker = (newLines[now.line - 1] ?? "").trim();
        out.push(finding("guard-weakened", file, now.line, marker, /^(?:-\s+)?if:/.test(marker) ? "CI step is now switched off" : "CI step is now allowed to fail", commit));
        break;
      }
    }
    const swallowing = (text: string) => text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index }))
      .filter(item => !item.line.startsWith("#") && ciRuns(item.line) && SHELL_SWALLOW.test(item.line));
    const was = swallowing(oldText), now = swallowing(newText);
    // A `continue-on-error: true` that went away in the same change was the same tolerance written another way.
    const tolerance = (text: string) => text.split(/\r?\n/).filter(line => !line.trim().startsWith("#") && /continue-on-error:\s*true|allow_failure:\s*true/.test(line)).length;
    const traded = Math.max(0, tolerance(oldText) - tolerance(newText));
    if (now.length > was.length + traded) {
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
