import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync, spawn } from "child_process";
import { pathToFileURL } from "url";
import { checkProject } from "../src/check.js";
import { configFromText, loadConfig } from "../src/config.js";
import { initProject } from "../src/init.js";
import { reviewStagedChanges } from "../src/review.js";

let root: string;
let repo: string;
const cli = path.resolve("dist/cli.js");
const cleanEnv = () => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  return env;
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const initGit = (cwd: string) => {
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, "init", "-b", "main"); git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.invalid"); git(cwd, "config", "commit.gpgsign", "false");
};
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "roast-io-safety-")); repo = path.join(root, "repo"); initGit(repo); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("bounded, explicit policy and repository inputs", () => {
  it("does not let ambient Git variables redirect a current-code scan", async () => {
    fs.writeFileSync(path.join(repo, "auth.test.ts"), "it.skip('auth');\n");
    const other = path.join(root, "other"); initGit(other); fs.writeFileSync(path.join(other, "clean.ts"), "const ok = true;\n");
    const previous = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    try {
      process.env.GIT_DIR = path.join(other, ".git"); process.env.GIT_WORK_TREE = other; process.env.GIT_INDEX_FILE = path.join(other, ".git/index");
      const result = await checkProject({ cwd: repo });
      expect(result.exitCode).toBe(1); expect(result.infractions[0].file).toBe("auth.test.ts");
    } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  });
  it.each([{ ignorePath: ["**/*"] }, { failon: [] }, { rules: { "test-skip": ["off"] } }, { rules: { "test-skip": { toString: "off" } } }, { $schema: [] }])("rejects unsupported or coercible policy %j", value => {
    expect(() => configFromText(JSON.stringify(value), "test")).toThrow();
  });
  it("accepts a schema declaration as metadata without fetching it", () => {
    expect(configFromText('{"$schema":"https://example.invalid/schema.json"}', "test").failOn).toContain("test-skip");
  });
  it("refuses existing and dangling symlinked policies instead of following or ignoring them", () => {
    const outside = path.join(root, "outside.json"); fs.writeFileSync(outside, '{"failOn":[]}');
    const policy = path.join(repo, ".agentroastrc.json");
    fs.symlinkSync(outside, policy); expect(() => loadConfig(repo)).toThrow(/regular file/);
    fs.unlinkSync(policy); fs.symlinkSync(path.join(root, "absent.json"), policy);
    expect(() => loadConfig(repo)).toThrow(/regular file/);
  });
  it("rejects oversized and invalid-UTF8 policy files before parsing", () => {
    const file = path.join(repo, ".agentroastrc.json");
    fs.writeFileSync(file, " ".repeat(64 * 1024 + 1)); expect(() => loadConfig(repo)).toThrow(/65536|64 KiB/);
    expect(() => configFromText(" ".repeat(64 * 1024 + 1), "test")).toThrow(/64 KiB/);
    fs.writeFileSync(file, Buffer.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125])); expect(() => loadConfig(repo)).toThrow();
  });
  it("preserves spaces and newline characters in a repository root path", async () => {
    const unusual = path.join(root, " repository with whitespace \n"); initGit(unusual);
    fs.writeFileSync(path.join(unusual, "auth.test.ts"), "it.skip('auth');\n");
    const result = await checkProject({ cwd: unusual });
    expect(result.exitCode).toBe(1); expect(result.filesInspected).toBe(1);
  });
  it("refuses FIFO config without waiting for a writer", () => {
    if (process.platform === "win32") return;
    execFileSync("mkfifo", [path.join(repo, ".agentroastrc.json")]);
    expect(() => loadConfig(repo)).toThrow(/regular file/);
  });
});

describe("initialization preserves filesystem ownership", () => {
  it("preserves dangling config and hook links without creating their outside targets", async () => {
    const configTarget = path.join(root, "outside-config.json"); const hookTarget = path.join(root, "outside-hook");
    fs.symlinkSync(configTarget, path.join(repo, ".agentroastrc.json")); fs.symlinkSync(hookTarget, path.join(repo, ".git/hooks/pre-commit"));
    const result = await initProject({ cwd: repo, hook: true });
    expect(result.skipped).toContain(".agentroastrc.json"); expect(result.skipped).toContain(".git/hooks/pre-commit");
    expect(fs.existsSync(configTarget)).toBe(false); expect(fs.existsSync(hookTarget)).toBe(false);
    expect(fs.lstatSync(path.join(repo, ".agentroastrc.json")).isSymbolicLink()).toBe(true);
  });
  it("rejects a symlinked workflow directory without writing outside the project", async () => {
    const outside = path.join(root, "outside"); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(repo, ".github"));
    await expect(initProject({ cwd: repo, ci: true })).rejects.toThrow(/symlinked/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("supports a linked worktree without changing existing shared hooks", async () => {
    fs.writeFileSync(path.join(repo, "readme.md"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
    const linked = path.join(root, "linked"); git(repo, "worktree", "add", "--detach", linked, "HEAD");
    expect((await initProject({ cwd: linked, hook: true })).created).toContain(".git/hooks/pre-commit");
    const hook = path.join(repo, ".git/hooks/pre-commit"); expect(fs.readFileSync(hook, "utf8")).toContain("agent-roast --staged");
    fs.writeFileSync(hook, "custom hook\n");
    expect((await initProject({ cwd: linked, hook: true })).skipped).toContain(".git/hooks/pre-commit"); expect(fs.readFileSync(hook, "utf8")).toBe("custom hook\n");
  });
  it("does not write to a custom hooks path outside repository metadata", async () => {
    const outside = path.join(root, "custom-hooks"); fs.mkdirSync(outside); git(repo, "config", "core.hooksPath", outside);
    const result = await initProject({ cwd: repo, hook: true });
    expect(result.skipped.some(entry => entry.includes("custom hooks path"))).toBe(true); expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("allows exactly one concurrent initializer to create each complete file", async () => {
    const moduleUrl = pathToFileURL(path.resolve("dist/index.js")).href;
    const script = `import { initProject } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await initProject({cwd:process.argv[1],ci:true,hook:true})));`;
    const attempt = () => new Promise<any>((resolve, reject) => {
      const child = spawn((process.env.AGENT_ROAST_TEST_NODE || process.execPath), ["--input-type=module", "-e", script, repo], { stdio: ["ignore", "pipe", "pipe"], env: cleanEnv() });
      let output = ""; child.stdout.on("data", data => { output += data; }); child.on("error", reject); child.on("close", code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error("Initializer failed")));
    });
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    for (const name of [".agentroastrc.json", ".github/workflows/agent-roast.yml", ".git/hooks/pre-commit"]) expect(results.filter(result => result.created.includes(name))).toHaveLength(1);
    expect(() => loadConfig(repo)).not.toThrow();
    expect(fs.readdirSync(repo).some(name => name.endsWith(".tmp"))).toBe(false);
  });
});

describe("the real commit candidate in Git hooks", () => {
  const prepare = () => {
    fs.writeFileSync(path.join(repo, "auth.test.ts"), "test('auth', () => {});\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(path.join(repo, ".git/hooks/pre-commit"), `#!/bin/sh\n${quote((process.env.AGENT_ROAST_TEST_NODE || process.execPath))} ${quote(cli)} --staged\n`, { mode: 0o755 });
  };
  it.each([["commit", "-am", "focused"], ["commit", "--only", "-m", "focused", "--", "auth.test.ts"]])("blocks focused code in the temporary index for git %j", (...args) => {
    prepare(); const before = git(repo, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(repo, "auth.test.ts"), "test.only('auth', () => {});\n");
    const result = spawnSync("git", args, { cwd: repo, env: cleanEnv(), encoding: "utf8" });
    expect(result.status).toBe(1); expect(result.stderr).toContain("test-focus"); expect(git(repo, "rev-parse", "HEAD")).toBe(before);
    expect(git(repo, "show", "HEAD:auth.test.ts")).not.toContain(".only");
  });
  it("approves a clean partial commit without scanning unrelated staged files", () => {
    prepare();
    fs.writeFileSync(path.join(repo, "unrelated.test.ts"), "test.only('unrelated', () => {});\n"); git(repo, "add", "unrelated.test.ts");
    fs.writeFileSync(path.join(repo, "auth.test.ts"), "test('auth improved', () => {});\n");
    const result = spawnSync("git", ["commit", "--only", "-m", "clean partial", "--", "auth.test.ts"], { cwd: repo, env: cleanEnv(), encoding: "utf8" });
    expect(result.status).toBe(0); expect(git(repo, "diff", "--cached", "--name-only")).toBe("unrelated.test.ts");
  });
  it("refuses an outside alternate index instead of silently approving another candidate", async () => {
    const outside = path.join(root, "outside.index"); fs.writeFileSync(outside, "not an index");
    const old = process.env.GIT_INDEX_FILE;
    try { process.env.GIT_INDEX_FILE = outside; await expect(reviewStagedChanges({ cwd: repo })).rejects.toThrow(/GIT_INDEX_FILE/); }
    finally { if (old === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = old; }
  });
});

describe("legacy audits keep offline and explicit repository boundaries", () => {
  it("refuses history and added-lines diff reads from promisor clones", async () => {
    const { streamGitLog, streamGitDiff, parseGitLogStream } = await import("../src/git.js");
    fs.writeFileSync(path.join(repo, "readme.md"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
    const head = git(repo, "rev-parse", "HEAD"); git(repo, "config", "remote.origin.promisor", "true");
    await expect(parseGitLogStream(streamGitLog(repo), () => {})).rejects.toThrow(/partial clone|promisor/);
    const stream = streamGitDiff(repo, head, head);
    await expect(new Promise((resolve, reject) => { stream.on("data", () => {}); stream.on("error", reject); stream.on("end", resolve); })).rejects.toThrow(/partial clone|promisor/);
  });
});


describe("history record framing and parser completeness", () => {
  it("does not let static separator text in commit messages hide findings", async () => {
    const { roastRepository } = await import("../src/index.js");
    const { RECORD_SEPARATOR, FIELD_SEPARATOR } = await import("../src/git.js");
    fs.writeFileSync(path.join(repo, "auth.test.ts"), "it.skip('auth');\n");
    const message = path.join(root, "message.txt"); fs.writeFileSync(message, "tests\n\n" + RECORD_SEPARATOR + "spoof" + FIELD_SEPARATOR + "field\n");
    git(repo, "add", "."); git(repo, "commit", "-F", message);
    const result = await roastRepository({ cwd: repo, all: true });
    expect(result.summary.totalCommits).toBe(1); expect(result.summary.testSkips).toHaveLength(1);
  });
  it("reports invalid history UTF-8 instead of replacing and scanning different text", async () => {
    const { roastRepository } = await import("../src/index.js");
    fs.writeFileSync(path.join(repo, "auth.test.ts"), Buffer.from([0xff, 10])); git(repo, "add", "."); git(repo, "commit", "-m", "invalid UTF8 source");
    await expect(roastRepository({ cwd: repo, all: true })).rejects.toThrow(/UTF-8/);
  });
  it("scans repository-wide paths from a subdirectory despite relative diff configuration", async () => {
    const { roastRepository, auditPullRequest } = await import("../src/index.js");
    fs.writeFileSync(path.join(repo, "readme.md"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base"); const base = git(repo, "rev-parse", "HEAD");
    fs.mkdirSync(path.join(repo, "src")); fs.writeFileSync(path.join(repo, "src/clean.ts"), "const clean = true;\n");
    fs.writeFileSync(path.join(repo, "auth.test.ts"), "it.skip('auth');\n"); git(repo, "add", "."); git(repo, "commit", "-m", "candidate");
    git(repo, "config", "diff.relative", "true");
    expect((await roastRepository({ cwd: path.join(repo, "src"), all: true })).summary.testSkips).toHaveLength(1);
    expect((await auditPullRequest({ cwd: path.join(repo, "src"), base })).infractions).toHaveLength(1);
  });
  it("parses multi-character record delimiters even when every byte is a separate chunk", async () => {
    const { parseGitLogStream, RECORD_SEPARATOR: R, FIELD_SEPARATOR: F } = await import("../src/git.js");
    const { Readable } = await import("stream");
    const record = (hash: string) => R + [hash, "2026-10-28T00:00:00Z", "Dev", "dev@example.invalid", "message", ""].join(F);
    const buffer = Buffer.from(record("one") + record("two")); const hashes: string[] = [];
    await parseGitLogStream(Readable.from([...buffer].map(byte => Buffer.from([byte]))), commit => hashes.push(commit.hash));
    expect(hashes).toEqual(["one", "two"]);
  });
  it.each([
    "diff --git a/auth.ts b/auth.ts\n+++ b/auth.ts\n@@ -0,0 +1,2 @@\n+only one line\n",
    "diff --git a/auth.ts b/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,1 @@\n+added without old deletion\n",
    "diff --git a/auth.ts b/auth.ts\n+++ b/auth.ts\n@@ -1,2 +1,0 @@\n unexpected context\n",
  ])("refuses truncated or internally inconsistent diff hunks", async raw => {
    const { parseDiff } = await import("../src/git.js"); expect(() => parseDiff(raw)).toThrow(/hunk/);
  });
});
