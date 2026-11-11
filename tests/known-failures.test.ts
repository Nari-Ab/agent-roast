import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { analyzeGuardFile, analyzeTestFile, newKnownFailureMarkers } from "../src/tampering.js";

const scan = (text: string, filename: string) =>
  auditFileDiffs([{ path: filename, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const types = (text: string, filename: string) => scan(text, filename).map(f => [f.type, f.lineNumber]);

describe("pytest markers that expect or force a failure", () => {
  it.each([
    "@pytest.mark.xfail\ndef test_a(): pass",
    '@pytest.mark.xfail(reason="flaky")\ndef test_a(): pass',
    '@pytest.mark.xfail(\n    reason="pricing rewrite",\n    strict=True,\n)\ndef test_a(): pass',
    "@pytest.mark.xfail(raises=ValueError)\ndef test_a(): pass",
    "@pytest.mark.xfail(run=False)\ndef test_a(): pass",
    '@pytest.mark.xfail(True, reason="always")\ndef test_a(): pass',
    "@pytest.mark.xfail(condition=True)\ndef test_a(): pass",
    '@pytest.mark.xfail(os.environ.get("CI"), reason="slow")\ndef test_a(): pass',
    '@pytest.mark.xfail(condition=bool(os.getenv("GITHUB_ACTIONS")))\ndef test_a(): pass',
  ])("reports an xfail that holds everywhere: %s", text => {
    expect(types(text, "test_a.py")).toEqual([["test-skip", 1]]);
  });

  it.each([
    '@pytest.mark.xfail(sys.platform == "win32", reason="paths")\ndef test_a(): pass',
    '@pytest.mark.xfail(\n    sys.platform == "win32",\n    reason="paths",\n)\ndef test_a(): pass',
    '@pytest.mark.xfail(condition=sys.version_info < (3, 12), reason="new api")\ndef test_a(): pass',
    '@pytest.mark.xfail("sys.platform == \'win32\'", reason="paths")\ndef test_a(): pass',
    "@pytest.mark.xfail(not HAS_GPU)\ndef test_a(): pass",
  ])("leaves an xfail under an environment condition alone: %s", text => {
    expect(types(text, "test_a.py")).toEqual([]);
  });

  it("reports a marker whose call is cut by a diff hunk, because its condition is unknown", () => {
    const findings = auditFileDiffs([{ path: "test_a.py", addedLines: [
      { line: "@pytest.mark.xfail(", lineNumber: 1 }, { line: "    reason='x',", lineNumber: 9 },
    ] }]).infractions;
    expect(findings.map(f => f.type)).toEqual(["test-skip"]);
  });

  it("reports a whole-module marker and a marker on one parametrized case", () => {
    expect(types('pytestmark = pytest.mark.skip(reason="rewrite")', "test_a.py")).toEqual([["test-skip", 1]]);
    expect(types("pytestmark = [pytest.mark.xfail]", "test_a.py")).toEqual([["test-skip", 1]]);
    expect(types('CASES = [pytest.param(1, 2, marks=pytest.mark.xfail(reason="rounding"))]', "test_a.py")).toEqual([["test-skip", 1]]);
    expect(types("CASES = [pytest.param(1, 2, marks=[pytest.mark.skip])]", "test_a.py")).toEqual([["test-skip", 1]]);
  });

  it("does not report markers that are only built, quoted or conditional", () => {
    // The pytest documentation's own pattern for --runslow builds the marker and attaches it under a condition.
    expect(types('skip_slow = pytest.mark.skip(reason="need --runslow")', "conftest.py")).toEqual([]);
    expect(types('@pytest.mark.skipif(sys.platform == "win32", reason="paths")\ndef test_a(): pass', "test_a.py")).toEqual([]);
    expect(types('DOC = "@pytest.mark.xfail"', "test_a.py")).toEqual([]);
    expect(types('"""\n@pytest.mark.xfail\npytestmark = pytest.mark.skip\n"""', "test_a.py")).toEqual([]);
    expect(types("# @pytest.mark.xfail", "test_a.py")).toEqual([]);
  });

  it("does not report a skip marker twice", () => {
    expect(types("@pytest.mark.skip\ndef test_a(): pass", "test_a.py")).toEqual([["test-skip", 1]]);
    expect(types('@pytest.mark.skip(reason="x")\n@pytest.mark.xfail\ndef test_a(): pass', "test_a.py")).toEqual([["test-skip", 1], ["test-skip", 2]]);
  });

  it("treats pytest.xfail() like pytest.skip(): reported as a statement of a test, not under a condition or in a helper", () => {
    expect(types('def test_a():\n    pytest.xfail("later")', "test_a.py")).toEqual([["test-skip", 2]]);
    expect(types('def test_a():\n    if not has_gpu():\n        pytest.xfail("no GPU")', "test_a.py")).toEqual([]);
    expect(types('def test_a():\n    if os.environ.get("CI"):\n        pytest.xfail("slow on CI")', "test_a.py")).toEqual([["test-skip", 3]]);
    expect(types('@pytest.fixture\ndef gpu():\n    pytest.xfail("no GPU")', "test_a.py")).toEqual([]);
  });

  it("reports unittest.expectedFailure but not the conditional skips", () => {
    expect(types("@unittest.expectedFailure\ndef test_a(self): pass", "test_a.py")).toEqual([["test-skip", 1]]);
    expect(types("from unittest import expectedFailure\n@expectedFailure\ndef test_a(self): pass", "test_a.py")).toEqual([["test-skip", 2]]);
    expect(types('@unittest.skipIf(sys.platform == "win32", "paths")\ndef test_a(self): pass', "test_a.py")).toEqual([]);
  });
});

describe("JavaScript tests that are expected to fail", () => {
  it.each([
    'it.fails("applies a discount", () => {});',
    'test.fails("applies a discount", () => {});',
    'it.failing("applies a discount", () => {});',
    'test.failing.each([1, 2])("adds %i", () => {});',
    'test.concurrent.failing("applies a discount", async () => {});',
    'test.fixme("renders the cart", async ({ page }) => {});',
    'test.describe.fixme("cart", () => {});',
    "test.fail();",
    'test.fail("renders the cart", async ({ page }) => {});',
    "test.fixme(true, 'later');",
    "test.fail(!!process.env.CI, 'flaky on CI');",
  ])("reports %s", text => {
    expect(types(text, "cart.spec.ts")).toEqual([["test-skip", 1]]);
  });

  it.each([
    "test.fixme(browserName === 'webkit', 'not supported yet');",
    "test.fail(process.platform === 'win32', 'paths');",
    "test.fixme(isMobile);",
    "test.fail(({ browserName }) => browserName === 'firefox', 'bug 123');",
  ])("leaves a marker under an environment condition alone: %s", text => {
    expect(types(text, "cart.spec.ts")).toEqual([]);
  });

  it("does not take other calls named fail for markers", () => {
    for (const text of [
      'assert.fail("boom");', "t.fail();", 'expect.fail("boom");', "this.test.fail();", "const fails = 1;",
      'it("fails when the cart is empty", () => {});', 'describe("failing builds", () => {});', "function fixme() {}\nfixme();",
    ]) expect(types(text, "cart.test.ts")).toEqual([]);
  });

  it("explains that the test cannot fail the run", () => {
    expect(scan('it.fails("x", () => {});', "cart.test.ts")[0].reason).toMatch(/expected to fail/);
    expect(scan('test.fixme("x", () => {});', "cart.spec.ts")[0].reason).toMatch(/skipped, disabled/);
  });
});

describe("test-harness code that rewrites the result", () => {
  const hook = (body: string) => `@pytest.hookimpl(hookwrapper=True)\ndef pytest_runtest_makereport(item, call):\n    outcome = yield\n    report = outcome.get_result()\n${body}`;

  it.each([
    '    report.outcome = "passed"',
    "    rep.outcome = 'passed'",
    '    if report.when == "call":\n        report.outcome = "passed"',
    "    call.excinfo = None",
    "    session.exitstatus = 0",
    "    session.exitstatus = pytest.ExitCode.OK",
  ])("reports %s in conftest.py", body => {
    const findings = scan(hook(body), "conftest.py");
    expect(findings.map(f => f.type)).toEqual(["guard-weakened"]);
  });

  it("reads files that are part of the harness only", () => {
    expect(scan(hook('    report.outcome = "passed"'), "tests/test_plugin.py").map(f => f.type)).toEqual(["guard-weakened"]);
    expect(scan(hook('    report.outcome = "passed"'), "sitecustomize.py").map(f => f.type)).toEqual(["guard-weakened"]);
    // A pytest plugin has its own reasons to touch report objects.
    expect(scan(hook('    report.outcome = "passed"'), "src/pytest_plugin/plugin.py")).toEqual([]);
  });

  it.each([
    '    if report.outcome == "passed":\n        record(item)',
    '    report.outcome = "rerun"',
    '    report.outcome = "skipped"',
    "    session.exitstatus = 1",
    "    session.exitstatus = exitstatus",
    '    DOC = "report.outcome = \'passed\'"',
    '    # report.outcome = "passed"',
  ])("leaves %s alone", body => {
    expect(scan(hook(body), "conftest.py")).toEqual([]);
  });
});

describe("suppression directives that exclude code from checks or coverage", () => {
  it.each([
    ["x = 1  # pragma: no cover", "coverage exclusion"],
    ["if cond:  # pragma: no branch", "coverage exclusion"],
    ["x = 1  #pragma: NO COVER", "coverage exclusion"],
    ["import foo  # pylint: disable=unused-import", "pylint"],
    ["# pylint: skip-file", "pylint"],
    ["x = load()  # pyright: ignore[reportGeneralTypeIssues]", "pyright"],
    ["# mypy: ignore-errors", "mypy"],
    ["# flake8: noqa", "flake8"],
    ["# ruff: noqa: F401", "flake8"],
  ])("reports %s in Python", (text, label) => {
    const findings = scan(text, "src/price.py");
    expect(findings.map(f => f.type)).toEqual(["type-escape"]);
    expect(findings[0].reason.toLowerCase()).toContain(label);
  });

  it.each([
    ["/* istanbul ignore next */\nfunction a() {}", 1],
    ["// istanbul ignore else\nif (a) {}", 1],
    ["const a = /* istanbul ignore next */ load();", 1],
    ["/* c8 ignore next 3 */\nfunction a() {}", 1],
    ["// c8 ignore start\nfunction a() {}\n// c8 ignore stop", 1],
    ["/* v8 ignore start */\nfunction a() {}", 1],
    ["// v8 ignore next\nfunction a() {}", 1],
    ["/* node:coverage ignore next */\nfunction a() {}", 1],
    ["// biome-ignore lint/suspicious/noExplicitAny: legacy\nconst a: any = 1;", 1],
  ])("reports %j in TypeScript", (text, line) => {
    const findings = scan(text, "src/price.ts").filter(f => f.type === "type-escape");
    expect(findings.map(f => f.lineNumber)).toEqual([line]);
  });

  it("does not take quoted or documented directives for real ones", () => {
    expect(scan('HINT = "add  # pragma: no cover  to skip a line"', "src/price.py")).toEqual([]);
    expect(scan('"""\n# pragma: no cover\n# pylint: disable=all\n"""', "src/price.py")).toEqual([]);
    expect(scan('const hint = "/* istanbul ignore next */";', "src/price.ts")).toEqual([]);
    expect(scan("/*\n// c8 ignore next\n// istanbul ignore next\n*/", "src/price.ts")).toEqual([]);
    // A region is one exclusion: its closing line is not another.
    expect(scan("/* c8 ignore stop */\n// v8 ignore end\n// node:coverage enable", "src/price.ts")).toEqual([]);
    expect(scan("const hint = `\n// v8 ignore next\n`;", "src/price.ts")).toEqual([]);
  });

  it("reports one finding per line when several directives share it", () => {
    expect(scan("x = load()  # type: ignore  # pragma: no cover", "src/price.py")).toHaveLength(1);
    expect(scan("/* istanbul ignore next */ /* eslint-disable */", "src/price.ts")).toHaveLength(1);
  });
});

describe("xfail_strict", () => {
  const verdict = (file: string, before: string, after: string) => analyzeGuardFile(file, before, after, "HEAD").map(f => [f.type, f.lineNumber, f.reason]);

  it.each([
    ["pytest.ini", "[pytest]\nxfail_strict = true\n", "[pytest]\nxfail_strict = false\n"],
    ["pytest.ini", "[pytest]\nxfail_strict=True\n", "[pytest]\nxfail_strict=False\n"],
    ["setup.cfg", "[metadata]\nname = x\n\n[tool:pytest]\nxfail_strict = true\n", "[metadata]\nname = x\n\n[tool:pytest]\nxfail_strict = false\n"],
    ["tox.ini", "[pytest]\nxfail_strict = 1\n", "[pytest]\nxfail_strict = 0\n"],
    ["backend/pyproject.toml", '[tool.pytest.ini_options]\naddopts = "-q"\nxfail_strict = true\n', '[tool.pytest.ini_options]\naddopts = "-q"\nxfail_strict = false\n'],
  ])("reports xfail_strict switched off in %s", (file, before, after) => {
    const [finding] = verdict(file, before, after);
    expect(finding[0]).toBe("guard-weakened");
    expect(finding[2]).toBe("Strict xfail switched off");
    expect(finding[1]).toBe(after.split("\n").findIndex(line => /xfail_strict/.test(line)) + 1);
  });

  it("stays quiet when strictness is kept, raised, added, moved or unrelated", () => {
    expect(verdict("pytest.ini", "[pytest]\nxfail_strict = true\n", "[pytest]\nxfail_strict = true\naddopts = -q\n")).toEqual([]);
    expect(verdict("pytest.ini", "[pytest]\nxfail_strict = false\n", "[pytest]\nxfail_strict = true\n")).toEqual([]);
    expect(verdict("pytest.ini", "[pytest]\naddopts = -q\n", "[pytest]\nxfail_strict = false\n")).toEqual([]);
    expect(verdict("pytest.ini", "[pytest]\nxfail_strict = true\n", "[pytest]\naddopts = -q\n")).toEqual([]);
    expect(verdict("pytest.ini", "[pytest]\n# xfail_strict = true\n", "[pytest]\n# xfail_strict = false\n")).toEqual([]);
    expect(verdict("README.md", "xfail_strict = true\n", "xfail_strict = false\n")).toEqual([]);
  });
});

describe("a check that says the same thing with less in it", () => {
  const js = (assertion: string) => `it("works", async () => {\n  const value = run();\n  ${assertion}\n});\n`;
  const py = (assertion: string) => `def test_works():\n    value = run()\n    ${assertion}\n`;
  const changed = (before: string, after: string, file: string) => analyzeTestFile(file, file, before, after, "HEAD").immediate.map(f => f.type);

  it.each([
    ['expect(() => parse("x")).toThrow("bad input");', "expect(() => parse(\"x\")).toThrow();"],
    ["expect(() => parse(1)).toThrow(TypeError);", "expect(() => parse(1)).toThrow();"],
    ["expect(() => parse(1)).toThrow(TypeError);", "expect(() => parse(1)).toThrow(Error);"],
    ['await expect(load()).rejects.toThrow("boom");', "await expect(load()).rejects.toThrow();"],
    ['expect(send).toHaveBeenCalledWith("a", 1);', "expect(send).toHaveBeenCalled();"],
    ["expect(send).toHaveBeenCalledTimes(2);", "expect(send).toHaveBeenCalled();"],
    ["expect(value).toBe(42);", "expect(value).toEqual(expect.anything());"],
    ["expect(value).toEqual({ id: 1 });", "expect(value).toEqual(expect.any(Object));"],
    ["expect(value.items).toHaveLength(3);", "expect(value.items.length).toBeGreaterThan(0);"],
    ["expect(value).toBe(42);", "expect(value).toBeGreaterThanOrEqual(1);"],
    ["expect(value).toBeGreaterThan(5);", "expect(value).toBeGreaterThan(0);"],
  ])("reports %s → %s", (before, after) => {
    expect(changed(js(before), js(after), "a.test.ts")).toEqual(["assertion-weakened"]);
  });

  it.each([
    ["expect(() => parse(1)).toThrow();", 'expect(() => parse(1)).toThrow("bad input");'],
    ['expect(() => parse(1)).toThrow("a");', 'expect(() => parse(1)).toThrow("b");'],
    ["expect(() => parse(1)).toThrow(Error);", "expect(() => parse(1)).toThrow(TypeError);"],
    ["expect(value.items).toHaveLength(0);", "expect(value.items.length).toBeGreaterThan(0);"],
    ["expect(value).toBe(0);", "expect(value).toBeGreaterThan(0);"],
    ["expect(send).toHaveBeenCalled();", 'expect(send).toHaveBeenCalledWith("a");'],
    ["expect(value).toEqual(expect.anything());", "expect(value).toEqual(expect.anything());"],
    ["expect(value).toEqual({ id: 1 });", "expect(value).toEqual({ id: expect.any(Number) });"],
  ])("leaves %s → %s alone", (before, after) => {
    expect(changed(js(before), js(after), "a.test.ts").filter(type => type === "assertion-weakened")).toEqual([]);
  });

  it.each([
    ["with pytest.raises(ValueError):\n        parse('x')", "with pytest.raises(Exception):\n        parse('x')"],
    ["with pytest.raises(ValueError):\n        parse('x')", "with pytest.raises(BaseException):\n        parse('x')"],
    ["with pytest.raises(ValueError):\n        parse('x')", "with pytest.raises(builtins.Exception):\n        parse('x')"],
    ["with pytest.raises(ValueError, match='bad'):\n        parse('x')", "with pytest.raises(ValueError):\n        parse('x')"],
    ["with self.assertRaisesRegex(ValueError, 'bad'):\n        parse('x')", "with self.assertRaises(ValueError):\n        parse('x')"],
    ["with self.assertRaises(ValueError):\n        parse('x')", "with self.assertRaises(Exception):\n        parse('x')"],
    ["assert len(value) == 3", "assert len(value) > 0"],
    ["assert len(value) == 3", "assert len(value) >= 1"],
    ["assert value == 42", "assert value >= 0"],
  ])("reports %s → %s", (before, after) => {
    expect(changed(py(before), py(after), "test_a.py")).toEqual(["assertion-weakened"]);
  });

  it.each([
    ["with pytest.raises(Exception):\n        parse('x')", "with pytest.raises(ValueError):\n        parse('x')"],
    ["with pytest.raises(ValueError, match='a'):\n        parse('x')", "with pytest.raises(ValueError, match='b'):\n        parse('x')"],
    ["with pytest.raises(ValueError):\n        parse('x')", "with pytest.raises(ValueError, match='bad'):\n        parse('x')"],
    ["assert len(value) == 0", "assert len(value) > 0"],
    ["assert value is None", "assert value > 0"],
    ["assert value != 0", "assert value > 0"],
  ])("leaves %s → %s alone", (before, after) => {
    expect(changed(py(before), py(after), "test_a.py")).toEqual([]);
  });
});

describe("known-failure markers count only on tests that were already there", () => {
  // The review audits the whole text of each version of a file, so these tests do the same.
  const audit = (text: string, file: string) => auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
  const added = (before: string | null, after: string, file = "test_a.py") =>
    newKnownFailureMarkers(before === null ? [] : audit(before, file), audit(after, file), before, after).map(f => f.lineNumber);

  it("drops a marker on a test the change added, keeps one on a test that was there", () => {
    const before = "def test_old():\n    assert f() == 1\n";
    const after = "@pytest.mark.xfail\ndef test_old():\n    assert f() == 1\n\n\n@pytest.mark.xfail\ndef test_new():\n    assert g() == 2\n";
    expect(added(before, after)).toEqual([1]);
  });

  it("is not fooled by identical marker lines: the new test is the one dropped, wherever the lines sit", () => {
    // Five tests carry the same decorator line; the change adds a sixth in the middle. Matching by text alone would blame the last one.
    const test = (name: string, marked: boolean) => `${marked ? "@pytest.mark.xfail(\n    reason='known',\n)\n" : ""}def ${name}():\n    assert f() == 1\n`;
    const before = ["a", "b", "c", "d", "e"].map(name => test(`test_${name}`, true)).join("\n\n");
    const after = ["a", "b", "c"].map(name => test(`test_${name}`, true)).concat(test("test_new", true), ["d", "e"].map(name => test(`test_${name}`, true))).join("\n\n");
    expect(added(before, after)).toEqual([]);
    // Marking an existing test while adding a new marked one reports the existing one, and names its line.
    const unmarked = ["a", "b", "c", "d", "e"].map(name => test(`test_${name}`, name !== "c")).join("\n\n");
    const both = ["a", "b", "c"].map(name => test(`test_${name}`, true)).concat(test("test_new", true), ["d", "e"].map(name => test(`test_${name}`, true))).join("\n\n");
    const reported = added(unmarked, both);
    expect(reported).toHaveLength(1);
    expect(both.split("\n")[reported[0]]).toContain("reason='known'");
    expect(both.split("\n").slice(reported[0] + 2, reported[0] + 4).join("\n")).toContain("def test_c");
  });

  it("follows a multi-line marker and a parametrized case to the def they belong to", () => {
    const before = "def test_old(code):\n    assert f(code) == 1\n";
    const after = '@pytest.mark.parametrize("code", [pytest.param(1, marks=pytest.mark.xfail(reason="x")), 2])\ndef test_old(code):\n    assert f(code) == 1\n\n\n@pytest.mark.xfail(\n    reason="x",\n)\ndef test_new():\n    pass\n';
    expect(added(before, after)).toEqual([1]);
  });

  it("finds the test around an imperative pytest.xfail()", () => {
    const before = "def test_old():\n    assert f() == 1\n";
    const after = 'def test_old():\n    pytest.xfail("later")\n    assert f() == 1\n\n\ndef test_new():\n    pytest.xfail("later")\n';
    expect(added(before, after)).toEqual([2]);
  });

  it("drops every marker of a new file, and a marker an existing test already had", () => {
    expect(added(null, "@pytest.mark.xfail\ndef test_a(): pass\n")).toEqual([]);
    const test = "@pytest.mark.xfail(reason='x')\ndef test_a():\n    assert f() == 1\n";
    expect(added(test, test + "\n\ndef test_b():\n    assert g() == 2\n")).toEqual([]);
  });

  it("counts a marker that names no single test when the file has more of them than before", () => {
    expect(added("x = 1\n", "pytestmark = pytest.mark.xfail\n")).toEqual([1]);
    expect(added("pytestmark = pytest.mark.xfail\n", "pytestmark = pytest.mark.xfail\n")).toEqual([]);
  });

  it("matches a JavaScript marker by the title of its test", () => {
    const before = 'test("renders the cart", () => {});\ntest.fixme("old note", () => {});\n';
    const after = 'test.fixme("renders the cart", () => {});\ntest.fixme("old note", () => {});\ntest.fixme("brand new", () => {});\ntest.fixme("CT-1 old note", () => {});\n';
    expect(added(before, after, "cart.spec.ts")).toEqual([1]);
  });

  it("never touches a plain skip or another rule", () => {
    const skip = "@pytest.mark.skip\ndef test_a(): pass\n";
    expect(newKnownFailureMarkers([], audit(skip, "test_a.py"), "def test_a(): pass\n", skip)).toEqual([]);
  });
});

describe("CI and package scripts that stop a check from failing", () => {
  const WORKFLOW = (steps: string) => `on:\n  push:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
  const ci = (before: string, after: string) => analyzeGuardFile(".github/workflows/ci.yml", WORKFLOW(before), WORKFLOW(after), "HEAD").map(f => f.reason);

  it.each([
    ["      - run: npm test\n", "      - run: npm test || true\n", "Test command can no longer fail the CI step"],
    ["      - run: pytest -q\n", "      - run: pytest -q; exit 0\n", "Test command can no longer fail the CI step"],
    ["      - run: pytest -q\n", '      - run: pytest -q || echo "tests failed"\n', "Test command can no longer fail the CI step"],
    ["      - run: pnpm test\n", "      - run: |\n          pnpm test || exit 0\n", "Test command can no longer fail the CI step"],
    ["      - run: npm test\n", "      - if: false\n        run: npm test\n", "CI step is now switched off"],
    ["      - name: Test\n        run: npm test\n", "      - name: Test\n        if: ${{ false }}\n        run: npm test\n", "CI step is now switched off"],
    ["      - name: Test\n        run: npm test\n", "      - name: Test\n        run: npm test\n        continue-on-error: true\n", "CI step is now allowed to fail"],
  ])("reports %j → %j", (before, after, reason) => {
    expect(ci(before, after)).toEqual([reason]);
  });

  it.each([
    ["      - run: npm test\n", "      - run: npm test\n      - run: npm cache clean --force || true\n"],
    ["      - run: npm test || true\n", "      - run: npm test || true\n"],
    ["      - run: npm test\n", "      - name: Test\n        if: github.event_name == 'push'\n        run: npm test\n"],
    ["      - run: npm test\n", "      - run: npm test\n      # - if: false\n"],
    ["      - run: npm test\n", "      - run: npm test\n      - if: false\n        run: echo a brand new step\n"],
    ["      - run: npm test || true\n", "      - run: npm test\n"],
  ])("leaves %j → %j alone", (before, after) => {
    expect(ci(before, after)).toEqual([]);
  });

  it("reads the --fail-under of coverage report in a workflow like any other coverage threshold", () => {
    const run = (n: number) => WORKFLOW(`      - run: coverage report --fail-under=${n}\n      - run: pytest --cov --cov-fail-under=${n}\n`);
    const findings = analyzeGuardFile(".github/workflows/ci.yml", run(95), run(60), "HEAD");
    expect(findings.map(f => f.reason)).toEqual(["Coverage threshold lowered", "Coverage threshold lowered"]);
    expect(findings.map(f => f.lineSnippet).sort()).toEqual(["--cov-fail-under: 95 → 60", "--fail-under: 95 → 60"]);
    expect(analyzeGuardFile(".github/workflows/ci.yml", run(60), run(95), "HEAD")).toEqual([]);
  });

  it("reports the line of the new shell swallow", () => {
    const findings = analyzeGuardFile(".github/workflows/ci.yml", WORKFLOW("      - run: npm ci\n      - run: npm test\n"), WORKFLOW("      - run: npm ci\n      - run: npm test || true\n"), "HEAD");
    expect(findings[0].lineNumber).toBe(8);
    expect(findings[0].lineSnippet).toBe("- run: npm test || true");
  });

  const scripts = (before: Record<string, string>, after: Record<string, string>) =>
    analyzeGuardFile("package.json", JSON.stringify({ scripts: before }, null, 2), JSON.stringify({ scripts: after }, null, 2), "HEAD").map(f => f.reason);

  it.each([
    [{ lint: "eslint ." }, { lint: "echo skipped" }, "The lint script can no longer fail"],
    [{ typecheck: "tsc --noEmit" }, { typecheck: "tsc --noEmit || true" }, "The typecheck script can no longer fail"],
    [{ "test:unit": "vitest run" }, { "test:unit": "exit 0" }, "Test script can no longer fail"],
    [{ test: "jest" }, { test: "jest --passWithNoTests" }, "Test script can no longer fail"],
    [{ check: "tsc && eslint ." }, { check: ":" }, "The check script can no longer fail"],
  ])("reports %j → %j", (before, after, reason) => {
    expect(scripts(before, after)).toEqual([reason]);
  });

  it.each([
    [{ lint: "eslint ." }, { lint: "eslint . --fix" }],
    [{ test: "jest" }, { test: "vitest run" }],
    [{ build: "tsc" }, { build: "echo nothing to build" }],
    [{ lint: "eslint . || true" }, { lint: "eslint . --max-warnings 0 || true" }],
    [{ test: "vitest run" }, { test: "vitest run", lint: "echo none" }],
  ])("leaves %j → %j alone", (before, after) => {
    expect(scripts(before, after)).toEqual([]);
  });
});

describe("Python lint and type-checker settings that got easier to pass", () => {
  const verdict = (file: string, before: string, after: string) => analyzeGuardFile(file, before, after, "HEAD").map(f => f.reason);
  const RUFF = '[tool.ruff.lint]\nselect = ["E", "F", "B"]\nignore = ["E501"]\n';

  it.each([
    ["pyproject.toml", RUFF, RUFF.replace('["E501"]', '["E501", "F401"]'), "Lint or type checks switched off in the configuration"],
    ["pyproject.toml", RUFF, RUFF.replace('ignore = ["E501"]', 'extend-ignore = ["E501"]\nignore = ["E501", "B008"]'), "Lint or type checks switched off in the configuration"],
    ["pyproject.toml", RUFF, RUFF.replace('["E501"]', '[\n    "E501",\n    "F841",  # unused\n]'), "Lint or type checks switched off in the configuration"],
    ["ruff.toml", 'select = ["E"]\nignore = ["E501"]\n', 'select = ["E"]\nignore = ["E501", "E741"]\n', "Lint or type checks switched off in the configuration"],
    ["pyproject.toml", RUFF, RUFF + '\n[tool.ruff.lint.per-file-ignores]\n"tests/*" = ["S101"]\n', "Lint or type checks switched off in the configuration"],
    ["pyproject.toml", RUFF, RUFF.replace('["E", "F", "B"]', '["E", "F"]'), "Lint rules removed from the selected set"],
    ["pyproject.toml", RUFF.replace('["E", "F", "B"]', '["ALL"]'), RUFF.replace('["E", "F", "B"]', '["E"]'), "Lint rules removed from the selected set"],
    ["setup.cfg", "[flake8]\nignore = E501\nmax-line-length = 88\n", "[flake8]\nignore = E501,F401\nmax-line-length = 88\n", "Lint or type checks switched off in the configuration"],
    ["tox.ini", "[flake8]\nextend-ignore =\n    E203\n", "[flake8]\nextend-ignore =\n    E203\n    W503\n", "Lint or type checks switched off in the configuration"],
    [".flake8", "[flake8]\nper-file-ignores =\n    tests/*: S101\n", "[flake8]\nper-file-ignores =\n    tests/*: S101\n    app/*: F401\n", "Lint or type checks switched off in the configuration"],
    ["pyproject.toml", '[tool.pylint."messages control"]\ndisable = ["C0114"]\n', '[tool.pylint."messages control"]\ndisable = ["C0114", "R0913"]\n', "Lint or type checks switched off in the configuration"],
    [".pylintrc", "[MESSAGES CONTROL]\ndisable=C0114,\n        C0115\n", "[MESSAGES CONTROL]\ndisable=C0114,\n        C0115,\n        C0116\n", "Lint or type checks switched off in the configuration"],
    ["pyproject.toml", MYPY_BASE(), MYPY_BASE().replace("strict = true", "strict = false"), "Type checker strictness switched off"],
    ["mypy.ini", "[mypy]\ndisallow_untyped_defs = True\n", "[mypy]\ndisallow_untyped_defs = False\n", "Type checker strictness switched off"],
    ["mypy.ini", "[mypy]\nstrict = True\n", "[mypy]\nstrict = True\n\n[mypy-app.*]\nignore_errors = True\n", "Type errors ignored for a module"],
    ["pyproject.toml", MYPY_BASE(), MYPY_BASE() + '\n[[tool.mypy.overrides]]\nmodule = "app.legacy"\nignore_errors = true\n', "Type errors ignored for a module"],
    ["pyproject.toml", MYPY_BASE(), MYPY_BASE() + 'disable_error_code = ["attr-defined"]\n', "Lint or type checks switched off in the configuration"],
    [".pylintrc", "[MASTER]\nfail-under=9.5\n", "[MASTER]\nfail-under=8\n", "Lint score threshold lowered"],
  ])("reports a change to %s", (file, before, after, reason) => {
    expect(verdict(file, before, after)).toEqual([reason]);
  });

  it.each([
    ["pyproject.toml", '[project]\nname = "x"\n', '[project]\nname = "x"\n\n' + RUFF],
    ["pyproject.toml", RUFF.replace('["E501"]', '["E501", "F401"]'), RUFF],
    ["pyproject.toml", RUFF, RUFF.replace('["E", "F", "B"]', '["E", "F", "B", "S"]')],
    ["pyproject.toml", RUFF.replace('["E", "F", "B"]', '["E501", "F401", "B"]'), RUFF],
    ["pyproject.toml", RUFF, RUFF.replace('["E501"]', '["E501"]  # long lines')],
    [".flake8", "[flake8]\nignore = E501,W503\n", "[flake8]\nignore = W503, E501\n"],
    ["pyproject.toml", MYPY_BASE(), MYPY_BASE().replace("strict = true", "strict = true\nwarn_unused_ignores = true")],
    ["pyproject.toml", MYPY_BASE(), MYPY_BASE() + '\n[[tool.mypy.overrides]]\nmodule = "tests.*"\ndisallow_untyped_defs = false\n'],
    ["pyproject.toml", MYPY_BASE().replace("true", "false"), MYPY_BASE()],
    [".pylintrc", "[MASTER]\nfail-under=7\n", "[MASTER]\nfail-under=9\n"],
    ["pyproject.toml", '[tool.black]\nline-length = 88\n[tool.isort]\nignore = ["x"]\n', '[tool.black]\nline-length = 88\n[tool.isort]\nignore = ["x", "y"]\n'],
    // The same ignores for files that moved, or an ignore for a code that is already off everywhere, switch nothing new off.
    ["pyproject.toml", RUFF + '\n[tool.ruff.lint.per-file-ignores]\n"tests/*" = ["S101"]\n', RUFF + '\n[tool.ruff.lint.per-file-ignores]\n"src/tests/*" = ["S101"]\n'],
    ["pyproject.toml", RUFF, RUFF + '\n[tool.ruff.lint.per-file-ignores]\n"tests/*" = ["E501"]\n'],
    ["pyproject.toml", RUFF.replace('["E501"]', '["E5"]'), RUFF.replace('["E501"]', '["E5", "E501"]')],
    ["setup.cfg", "[flake8]\nper-file-ignores =\n    requests/__init__.py: E402\n", "[flake8]\nper-file-ignores =\n    src/requests/__init__.py: E402\n"],
    ["README.md", "ignore = E501\n", "ignore = E501,F401\n"],
  ])("leaves a change to %s alone", (file, before, after) => {
    expect(verdict(file, before, after)).toEqual([]);
  });

  it("names the codes and the line", () => {
    const findings = analyzeGuardFile("pyproject.toml", RUFF, RUFF.replace('["E501"]', '["E501", "F401", "B008"]'), "HEAD");
    expect(findings).toHaveLength(1);
    expect(findings[0].lineSnippet).toBe("ruff ignore: +F401, +B008");
    expect(findings[0].lineNumber).toBe(3);
    expect(findings[0].type).toBe("guard-weakened");
  });
});

function MYPY_BASE() { return "[tool.mypy]\nstrict = true\n"; }
