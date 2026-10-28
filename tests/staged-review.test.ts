import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { reviewStagedChanges } from "../src/review.js";
import * as snapshots from "../src/snapshot.js";
import { stagedSnapshot } from "../src/snapshot.js";

let dir: string;
const cli = path.resolve("dist/cli.js");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string | Buffer) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const commit = () => { git("add", "."); git("commit", "-m", "base"); return git("rev-parse", "HEAD"); };
const review = () => reviewStagedChanges({ cwd: dir });
const run = (...args: string[]) => spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [cli, dir, "--staged", ...args], { env, encoding: "utf8" });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-staged-context-"));
  git("init", "-b", "main"); git("config", "user.name", "Dev"); git("config", "user.email", "dev@example.invalid"); git("config", "commit.gpgsign", "false");
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("full-source review of the next commit", () => {
  it("detects a deletion-only regression from index even if worktree is repaired", async () => {
    write("save.ts", "try { save(); } catch (error) {\n  report(error);\n}\n"); const base = commit();
    write("save.ts", "try { save(); } catch (error) {\n}\n"); git("add", "save.ts");
    write("save.ts", "try { save(); } catch (error) {\n  report(error);\n}\n");
    const beforeIndex = fs.readFileSync(path.join(dir, ".git/index"));
    const beforeFiles = fs.readFileSync(path.join(dir, "save.ts"));
    const result = await reviewStagedChanges({ cwd: dir, failOn: ["swallowed-error"] });
    expect(result).toMatchObject({ source: "index", baseSha: base, policySha: base, complete: true, exitCode: 1 });
    expect(result.infractions).toEqual([expect.objectContaining({ type: "swallowed-error", lineNumber: 1 })]);
    expect(result.headSha).toMatch(/^INDEX:[a-f0-9]{64}$/);
    expect(fs.readFileSync(path.join(dir, ".git/index"))).toEqual(beforeIndex);
    expect(fs.readFileSync(path.join(dir, "save.ts"))).toEqual(beforeFiles);
    expect(git("rev-parse", "HEAD")).toBe(base);
  });
  it("knows existing comment context and does not flag staged examples", async () => {
    write("auth.ts", "/*\nDocumentation\n*/\n"); commit();
    write("auth.ts", "/*\nDocumentation\nit.skip('example');\n*/\n"); git("add", ".");
    expect((await review()).infractions).toEqual([]);
  });
  it("gates only additional findings and counts disappearing patterns", async () => {
    write("auth.test.ts", "it.skip('old');\ntest.only('old', () => {});\n"); commit();
    write("auth.test.ts", "// line shift\nit.skip('old');\nit.skip('old');\n"); git("add", ".");
    const result = await review();
    expect(result.unchangedCount).toBe(1); expect(result.infractions).toHaveLength(1);
    expect(result.removedFindings[0].type).toBe("test-focus");
    expect(result.exitCode).toBe(1);
  });
  it("does not block unchanged historical debt when clean code is staged", async () => {
    write("auth.test.ts", "it.skip('old');\n"); commit();
    write("auth.test.ts", "// harmless line\nit.skip('old');\n"); git("add", ".");
    const result = await review();
    expect(result.unchangedCount).toBe(1); expect(result.infractions).toEqual([]); expect(result.exitCode).toBe(0);
  });
  it("supports initial commits using defaults, and never reads unstaged config", async () => {
    write("auth.test.ts", "test.only('auth', () => {});\n"); git("add", ".");
    write(".agentroastrc.json", JSON.stringify({ failOn: [], ignorePaths: ["**/*"] }));
    const result = await review();
    expect(result).toMatchObject({ baseSha: "EMPTY", policySha: "EMPTY", exitCode: 1, policyFile: null });
    expect(result.infractions[0].type).toBe("test-focus");
    expect(run("--json").status).toBe(1);
    expect(run("--fail-on", "", "--json").status).toBe(0);
  });
  it("uses committed policy even if index and worktree try to disable it", async () => {
    write(".agentroastrc.json", JSON.stringify({ rules: { "test-focus": "error" } })); commit();
    write(".agentroastrc.json", JSON.stringify({ failOn: [], rules: { "test-focus": "off" } }));
    write("auth.test.ts", "test.only('auth', () => {});\n"); git("add", ".");
    write(".agentroastrc.json", "invalid json");
    const result = await review();
    expect(result.exitCode).toBe(1); expect(result.policyChanges).toContain(".agentroastrc.json");
    expect(run("--json").status).toBe(1);
  });
  it("honors committed advisory/off policy and explicit fail-on overrides", async () => {
    write(".agentroastrc.json", JSON.stringify({ rules: { "test-focus": "warn" } })); commit();
    write("auth.test.ts", "test.only('auth', () => {});\n"); git("add", ".");
    expect((await review()).exitCode).toBe(0);
    expect(run("--fail-on", "test-focus").status).toBe(1);
  });
  it("ignores unstaged, untracked and intent-to-add files", async () => {
    write("clean.ts", "const ok = true;\n"); commit();
    write("clean.ts", "test.only('bad', () => {});\n");
    write("untracked.test.ts", "test.only('bad', () => {});\n");
    write("intent.test.ts", "test.only('bad', () => {});\n"); git("add", "-N", "intent.test.ts");
    const result = await review();
    expect(result.filesChanged).toBe(0); expect(result.exitCode).toBe(0);
  });
  it("preserves pure renames and reports deletion as disappearance", async () => {
    write("old.test.ts", "test.only('old', () => {});\n"); commit();
    git("mv", "old.test.ts", "new.test.ts");
    const result = await review();
    expect(result.renamedFiles).toBe(1); expect(result.unchangedCount).toBe(1); expect(result.exitCode).toBe(0);
    git("rm", "-f", "new.test.ts");
    const removed = await review(); expect(removed.removedFindings).toHaveLength(1); expect(removed.exitCode).toBe(0);
  });
  it("handles linked worktrees and subdirectory invocation", async () => {
    write("src/clean.ts", "const ok = true;\n"); commit();
    const linked = path.join(dir, "linked"); git("worktree", "add", "--detach", linked, "HEAD");
    fs.writeFileSync(path.join(linked, "src/clean.ts"), "test.only('bad', () => {});\n");
    execFileSync("git", ["add", "."], { cwd: linked, env });
    const result = await reviewStagedChanges({ cwd: path.join(linked, "src") });
    expect(result.infractions[0].file).toBe("src/clean.ts"); expect(result.exitCode).toBe(1);
  });
  it("refuses unmerged entries, including unsupported non-source conflicts", async () => {
    write("conflict.txt", "base\n"); const base = commit();
    git("checkout", "-b", "other"); write("conflict.txt", "other\n"); commit();
    git("checkout", "main"); write("conflict.txt", "main\n"); commit();
    expect(spawnSync("git", ["merge", "other"], { cwd: dir, env }).status).toBe(1);
    await expect(review()).rejects.toThrow(/unmerged/);
    expect(run("--json").status).toBe(2);
    expect(git("rev-parse", "HEAD")).not.toBe(base);
  });
  it("rejects symlink, binary, oversized, and invalid-UTF8 source as incomplete", async () => {
    fs.symlinkSync("missing", path.join(dir, "linked.ts"));
    write("binary.ts", Buffer.from([0, 1])); write("encoding.ts", Buffer.from([0xff]));
    write("large.ts", "x".repeat(2 * 1024 * 1024 + 1)); git("add", ".");
    const result = await review();
    expect(result.exitCode).toBe(2); expect(result.complete).toBe(false); expect(result.skippedFiles).toHaveLength(4);
  });
  it("rejects a changed staged inventory instead of approving a stale snapshot", async () => {
    write("auth.ts", "const clean = true;\n"); commit();
    const snapshot = await stagedSnapshot(dir);
    write("auth.ts", "it.skip('new');\n"); git("add", ".");
    await expect(snapshot.verify()).rejects.toThrow(/changed during review/);
    expect(git("diff", "--cached")).toContain("it.skip");
  });
  it("aborts the full review if a concurrent writer stages a different candidate", async () => {
    write("auth.ts", "const clean = true;\n"); commit();
    write("auth.ts", "const candidate = true;\n"); git("add", ".");
    const original = snapshots.readBlob;
    let replaced = false;
    vi.spyOn(snapshots, "readBlob").mockImplementation(async (...args) => {
      const content = await original(...args);
      if (!replaced) {
        replaced = true;
        write("auth.ts", "it.skip('concurrent problem');\n"); git("add", ".");
      }
      return content;
    });
    await expect(review()).rejects.toThrow(/changed during review/);
    expect(git("show", ":auth.ts")).toContain("concurrent problem");
  });
  it("rejects HEAD supersession even when staged content is identical", async () => {
    write("auth.ts", "const clean = true;\n"); commit();
    const snapshot = await stagedSnapshot(dir);
    git("commit", "--allow-empty", "-m", "operator commit");
    await expect(snapshot.verify()).rejects.toThrow(/changed during review/);
  });
  it("does not execute repository diff helpers or trust replacement objects", async () => {
    write("helper.sh", "#!/bin/sh\ntouch SHOULD_NOT_EXIST\n"); fs.chmodSync(path.join(dir, "helper.sh"), 0o755);
    write("good.ts", "const ok = true;\n"); commit();
    write("auth.test.ts", "test.only('new', () => {});\n"); git("add", ".");
    git("replace", git("rev-parse", ":auth.test.ts"), git("rev-parse", "HEAD:good.ts"));
    git("config", "diff.external", path.join(dir, "helper.sh"));
    git("config", "core.fsmonitor", path.join(dir, "helper.sh"));
    const result = await review();
    expect(result.infractions[0].type).toBe("test-focus"); expect(result.exitCode).toBe(1);
    expect(fs.existsSync(path.join(dir, "SHOULD_NOT_EXIST"))).toBe(false);
  });
  it("rejects over-limit inventories instead of silently truncating the commit", async () => {
    for (let i = 0; i < 1001; i++) write(`notes-${i}.txt`, "note\n");
    git("add", ".");
    await expect(review()).rejects.toThrow(/1000 changed-file limit/);
  });
  it("refuses offline partial clones before reading candidate objects", async () => {
    git("config", "remote.origin.promisor", "true");
    await expect(review()).rejects.toThrow(/partial clone|promisor/);
  });
  it("supports concurrent read-only reviews and cancellation", async () => {
    write("auth.test.ts", "test.only('new', () => {});\n"); git("add", ".");
    const results = await Promise.all([review(), review()]); expect(results[0]).toEqual(results[1]);
    const before = new AbortController(); before.abort();
    await expect(reviewStagedChanges({ cwd: dir, signal: before.signal })).rejects.toThrow(/cancelled/);
    const during = new AbortController(); const running = reviewStagedChanges({ cwd: dir, signal: during.signal }); during.abort();
    await expect(running).rejects.toThrow(/cancelled/);
  });
  it("exports staged JSON, SARIF and markdown through both CLI spellings", () => {
    write("auth.test.ts", "test.only('new', () => {});\n"); git("add", ".");
    const root = run("--json"); expect(root.status).toBe(1); expect(JSON.parse(root.stdout).source).toBe("index");
    const cmd = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [cli, "review", dir, "--staged", "--format", "sarif"], { env, encoding: "utf8" });
    expect(cmd.status).toBe(1); const report = JSON.parse(cmd.stdout).runs[0];
    expect(report.results[0].ruleId).toBe("test-focus"); expect(report.properties.source).toBe("index");
    expect(run("--format", "markdown").stdout).toContain("staged context review");
  });
  it.each([["--base", "HEAD"], ["--head", "HEAD"], ["--all"], ["--since", "yesterday"], ["--fail-under", "50"], ["--fail-on", "typo"]])("rejects conflicting CLI options %j", (...args) => {
    expect(run(...args).status).toBe(2);
  });
});
