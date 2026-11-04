import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { runDemo } from "../src/demo.js";

let dir: string;
const cli = path.resolve("dist/cli.js");
const node = process.env.AGENT_ROAST_TEST_NODE || process.execPath;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", NO_COLOR: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const commit = (message: string) => { git("add", "."); git("commit", "-m", message); };
const run = (...args: string[]) => spawnSync(node, [cli, ...args], { cwd: dir, encoding: "utf8", env });
const TEST = "import { add } from './calc';\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-first-run-"));
  git("init", "-b", "main"); git("config", "user.name", "Dev"); git("config", "user.email", "dev@example.invalid"); git("config", "commit.gpgsign", "false");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("agent-roast demo", () => {
  const leftovers = () => fs.readdirSync(tmpdir()).filter(name => name.startsWith("agent-roast-demo-"));

  it("runs the real review on a scripted weakening and cleans up after itself", async () => {
    const before = leftovers();
    const demo = await runDemo();
    expect(demo.exitCode).toBe(0);
    expect(demo.result.source).toBe("worktree");
    expect([...new Set(demo.result.infractions.map(finding => finding.type))].sort()).toEqual(["assertion-weakened", "guard-weakened", "test-skip", "trivial-assert"]);
    expect(demo.result.infractions.filter(finding => finding.type === "guard-weakened")).toHaveLength(3);
    expect(demo.output).toContain("nothing of yours is read or changed");
    expect(demo.output).toContain("working tree review: BLOCKED");
    expect(leftovers()).toEqual(before);
  });

  it("is a command that succeeds without a repository", () => {
    const outside = fs.mkdtempSync(path.join(tmpdir(), "roast-demo-outside-"));
    try {
      const result = spawnSync(node, [cli, "demo"], { cwd: outside, encoding: "utf8", env: { ...env, GIT_CEILING_DIRECTORIES: path.dirname(outside) } });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("[guard-weakened] vitest.config.ts");
      expect(result.stdout).toContain("npx agent-roast hook install");
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});

describe("agent-roast with no arguments", () => {
  it("reviews what is not committed yet and exits 1 on a blocking finding", () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", TEST); commit("base");
    write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()"));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("working tree review: BLOCKED");
    expect(result.stdout).toContain("[assertion-weakened] calc.test.ts:2");
  });

  it("takes --advisory, --fail-on, --json and --format like the other reviews", () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", TEST); commit("base");
    write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()"));
    expect(run("--advisory").status).toBe(0);
    expect(run("--fail-on", "test-skip").status).toBe(0);
    const json = run("--json");
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ source: "worktree", schemaVersion: "1.2.0", failedRules: ["assertion-weakened"] });
    expect(run("--format", "markdown").stdout).toMatch(/^## agent-roast working tree review: BLOCKED/);
    expect(run("--format", "typo").status).toBe(2);
  });

  it("replays recent history when nothing is uncommitted, so a first run still says something", () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", TEST); commit("base");
    write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()")); commit("make it green");
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Nothing is uncommitted");
    expect(result.stdout).toContain("replay of the last 1 commit");
    expect(result.stdout).toContain("make it green");
    expect(result.stdout).toContain("npx agent-roast hook install");
  });

  it("explains itself on a repository with a single commit", () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); commit("base");
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no earlier commit to compare with yet");
  });

  it("points to the demo outside a repository", () => {
    const outside = fs.mkdtempSync(path.join(tmpdir(), "roast-outside-"));
    try {
      const result = spawnSync(node, [cli], { cwd: outside, encoding: "utf8", env: { ...env, GIT_CEILING_DIRECTORIES: path.dirname(outside) } });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/is not inside one[\s\S]*npx agent-roast demo/);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it("keeps the history score as the audit command and under its old flags", () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); commit("base");
    expect(run("audit").stdout).toMatch(/git discipline audit/);
    expect(run("--all").stdout).toMatch(/git discipline audit/);
  });
});

describe("review --worktree", () => {
  it("is the same review as the bare command, for scripts", () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", TEST); commit("base");
    write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()"));
    const json = run("review", "--worktree", "--json");
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout).source).toBe("worktree");
    expect(run("--worktree").status).toBe(1);
    expect(run("review", "--worktree", "--advisory").status).toBe(0);
    const sarif = JSON.parse(run("review", "--worktree", "--format", "sarif").stdout);
    expect(sarif.runs[0].properties.source).toBe("worktree");
  });

  it("does not mix with the other sources or with history options", () => {
    write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); commit("base");
    expect(run("review", "--worktree", "--staged").status).toBe(2);
    expect(run("review", "--worktree", "--base", "HEAD").status).toBe(2);
    expect(run("--worktree", "--base", "HEAD").status).toBe(2);
    expect(run("--worktree", "--all").status).toBe(2);
    expect(run("check", "--worktree").status).toBe(2);
    expect(run("replay", "--worktree").status).toBe(2);
  });
});
