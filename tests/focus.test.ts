import { describe, expect, it } from "vitest";
import { auditFileDiffs, MetricsCollector } from "../src/metrics.js";
import { configFromText } from "../src/config.js";
import { formatTerminalCard } from "../src/renderer.js";

const scan = (text: string, file = "auth.test.ts") => auditFileDiffs([{ path: file,
  addedLines: text.split("\n").map((line, i) => ({ line, lineNumber: i + 1 })),
}]).infractions;

describe("exclusive tests that narrow a successful run", () => {
  it.each([
    "test.only('auth', () => {});", "it.only('auth', () => {});", "describe.only('auth', () => {});",
    "suite.only('auth', () => {});", "test.describe.only('auth', () => {});",
    "test.describe.serial.only('auth', () => {});", "test.concurrent.only.each([1])('auth', () => {});",
    "test.only.failing('auth', () => {});", "fit('auth', () => {});", "fdescribe.each([1])('auth', () => {});",
    "test /* explain */ . only ('auth', () => {});", "test\n  .only('auth', () => {});",
    "test\n// debugging\n .describe\n .only('auth', () => {});",
  ])("finds %s", text => {
    expect(scan(text)).toEqual([expect.objectContaining({ type: "test-focus", lineNumber: 1, suggestion: expect.stringContaining("full suite") })]);
  });
  it.each([
    "const example = `test.only('example');`;", "/*\ntest.only('example');\n*/",
    "// test.only('example');", "const regex = /test.only/;", "test('auth', () => {});",
    "const filter = records.only('active');", "credit.only();", "mytest.only();",
    "client.test.only();", "client . test.only();", "const only = test.only;",
    "const only = { only: true };", "function fit(value) { return value; }",
    "test.onlyIf(condition)('auth', () => {});",
  ])("does not mistake examples or unrelated calls for focused tests: %s", text => {
    expect(scan(text)).toEqual([]);
  });
  it("restricts focus syntax to JS-family sources and global aliases to test paths", () => {
    expect(scan("fit(value)", "src/math.ts")).toEqual([]);
    expect(scan("test.only()", "src/model.py")).toEqual([]);
    expect(scan("test.only()", "src/model.rs")).toEqual([]);
    expect(scan("test.only('auth', () => {});", "src/auth.mts")).toHaveLength(1);
  });
  it("does not fabricate member chains across diff gaps", () => {
    expect(auditFileDiffs([{ path: "auth.test.ts", addedLines: [
      { line: "test", lineNumber: 1 }, { line: ".only('auth', () => {});", lineNumber: 20 },
    ] }]).infractions).toEqual([]);
  });
  it("tracks individual calls on one line", () => {
    expect(scan("it.only('a', () => {}); test.only('b', () => {});")).toHaveLength(2);
  });
  it("supports rule off, advisory and default blocking policy", () => {
    expect(configFromText("{}", "test").failOn).toContain("test-focus");
    expect(configFromText('{"rules":{"test-focus":"warn"}}', "test").failOn).not.toContain("test-focus");
    expect(auditFileDiffs([{ path: "auth.test.ts", addedLines: [{ line: "test.only('a', () => {});", lineNumber: 1 }] }], "HEAD", "", { rules: { "test-focus": "off" } }).infractions).toEqual([]);
  });
  it("includes exclusive tests in historical findings and terminal output", () => {
    const collector = new MetricsCollector({ all: true });
    collector.processCommit({ hash: "1234567", date: "2026-10-28T00:00:00Z", authorName: "Dev", authorEmail: "dev@example.invalid",
      message: "tests", isAiAttributed: false, aiSignatures: [], totalAddedCount: 1,
      files: [{ path: "auth.test.ts", addedLines: [{ line: "test.only('a', () => {});", lineNumber: 1 }] }],
    });
    const summary = collector.getSummary();
    expect(summary.focusedTests).toHaveLength(1);
    expect(formatTerminalCard(summary, { repoName: "sample", verbose: true })).toContain("test-focus");
  });
});

describe("source-context skipped and focused registrations", () => {
  it.each([
    "test . skip('auth', () => {});", "test.concurrent.skip('auth', () => {});",
    "test\n .describe\n .skip('auth', () => {});", "suite.skip('auth', () => {});",
    "test.skip.each([1])('auth', () => {});", "test.skip.each`a | b\n1 | 2`('auth', () => {});",
    "xdescribe('auth', () => {});", "xit ('auth', () => {});", "test.todo ('auth');",
  ])("finds the skipped registration %s", text => {
    expect(scan(text)).toEqual([expect.objectContaining({ type: "test-skip", lineNumber: 1 })]);
  });
  it.each([
    "const skipped = test.skip;", "const focused = test.only;", "const selected = test.only.each;",
    "const skipped = test.skip.each;", "client . test.skip('ordinary API');",
    "const docs = `test.skip('example');`;", "/* test\n.skip('example'); */",
    "test.skipIf(condition)('conditional', () => {});", "function xit(value) { return value; }",
  ])("does not register a test merely by referencing it: %s", text => expect(scan(text)).toEqual([]));
  it.each([
    "test.only.each`a | b\n1 | 2`('auth', () => {});",
    "fit.each`a | b\n1 | 2`('auth', () => {});",
    "test.sequential.only('auth', () => {});",
  ])("retains exclusive tagged-table and modifier support: %s", text => {
    expect(scan(text)).toEqual([expect.objectContaining({ type: "test-focus" })]);
  });
  it("does not infer a tagged call from a reference followed by a comment", () => {
    expect(scan("const focused = test.only.each; /* `documentation` */")).toEqual([]);
  });
  it("keeps skipped calls on the following line separate from a literal example", () => {
    expect(scan("const docs = `test.skip('example');`;\ntest.skip('real', () => {});")).toEqual([
      expect.objectContaining({ type: "test-skip", lineNumber: 2 }),
    ]);
  });
  it("does not join skipped chains across missing diff context", () => {
    expect(auditFileDiffs([{ path: "auth.test.ts", addedLines: [
      { line: "test", lineNumber: 1 }, { line: ".skip('auth', () => {});", lineNumber: 20 },
    ] }]).infractions).toEqual([]);
  });
});
