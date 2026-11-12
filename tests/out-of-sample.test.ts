import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { analyzeTestFile, ciTestSteps, resolveCiTestSteps } from "../src/tampering.js";

// False alarms that turned up when 0.17.0 was replayed on 40 repositories no earlier measurement had used (docs/benchmarks.md, section 9).

const scan = (text: string, file: string) =>
  auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const review = (before: string, after: string, file: string) => analyzeTestFile(file, file, before, after, "HEAD").immediate.map(f => f.type);

describe("an exact check turned into toBeUndefined() is a flipped expectation", () => {
  const it1 = (assertion: string) => `it("colors", () => {\n  ${assertion}\n});\n`;

  it("leaves a value that was removed alone", () => {
    expect(review(it1('expect(config.color).toBe("#4dc4e6");'), it1("expect(config.color).toBeUndefined();"), "a.test.ts")).toEqual([]);
    expect(review(it1("expect(registry.has(name)).toBe(false);"), it1("expect(registry.get(name)).toBeUndefined();"), "a.test.ts")).toEqual([]);
  });

  it("still reads the forms that accept many values, and 'something is there'", () => {
    expect(review(it1('expect(config.color).toBe("#4dc4e6");'), it1("expect(config.color).toBeTruthy();"), "a.test.ts")).toEqual(["assertion-weakened"]);
    expect(review(it1('expect(config.color).toBe("#4dc4e6");'), it1("expect(config.color).not.toBeUndefined();"), "a.test.ts")).toEqual(["assertion-weakened"]);
  });
});

describe("a helper called fit() inside an expression is not a focused test", () => {
  it.each([
    'expect(fit({ x: 100, y: 100 })).toEqual({ left: 100 });\n',
    'expect(await fit("okapi")).toBe(true);\n',
    'const placed = fit(point, size);\n',
    'return fit("x", 1);\n',
  ])("leaves %j alone", (text) => {
    expect(scan(`it("places", async () => {\n  ${text}});\n`, "a.test.ts").map(f => f.type)).toEqual([]);
  });

  it("still reports a registration after a statement with or without a semicolon", () => {
    expect(scan("describe('x', () => {\n  fit('y', () => {});\n});\n", "a.test.ts").map(f => f.type)).toEqual(["test-focus"]);
    expect(scan("beforeEach(() => setup())\nfit('y', () => {})\n", "a.test.ts").map(f => f.type)).toEqual(["test-focus"]);
  });
});

describe("a bound that rejects the value the old check pinned is another expectation", () => {
  const js = (assertion: string) => `it("counts", () => {\n  ${assertion}\n});\n`;
  const py = (assertion: string) => `def test_counts(self):\n    ${assertion}\n`;

  it.each([
    [js("expect(attempts).toBe(2);"), js("expect(attempts).toBeGreaterThanOrEqual(3);")],
    [js("expect(attempts).toBe(1);"), js("expect(attempts).toBeGreaterThan(1);")],
    [js("expect(attempts).toBe(5);"), js("expect(attempts).toBeLessThan(5);")],
    [js("assert.equal(rows.length, 3);"), js("assert.ok(rows.length > 3);")],
    [py("assert generation == before"), py("assert generation > before")],
    [py("assert index_count == 12"), py("assert index_count > 12")],
    [py("self.assertEqual(count, 16)"), py("self.assertLess(count, 8)")],
  ])("leaves %j turned into %j alone", (before, after) => {
    expect(review(before, after, before.includes("def ") ? "test_a.py" : "a.test.ts")).toEqual([]);
  });

  it.each([
    [js("expect(attempts).toBe(2);"), js("expect(attempts).toBeGreaterThanOrEqual(2);")],
    [js("expect(attempts).toBe(2);"), js("expect(attempts).toBeGreaterThan(1);")],
    [py("assert index_count == 12"), py("assert index_count >= 12")],
    [py("assert index_count == 12"), py("assert index_count > 8")],
    [py("self.assertEqual(count, 16)"), py("self.assertGreater(count, 8)")],
  ])("still reads %j turned into %j", (before, after) => {
    expect(review(before, after, before.includes("def ") ? "test_a.py" : "a.test.ts")).toEqual(["assertion-weakened"]);
  });
});

describe("brackets around the message of a Python assertion are a formatter's choice", () => {
  const py = (assertion: string) => `def test_a():\n    ${assertion}\n`;

  it("does not read them as a change of the check", () => {
    expect(review(py('assert (len(out["messages"]) > 0), "Tool output is empty"'), py('assert len(out["messages"]) > 0, ("Tool output is empty")'), "test_a.py")).toEqual([]);
    expect(review(py('assert len(x) > 0, "empty"'), py('assert len(x) > 0, (\n        "empty"\n    )'), "test_a.py")).toEqual([]);
  });
});

describe("a method that happens to be called fit or xit is not a test registration", () => {
  it.each([
    "class FitAddon {\n  fit() {}\n}\n",
    "const addon = {\n  fit() {},\n  dispose() {},\n};\n",
    "class Terminal {\n  xit() {\n    return 1;\n  }\n}\n",
  ])("leaves %j alone", (text) => {
    expect(scan(text, "terminal.test.ts").map(f => f.type)).toEqual([]);
  });

  it("still reports the focused and the disabled registrations", () => {
    expect(scan("fit('works', () => {});\n", "a.test.ts").map(f => f.type)).toEqual(["test-focus"]);
    expect(scan("fdescribe('suite', () => {});\n", "a.test.ts").map(f => f.type)).toEqual(["test-focus"]);
    expect(scan("xit('works', () => {});\n", "a.test.ts").map(f => f.type)).toEqual(["test-skip"]);
  });
});

describe("a mock factory that is handed the real module keeps it, whatever the parameter is called", () => {
  const body = (mock: string) => `import { price } from "./price";\n${mock}\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n`;
  const base = 'import { price } from "./price";\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n';

  it.each([
    'vi.mock("./price", async (original) => ({ ...(await original()), price: () => 42 }));',
    'vi.mock("./price", async function (orig) { return { ...(await orig()), price: () => 42 }; });',
    'vi.mock("./price", async (importOriginal) => ({ ...(await importOriginal()), price: () => 42 }));',
    'vi.mock("./price", async (original) => ({ ...(await original<typeof import("./price")>()), price: () => 42 }));',
  ])("leaves %s alone", (mock) => {
    expect(review(base, body(mock), "price.test.ts")).toEqual([]);
  });

  it("still reports a factory that replaces the module wholesale", () => {
    expect(review(base, body('vi.mock("./price", () => ({ price: () => 42 }));'), "price.test.ts")).toEqual(["trivial-assert"]);
    // A parameter that is never called does not bring the real module in.
    expect(review(base, body('vi.mock("./price", async (original) => ({ price: () => 42 }));'), "price.test.ts")).toEqual(["trivial-assert"]);
  });
});

describe("Python assertions that only changed their brackets or index a table", () => {
  const test = (...lines: string[]) => `def test_a():\n${lines.map(line => `    ${line}`).join("\n")}\n`;

  it("does not read the brackets around a whole assertion as a change", () => {
    expect(review(test("assert (scaled[0, COL] == 3.0)"), test("assert scaled[0, COL] == 3.0"), "test_a.py")).toEqual([]);
    expect(review(test("assert (", "    matrix[1, COL] == 0", ")"), test("assert matrix[1, COL] == 0.0"), "test_a.py")).toEqual([]);
    expect(review(test('assert (x == 1), "message"'), test('assert x == 1, "message"'), "test_a.py")).toEqual([]);
  });

  it("does not take x[0, 1] == 3 for a bare name followed by a message", () => {
    expect(review(test("assert matrix[0, 1] == 3.0, 'rate'"), test("assert matrix[0, 1] == 3.5, 'rate'"), "test_a.py")).toEqual([]);
  });

  it("still reads an exact check turned into a bare subscript as a weaker one", () => {
    expect(review(test("assert matrix[0, 1] == 3.0"), test("assert matrix[0, 1]"), "test_a.py")).toEqual(["assertion-weakened"]);
  });
});

describe("a negative check with an argument is not the weak form of a throw", () => {
  const it1 = (assertion: string) => `it("rejects", async () => {\n  ${assertion}\n});\n`;

  it("leaves rejects.toThrow(/a/) turned into rejects.not.toThrow(/b/) alone", () => {
    expect(review(it1("await expect(run()).rejects.toThrow(/GOOGLE_CLIENT_ID/);"), it1("await expect(run()).rejects.not.toThrow(/redirect/);"), "a.test.ts")).toEqual([]);
  });

  it("still reads toThrow(/a/) turned into not.toThrow() as a weaker check", () => {
    expect(review(it1("expect(() => run()).toThrow(/bad input/);"), it1("expect(() => run()).not.toThrow();"), "a.test.ts")).toEqual(["assertion-weakened"]);
  });
});

describe("a threshold that moves against another expression, or a membership test, is another check", () => {
  const js = (assertion: string) => `it("grows", () => {\n  ${assertion}\n});\n`;
  const py = (assertion: string) => `def test_grows():\n    ${assertion}\n`;

  it("leaves a bound against a variable turned into a bound against zero alone", () => {
    expect(review(js("expect(after.height).toBeGreaterThan(before.height);"), js("expect(growth).toBeGreaterThan(0);"), "a.test.ts")).toEqual([]);
    expect(review(py("assert after > before"), py("assert growth > 0"), "test_a.py")).toEqual([]);
  });

  it("leaves a membership test turned into a positive number alone", () => {
    expect(review(py('assert "clamped" in result["reasons"]'), py('assert result["after"] > 0'), "test_a.py")).toEqual([]);
  });

  it("still reads a numeric limit that was lowered to zero, and an exact count turned into 'not empty'", () => {
    expect(review(js("expect(items.length).toBeGreaterThan(5);"), js("expect(items.length).toBeGreaterThan(0);"), "a.test.ts")).toEqual(["assertion-weakened"]);
    expect(review(py("assert len(rows) == 3"), py("assert len(rows) > 0"), "test_a.py")).toEqual(["assertion-weakened"]);
  });
});

describe("a compound Python assertion is not one comparison", () => {
  const py = (assertion: string) => `def test_encoding():\n    ${assertion}\n`;

  it("does not read the subset test of the second half as a bound on the first", () => {
    expect(review(py('assert schema.ID == "st4" and "st3" in schema.LEGACY'), py('assert schema.ID != "st3" and {"st3", "st4"} <= set(schema.LEGACY)'), "test_a.py")).toEqual([]);
  });

  it("still reads a plain equality turned into a subset test", () => {
    expect(review(py("assert set(a) == set(b)"), py("assert set(a) <= set(b)"), "test_a.py")).toEqual(["assertion-weakened"]);
  });
});

describe("quotes and brackets inside a regular expression literal are not code", () => {
  // The apostrophe in the pattern used to open a string that ran into the next line's quotes, so the lines after a multi-line assertion
  // were read as part of it and compared with whatever stood there before.
  const test = (rest: string) => `it("checks", () => {\n  expect(step).not.toMatch(\n    /'\\.github\\/shared\\(\\s*x/,\n  );\n${rest}});\n`;

  it("keeps the assertions after a multi-line one as assertions of their own", () => {
    const before = test("  expect(lock).toContain('name: Checkout');\n");
    const after = test("  expect(lock).toContain('name: Checkout');\n  expect(extra).toBeUndefined();\n");
    expect(review(before, after, "a.test.ts")).toEqual([]);
  });

  it("still reads a check turned into toBeTruthy() in the same place", () => {
    const before = test("  expect(lock).toContain('name: Checkout');\n");
    const after = test("  expect(lock).toBeTruthy();\n");
    expect(review(before, after, "a.test.ts")).toEqual(["assertion-weakened"]);
  });
});

describe("a monorepo runner counts as a test step", () => {
  const WORKFLOW = (step: string) => `on:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${step}\n`;

  it.each([
    "yarn nx affected --target=test --parallel",
    "pnpm nx run-many -t test",
    "npx turbo run test",
    "npx lerna run test",
    "bazel test //...",
  ])("sees %s as the tests moving to another workflow", (command) => {
    const counts = [ciTestSteps(".github/workflows/check-pr.yml", WORKFLOW("yarn test"), null)!, ciTestSteps(".github/workflows/ci.yml", null, WORKFLOW(command))!];
    expect(resolveCiTestSteps(counts, "HEAD")).toEqual([]);
  });

  it("still reports a workflow whose tests were replaced by a build", () => {
    const counts = [ciTestSteps(".github/workflows/check-pr.yml", WORKFLOW("yarn test"), null)!, ciTestSteps(".github/workflows/ci.yml", null, WORKFLOW("yarn nx affected --target=build"))!];
    expect(resolveCiTestSteps(counts, "HEAD").map(f => f.type)).toEqual(["guard-weakened"]);
  });
});

describe("test.skip(true, reason), test.fail(cond, reason) and test.fixme() inside a test belong to that test", () => {
  const suite = (body: string) => `import { test } from "@playwright/test";\n${body}`;
  const old = suite('test("lists albums", async ({ page }) => {\n  await page.goto("/");\n});\n');

  it("drops the marker of a test the change adds", () => {
    const after = old + 'test("opens an empty album", async ({ page }) => {\n  test.fail(true, "Not implemented yet #1312");\n  await page.goto("/x");\n});\n';
    expect(analyzeTestFile("a.spec.ts", "a.spec.ts", old, after, "HEAD").immediate.map(f => f.type)).toEqual([]);
  });

  it("keeps the marker put on a test that was there", () => {
    const after = suite('test("lists albums", async ({ page }) => {\n  test.fail(true, "Not implemented yet #1312");\n  await page.goto("/");\n});\n');
    expect(auditFileDiffs([{ path: "a.spec.ts", addedLines: after.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions.map(f => f.type)).toEqual(["test-skip"]);
    expect(analyzeTestFile("a.spec.ts", "a.spec.ts", old, after, "HEAD").immediate).toEqual([]);
  });
});
