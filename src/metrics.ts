import { ParsedCommit, ParsedFileDiff } from "./git.js";
import { Infraction, MetricSummary } from "./types.js";
import { SourceMasker } from "./source.js";
import { RULE_GUIDES } from "./rules.js";

const PYTHON_TEST_SKIP_PATTERNS = [
  { regex: /@pytest\s*\.\s*mark\s*\.\s*skip\b/, name: "skipped pytest (@pytest.mark.skip)" },
  { regex: /(?<![\w.])pytest\s*\.\s*skip\s*\(/, name: "imperative pytest skip (pytest.skip)", imperative: true },
  { regex: /@unittest\s*\.\s*skip\s*\(/, name: "skipped unittest (@unittest.skip)", imperative: false },
  { regex: /\bself\s*\.\s*skipTest\s*\(/, name: "imperative unittest skip (self.skipTest)", imperative: true },
  // A test that is expected to fail cannot fail the run, which is what a skip does too.
  { regex: /(?<![\w.])pytest\s*\.\s*xfail\s*\(/, name: "imperative pytest xfail (pytest.xfail)", imperative: true },
  { regex: /@(?:unittest\s*\.\s*)?expectedFailure\b/, name: "test expected to fail (@unittest.expectedFailure)", imperative: false },
];

/** `pytest.mark.skip` or `.xfail` as a decorator, as `pytestmark = ...` for a whole module, or as `marks=` of one parametrized
 * case. `skipif` ends in a word character after `skip`, so `\b` leaves it alone. */
const PYTHON_MARKER = /(@\s*|(?<![\w.])marks\s*=\s*\[?\s*|^[ \t]*pytestmark\s*=\s*\[?\s*)pytest\s*\.\s*mark\s*\.\s*(skip|xfail)\b/gm;

/** `@pytest.mark.xfail(sys.platform == "win32", reason="paths")` expects the failure only where its condition holds, like
 * `skipif`. A bare marker, one with only `reason=`, `strict=`, `raises=` or `run=`, a literal `True`, or a condition that mentions
 * CI expects it everywhere and hides the failure from the pipeline. `args` are the call's arguments as written; none are
 * known (an unclosed call, a hunk gap) means the marker is reported. */
function isConditionalXfail(args: string[] | null): boolean {
  if (!args?.length) return false;
  const keyword = (arg: string) => /^(\w+)\s*=(?!=)/.exec(arg)?.[1];
  const condition = keyword(args[0]) ? args.find(arg => keyword(arg) === "condition")?.replace(/^condition\s*=\s*/, "") : args[0];
  if (condition === undefined || /^(?:True|1)$/.test(condition.trim())) return false;
  return !/\bCI\b|\bisCI\b|GITHUB_ACTIONS/.test(condition);
}

/** `if not has_gpu(): pytest.skip("no GPU")` gates a test on its environment, and so does a skip in a fixture or
 * helper that no test name covers. A skip that is a direct statement of a `test*` function disables it, and so does
 * one under a condition that mentions CI. The last line of `lines` is the skip; a hunk gap or a header too far up
 * leaves the context unknown and the skip is reported. */
function isGuardedSkip(lines: { code: string; raw: string; number: number }[]): boolean {
  const indentOf = (text: string) => text.length - text.trimStart().length;
  const mentionsCi = (raw: string) => /\bCI\b|\bGITHUB_ACTIONS\b/.test(raw);
  const own = lines[lines.length - 1];
  if (/^\s*(?:if|elif|else)\b.*:\s*\S/.test(own.code)) return !mentionsCi(own.raw);
  let limit = indentOf(own.code);
  for (let i = lines.length - 2; i >= 0 && lines.length - 1 - i <= 200; i--) {
    if (lines[i].number !== lines[i + 1].number - 1) return false;
    const { code, raw } = lines[i];
    if (!code.trim() || indentOf(code) >= limit) continue;
    const keyword = /^\s*(async\s+def|def|class|if|elif|else|try|except|finally|with|for|while)\b/.exec(code)?.[1];
    if (keyword === "def" || keyword === "async def") return !/^\s*(?:async\s+)?def\s+test/.test(code);
    if (keyword === "class") return false;
    if (keyword === "if" || keyword === "elif" || keyword === "else" || keyword === "try" || keyword === "except" || keyword === "finally") return !mentionsCi(raw);
    limit = indentOf(code) + (keyword ? 0 : 1);
  }
  return false;
}

/** How a language marks where an imperative skip sits: under a condition (the skip depends on the environment), in a
 * test or sub-test (the skip disables it) or in a helper that no test name covers. */
interface GuardProfile {
  /** A trailing `if`/`unless` on the skip's own line. */
  modifier?: RegExp;
  conditional: RegExp;
  test: RegExp;
  helper: RegExp;
  /** Conditional compilation (`#if` ... `#endif`) gates a skip without indenting it. */
  preprocessor?: { open: RegExp; close: RegExp; other: RegExp };
}

interface LineRule {
  type: "test-skip" | "test-focus" | "trivial-assert";
  regex: RegExp;
  name: string;
  /** Imperative skips are looked up in their surroundings; annotations and `xit` are always switched-off tests. */
  guard?: GuardProfile;
}

const GO_GUARD: GuardProfile = {
  conditional: /^\s*(?:\}\s*)?(?:if|else|switch|case|select|for)\b/,
  test: /^\s*func\s+(?:\([^)]*\)\s*)?(?:Test|Benchmark|Fuzz|Example)\w*\s*\(|\.Run\s*\(|\bfunc\s*\(\s*\w+\s+\*testing\.[TB]\s*\)/,
  helper: /^\s*func\s+(?:\([^)]*\)\s*)?\w+\s*\(/,
};
const RUBY_GUARD: GuardProfile = {
  modifier: /^\s*(?:skip|pending)\b.*\b(?:if|unless)\b/,
  conditional: /^\s*(?:if|unless|else|elsif|case|when|begin|rescue|ensure|while|until)\b/,
  // Hooks (before, after, around) are not listed: a hook declared under `elsif RUBY_VERSION ...` gates its skip like an example does.
  test: /^\s*(?:it|specify|example|scenario|test)\b|^\s*def\s+test_/,
  helper: /^\s*def\s+\w+/,
};
const PHP_GUARD: GuardProfile = {
  modifier: /\b(?:or|and)\b.*markTest|(?:&&|\|\||\?).*markTest/,
  conditional: /^\s*(?:\}\s*)?(?:if|else|elseif|switch|case|foreach|for|while|try|catch)\b/,
  test: /^\s*(?:(?:public|protected|private|static)\s+)*function\s+test\w*\s*\(/,
  helper: /^\s*(?:(?:public|protected|private|static)\s+)*function\s+\w+\s*\(/,
};
const SWIFT_GUARD: GuardProfile = {
  preprocessor: { open: /^\s*#if\b/, close: /^\s*#endif\b/, other: /^\s*#else(?:if)?\b/ },
  conditional: /^\s*(?:\}\s*)?(?:if|else|guard|switch|case|for|while|do|catch)\b/,
  test: /^\s*(?:@\w+\s+)*(?:(?:public|open|internal|private|fileprivate|static|final|override|class|nonisolated)\s+)*func\s+test\w*\s*\(/,
  helper: /^\s*(?:@\w+\s+)*(?:(?:public|open|internal|private|fileprivate|static|final|override|class|nonisolated)\s+)*func\s+\w+\s*\(/,
};

/** Disabled tests and placeholder assertions in the test ecosystems other than JavaScript and Python. Matching is per line
 * on masked code (strings and comments blanked), so an example in a comment or string is not a skip. */
const LANGUAGE_LINE_RULES: { files: RegExp; rules: LineRule[] }[] = [
  { files: /_test\.go$/i, rules: [
    { type: "test-skip", regex: /\b(?:t|tb|b)\s*\.\s*(?:Skip|Skipf|SkipNow)\s*\(|\.T\(\)\s*\.\s*(?:Skip|Skipf|SkipNow)\s*\(/, name: "skipped Go test (t.Skip)", guard: GO_GUARD },
    { type: "trivial-assert", regex: /\b(?:assert|require)\s*\.\s*True\s*\(\s*\w+\s*,\s*true\s*\)/, name: "trivial assert (assert.True(t, true))" },
    { type: "trivial-assert", regex: /\b(?:assert|require)\s*\.\s*False\s*\(\s*\w+\s*,\s*false\s*\)/, name: "trivial assert (assert.False(t, false))" },
    { type: "trivial-assert", regex: /\b(?:assert|require)\s*\.\s*Equal\s*\(\s*\w+\s*,\s*(\d+|true|false|nil)\s*,\s*\1\s*\)/, name: "trivial assert (assert.Equal(t, 1, 1))" },
  ] },
  { files: /\.rs$/i, rules: [
    { type: "test-skip", regex: /^\s*#\[\s*ignore\b/, name: "ignored Rust test (#[ignore])" },
    { type: "trivial-assert", regex: /(?<![\w!])assert!\s*\(\s*true\s*\)/, name: "trivial assert (assert!(true))" },
    { type: "trivial-assert", regex: /(?<![\w!])assert_eq!\s*\(\s*(\d+|true|false)\s*,\s*\1\s*\)/, name: "trivial assert (assert_eq!(1, 1))" },
  ] },
  { files: /\.(?:java|kt)$/i, rules: [
    { type: "test-skip", regex: /(?:^|\s)@(?:Ignore|Disabled)\b/, name: "ignored JUnit test (@Ignore / @Disabled)" },
    { type: "test-skip", regex: /@Test\s*\([^)]*\benabled\s*=\s*false\b/, name: "disabled TestNG test (enabled = false)" },
    { type: "trivial-assert", regex: /\bassertTrue\s*\(\s*true\s*\)/, name: "trivial assert (assertTrue(true))" },
    { type: "trivial-assert", regex: /\bassertFalse\s*\(\s*false\s*\)/, name: "trivial assert (assertFalse(false))" },
    { type: "trivial-assert", regex: /\bassertEquals\s*\(\s*(\d+|true|false|null)\s*,\s*\1\s*\)/, name: "trivial assert (assertEquals(1, 1))" },
    { type: "trivial-assert", regex: /\bassertThat\s*\(\s*true\s*\)\s*\.\s*isTrue\s*\(/, name: "trivial assert (assertThat(true).isTrue())" },
  ] },
  { files: /\.cs$/i, rules: [
    // `[Ignore]` is checked separately: it also names a mapping attribute (AutoMapper) and must sit next to a test attribute.
    // Skip = with SkipUnless, SkipWhen or SkipType depends on the environment.
    { type: "test-skip", regex: /\b(?:Fact|Theory)\s*\(\s*(?:[^)]*,\s*)?Skip\s*=(?![^\]]*\bSkip(?:Unless|When|Type)\b)/, name: "ignored .NET test (Skip =)" },
    { type: "trivial-assert", regex: /\bAssert\s*\.\s*(?:True|IsTrue)\s*\(\s*true\s*\)/, name: "trivial assert (Assert.True(true))" },
    { type: "trivial-assert", regex: /\bAssert\s*\.\s*(?:False|IsFalse)\s*\(\s*false\s*\)/, name: "trivial assert (Assert.False(false))" },
    { type: "trivial-assert", regex: /\bAssert\s*\.\s*(?:AreEqual|Equal)\s*\(\s*(\d+|true|false|null)\s*,\s*\1\s*\)/, name: "trivial assert (Assert.Equal(1, 1))" },
  ] },
  // Ruby has no file-name convention as strict as the others, and `skip`/`pending` are ordinary method names: only spec and test files.
  { files: /(?:^|\/)(?:spec|test)\/.*\.rb$|_(?:spec|test)\.rb$/i, rules: [
    { type: "test-focus", regex: /^\s*(?:fit|fdescribe|fcontext|fspecify|fexample|fscenario)\b/, name: "focused RSpec example (fit / fdescribe)" },
    { type: "test-focus", regex: /\b(?:it|describe|context|specify|scenario)\b[^\n]*[,(]\s*(?::focus\b|focus:\s*true\b)/, name: "focused RSpec example (focus: true)" },
    { type: "test-skip", regex: /^\s*(?:xit|xdescribe|xcontext|xspecify|xexample|xscenario|xfeature)\b/, name: "disabled RSpec example (xit / xdescribe)" },
    // `:skip => !feature?` or `skip: RUBY_VERSION < "3"` gates the example on its environment; only a bare flag, true or a reason
    // disables it. The line is matched with its strings blanked, so a reason shows as nothing between `skip:` and `do`, `{`, `,` or `)`.
    { type: "test-skip", regex: /\b(?:it|describe|context|specify|scenario)\b[^\n]*[,(]\s*(?::skip\b(?!\s*=>)|(?::skip\s*=>|skip:)\s*(?:true\b|(?=do\b|\{|,|\)|$)))/, name: "disabled RSpec example (skip: true)" },
    { type: "test-skip", regex: /^\s*skip(?:\s|\(|$)/, name: "skipped Ruby test (skip)", guard: RUBY_GUARD },
    { type: "test-skip", regex: /^\s*pending(?:\s+["'(]|\s*$)/, name: "pending Ruby example (pending)", guard: RUBY_GUARD },
    { type: "trivial-assert", regex: /\bexpect\s*\(\s*(true|false|1|0|nil)\s*\)\s*\.\s*to\s+(?:eq|eql|be|equal)\b\s*\(?\s*\1\b/, name: "trivial expectation (expect(true).to eq(true))" },
    { type: "trivial-assert", regex: /^\s*assert\s*\(?\s*true\s*\)?\s*$/, name: "trivial assert (assert true)" },
    { type: "trivial-assert", regex: /\bassert_equal\s*\(?\s*(\d+|true|false|nil)\s*,\s*\1\s*\)?\s*$/, name: "trivial assert (assert_equal 1, 1)" },
  ] },
  { files: /\.php$/i, rules: [
    { type: "test-skip", regex: /\$this\s*->\s*markTest(?:Skipped|Incomplete)\s*\(/, name: "skipped PHPUnit test (markTestSkipped)", guard: PHP_GUARD },
    { type: "trivial-assert", regex: /\$this\s*->\s*assertTrue\s*\(\s*true\s*\)/, name: "trivial assert ($this->assertTrue(true))" },
    { type: "trivial-assert", regex: /\$this\s*->\s*assertFalse\s*\(\s*false\s*\)/, name: "trivial assert ($this->assertFalse(false))" },
    { type: "trivial-assert", regex: /\$this\s*->\s*assert(?:Equals|Same)\s*\(\s*(\d+|true|false|null)\s*,\s*\1\s*\)/, name: "trivial assert ($this->assertEquals(1, 1))" },
  ] },
  { files: /\.swift$/i, rules: [
    { type: "test-skip", regex: /\bthrow\s+XCTSkip\s*\(/, name: "skipped XCTest (XCTSkip)", guard: SWIFT_GUARD },
    // `.disabled(if: condition)` depends on the environment; `.disabled()` and `.disabled("reason")` switch the test off.
    { type: "test-skip", regex: /@(?:Test|Suite)\s*\([^)]*\.disabled\s*\((?!\s*if\b)/, name: "disabled Swift Testing test (.disabled)" },
    { type: "trivial-assert", regex: /\bXCTAssertTrue\s*\(\s*true\s*\)/, name: "trivial assert (XCTAssertTrue(true))" },
    { type: "trivial-assert", regex: /\bXCTAssertFalse\s*\(\s*false\s*\)/, name: "trivial assert (XCTAssertFalse(false))" },
    { type: "trivial-assert", regex: /\bXCTAssertEqual\s*\(\s*(\d+|true|false|nil)\s*,\s*\1\s*\)/, name: "trivial assert (XCTAssertEqual(1, 1))" },
    { type: "trivial-assert", regex: /#expect\s*\(\s*true\s*\)/, name: "trivial expectation (#expect(true))" },
  ] },
];

/** `[Ignore]` also names a mapping or serialization attribute (AutoMapper, Json.NET), so it disables a test only inside a
 * test's attribute list: the contiguous attribute lines around it must include a test attribute. */
function inTestAttributeList(lines: { code: string; number: number }[], index: number): boolean {
  const marker = /\[\s*(?:Test|TestCase|TestCaseSource|TestMethod|DataTestMethod|TestFixture|TestClass|Fact|Theory)\b/;
  if (marker.test(lines[index].code)) return true;
  for (const step of [-1, 1]) {
    for (let i = index + step, seen = 0; i >= 0 && i < lines.length && seen < 6; i += step, seen++) {
      if (lines[i].number !== lines[i - step].number + step || !/^\s*\[/.test(lines[i].code)) break;
      if (marker.test(lines[i].code)) return true;
    }
  }
  return false;
}

/** The same question as isGuardedSkip for brace and `end` languages: is the skip under a condition or in a helper? */
function isGuardedBlockSkip(lines: { code: string; raw: string; number: number }[], profile: GuardProfile): boolean {
  const indentOf = (text: string) => text.length - text.trimStart().length;
  const mentionsCi = (raw: string) => /\bCI\b|\bGITHUB_ACTIONS\b/.test(raw);
  const own = lines[lines.length - 1];
  if (profile.modifier?.test(own.code) || profile.conditional.test(own.code)) return !mentionsCi(own.raw);
  // `#if os(Windows)` then `throw XCTSkip(...)` at the same indentation: still inside an unclosed `#if` opened since `from`.
  // Counting starts at the enclosing function, so a test file wrapped in `#if canImport(XCTest)` still reports its skips.
  const compiledConditionally = (from: number) => {
    const directives = profile.preprocessor;
    if (!directives) return false;
    let depth = 0;
    for (let i = from; i < lines.length - 1; i++) {
      if (directives.open.test(lines[i].code)) depth++;
      else if (directives.close.test(lines[i].code)) depth = Math.max(0, depth - 1);
    }
    return depth > 0;
  };
  let limit = indentOf(own.code);
  let i = lines.length - 2;
  for (; i >= 0 && lines.length - 1 - i <= 200; i--) {
    if (lines[i].number !== lines[i + 1].number - 1) return compiledConditionally(i + 1);
    const { code, raw } = lines[i];
    if (!code.trim() || indentOf(code) >= limit) continue;
    // A directive at column 0 inside a function must not look like the end of that function.
    if (profile.preprocessor && (profile.preprocessor.open.test(code) || profile.preprocessor.close.test(code) || profile.preprocessor.other.test(code))) continue;
    if (profile.conditional.test(code)) return !mentionsCi(raw);
    if (profile.test.test(code)) return compiledConditionally(i + 1);
    if (profile.helper.test(code)) return true;
    limit = indentOf(code);
  }
  return compiledConditionally(i + 1);
}

// Familiar test APIs only; this does not resolve imports or custom aliases.
// Contiguous full-source/diff runs share one matcher. NUL marks hunk gaps;
// SOH marks a real template opener, so .each`...` is distinguished from a reference.
// `fixme` and `fail` are Playwright's; `fails` is Vitest's and `failing` Jest's and AVA's: tests expected to fail, which cannot fail the run.
const JS_TEST_API = /(?<![\w$.])(?:(?:it|test|describe|suite)(?:\s*\.\s*(?:concurrent|serial|parallel|describe|failing|sequential))*\s*\.\s*(skip|todo|only|fixme|failing|fails|fail)|((?:xit|xtest|xdescribe|fit|fdescribe)))\b((?:\s*\.\s*(?:each|failing|concurrent|serial|parallel|sequential))*)\s*(?=\(|\u0001)/g;

/** `test.skip(browserName === 'webkit', 'reason')` gates a test on its environment, so it is not a disabled test.
 * A title, a bare `skip()` and `skip(true)` switch a test off; so does a condition that mentions CI, which is how
 * a failing test gets hidden from the pipeline. `open` is the offset of the call's parenthesis; a hunk gap or an
 * unclosed call leaves the context unknown and the skip is reported. */
function isConditionalSkip(source: string, raw: string, open: number): boolean {
  const args = callArguments(source, raw, open);
  if (!args) return false;
  const isString = (arg: string) => /^(['"`])[\s\S]*\1$/.test(arg);
  if (!args.length || isString(args[0]) || args[0] === "true") return false;
  if (args.length > 1 && !isString(args.at(-1)!)) return false;
  return !/\bCI\b|\bisCI\b|GITHUB_ACTIONS/.test(args[0]);
}

/** The arguments, as written in `raw`, of the call whose parenthesis sits at `open` in `source`. Null when `open` is not a
 * parenthesis, or when the call is unclosed, longer than 2000 characters or crosses a hunk gap (NUL): its context is unknown. */
function callArguments(source: string, raw: string, open: number): string[] | null {
  if (source[open] !== "(") return null;
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = start; i < source.length && i - open <= 2000; i++) {
    const char = source[i];
    if (char === "\0") return null;
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) {
      if (depth) { depth--; continue; }
      if (char !== ")") return null;
      args.push(raw.slice(start, i).trim());
      while (args.length && !args.at(-1)) args.pop();
      return args;
    } else if (char === "," && !depth) { args.push(raw.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

// A directive that switches off a type, lint or coverage check for the code next to it. Coverage exclusions keep a line out of
// the figure a coverage threshold is measured on, which is a way to pass the threshold without testing the code.
/** `unless` names code a directive is conventionally written on, which is then not a way around a check. */
interface Directive { regex: RegExp; name: string; unless?: RegExp }
const JS_COMMENT_DIRECTIVE_PATTERNS: Directive[] = [
  { regex: /^\s*\/\/\s*@ts-ignore\b/, name: "compiler ignore (@ts-ignore)" },
  { regex: /^\s*\/\/\s*@ts-expect-error\b/, name: "compiler suppression (@ts-expect-error)" },
  { regex: /^\s*\/\/\s*@ts-nocheck\b/, name: "compiler check disable (@ts-nocheck)" },
  { regex: /^\s*\/\/\s*eslint-disable(?:-next-line|-line)?\b/, name: "linter suppression (eslint-disable)" },
  { regex: /^\s*\/\/\s*biome-ignore\b/, name: "linter suppression (biome-ignore)" },
  { regex: /^\s*\/\/\s*(?:istanbul|c8|v8|node:coverage)\s+(?:ignore\b(?!\s+(?:stop|end)\b)|disable\b)/, name: "coverage exclusion (istanbul / c8 / v8 ignore)" },
];
/** The same directives written as block comments, which the masker reports by offset only. */
const JS_BLOCK_DIRECTIVE_PATTERNS: Directive[] = [
  { regex: /^\/\*\s*eslint-disable(?:-next-line|-line)?\b/, name: "linter suppression (eslint-disable)" },
  { regex: /^\/\*\s*(?:istanbul|c8|v8|node:coverage)\s+(?:ignore\b(?!\s+(?:stop|end)\b)|disable\b)/, name: "coverage exclusion (istanbul / c8 / v8 ignore)" },
];
// Code that is conventionally left out of coverage because no test can or should reach it: type-checking and `__main__` blocks,
// abstract and defensive stubs, optional-import guards, platform branches. A pragma on these is not a way around a threshold.
const COVERAGE_IDIOM = /^\s*(?:if\s+(?:(?:typing|t)\s*\.\s*)?TYPE_CHECKING\b|if\s+__name__\s*==|raise\s+(?:NotImplementedError|AssertionError)\b|(?:\w+\s*\.\s*)?assert_never\s*\(|@(?:abc\s*\.\s*)?abstractmethod\b|except\s*\(?\s*(?:ImportError|ModuleNotFoundError)\b|import\s|from\s+\S+\s+import\b|\.\.\.\s*$|pass\s*$|else\s*:|case\s+_\s*:|(?:el)?if\s+sys\s*\.\s*(?:version_info|platform)\b)/;
const PYTHON_COMMENT_DIRECTIVE_PATTERNS: Directive[] = [
  { regex: /#\s*type:\s*ignore\b/, name: "python type ignore" },
  { regex: /#\s*noqa\b/, name: "python linter suppression (# noqa)" },
  { regex: /#\s*pragma:\s*no\s*(?:cover|branch)\b/i, name: "coverage exclusion (# pragma: no cover)", unless: COVERAGE_IDIOM },
  { regex: /#\s*pylint:\s*(?:disable|skip-file)\b/, name: "python linter suppression (# pylint: disable)" },
  { regex: /#\s*pyright:\s*ignore\b/, name: "python type ignore (# pyright: ignore)" },
  { regex: /#\s*mypy:\s*ignore-errors\b/, name: "python type check disabled for the file (# mypy: ignore-errors)" },
  { regex: /#\s*(?:flake8|ruff):\s*noqa\b/i, name: "python linter suppression for the file (# flake8: noqa)" },
];
// Test-harness code that rewrites what the runner reports. Read only in files that are part of the harness (conftest.py,
// sitecustomize.py, test files); a pytest plugin has its own reasons to touch report objects.
const PYTHON_HARNESS_FILE = /(?:^|\/)(?:conftest|sitecustomize|usercustomize)\.py$/i;
const PYTHON_HARNESS_PATTERNS = [
  { regex: /\.\s*outcome\s*=\s*(["'])passed\1/, name: "test report outcome forced to passed" },
  { regex: /(?<![\w.])call\s*\.\s*excinfo\s*=\s*None\b/, name: "failure cleared from a test report hook (call.excinfo = None)" },
  { regex: /(?<![\w.])session\s*\.\s*exitstatus\s*=\s*(?:0\b|(?:pytest\s*\.\s*)?ExitCode\s*\.\s*OK\b)/, name: "pytest exit status forced to 0" },
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
  ".py", ".go", ".rs", ".java", ".kt", ".vue", ".svelte", ".php", ".rb", ".cs", ".cpp", ".c", ".swift"
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
    const languageRules = LANGUAGE_LINE_RULES.find(entry => entry.files.test(file.path))?.rules;
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
            if (rule.imperative && isGuardedSkip(maskedLines)) break;
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

      // A2. Disabled tests, focused tests and placeholder assertions in the other test ecosystems
      if (languageRules && !isComment) {
        for (const rule of languageRules) {
          if (!rule.regex.test(cleanedLine)) continue;
          if (rule.guard && isGuardedBlockSkip(maskedLines, rule.guard)) break;
          infractions.push({ type: rule.type, file: file.path, lineNumber: added.lineNumber, lineSnippet: rawLine.trim(), commitHash, commitDate, reason: rule.name });
          break;
        }
      }

      // B. Type Escapes
      let foundEscape = false;
      for (const rule of directives) {
        if (rule.regex.test(masked.comments) && !rule.unless?.test(cleanedLine)) {
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

      const blockDirective = javascript && !foundEscape
        ? JS_BLOCK_DIRECTIVE_PATTERNS.find(rule => masked.blockStarts.some(start => rule.regex.test(rawLine.slice(start))))
        : undefined;
      if (blockDirective) {
        infractions.push({ type: "type-escape", file: file.path, lineNumber: added.lineNumber, lineSnippet: rawLine.trim(), commitHash, commitDate, reason: blockDirective.name });
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

    if (/\.cs$/i.test(file.path)) {
      maskedLines.forEach((line, index) => {
        if (/\[\s*Ignore\b/.test(line.code) && inTestAttributeList(maskedLines, index)) {
          infractions.push({ type: "test-skip", file: file.path, lineNumber: line.number, lineSnippet: line.raw.trim(), commitHash, commitDate, reason: "ignored .NET test ([Ignore])" });
        }
      });
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

    if (python) {
      // Markers on decorators, `pytestmark = ...` and `marks=...` can span lines, so they are read from the joined source.
      const reportedSkips = new Set(infractions.slice(firstFinding).filter(f => f.type === "test-skip").map(f => f.lineNumber));
      for (const match of source.matchAll(PYTHON_MARKER)) {
        const xfail = match[2] === "xfail";
        let open = match.index + match[0].length;
        while (source[open] === " " || source[open] === "\t") open++;
        if (xfail && isConditionalXfail(callArguments(source, raw, open))) continue;
        const location = evidence(match.index, match[0].length);
        if (reportedSkips.has(location.lineNumber)) continue;
        reportedSkips.add(location.lineNumber);
        infractions.push({ type: "test-skip", file: file.path, ...location, commitHash, commitDate,
          reason: xfail ? "test marked as expected to fail (pytest.mark.xfail)" : "test skipped by a marker (pytest.mark.skip)" });
      }
      if (isTestFile(file.path) || PYTHON_HARNESS_FILE.test(file.path)) {
        for (const rule of PYTHON_HARNESS_PATTERNS) {
          for (const match of raw.matchAll(new RegExp(rule.regex.source, "g"))) {
            // The value is a string literal, but the assignment around it must be code.
            if (code[match.index] !== raw[match.index]) continue;
            infractions.push({ type: "guard-weakened", file: file.path, ...evidence(match.index, match[0].length), commitHash, commitDate, reason: rule.name });
          }
        }
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
        // Playwright's `test.fixme(cond, why)` and `test.fail(cond, why)` take a condition like `test.skip` does.
        if ((match[1] === "skip" || match[1] === "fixme" || match[1] === "fail") && !match[3] && isConditionalSkip(source, raw, match.index + match[0].length)) continue;
        const focus = match[1] === "only" || match[2] === "fit" || match[2] === "fdescribe";
        const expectedToFail = match[1] === "failing" || match[1] === "fails" || match[1] === "fail";
        infractions.push({ type: focus ? "test-focus" : "test-skip", file: file.path, ...evidence(match.index, match[0].length),
          commitHash, commitDate, reason: focus ? "focused test or suite excludes other tests from the run"
            : expectedToFail ? `test expected to fail, so its failure cannot fail the run (${match[0].replace(/\s/g, "")})`
            : `skipped, disabled or placeholder test registration (${match[0].replace(/\s/g, "")})`,
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
    // Diff-aware rules (tampering.ts) only run in context reviews, not here.
    const buckets: Partial<Record<Infraction["type"], Infraction[]>> = {
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
      if (count < MAX_INFRACTIONS_PER_COMMIT) buckets[infraction.type]?.push(infraction);
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
