import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { auditPullRequest } from "../src/index.js";
let dir: string;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" }).trim();
const write = (name: string, value: string) => fs.writeFileSync(path.join(dir, name), value);
const commit = () => { git("add", "."); git("commit", "-m", "change"); return git("rev-parse", "HEAD"); };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-legacy-complete-")); git("init", "-b", "main");
  git("config", "user.name", "Tester"); git("config", "user.email", "test@example.invalid"); git("config", "commit.gpgsign", "false");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("honest legacy diff coverage", () => {
  it("cannot pass when source lines are skipped by the legacy parser", async () => {
    write("README.md", "base"); const base = commit();
    write("auth.test.ts", "it.skip('hidden');" + " ".repeat(5000)); commit();
    for (const format of ["json", "github", "markdown", "terminal"] as const) {
      const result = await auditPullRequest({ cwd: dir, base, failOn: [], format });
      expect(result).toMatchObject({ complete: false, passed: false, exitCode: 2, skippedLongLines: 1 });
      if (format !== "json") expect(result.output).toMatch(/INCOMPLETE|incomplete/);
    }
  });
  it("honors repository-root policy in subdirectories instead of reintroducing default blockers", () => {
    write(".agentroastrc.json", JSON.stringify({ failOn: [] })); write("README.md", "base"); const base = commit();
    fs.mkdirSync(path.join(dir, "src")); write("src/auth.test.ts", "it.skip('advisory');\n"); commit();
    const run = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [path.resolve("dist/cli.js"), path.join(dir, "src"), "--base", base, "--json"], { env, encoding: "utf8" });
    expect(run.status).toBe(0); expect(JSON.parse(run.stdout).infractions).toHaveLength(1);
  });
  it("rejects unsupported API output formats", async () => {
    write("README.md", "base"); const base = commit();
    const javascriptOptions = { cwd: dir, base };
    Reflect.set(javascriptOptions, "format", "invalid");
    await expect(auditPullRequest(javascriptOptions)).rejects.toThrow(/format/);
  });
  it("historical CLI audits return exit2 for skipped source instead of a false clean score", () => {
    write("auth.test.ts", "it.skip('hidden');" + " ".repeat(5000)); commit();
    const result = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [path.resolve("dist/cli.js"), dir, "--all", "--json"], { env, encoding: "utf8" });
    expect(result.status).toBe(2); expect(JSON.parse(result.stdout).skippedLongLines).toBe(1);
  });
});

it("uses the global badge history window and refuses a badge from skipped source", () => {
  write("auth.test.ts", "it.skip('hidden');" + " ".repeat(5000)); commit();
  const cli = path.resolve("dist/cli.js");
  const empty = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [cli, "--since", "2099-01-01", "badge", dir, "--all", "--json"], { env, encoding: "utf8" });
  expect(empty.status).toBe(0); expect(JSON.parse(empty.stdout).message).toBe("N/A");
  const incomplete = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [cli, "badge", dir, "--all", "--json"], { env, encoding: "utf8" });
  expect(incomplete.status).toBe(2); expect(incomplete.stderr).toContain("incomplete");
});

it("keeps errors from repository-controlled policy as inert, single-line terminal data", () => {
  write(".agentroastrc.json", JSON.stringify({ rules: { "bad\u001b]52;c;payload\u0007\n::error::injected": "off" } }));
  const result = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [path.resolve("dist/cli.js"), "check", dir], { env, encoding: "utf8" });
  expect(result.status).toBe(2); expect(result.stderr).not.toContain("\u001b]"); expect(result.stderr).not.toContain("\n::error::");
  expect(result.stderr).toContain("\\u001b");
});

it("does not claim Git binary-marked source was checked, even in advisory mode", async () => {
  write(".gitattributes", "*.ts -diff\n"); const base = commit();
  write("auth.test.ts", "it.skip('hidden by attributes');\n"); commit();
  const review = await auditPullRequest({ cwd: dir, base, failOn: [] });
  expect(review).toMatchObject({ complete: false, skippedBinaryFiles: 1, exitCode: 2 });
  const result = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [path.resolve("dist/cli.js"), dir, "--all", "--json"], { env, encoding: "utf8" });
  expect(result.status).toBe(2); expect(JSON.parse(result.stdout).skippedBinaryFiles).toBe(1);
});

it("does not hide a completed review report when an optional GitHub artifact cannot be written", () => {
  write("auth.test.ts", "test.only('bad', () => {});\n"); git("add", ".");
  const result = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [path.resolve("dist/cli.js"), dir, "--staged", "--json"], {
    env: { ...env, GITHUB_OUTPUT: path.join(dir, "missing-directory/output"), GITHUB_STEP_SUMMARY: path.join(dir, "missing-directory/summary") }, encoding: "utf8",
  });
  expect(result.status).toBe(1); expect(JSON.parse(result.stdout).complete).toBe(true);
  expect(result.stderr).toContain("optional GitHub report artifact");
});
