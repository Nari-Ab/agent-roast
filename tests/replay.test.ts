import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { pathToFileURL } from "url";
import { formatReplayTerminal, replayHistory } from "../src/replay.js";

let dir: string;
const cli = path.resolve("dist/cli.js");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const commit = (message: string) => { git("add", "."); git("commit", "-m", message); };
const init = () => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-replay-"));
  git("init", "-b", "main"); git("config", "user.name", "Replay"); git("config", "user.email", "replay@example.invalid"); git("config", "commit.gpgsign", "false");
};
const roast = (...args: string[]) => spawnSync(process.env.AGENT_ROAST_TEST_NODE || process.execPath, [cli, ...args], { encoding: "utf8", env });

const SUITE = (check: string) => `import { add } from './add';\nit('adds', () => {\n  expect(add(1, 2))${check};\n});\nit('adds negatives', () => {\n  expect(add(-1, -2)).toBe(-3);\n});\n`;
const NEWEST_FIRST = ["Merge feature", "cast", "drop negatives test", "loosen the adds check", "add sub", "docs only"];

beforeEach(() => {
  init();
  write("src/add.ts", "export const add = (a: number, b: number) => a + b;\n");
  write("src/add.test.ts", SUITE(".toBe(3)")); commit("initial");
  write("README.md", "docs\n"); commit("docs only");
  write("src/sub.ts", "export const sub = (a: number, b: number) => a - b;\n"); commit("add sub");
  write("src/add.test.ts", SUITE(".toBeDefined()")); commit("loosen the adds check");
  write("src/add.test.ts", SUITE(".toBeDefined()").replace(/it\('adds negatives'[\s\S]*$/, "")); commit("drop negatives test");
  write("src/cast.ts", "export const raw = (globalThis as any).raw;\n"); commit("cast");
  git("checkout", "-q", "-b", "feature");
  write("src/add.test.ts", "import { add } from './add';\nit.skip('adds', () => {\n  expect(add(1, 2)).toBeDefined();\n});\n"); commit("skip on the branch");
  git("checkout", "-q", "main"); git("merge", "--no-ff", "feature", "-m", "Merge feature");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("replay of recent history", () => {
  it("reviews each commit of the first-parent history on its own and sorts out what it did", async () => {
    const result = await replayHistory({ cwd: dir });
    expect(result.commits.map(commit => commit.subject)).toEqual(NEWEST_FIRST);
    expect(Object.fromEntries(result.commits.map(commit => [commit.subject, commit.status]))).toEqual({
      "Merge feature": "blocked", cast: "noted", "drop negatives test": "warned", "loosen the adds check": "blocked", "add sub": "clean", "docs only": "untouched",
    });
    expect(result.commitsWithoutParent).toBe(1);
    expect(result.shallow).toBe(false);
    expect(result.summary).toMatchObject({ commits: 6, blocked: 2, warned: 1, noted: 1, clean: 1, untouched: 1, incomplete: 0, failed: 0 });
    expect(result.summary.findingsByRule).toMatchObject({ "assertion-weakened": 1, "test-skip": 1, "test-removed": 1, "type-escape": 1 });
    expect(result.commits[0].failedRules).toEqual(["test-skip"]);
    expect(result.exitCode).toBe(0);
  });

  it("lists blocking commits first and keeps line patterns out of the list unless asked", async () => {
    const { output } = await replayHistory({ cwd: dir });
    expect(output).toContain("replay of the last 6 commits");
    expect(output).toContain("Would have blocked: 2 commits · warnings on 1 · line patterns only on 1 · nothing to report on 1");
    expect(output).toContain("FAIL [assertion-weakened] src/add.test.ts");
    expect(output).toContain("FAIL [test-skip] src/add.test.ts");
    expect(output).toContain("WARN [test-removed] src/add.test.ts");
    expect(output.indexOf("loosen the adds check")).toBeLessThan(output.indexOf("drop negatives test"));
    expect(output).not.toContain("[type-escape]");
    expect(output).toContain("Line patterns not listed: 1 finding (type-escape 1). Add --all-rules to list them.");
    const all = await replayHistory({ cwd: dir, allRules: true });
    expect(all.output).toContain("WARN [type-escape] src/cast.ts");
    expect(all.output).not.toContain("Line patterns not listed");
  });

  it("limits the window and validates it", async () => {
    const two = await replayHistory({ cwd: dir, last: 2 });
    expect(two.commits.map(commit => commit.subject)).toEqual(["Merge feature", "cast"]);
    expect(two).toMatchObject({ requested: 2, commitsWithoutParent: 0 });
    for (const last of [0, 1001, 1.5]) await expect(replayHistory({ cwd: dir, last })).rejects.toThrow(/between 1 and 1000/);
  });

  it("returns every finding as JSON, without the rendered text", async () => {
    const { output } = await replayHistory({ cwd: dir, format: "json" });
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({ mode: "replay", schemaVersion: "1.0.0", requested: 50 });
    expect(parsed).not.toHaveProperty("output");
    expect(parsed.commits).toHaveLength(6);
    expect(parsed.commits.flatMap((commit: { findings: { type: string }[] }) => commit.findings.map(finding => finding.type))).toContain("type-escape");
  });

  it("keeps going past a commit it cannot review and says so", async () => {
    for (let i = 0; i < 1001; i++) write(`gen/f${i}.ts`, `export const v${i} = ${i};\n`);
    commit("generated");
    const result = await replayHistory({ cwd: dir });
    expect(result.commits[0]).toMatchObject({ subject: "generated", status: "failed" });
    expect(result.commits[0].error).toMatch(/1000 changed-file limit/);
    expect(result.summary).toMatchObject({ failed: 1, blocked: 2 });
    expect(result.output).toContain("Not reviewed in full: 1 commit");
    expect(result.output).toMatch(/Not reviewed in full: [0-9a-f]{7} generated — Review exceeds the 1000 changed-file limit/);
  });

  it("keeps both sides of a long before-and-after line readable", () => {
    const before = `expect(first("${"a".repeat(150)}")).toBe(1)`;
    const after = `expect(first("${"b".repeat(150)}")).toBe(2)`;
    const finding = { type: "expectation-rewritten", file: "src/add.test.ts", lineNumber: 3, lineSnippet: `adds: ${before} → ${after}`, commitHash: "", commitDate: "", reason: "" };
    const commit = { sha: "a".repeat(40), date: "2026-11-02T00:00:00Z", subject: "bump", status: "warned" as const, failedRules: [], findings: [finding], filesInspected: 1, skipped: [] };
    const result = { schemaVersion: "1.0.0", mode: "replay" as const, head: commit.sha, requested: 50, commitsWithoutParent: 0, shallow: false, commits: [commit], exitCode: 0, output: "",
      summary: { commits: 1, blocked: 0, warned: 1, noted: 0, clean: 0, untouched: 0, incomplete: 0, failed: 0, findingsByRule: { "expectation-rewritten": 1 } } };
    const line = formatReplayTerminal(result).split("\n").find(text => text.includes(" → "))!;
    expect(line.length).toBeLessThanOrEqual(6 + 200);
    expect(line).toMatch(/aaa.*….* → .*bbb.*…/);
  });

  it("says so when a shallow clone holds too little history", async () => {
    const shallow = fs.mkdtempSync(path.join(tmpdir(), "roast-replay-shallow-"));
    try {
      execFileSync("git", ["clone", "-q", "--depth", "1", pathToFileURL(dir).href, shallow], { stdio: "ignore" });
      const result = await replayHistory({ cwd: shallow });
      expect(result).toMatchObject({ shallow: true, commitsWithoutParent: 1 });
      expect(result.summary.commits).toBe(0);
      expect(result.output).toMatch(/This clone is shallow.*git fetch --unshallow/);
    } finally { fs.rmSync(shallow, { recursive: true, force: true }); }
  });

  it("refuses to report when no commit could be reviewed, and handles histories with nothing to compare", async () => {
    fs.rmSync(dir, { recursive: true, force: true }); init();
    await expect(replayHistory({ cwd: dir })).rejects.toThrow(/Cannot read the commit history|no commits/);
    write("a.ts", "export const a = 1;\n"); commit("only commit");
    const single = await replayHistory({ cwd: dir });
    expect(single.summary.commits).toBe(0);
    expect(single.output).toContain("nothing was reviewed");
    for (let i = 0; i < 1001; i++) write(`gen/f${i}.ts`, `export const v${i} = ${i};\n`);
    commit("generated");
    await expect(replayHistory({ cwd: dir })).rejects.toThrow(/No commit could be reviewed/);
  });

  it("runs from the command line and rejects options that belong to other commands", () => {
    const ok = roast("replay", dir);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("replay of the last 6 commits");
    const json = roast("replay", dir, "--json", "--last", "3");
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout).commits).toHaveLength(3);
    for (const args of [["--base", "HEAD~1"], ["--staged"], ["--fail-on", "test-skip"], ["--advisory"], ["--last", "abc"], ["--last", "0"], ["--format", "markdown"]]) {
      expect(roast("replay", dir, ...args).status, args.join(" ")).toBe(2);
    }
  });
});
