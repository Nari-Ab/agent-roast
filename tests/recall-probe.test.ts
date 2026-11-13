import { describe, expect, it } from "vitest";
import { assertsAlwaysTrue, auditFileDiffs } from "../src/metrics.js";
import { newTestMarkers } from "../src/tampering.js";

// Two shapes that a probe of the documented gaps found to be real and precise: the newest 300 commits of 505 repositories (126,486 commits) were searched for what the rules do not see
// (docs/benchmarks.md, section 13). Most shapes were too common in ordinary code to report; these two were not.

const scan = (text: string, file: string) =>
  auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const types = (text: string, file: string) => scan(text, file).map(found => [found.type, found.lineNumber]);
const markers = (before: string, after: string, file: string) => newTestMarkers(scan(before, file), scan(after, file), before, after).map(found => found.type);

describe("an assertion with `or True` among its operands cannot fail", () => {
  const file = "tests/test_cart.py";

  it("is a trivial assertion, with a message, a comment or the unittest form", () => {
    expect(types("def test_a():\n    assert len(new_snapshots) > initial_count or True  # TDD placeholder", file)).toEqual([["trivial-assert", 2]]);
    expect(types('def test_a():\n    assert "source" in latest.summary or True, "summary"', file)).toEqual([["trivial-assert", 2]]);
    expect(types("def test_a():\n    assert not seg or True or other", file)).toEqual([["trivial-assert", 2]]);
    expect(types("class T:\n    def test_a(self):\n        self.assertTrue(run() == run() or True)", file)).toEqual([["trivial-assert", 3]]);
  });

  it("is not read from a callback or a call that ends in `or True`, a string, or an ordinary `or`", () => {
    expect(types("def test_a():\n    assert coordinator.request([asset], lambda paths: seen.append(paths) or True, load_error=error)", file)).toEqual([]);
    expect(types("def test_a():\n    assert identity(1 if (flag := False) or True else 3) == 1", file)).toEqual([]);
    expect(types('def test_a():\n    assert x, "it fails or True"', file)).toEqual([]);
    expect(types("def test_a():\n    assert a == 1 or b == 2", file)).toEqual([]);
    expect(types("def test_a():\n    assert flags or default_flags", file)).toEqual([]);
  });

  it("is read in test files only", () => {
    expect(types("def check(x):\n    assert x or True", "src/app.py")).toEqual([]);
  });

  it("reads only what is outside every bracket", () => {
    expect(assertsAlwaysTrue("assert x == 1 or True")).toBe(true);
    expect(assertsAlwaysTrue("assert x == 1 or 1")).toBe(true);
    expect(assertsAlwaysTrue("self.assertTrue(x(y) or True, msg)")).toBe(true);
    expect(assertsAlwaysTrue("assert any(x is None or True for x in rows)")).toBe(false);
    expect(assertsAlwaysTrue("assert call(lambda p: p or True)")).toBe(false);
    expect(assertsAlwaysTrue("assert x or Trueish")).toBe(false);
    expect(assertsAlwaysTrue("value = x or True")).toBe(false);
  });
});

describe("a skip whose condition is the constant True switches the test off wherever it runs", () => {
  const file = "tests/test_cart.py";
  const test = "def test_a():\n    assert run() == 1\n";

  it("is reported on a test that was running, as a decorator of pytest or unittest", () => {
    expect(markers(test, `@pytest.mark.skipif(True, reason="precondition vanished")\n${test}`, file)).toEqual(["test-skip"]);
    expect(markers(test, `@unittest.skipIf(True, "FIXME: web3.auto.infura was removed")\n${test}`, file)).toEqual(["test-skip"]);
    expect(markers(test, `@skipIf(True, "none")\n${test}`, file)).toEqual(["test-skip"]);
  });

  it("is reported as a mark of a parametrized case and for a whole module", () => {
    expect(types('CASES = [pytest.param(1, 2, marks=pytest.mark.skipif(True, reason="rounding"))]', file)).toEqual([["test-skip", 1]]);
    expect(types('pytestmark = pytest.mark.skipif(True, reason="not opted in")', file)).toEqual([["test-skip", 1]]);
  });

  it("is left alone on a test the change adds, and when the condition is about the environment", () => {
    expect(markers("def test_other():\n    pass\n", `@pytest.mark.skipif(True, reason="needs a device")\n${test}`, file)).toEqual([]);
    expect(types('@pytest.mark.skipif(sys.platform == "win32", reason="paths")\ndef test_a(): pass', file)).toEqual([]);
    expect(types('@pytest.mark.skipif(not HAS_GPU, reason="no GPU")\ndef test_a(): pass', file)).toEqual([]);
    expect(types('@unittest.skipIf(Trueish, "x")\ndef test_a(self): pass', file)).toEqual([]);
  });
});
