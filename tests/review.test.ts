import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { reviewChanges } from "../src/review.js";
import { auditPullRequest } from "../src/index.js";

let dir: string;
let base: string;
const cli = path.resolve("dist/cli.js");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const commit = (message = "change") => { git("add", "."); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
const run = (...args: string[]) => spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [cli, "review", dir, ...args], { encoding: "utf8", env });
const policy = (value: unknown) => write(".agentroastrc.json", JSON.stringify(value));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-review-"));
  git("init", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
  write("README.md", "test repository\n"); base = commit("base");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("context review of committed code", () => {
  it("detects deletion-only empty catches missed by added-line scanning", async () => {
    write("save.ts", "try { save(); } catch (error) {\n  report(error);\n}\n"); base = commit();
    write("save.ts", "try { save(); } catch (error) {\n}\n"); const head = commit();
    const legacy = await auditPullRequest({ cwd: dir, base, head, failOn: ["swallowed-error"] });
    expect(legacy.infractions).toEqual([]);
    const result = await reviewChanges({ cwd: dir, base, failOn: ["swallowed-error"] });
    expect(result.complete).toBe(true); expect(result.exitCode).toBe(1);
    expect(result.infractions[0]).toMatchObject({ type: "swallowed-error", file: "save.ts", lineNumber: 1, commitHash: head });
  });
  it("does not flag examples added inside an existing block comment", async () => {
    write("auth.ts", "/*\nDocumentation\n*/\nconst ok = true;\n"); base = commit();
    write("auth.ts", "/*\nDocumentation\nit.skip('example');\n*/\nconst ok = true;\n"); commit();
    expect((await auditPullRequest({ cwd: dir, base })).infractions).toHaveLength(1);
    expect((await reviewChanges({ cwd: dir, base })).infractions).toEqual([]);
  });
  it("blocks only newly focused tests in committed review and supports explicit advisory", async () => {
    write("auth.test.ts", "test.only('old', () => {});\n"); base = commit();
    write("auth.test.ts", "test.only('old', () => {});\nit.only('new', () => {});\n"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.exitCode).toBe(1); expect(result.unchangedCount).toBe(1);
    expect(result.infractions).toEqual([expect.objectContaining({ type: "test-focus", lineNumber: 2 })]);
    expect((await reviewChanges({ cwd: dir, base, failOn: [] })).exitCode).toBe(0);
  });
  it("keeps existing findings after line shifts and flags only an additional duplicate", async () => {
    write("auth.test.ts", "it.skip('auth');\n"); base = commit();
    write("auth.test.ts", "// clean shift\nit.skip('auth');\nit.skip('auth');\n"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.beforeFindings).toBe(1); expect(result.afterFindings).toBe(2);
    expect(result.unchangedCount).toBe(1); expect(result.infractions).toHaveLength(1); expect(result.removedFindings).toEqual([]);
  });
  it("reports patterns that disappear without equating deletion to a verified fix", async () => {
    write("auth.test.ts", "it.skip('auth');\n"); base = commit();
    git("rm", "auth.test.ts"); commit();
    const result = await reviewChanges({ cwd: dir, base, format: "markdown" });
    expect(result.passed).toBe(true); expect(result.removedFindings).toHaveLength(1);
    expect(result.removedFindings[0].commitHash).toBe(base);
    expect(result.output).toContain("not proof of a behavioral fix");
  });
  it("understands pure renames without claiming a fix or introducing debt", async () => {
    write("old.test.ts", "it.skip('auth');\n" + "// filler\n".repeat(10)); base = commit();
    git("mv", "old.test.ts", "new.test.ts"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.renamedFiles).toBe(1); expect(result.unchangedCount).toBe(1);
    expect(result.infractions).toEqual([]); expect(result.removedFindings).toEqual([]);
  });
  it("does not claim renamed code moved into generated output was fixed", async () => {
    write("old.test.ts", "it.skip('auth');\n" + "// filler\n".repeat(10)); base = commit();
    fs.mkdirSync(path.join(dir, "dist")); git("mv", "old.test.ts", "dist/new.test.ts"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.unchangedCount).toBe(1); expect(result.removedFindings).toEqual([]);
  });
  it("reports unsupported extension renames as incomplete", async () => {
    write("old.test.ts", "it.skip('auth');\n" + "// filler\n".repeat(10)); base = commit();
    git("mv", "old.test.ts", "archived.txt"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.complete).toBe(false); expect(result.exitCode).toBe(2);
    expect(result.removedFindings).toEqual([]);
  });
  it("uses immutable committed content despite different checkout/index content", async () => {
    write("auth.test.ts", "it.skip('auth');\n"); const head = commit();
    write("auth.test.ts", "it('auth');\n"); git("add", ".");
    const result = await reviewChanges({ cwd: dir, base, head });
    expect(result.infractions).toHaveLength(1); expect(result.headSha).toBe(head);
    expect(fs.readFileSync(path.join(dir, "auth.test.ts"), "utf8")).toContain("it('auth')");
    expect(git("diff", "--cached")).toContain("it('auth')");
  });
  it("uses the common ancestor for source and supplied base tip for policy", async () => {
    git("checkout", "-b", "feature"); write("auth.test.ts", "it.skip('auth');\n"); const head = commit();
    git("checkout", "main"); policy({ rules: { "test-skip": "warn", "trivial-assert": "off" } }); const baseTip = commit();
    const result = await reviewChanges({ cwd: dir, base: baseTip, head });
    expect(result.mergeBaseSha).toBe(base); expect(result.policySha).toBe(baseTip);
    expect(result.passed).toBe(true); expect(result.infractions).toHaveLength(1);
  });
  it("gates a candidate that tries disabling rules or ignoring all paths", async () => {
    policy({ rules: { "test-skip": "error" } }); base = commit();
    policy({ failOn: [], rules: { "test-skip": "off" }, ignorePaths: ["**/*"] });
    write("auth.test.ts", "it.skip('auth');\n"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.exitCode).toBe(1); expect(result.policyChanges).toContain(".agentroastrc.json");
    expect(result.output).toContain("Candidate policy changes were ignored");
  });
  it("ignores invalid candidate config but rejects invalid trusted config", async () => {
    write(".agentroastrc.json", "invalid json"); write("auth.test.ts", "it.skip('auth');\n"); commit();
    expect((await reviewChanges({ cwd: dir, base })).exitCode).toBe(1);
    base = git("rev-parse", "HEAD"); write("auth.test.ts", "it('auth');\n"); commit();
    await expect(reviewChanges({ cwd: dir, base })).rejects.toThrow(/Invalid/);
  });
  it("honors trusted off rules and explicit advisory CLI overrides", async () => {
    policy({ rules: { "test-skip": "off" } }); base = commit();
    write("auth.test.ts", "it.skip('auth');\nconst foo = obj as any;\n"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.infractions.map(f => f.type)).toEqual(["type-escape"]); expect(result.passed).toBe(true);
    expect((await reviewChanges({ cwd: dir, base, failOn: [] })).passed).toBe(true);
  });
  it("never reads changed source symlinks and never labels partial results clean", async () => {
    fs.symlinkSync("/private/unknown-sensitive.ts", path.join(dir, "linked.ts")); commit();
    const result = await reviewChanges({ cwd: dir, base, format: "github" });
    expect(result.complete).toBe(false); expect(result.exitCode).toBe(2);
    expect(result.infractions).toEqual([]); expect(result.output).toContain("::error::Context review incomplete");
  });
  it("rejects a symlinked trusted policy", async () => {
    fs.symlinkSync("README.md", path.join(dir, ".agentroastrc.json")); base = commit();
    await expect(reviewChanges({ cwd: dir, base })).rejects.toThrow(/regular Git blob/);
  });
  it("reports binary, invalid UTF-8 and oversized source as incomplete", async () => {
    fs.writeFileSync(path.join(dir, "binary.ts"), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(dir, "encoding.ts"), Buffer.from([0xff]));
    write("large.ts", "x".repeat(2 * 1024 * 1024 + 1)); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.complete).toBe(false); expect(result.skippedFiles).toHaveLength(3);
    expect(result.filesInspected).toBe(0); expect(result.exitCode).toBe(2);
  });
  it("accounts for excluded and unsupported changes without claiming full coverage", async () => {
    write("dist/bundle.ts", "it.skip('ignored');\n"); write("notes.txt", "note"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.filesChanged).toBe(2); expect(result.excludedFiles).toBe(1); expect(result.unsupportedFiles).toBe(1);
    expect(result.filesInspected).toBe(0); expect(result.output).toContain("No supported changed source files");
  });
  it("supports cancellation before starting and during Git reads", async () => {
    const before = new AbortController(); before.abort();
    await expect(reviewChanges({ cwd: dir, base, signal: before.signal })).rejects.toThrow(/cancelled/);
    const during = new AbortController(); const promise = reviewChanges({ cwd: dir, base, signal: during.signal }); during.abort();
    await expect(promise).rejects.toThrow(/cancelled/);
  });
  it("handles spaces, newlines, quote characters and unusual git config safely", async () => {
    git("config", "diff.noprefix", "true"); git("config", "core.quotepath", "true");
    write('тест "with\nnewline".test.ts', "it.skip('auth');\n"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.infractions[0].file).toBe('тест "with\nnewline".test.ts');
    expect(result.output).toContain('with\\u000anewline');
  });
  it("keeps repository-relative paths when invoked below root with diff.relative enabled", async () => {
    write("src/auth.test.ts", "it.skip('auth');\n"); commit();
    git("config", "diff.relative", "true");
    const result = await reviewChanges({ cwd: path.join(dir, "src"), base });
    expect(result.infractions[0].file).toBe("src/auth.test.ts"); expect(result.complete).toBe(true);
  });
  it("does not use Git replacement objects to change the inspected candidate", async () => {
    write("auth.test.ts", "it.skip('auth');\n"); const head = commit();
    const badObject = git("rev-parse", "HEAD:auth.test.ts");
    write("clean.ts", "const clean = true;\n"); git("add", "clean.ts"); const cleanObject = git("rev-parse", ":clean.ts");
    git("replace", badObject, cleanObject);
    const result = await reviewChanges({ cwd: dir, base, head });
    expect(result.infractions[0].type).toBe("test-skip");
  });
  it("handles concurrent independent reviews without persistent shared state", async () => {
    write("auth.test.ts", "it.skip('auth');\n"); commit();
    const results = await Promise.all([reviewChanges({ cwd: dir, base }), reviewChanges({ cwd: dir, base })]);
    expect(results[0]).toEqual(results[1]);
  });
  it.each([["--base", "--bad-option"], ["--base", "missing"], ["--base", "HEAD", "--format", "typo"],
    ["--base", "HEAD", "--head", ""], ["--base", "HEAD", "--format", ""],
    ["--base", "HEAD", "--staged"], ["--base", "HEAD", "--all"], ["--base", "HEAD", "--fail-under", "50"],
    ["--base", "HEAD", "--since", "yesterday"], ["--base", "HEAD", "--fail-on", "typo"], []])("rejects invalid/conflicting CLI options %j", (...args) => {
    expect(run(...args).status).toBe(2);
  });
  it("writes GitHub summary and machine outputs based on complete result", () => {
    write("auth.test.ts", "it.skip('auth');\n"); commit();
    const summary = path.join(dir, "summary.md"); const outputs = path.join(dir, "outputs.txt");
    const result = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [cli, "review", dir, "--base", base, "--format", "github"], {
      encoding: "utf8", env: { ...env, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: outputs },
    });
    expect(result.status).toBe(1); expect(result.stdout).toContain("::error file=auth.test.ts");
    expect(fs.readFileSync(summary, "utf8")).toContain("1 new");
    expect(fs.readFileSync(outputs, "utf8")).toContain("complete=true");
  });
});
