import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { SourceMasker } from "../src/source.js";

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

describe("language boundaries and literal regressions", () => {
  it.each([
    ["auth.py", "import typing as any\nimport never as never"],
    ["auth.rs", "use value as any;\nfn recatch() {}"],
    ["auth.go", "func recatch() {}"],
    ["auth.ts", "function recatch() {}\nconst myexcept = 1;\nconst handler = { catch() {} };"],
    ["auth.py", "myexcept: pass\nmycatch()"],
  ])("does not apply another language's syntax in %s", (file, text) => {
    expect(scan(text, file)).toEqual([]);
  });
  it("keeps Python floor division in code and reads a qualified type suppression", () => {
    expect(scan("result = value // divisor # type: ignore[assignment]", "auth.py")).toEqual([
      expect.objectContaining({ type: "type-escape", lineNumber: 1 }),
    ]);
  });
  it("does not treat pass followed by real handling as an empty Python handler", () => {
    expect(scan("try:\n  save()\nexcept Exception: pass; report(error)", "auth.py")).toEqual([]);
    expect(scan("try:\n  save()\nexcept Exception:\n  pass\n  report(error)", "auth.py")).toEqual([]);
    expect(scan("try:\n  save()\nexcept Exception: pass; # intentionally discarded", "auth.py")).toEqual([
      expect.objectContaining({ type: "swallowed-error", lineNumber: 3 }),
    ]);
  });
  it("handles exception groups without matching identifiers ending in except", () => {
    expect(scan("try:\n  save()\nexcept* ValueError:\n  pass", "auth.py")).toEqual([
      expect.objectContaining({ type: "swallowed-error", lineNumber: 3 }),
    ]);
  });
  it("finds the empty catch after another handled catch on the same line", () => {
    expect(scan("try { save(); } catch (first) { report(first); } try { other(); } catch {}" )).toEqual([
      expect.objectContaining({ type: "swallowed-error", lineNumber: 1 }),
    ]);
  });
  it("does not mistake escaped-newline string examples for test registrations", () => {
    expect(scan('const example = "continued\\\nit.skip(\'example\')";')).toEqual([]);
    expect(scan('const example = "continued\\\ntest.only(\'example\')";')).toEqual([]);
  });
  it("masks Rust raw strings, nested comments and lifetimes independently", () => {
    const text = 'const DOC: &str = r###"\nfn recatch() {}\ntodo!("example")\n"###;\n/* outside /* inside */ todo!("still comment") */\nfn save<\'a>(input: &\'a str) { todo!("implement"); }';
    expect(scan(text, "auth.rs")).toEqual([
      expect.objectContaining({ type: "stub-abandonment", lineNumber: 6 }),
    ]);
  });
  it.each([
    ["auth.java", 'String docs = """\ncatch (error) {}\n""";\ntry { save(); } catch (Error error) {}'],
    ["auth.kt", 'val docs = """\ncatch (error) {}\n""";\ntry { save() } catch (error: Error) {}'],
    ["auth.cs", 'var docs = @"\ncatch (error) {}\n";\ntry { Save(); } catch (Exception error) {}'],
    ["auth.cpp", 'auto docs = R"tag(\ncatch (error) {}\n)tag";\ntry { save(); } catch (Error error) {}'],
  ])("masks multiline examples while retaining a real catch in %s", (file, text) => {
    expect(scan(text, file)).toEqual([expect.objectContaining({ type: "swallowed-error", lineNumber: 4 })]);
  });
  it("recognizes source extension case consistently", () => {
    expect(scan('"""\nraise NotImplementedError\n"""', "auth.PY")).toEqual([]);
    expect(scan('raise NotImplementedError', "auth.PY")).toEqual([expect.objectContaining({ type: "stub-abandonment" })]);
  });
  it("recognizes block eslint directives without activating directive examples in comments", () => {
    expect(scan("/* eslint-disable no-explicit-any */\nconst okay = 1;")).toEqual([
      expect.objectContaining({ type: "type-escape", lineNumber: 1 }),
    ]);
    expect(scan("/*\n// @ts-ignore\n/* eslint-disable */\n")).toEqual([]);
    expect(scan('const docs = "/* eslint-disable */";')).toEqual([]);
  });
  it("does not stop at a stub example before a real stub on the same line", () => {
    expect(scan('const docs = \'throw new Error("Not implemented")\'; throw new Error("Not implemented");')).toEqual([
      expect.objectContaining({ type: "stub-abandonment", lineNumber: 1 }),
    ]);
  });
  it.each(['throw new Error("stubborn failure");', 'throw new Error("Not implementedation");'])
    ("does not classify a word beginning with a placeholder as an unfinished stub: %s", text => {
      expect(scan(text)).toEqual([]);
    });
  it("detects unconditional unittest skips without claiming conditional marks always skip", () => {
    expect(scan('@unittest.skip("reason")\ndef test_save(): pass\nself.skipTest("reason")', "test_save.py").map(f => f.type)).toEqual(["test-skip", "test-skip"]);
    expect(scan('@pytest.mark.skipif(condition, reason="reason")\ndef test_save(): pass', "test_save.py")).toEqual([]);
  });
  it("detects formatted Rust placeholder macros", () => {
    expect(scan('fn save() { todo!("save {}", id); }\nfn load() { unimplemented!("load"); }', "auth.rs").map(f => f.type)).toEqual(["stub-abandonment", "stub-abandonment"]);
  });
  it("finds trivial JS assertions split by whitespace or lines, without joining hunk gaps", () => {
    expect(scan("expect(\ntrue\n) . toBe (true);", "auth.test.ts")).toEqual([
      expect.objectContaining({ type: "trivial-assert", lineNumber: 1 }),
    ]);
    expect(auditFileDiffs([{ path: "auth.test.ts", addedLines: [
      { line: "expect(", lineNumber: 1 }, { line: "true).toBe(true);", lineNumber: 20 },
    ] }]).infractions).toEqual([]);
    expect(scan("expect(result) . toBe (true);", "auth.test.ts")).toEqual([]);
  });
});


describe("bounded lexer work", () => {
  it("handles a large arithmetic line without rescanning its growing prefix", () => {
    const line = "const result = " + "a / b + ".repeat(125_000) + "1;";
    const started = performance.now();
    const masked = new SourceMasker("arithmetic.ts").mask(line, 1);
    expect(masked.code).toBe(line);
    // A deliberately generous regression ceiling, not a production speed claim.
    expect(performance.now() - started).toBeLessThan(5000);
  });
  it("retains regexp context across long whitespace and keeps source offsets", () => {
    const line = "return" + " ".repeat(100_000) + "/it.skip(example)/;";
    const masked = new SourceMasker("auth.ts").mask(line, 1);
    expect(masked.code.length).toBe(line.length);
    expect(masked.code.trim()).toBe("return" + " ".repeat(100_000) + " ".repeat("/it.skip(example)/".length) + ";");
    expect(scan(line)).toEqual([]);
  });
});
