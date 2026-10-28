import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { auditPullRequest, roastRepository } from "../src/index.js";
import { auditFileDiffs, MetricsCollector } from "../src/metrics.js";
import { loadConfig, matchIgnorePath, DEFAULT_CONFIG } from "../src/config.js";
import { initProject } from "../src/init.js";
import { formatGithubAnnotations, formatTerminalCard } from "../src/renderer.js";
import type { ParsedCommit } from "../src/git.js";

let dir: string;
const cli = path.resolve("dist/cli.js");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
const run = (...args: string[]) => spawnSync(process.execPath, [cli, dir, ...args], { env, encoding: "utf8" });
const config = (value: unknown) => writeFileSync(path.join(dir, ".agentroastrc.json"), JSON.stringify(value));
const code = (lines: string[], file = "test.ts") => [{ path: file, addedLines: lines.map((line, i) => ({ line, lineNumber: i + 1 })) }];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-roast-regression-"));
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("configuration as an executable policy", () => {
  it.each([null, [], { rules: [] }, { rules: { typo: "off" } }, { rules: { "test-skip": "oops" } },
    { failOn: [42] }, { failOn: ["no-rule"] }, { ignorePaths: [null] },
    { scoreThreshold: 101 }, { scoreThreshold: "70" }, { panicLoopWindowMinutes: 0 }])("rejects invalid policy %j", value => {
    config(value);
    expect(() => loadConfig(dir)).toThrow();
    git("add", "."); git("commit", "-m", "invalid trusted policy");
    expect(run("--staged").status).toBe(2);
  });

  it("honors explicit failOn, including an empty array", () => {
    config({ failOn: [] });
    git("add", "."); git("commit", "-m", "trusted advisory policy");
    writeFileSync(path.join(dir, "auth.test.ts"), 'it.skip("auth", () => {});\n');
    git("add", ".");
    const result = run("--staged", "--json");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).infractions).toHaveLength(1);
    expect(run("--staged", "--fail-on", "test-skip").status).toBe(1);
  });

  it("honors warn/off levels without accidentally adding the default blocker", () => {
    config({ rules: { "test-skip": "warn", "trivial-assert": "off", "type-escape": "off" } });
    git("add", "."); git("commit", "-m", "trusted warning policy");
    writeFileSync(path.join(dir, "auth.test.ts"), 'it.skip("auth", () => {});\nconst x = foo as any;\n');
    git("add", ".");
    const result = run("--staged", "--format", "github");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning");
    expect(result.stdout).not.toContain("::error");
    expect(result.stdout).not.toContain("type-escape");
  });

  it("honors off in history and badge source data as well as PRs", async () => {
    writeFileSync(path.join(dir, "auth.test.ts"), 'it.skip("auth", () => {});\n');
    git("add", "."); git("commit", "-m", "test");
    const result = await roastRepository({ cwd: dir, all: true, rules: { "test-skip": "off" } });
    expect(result.summary.testSkips).toEqual([]);
  });

  it("does not share mutable defaults between repositories", () => {
    const first = loadConfig(dir);
    first.rules!["test-skip"] = "off";
    first.ignorePaths!.push("**/*");
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it("matches arbitrarily deep glob paths and escaped regex characters", () => {
    expect(matchIgnorePath("a/b/c/fixtures/auth.ts", ["**/fixtures/**"])).toBe(true);
    expect(matchIgnorePath("a/b/c/generated/auth.ts", ["**/generated/**"])).toBe(true);
    expect(matchIgnorePath("a/b/c/file.min.js", ["**/*.min.js"])).toBe(true);
    expect(matchIgnorePath("src/fileXmin.js", ["**/*.min.js"])).toBe(false);
    expect(matchIgnorePath("a/[test]/auth.ts", ["**/[test]/**"])).toBe(true);
  });
});

describe("staged checks protect the next commit", () => {
  it("checks the index on the first commit, not unstaged fixes", async () => {
    const file = path.join(dir, "auth.test.ts");
    writeFileSync(file, 'it.skip("auth", () => {});\n'); git("add", ".");
    writeFileSync(file, 'it("auth", () => {});\n');
    const result = await auditPullRequest({ cwd: dir, staged: true });
    expect(result.mode).toBe("staged"); expect(result.exitCode).toBe(1);
    expect(result.infractions[0].lineNumber).toBe(1);
    expect(result.output).toContain("staged changes audit");
    git("add", ".");
    expect((await auditPullRequest({ cwd: dir, staged: true })).infractions).toEqual([]);
  });

  it("ignores unstaged and untracked problems and handles an empty index", async () => {
    writeFileSync(path.join(dir, "clean.ts"), 'export const x = 1;\n');
    git("add", "."); git("commit", "-m", "base");
    writeFileSync(path.join(dir, "clean.ts"), 'it.skip("bad", () => {});\n');
    writeFileSync(path.join(dir, "untracked.test.ts"), 'it.skip("bad", () => {});\n');
    const result = await auditPullRequest({ cwd: dir, staged: true });
    expect(result.hasSupportedChanges).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("checks PRs using config and supports JSON history output", () => {
    writeFileSync(path.join(dir, "clean.ts"), 'export const x = 1;\n');
    git("add", "."); git("commit", "-m", "base"); const base = git("rev-parse", "HEAD");
    writeFileSync(path.join(dir, "auth.test.ts"), 'it.skip("auth", () => {});\n');
    git("add", "."); git("commit", "-m", "tests");
    config({ failOn: [] });
    expect(run("--base", base).status).toBe(0);
    const result = run("--all", "--format", "json");
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout).testSkips).toHaveLength(1);
  });

  it.each([["--staged", "--base", "HEAD"], ["--fail-under", "NaN"], ["--fail-under", "101"],
    ["--fail-under", ""], ["--format", "typo"], ["--fail-on", "test-skip"], ["--format", "markdown"]])("rejects invalid CLI options %j", (...args) => {
    expect(run(...args).status).toBe(2);
  });

  it("generates a valid config and a local staged pre-commit hook without overwriting existing files", async () => {
    await initProject({ cwd: dir, ci: true, hook: true });
    expect(() => loadConfig(dir)).not.toThrow();
    const hook = path.join(dir, ".git/hooks/pre-commit");
    expect(readFileSync(hook, "utf8")).toContain("--no-install agent-roast --staged");
    writeFileSync(hook, "custom hook\n");
    await initProject({ cwd: dir, hook: true });
    expect(readFileSync(hook, "utf8")).toBe("custom hook\n");
    expect(readFileSync(path.join(dir, ".github/workflows/agent-roast.yml"), "utf8")).toContain("uses: Nari-Ab/agent-roast@v1");
  });
});

describe("useful findings without false claims", () => {
  it("does not mistake deliberately failing tests for vacuous passing assertions", () => {
    const result = auditFileDiffs(code(["expect(true).toBe(false);", "assert False", "assert True == actual", "assert True and actual"], "auth.test.ts"));
    expect(result.infractions).toEqual([]);
    expect(auditFileDiffs(code(["expect(true).toBe(true);"], "auth.test.ts")).infractions).toHaveLength(1);
  });

  it("recognizes conventional Python test filenames and respects identifier boundaries", () => {
    expect(auditFileDiffs(code(["assert True"], "test_auth.py")).infractions[0].type).toBe("trivial-assert");
    expect(auditFileDiffs(code(["credit.skip();"], "auth.ts")).infractions).toEqual([]);
  });

  it("ignores stub examples inside strings and trailing comments", () => {
    const result = auditFileDiffs(code([
      `const example = 'throw new Error("Not implemented")';`,
      `const ok = true; // throw new Error("Not implemented")`,
      `const ok2 = true; // it.skip("not code")`,
      `const ok3 = true; /* value as any */`,
      `const ratio = a / b; const value = thing as any; const other = c / d;`,
      `throw new Error("Not implemented");`,
    ]));
    expect(result.infractions.map(inf => inf.type)).toEqual(["type-escape", "stub-abandonment"]);
    expect(result.infractions.map(inf => inf.lineNumber)).toEqual([5, 6]);
  });

  it("shows actual findings even when the history is too small to score", async () => {
    writeFileSync(path.join(dir, "auth.test.ts"), 'it.skip("auth", () => {});\n');
    git("add", "."); git("commit", "-m", "tests");
    const { summary } = await roastRepository({ cwd: dir, all: true });
    expect(summary.score).toBeNull();
    const output = formatTerminalCard(summary, { repoName: "tiny", verbose: true });
    expect(output).toContain("insufficient data");
    expect(output).toContain("auth.test.ts:1");
  });

  it("uses the configured panic-loop window and resets the chain across unattributed commits", () => {
    const commit = (hash: string, minute: number, ai = true): ParsedCommit => ({ hash, date: `2026-10-23T12:${String(minute).padStart(2, "0")}:00Z`, authorName: "Dev", authorEmail: "dev@example.invalid", message: "fix auth", isAiAttributed: ai, aiSignatures: [], totalAddedCount: 1, files: code(["const x = 1;"]) });
    const collector = new MetricsCollector({ panicLoopWindowMinutes: 2 });
    collector.processCommit(commit("a", 0)); collector.processCommit(commit("b", 3));
    expect(collector.getSummary().panicLoops).toEqual([]);
    const interrupted = new MetricsCollector();
    interrupted.processCommit(commit("a", 0)); interrupted.processCommit(commit("b", 1, false)); interrupted.processCommit(commit("c", 2));
    expect(interrupted.getSummary().panicLoops).toEqual([]);
  });

  it("escapes untrusted GitHub annotation properties and command data", async () => {
    writeFileSync(path.join(dir, "auth.test.ts"), 'it.skip("auth", () => {});\n'); git("add", ".");
    const result = await auditPullRequest({ cwd: dir, staged: true });
    result.infractions[0].file = "evil,annotation\n::error::injected.ts";
    result.infractions[0].lineSnippet = "100%\n::error::injected";
    result.failedRules = [];
    const annotations = formatGithubAnnotations(result);
    expect(annotations.split("\n")).toHaveLength(1);
    expect(annotations).toContain("::warning file=evil%2Cannotation%0A%3A%3Aerror%3A%3Ainjected.ts");
    expect(annotations).toContain("100%25%0A::error::injected");
  });
});
