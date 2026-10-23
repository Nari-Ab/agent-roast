import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";

const scan = (text: string, filename = "src/auth.ts") => auditFileDiffs([{ path: filename, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;

describe("source-aware shortcut detection", () => {
  it("ignores multi-line JS comments and retains real suppression comments", () => {
    const findings = scan(`/*
it.skip("example")
const x = data as any;
// @ts-ignore
*/
// @ts-ignore
const x = data as any;`);
    expect(findings.map(f => [f.type, f.lineNumber])).toEqual([["type-escape", 6], ["type-escape", 7]]);
  });
  it("ignores Python docstrings and comments while retaining type suppressions", () => {
    const findings = scan(`"""
pytest.skip("documentation")
raise NotImplementedError
"""
x = 1 # pytest.skip("example")
import foo # noqa
x = unknown # type: ignore`, "src/auth.py");
    expect(findings.map(f => [f.type, f.lineNumber])).toEqual([["type-escape", 6], ["type-escape", 7]]);
  });
  it("ignores template string examples and regex character classes", () => {
    expect(scan("const text = `\nit.skip('example')\n`;\nconst regex = /[/]it.skip[\\/]/;")).toEqual([]);
  });
  it("detects multi-line empty catch including comment-only bodies", () => {
    const findings = scan(`try { save(); } catch (error) {
  // No handling here
}
try { save(); } catch {
}`);
    expect(findings.map(f => [f.type, f.lineNumber])).toEqual([["swallowed-error", 1], ["swallowed-error", 4]]);
    expect(findings[0].suggestion).toContain("rethrow");
  });
  it("does not call a catch with a real handler empty", () => {
    expect(scan(`try { save(); } catch (error) {
  report(error);
}`)).toEqual([]);
  });
  it("detects multi-line Python except/pass without swallowing a real handler", () => {
    const findings = scan(`try:
    save()
except Exception:
    # deliberately empty
    pass
next_step()
try:
    save()
except Exception:
    pass
    report()
`, "src/auth.py");
    expect(findings.map(f => [f.type, f.lineNumber])).toEqual([["swallowed-error", 3]]);
  });
  it("does not join unrelated diff hunks into a fake empty handler", () => {
    const result = auditFileDiffs([{ path: "auth.ts", addedLines: [{ line: "catch (err) {", lineNumber: 1 }, { line: "}", lineNumber: 10 }] }]);
    expect(result.infractions).toEqual([]);
  });
  it("does not carry comment state across a gap into a new hunk", () => {
    const result = auditFileDiffs([{ path: "auth.ts", addedLines: [{ line: "/*", lineNumber: 1 }, { line: "it.skip('auth');", lineNumber: 10 }] }]);
    expect(result.infractions[0].type).toBe("test-skip");
  });
  it("ignores Ruby comments and Go raw string examples", () => {
    expect(scan("# it.skip('comment')", "auth.rb")).toEqual([]);
    expect(scan("text := `\nit.skip('example')\n`", "auth.go")).toEqual([]);
  });
  it("handles long unmatched literal delimiters without catastrophic regex scanning", () => {
    expect(scan('const example = "' + "a".repeat(100_000))).toEqual([]);
  });
});
