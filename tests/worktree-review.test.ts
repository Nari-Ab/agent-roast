import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewWorktreeChanges } from "../src/review.js";

let dir: string;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string | Buffer) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const commit = () => { git("add", "."); git("commit", "-m", "base"); return git("rev-parse", "HEAD"); };
const gitFiles = () => fs.readdirSync(path.join(dir, ".git")).sort();

const CALC_TEST = "import { add } from './calc';\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-worktree-"));
  git("init", "-b", "main"); git("config", "user.name", "Dev"); git("config", "user.email", "dev@example.invalid"); git("config", "commit.gpgsign", "false");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("review of the working tree against HEAD", () => {
  it("flags an unstaged weakened assertion and changes nothing in the repository", async () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n");
    write("calc.test.ts", CALC_TEST);
    const base = commit();
    write("calc.test.ts", CALC_TEST.replace("toBe(4)", "toBeDefined()"));
    const index = fs.readFileSync(path.join(dir, ".git/index"));
    const file = fs.readFileSync(path.join(dir, "calc.test.ts"));
    const before = gitFiles();

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result).toMatchObject({ source: "worktree", schemaVersion: "1.2.0", baseSha: base, mergeBaseSha: base, policySha: base, complete: true, exitCode: 1 });
    expect(result.headSha).toMatch(/^WORKTREE:[a-f0-9]{64}$/);
    expect(result.failedRules).toEqual(["assertion-weakened"]);
    expect(result.infractions).toEqual([expect.objectContaining({ type: "assertion-weakened", file: "calc.test.ts" })]);
    expect(result.output).toContain("working tree review");
    expect(fs.readFileSync(path.join(dir, ".git/index"))).toEqual(index);
    expect(fs.readFileSync(path.join(dir, "calc.test.ts"))).toEqual(file);
    expect(git("rev-parse", "HEAD")).toBe(base);
    expect(gitFiles()).toEqual(before);
  });

  it("sees untracked new files and a deleted test file", async () => {
    write("calc.test.ts", CALC_TEST); write("other.test.ts", "test('a', () => { expect(1 + 1).toBe(2); });\n");
    commit();
    write("fresh.test.ts", "it('later', () => { expect(true).toBe(true); });\n");
    fs.rmSync(path.join(dir, "other.test.ts"));

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result.infractions.map(finding => [finding.type, finding.file])).toEqual(expect.arrayContaining([["trivial-assert", "fresh.test.ts"], ["test-removed", "other.test.ts"]]));
    expect(result.failedRules).toEqual(["trivial-assert"]);
    expect(result.exitCode).toBe(1);
  });

  it("combines staged and unstaged edits of the same file and ignores ignored files", async () => {
    write(".gitignore", "generated/\n"); write("calc.test.ts", CALC_TEST); commit();
    write("calc.test.ts", CALC_TEST.replace("toBe(4)", "toBeTruthy()")); git("add", "calc.test.ts");
    write("calc.test.ts", CALC_TEST.replace("toBe(4)", "toBeDefined()"));
    write("generated/x.test.ts", "it.skip('generated', () => {});\n");

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result.infractions.filter(finding => finding.type === "assertion-weakened")).toHaveLength(1);
    expect(result.infractions.some(finding => finding.file === "generated/x.test.ts")).toBe(false);
  });

  it("treats a moved file as a move and reports nothing", async () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", CALC_TEST); commit();
    fs.mkdirSync(path.join(dir, "src"));
    fs.renameSync(path.join(dir, "calc.test.ts"), path.join(dir, "src/calc.test.ts"));

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result.infractions).toEqual([]);
    expect(result.renamedFiles).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  it("uses the policy committed at HEAD, so an uncommitted config cannot switch rules off", async () => {
    write(".agentroastrc.json", JSON.stringify({ rules: { "test-focus": "error" } })); const base = commit();
    write(".agentroastrc.json", JSON.stringify({ failOn: [], rules: { "test-focus": "off" } }));
    write("auth.test.ts", "test.only('auth', () => {});\n");

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result).toMatchObject({ policySha: base, policyFile: ".agentroastrc.json", exitCode: 1 });
    expect(result.policyChanges).toEqual([".agentroastrc.json"]);
    expect(result.infractions[0].type).toBe("test-focus");
  });

  it("works in a repository that has no commit yet", async () => {
    write("auth.test.ts", "test.only('auth', () => {});\n");

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result).toMatchObject({ baseSha: "EMPTY", policySha: "EMPTY", complete: true, exitCode: 1 });
    expect(result.infractions[0]).toMatchObject({ type: "test-focus", file: "auth.test.ts" });
  });

  it("sees an edit of the same size made in the second the index was written (racily clean stat data)", async () => {
    // Git cannot tell such an edit from stat data alone, so it re-reads files that are not older than the index file. A copy of
    // the index has a new modification time, which used to hide the edit. The times are set by hand to make the second
    // boundary deterministic: the file and the index are both stamped a minute in the past.
    git("config", "core.trustctime", "false");
    const config = (lines: number) => `export default { test: { coverage: { thresholds: { lines: ${lines} } } } };\n`;
    const file = path.join(dir, "vitest.config.ts");
    const past = new Date(Date.now() - 60_000);
    write("vitest.config.ts", config(90)); fs.utimesSync(file, past, past);
    commit();
    write("vitest.config.ts", config(50)); fs.utimesSync(file, past, past);
    fs.utimesSync(path.join(dir, ".git/index"), past, past);
    expect(git("diff-index", "--raw", "HEAD", "--")).toContain("vitest.config.ts");

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result.infractions).toEqual([expect.objectContaining({ type: "guard-weakened", file: "vitest.config.ts" })]);
  });

  it("passes when nothing changed", async () => {
    write("calc.test.ts", CALC_TEST); commit();
    const result = await reviewWorktreeChanges({ cwd: dir });
    expect(result).toMatchObject({ filesChanged: 0, filesInspected: 0, infractions: [], complete: true, exitCode: 0 });
  });

  it("reports a symlinked changed source as incomplete instead of passing it", async () => {
    if (process.platform === "win32") return;
    write("calc.test.ts", CALC_TEST); commit();
    write("real.ts", "export const x = 1;\n");
    fs.symlinkSync("real.ts", path.join(dir, "link.ts"));

    const result = await reviewWorktreeChanges({ cwd: dir });

    expect(result.complete).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.skippedFiles.map(skipped => skipped.file)).toContain("link.ts");
  });

  it("refuses to review while the index has unresolved conflicts", async () => {
    write("a.ts", "export const a = 1;\n"); commit();
    git("checkout", "-b", "other"); write("a.ts", "export const a = 2;\n"); git("commit", "-am", "other");
    git("checkout", "main"); write("a.ts", "export const a = 3;\n"); git("commit", "-am", "main");
    try { git("merge", "other"); } catch { /* the conflict is the point */ }

    await expect(reviewWorktreeChanges({ cwd: dir })).rejects.toThrow(/unmerged/i);
    expect(gitFiles().filter(name => name.startsWith("agent-roast-"))).toEqual([]);
  });

  it("can be cancelled", async () => {
    write("calc.test.ts", CALC_TEST); commit();
    const controller = new AbortController(); controller.abort();
    await expect(reviewWorktreeChanges({ cwd: dir, signal: controller.signal })).rejects.toThrow(/cancelled/i);
  });
});
