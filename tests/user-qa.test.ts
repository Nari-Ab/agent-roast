import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { auditFileDiffs } from "../src/metrics.js";
import { initProject } from "../src/init.js";
import { checkProject } from "../src/check.js";

const scan = (text: string, file = "auth.test.ts") => auditFileDiffs([{ path: file,
  addedLines: text.split("\n").map((line, i) => ({ line, lineNumber: i + 1 })),
}]).infractions;
const dirs: string[] = [];
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const repo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roast-user-qa-")); dirs.push(dir);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env, stdio: "pipe" });
  return dir;
};

describe("independent user workflow regressions", () => {
  it("initializes effective policy and CI at the repository root from a nested directory", async () => {
    const dir = repo(); const nested = path.join(dir, "packages/app"); fs.mkdirSync(nested, { recursive: true });
    const result = await initProject({ cwd: nested, ci: true, hook: true });
    expect(result.created).toContain(".agentroastrc.json");
    expect(fs.existsSync(path.join(dir, ".github/workflows/agent-roast.yml"))).toBe(true);
    expect(fs.existsSync(path.join(nested, ".agentroastrc.json"))).toBe(false);
    expect(fs.existsSync(path.join(nested, ".github"))).toBe(false);
    fs.writeFileSync(path.join(dir, ".agentroastrc.json"), JSON.stringify({ rules: { "test-focus": "off" } }));
    fs.writeFileSync(path.join(nested, "auth.test.ts"), "test.only('auth', () => {});\n");
    expect((await checkProject({ cwd: nested })).exitCode).toBe(0);
    expect(fs.existsSync(path.join(dir, ".git/hooks/pre-commit"))).toBe(true);
  });
  it("preserves the existing root policy when initializing from a child", async () => {
    const dir = repo(); const nested = path.join(dir, "src"); fs.mkdirSync(nested);
    const policy = '{"rules":{"test-focus":"warn"}}\n'; fs.writeFileSync(path.join(dir, ".agentroastrc.json"), policy);
    expect((await initProject({ cwd: nested })).skipped).toContain(".agentroastrc.json");
    expect(fs.readFileSync(path.join(dir, ".agentroastrc.json"), "utf8")).toBe(policy);
    expect(fs.existsSync(path.join(nested, ".agentroastrc.json"))).toBe(false);
  });
  it("refuses a bare repository before creating ineffective configuration", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roast-user-qa-bare-")); dirs.push(dir);
    execFileSync("git", ["init", "--bare"], { cwd: dir, env, stdio: "pipe" });
    await expect(initProject({ cwd: dir, ci: true })).rejects.toThrow(/working repository root/);
    expect(fs.existsSync(path.join(dir, ".agentroastrc.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".github"))).toBe(false);
  });
  it.each([
    "const matcher = () => /test.only('example')/;",
    "throw /test.only('example')/;",
    "if (ready) /test.only('example')/.test(value);",
    "if (ready && check(input)) /test.only('example')/.test(value);",
    "while (ready) /test.only('example')/.test(value);",
    "const matcher = () =>\n /test.only('example')/;",
    "if (ready &&\n check(input))\n /test.only('example')/.test(value);",
  ])("does not block regular-expression literals: %s", text => {
    expect(scan(text)).toEqual([]);
  });
  it.each([
    "const ratio = total / count; test.only('real', () => {});",
    "const ratio = total++ / count; test.only('real', () => {});",
    "const ratio = measure(input) / count; test.only('real', () => {});",
    "const ratio = rules.if(input) / a / b; test.only('real', () => {});",
    "const ratio = rules . if(input) / a / b; test.only('real', () => {});",
    "if (ready) run(); test.only('real', () => {});",
    "const matcher = () => /test.only('example')/; test.only('real', () => {});",
  ])("retains actual focused tests alongside divisions or regexps: %s", text => {
    expect(scan(text)).toEqual([expect.objectContaining({ type: "test-focus", lineNumber: 1 })]);
  });
  it("keeps operand-vs-regexp context across consecutive lines", () => {
    expect(scan("const ratio = measure(input)\n / divisor;\ntest.only('real', () => {});")).toEqual([
      expect.objectContaining({ type: "test-focus", lineNumber: 3 }),
    ]);
    expect(scan("const matcher = () =>\n /test.only('example')/;\ntest.only('real', () => {});")).toEqual([
      expect.objectContaining({ type: "test-focus", lineNumber: 3 }),
    ]);
  });
  it.each([
    ["payment.ts", "try { save(); } catch\n (error)\n {\n // lost error\n }"],
    ["Payment.java", "try { save(); } catch (\n Exception error\n) {\n}"],
    ["Payment.kt", "try { save() } catch\n (error: Exception)\n {\n}"],
    ["payment.ts", "try { save(); } catch\n {\n}"],
  ])("finds an empty multiline catch in %s", (file, source) => {
    expect(scan(source, file)).toEqual([expect.objectContaining({ type: "swallowed-error", lineNumber: 1 })]);
  });
  it("does not label a multiline catch with handling as empty", () => {
    expect(scan("try { save(); } catch\n (error)\n {\n report(error);\n }", "payment.ts")).toEqual([]);
  });
  it("never joins catch syntax across missing diff context", () => {
    expect(auditFileDiffs([{ path: "payment.ts", addedLines: [
      { line: "try { save(); } catch (", lineNumber: 1 }, { line: "error) {}", lineNumber: 10 },
    ] }]).infractions).toEqual([]);
  });
  it("bounds scanning work for repeated unfinished catch headers", () => {
    const started = performance.now();
    expect(scan("catch (error\n".repeat(15_000), "payment.ts")).toEqual([]);
    // Worktrees can contain incomplete syntax. This is a regression ceiling,
    // not a production throughput claim.
    expect(performance.now() - started).toBeLessThan(5000);
  });
  it.each([
    "const payload = response as\n any;",
    "const payload = response as /* override */\n any;",
    "const payload = response as\n unknown as Result;",
    "const payload = response as\n never;",
  ])("retains type bypasses across ordinary formatting: %s", text => {
    expect(scan(text, "payment.ts")).toEqual([expect.objectContaining({ type: "type-escape", lineNumber: 1 })]);
  });
  it("does not apply TypeScript casts to JavaScript or join casts across hunk gaps", () => {
    expect(scan("const payload = response as\n any;", "payment.js")).toEqual([]);
    expect(auditFileDiffs([{ path: "payment.ts", addedLines: [
      { line: "const payload = response as", lineNumber: 1 }, { line: "any;", lineNumber: 10 },
    ] }]).infractions).toEqual([]);
  });
  it.each([
    "throw new Error(\n 'Not implemented'\n);",
    "throw new\n Error('Not implemented');",
    "throw new Error(`Not implemented`);",
    "throw new Error('TODO: implement payments');",
  ])("finds formatted placeholder errors: %s", text => {
    expect(scan(text, "payment.ts")).toEqual([expect.objectContaining({ type: "stub-abandonment", lineNumber: 1 })]);
  });
  it.each([
    "throw new Error('TODO item not found');",
    "const docs = `throw new Error('Not implemented');`;",
    "/*\nthrow new Error(\n 'Not implemented'\n);\n*/",
    "throw new Error('stubborn provider failed');",
  ])("keeps ordinary errors and documentation out of placeholder findings: %s", text => {
    expect(scan(text, "payment.ts")).toEqual([]);
  });
  it("does not join a placeholder error through a missing hunk", () => {
    expect(auditFileDiffs([{ path: "payment.ts", addedLines: [
      { line: "throw new Error(", lineNumber: 1 }, { line: "'Not implemented');", lineNumber: 10 },
    ] }]).infractions).toEqual([]);
  });
});
