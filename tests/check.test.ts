import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { checkProject } from "../src/check.js";
import { writeBaseline } from "../src/baseline.js";

let dir: string;
const cli = path.resolve("dist/cli.js");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" });
const run = (...args: string[]) => spawnSync(process.execPath, [cli, "check", dir, ...args], { env, encoding: "utf8" });
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-current-"));
  git("init", "-b", "main"); git("config", "user.name", "Tester"); git("config", "user.email", "test@example.invalid"); git("config", "commit.gpgsign", "false");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("current-tree check", () => {
  it("finds real current bugs without a commit history or AI attribution", async () => {
    write("auth.test.ts", "it.skip('auth', () => {});\n");
    const result = await checkProject({ cwd: dir });
    expect(result.complete).toBe(true); expect(result.exitCode).toBe(1);
    expect(result.infractions[0].file).toBe("auth.test.ts");
    expect(result.output).toContain("Re-enable the test");
    expect(result.output).not.toContain("SCORE");
  });
  it("reads unstaged working content instead of the index", async () => {
    write("auth.test.ts", "it.skip('auth', () => {});\n"); git("add", ".");
    write("auth.test.ts", "it('auth', () => {});\n");
    expect((await checkProject({ cwd: dir })).infractions).toEqual([]);
    expect(git("diff", "--cached")).toContain("it.skip");
  });
  it("respects .gitignore, default generated paths and custom config ignores", async () => {
    write(".gitignore", "secret/\n");
    for (const file of ["secret/a.ts", "dist/a.ts", "vendor/a.ts", "src/generated/a.ts", "fixtures/a.ts"]) write(file, "it.skip('bad');\n");
    write(".agentroastrc.json", JSON.stringify({ ignorePaths: ["**/generated/**"] }));
    write("src/auth.ts", "export const auth = true;\n");
    const result = await checkProject({ cwd: dir });
    expect(result.filesInspected).toBe(1); expect(result.infractions).toEqual([]);
  });
  it("handles filenames containing spaces and newlines using Git's NUL-delimited list", async () => {
    write("odd name\n.test.ts", "it.skip('auth');\n");
    const result = await checkProject({ cwd: dir });
    expect(result.infractions[0].file).toBe("odd name\n.test.ts");
  });
  it("does not fail on tracked files intentionally deleted in the worktree", async () => {
    write("auth.ts", "const x = thing as any;"); git("add", "."); fs.unlinkSync(path.join(dir, "auth.ts"));
    const result = await checkProject({ cwd: dir }); expect(result.complete).toBe(true); expect(result.infractions).toEqual([]);
  });
  it("loads policy from repository root when invoked from a subdirectory", async () => {
    write(".agentroastrc.json", JSON.stringify({ rules: { "test-skip": "off" } }));
    write("src/auth.test.ts", "it.skip('auth');\n");
    expect((await checkProject({ cwd: path.join(dir, "src") })).infractions).toEqual([]);
  });
  it("uses a baseline for existing problems but fails on the same shortcut added again", async () => {
    write("auth.test.ts", "it.skip('auth');\n"); const result = await checkProject({ cwd: dir });
    writeBaseline(path.join(dir, "baseline.json"), result.infractions);
    write("auth.test.ts", "\n\nit.skip('auth');\n");
    const known = await checkProject({ cwd: dir, baseline: "baseline.json" });
    expect(known.passed).toBe(true); expect(known.baselineCount).toBe(1);
    write("auth.test.ts", "it.skip('auth');\nit.skip('auth');\n");
    const fresh = await checkProject({ cwd: dir, baseline: "baseline.json" });
    expect(fresh.exitCode).toBe(1); expect(fresh.infractions).toHaveLength(1); expect(fresh.totalFindings).toBe(2);
  });
  it("reports baseline debt that has disappeared", async () => {
    write("auth.test.ts", "it.skip('auth');\n"); writeBaseline(path.join(dir, "baseline.json"), (await checkProject({ cwd: dir })).infractions);
    write("auth.test.ts", "it('auth');\n"); const result = await checkProject({ cwd: dir, baseline: "baseline.json" });
    expect(result.staleBaselineCount).toBe(1); expect(result.baselineCount).toBe(0); expect(result.passed).toBe(true);
  });
  it("fails clearly for missing and malformed baselines instead of claiming a clean audit", async () => {
    await expect(checkProject({ cwd: dir, baseline: "absent.json" })).rejects.toThrow();
    write("bad.json", "not json"); await expect(checkProject({ cwd: dir, baseline: "bad.json" })).rejects.toThrow();
  });
  it("will not read an external symlink and labels the scan incomplete", async () => {
    const outside = fs.mkdtempSync(path.join(tmpdir(), "roast-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.ts"), "it.skip('private');\n");
      fs.symlinkSync(path.join(outside, "secret.ts"), path.join(dir, "linked.ts"));
      const result = await checkProject({ cwd: dir });
      expect(result.complete).toBe(false); expect(result.passed).toBe(false); expect(result.exitCode).toBe(2);
      expect(result.infractions).toEqual([]); expect(result.skippedFiles[0].reason).toContain("Symlinks");
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
  it("does not create a misleading baseline when source is too large to scan", () => {
    write("large.ts", "a".repeat(2 * 1024 * 1024 + 1));
    const result = run("--write-baseline", "baseline.json");
    expect(result.status).toBe(2); expect(result.stderr).toContain("incomplete");
    expect(fs.existsSync(path.join(dir, "baseline.json"))).toBe(false);
  });
  it("treats binary source as incomplete, not as clean", async () => {
    write("binary.ts", "const x = 1;\u0000"); const result = await checkProject({ cwd: dir });
    expect(result.complete).toBe(false); expect(result.exitCode).toBe(2);
  });
  it("supports cancellation before scanning and between asynchronous reads", async () => {
    const before = new AbortController(); before.abort();
    await expect(checkProject({ cwd: dir, signal: before.signal })).rejects.toThrow(/cancelled/);
    for (let i = 0; i < 20; i++) write(`source-${i}.ts`, "const ok = 1;\n".repeat(1000));
    const during = new AbortController();
    const promise = checkProject({ cwd: dir, signal: during.signal });
    setImmediate(() => during.abort());
    await expect(promise).rejects.toThrow(/cancelled/);
  });
  it("creates an explicit, reviewable baseline via CLI and preserves it on retry", () => {
    write("auth.test.ts", "it.skip('auth');\n");
    const first = run("--write-baseline", "baseline.json", "--json");
    expect(first.status).toBe(0); expect(JSON.parse(first.stdout).operation).toBe("write-baseline");
    const bytes = fs.readFileSync(path.join(dir, "baseline.json"));
    expect(run("--write-baseline", "baseline.json").status).toBe(2);
    expect(fs.readFileSync(path.join(dir, "baseline.json"))).toEqual(bytes);
    expect(run("--baseline", "baseline.json", "--json").status).toBe(0);
  });
  it("exports machine-readable and markdown reports with policy severity", () => {
    write("auth.test.ts", "it.skip('auth');\n");
    const json = run("--format", "json", "--fail-on", "");
    expect(json.status).toBe(0); expect(JSON.parse(json.stdout).complete).toBe(true);
    expect(run("--format", "github", "--fail-on", "").stdout).toContain("::warning");
    expect(run("--format", "markdown").stdout).toContain("Next step");
  });
  it.each([["--baseline", "x", "--write-baseline", "y"], ["--format", "nonsense"], ["--fail-on", "typo"], ["--base", "HEAD"], ["--staged"], ["--all"], ["--fail-under", "50"], ["--since", "yesterday"], ["--head", "HEAD"]])("rejects conflicting or invalid check options %j", (...args) => {
    expect(run(...args).status).toBe(2);
  });
  it("does not execute repository-controlled project scripts", async () => {
    write("package.json", JSON.stringify({ scripts: { pretest: "touch SHOULD_NOT_EXIST", test: "touch SHOULD_NOT_EXIST" } }));
    write("auth.ts", "const ok = true;\n");
    expect((await checkProject({ cwd: dir })).complete).toBe(true);
    expect(fs.existsSync(path.join(dir, "SHOULD_NOT_EXIST"))).toBe(false);
  });
  it("escapes terminal control characters and markdown images in source names", async () => {
    write("hostile\u001b[31m![image](https--example).test.ts", "it.skip('auth');\n");
    const terminal = await checkProject({ cwd: dir });
    expect(terminal.output).not.toContain("hostile\u001b[31m");
    expect(terminal.output).toContain("\\u001b[31m");
    const markdown = await checkProject({ cwd: dir, format: "markdown" });
    expect(markdown.output).not.toContain("![image]");
  });
  it("prevents repository fsmonitor hooks from running during Git reads", async () => {
    write("monitor.sh", "#!/bin/sh\ntouch SHOULD_NOT_EXIST\n");
    fs.chmodSync(path.join(dir, "monitor.sh"), 0o755);
    git("config", "core.fsmonitor", path.join(dir, "monitor.sh"));
    write("auth.ts", "const ok = true;\n");
    const result = await checkProject({ cwd: dir });
    expect(result.complete).toBe(true);
    expect(fs.existsSync(path.join(dir, "SHOULD_NOT_EXIST"))).toBe(false);
  });
  it("does not claim an empty repository has source coverage", async () => {
    const result = await checkProject({ cwd: dir });
    expect(result.filesInspected).toBe(0); expect(result.output).toContain("No supported source files inspected");
  });
  it("accepts focused-test debt explicitly and still gates an additional occurrence", () => {
    write("auth.test.ts", "test.only('auth', () => {});\n");
    expect(run("--write-baseline", "baseline.json").status).toBe(0);
    expect(run("--baseline", "baseline.json").status).toBe(0);
    write("auth.test.ts", "test.only('auth', () => {});\ntest.only('auth', () => {});\n");
    const result = run("--baseline", "baseline.json", "--json");
    expect(result.status).toBe(1); expect(JSON.parse(result.stdout).infractions[0].type).toBe("test-focus");
  });
  it("explains all supported rules locally and rejects a typo", () => {
    for (const rule of ["test-skip", "type-escape", "swallowed-error", "trivial-assert", "stub-abandonment", "panic-loop", "test-focus"]) {
      const result = spawnSync(process.execPath, [cli, "explain", rule], { encoding: "utf8", env });
      expect(result.status).toBe(0); expect(result.stdout).toContain("Next:");
    }
    expect(spawnSync(process.execPath, [cli, "explain", "typo"], { env }).status).toBe(2);
  });
});
