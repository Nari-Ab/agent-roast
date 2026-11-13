import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewChanges } from "../src/review.js";
import { ciTestSteps, gatingTestCommands, resolveCiTestSteps } from "../src/tampering.js";

// Found by reading the code of the fixes of sample 9 once more, not by a sample (docs/benchmarks.md, section 14): an installer of a tool that is called like a runner, the same command in a step that is
// allowed to fail and in one that gates, and a regular expression that was quadratic on a line with `tox` in it again and again.

const FILE = ".github/workflows/ci.yml";
const header = "on:\n  push:\n  pull_request:\njobs:\n";
const job = (name: string, steps: string, extra = "") => `  ${name}:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${steps}`;
const step = (command: string, extra = "") => `      - run: ${command}\n${extra}`;
const commands = (command: string) => gatingTestCommands(FILE, header + job("ci", step(command)));
const lost = (before: string, after: string) => resolveCiTestSteps([ciTestSteps(FILE, before, after)!], "HEAD").map(found => found.type);
const lint = header + job("lint", step("ruff check"));
const MAY_FAIL = "    continue-on-error: true\n";

describe("a command that installs a tool or a package is no test run, whatever the package is called", () => {
  it("does not read the install of tox or of a test dependency", () => {
    expect(commands("uv tool install --python-preference only-managed --python 3.13 tox --with tox-uv")).toEqual([]);
    expect(commands("uv add --dev pytest")).toEqual([]);
    expect(commands("poetry add --group test pytest")).toEqual([]);
    expect(commands("pnpm add -D vitest")).toEqual([]);
    expect(commands("bun add -d vitest")).toEqual([]);
    expect(commands("npm add --save-dev jest")).toEqual([]);
  });

  it("still reads the command that follows the install", () => {
    expect(commands("uv tool install tox --with tox-uv && tox -e py312")).toHaveLength(1);
    expect(commands("npm add -D jest && npm test")).toHaveLength(1);
    expect(commands("uv tool run tox -e py312")).toHaveLength(1);
  });

  it("reads a line with `tox` in it a hundred thousand times in linear time", () => {
    const started = Date.now();
    commands("tox ".repeat(50_000));
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("a test step that may fail is left out by the line it stands on, not by its text", () => {
  it("is a lost check when the same command also runs in a job that gates", () => {
    const both = header + job("stable", step("pytest")) + job("nightly", step("pytest"), MAY_FAIL);
    expect(lost(both, lint)).toEqual(["guard-weakened"]);
  });

  it("is no lost check when every run of the command may fail", () => {
    expect(lost(header + job("nightly", step("pytest"), MAY_FAIL), lint)).toEqual([]);
    expect(lost(header + job("nightly", step("pytest") + step("pytest"), MAY_FAIL), lint)).toEqual([]);
  });

  it("is no lost check when a job that may fail has a step that may fail in it", () => {
    expect(lost(header + job("nightly", step("pytest", "        continue-on-error: true\n"), MAY_FAIL), lint)).toEqual([]);
  });
});

describe("a workflow deleted while the same command runs in a workflow that the change did not touch", () => {
  let dir: string;
  let base: string;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  const commit = (message: string) => { git("add", "-A"); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  const types = async () => (await reviewChanges({ cwd: dir, base })).infractions.map(found => found.type);
  const gating = "on:\n  push:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
  const mayFail = gating.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    continue-on-error: true\n");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "roast-tolerated-"));
    git("init", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
    write("README.md", "test repository\n");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is not reported when the other workflow gates", async () => {
    write(".github/workflows/stable.yml", gating);
    write(".github/workflows/nightly.yml", gating);
    base = commit("base");
    git("rm", "-q", ".github/workflows/stable.yml"); commit("drop the duplicate");
    expect(await types()).toEqual([]);
  });

  it("is reported when the other workflow may fail: it checks nothing", async () => {
    write(".github/workflows/stable.yml", gating);
    write(".github/workflows/nightly.yml", mayFail);
    base = commit("base");
    git("rm", "-q", ".github/workflows/stable.yml"); commit("drop the job that gates");
    expect(await types()).toEqual(["guard-weakened"]);
  });
});
