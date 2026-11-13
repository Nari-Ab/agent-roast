import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewChanges } from "../src/review.js";
import { calledTestCommands, lostCalls, resolveLostCallers } from "../src/tampering.js";

// A gap that docs/rules.md documented while writing the check of 0.23.0: deleting (or editing) the only workflow that calls a reusable test workflow
// stops its tests from running on a push or pull request, without the reusable workflow's own file changing at all.

const gating = "on:\n  push:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
const reusable = "on:\n  workflow_call:\njobs:\n  sdk:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
const reusableAndGating = "on:\n  push:\n  workflow_call:\njobs:\n  sdk:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
const caller = (target: string) => `on:\n  pull_request:\njobs:\n  sdk:\n    uses: ${target}\n`;

describe("lostCalls", () => {
  it("lists a call that a deleted or edited caller made, and nothing when it was never gating", () => {
    expect(lostCalls(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"), null)).toEqual([".github/workflows/sdk.yml"]);
    expect(lostCalls(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"), "on:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n")).toEqual([".github/workflows/sdk.yml"]);
    expect(lostCalls(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"), caller("./.github/workflows/sdk.yml"))).toEqual([]);
    expect(lostCalls(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml").replace("pull_request:", "workflow_dispatch:"), null)).toEqual([]);
  });
});

describe("resolveLostCallers", () => {
  it("is not reported when the workflow is still called, has no test command, or already gates on its own trigger", () => {
    expect(resolveLostCallers(new Map([[".github/workflows/sdk.yml", { content: reusable, stillCalled: true }]]), "HEAD")).toEqual([]);
    expect(resolveLostCallers(new Map([[".github/workflows/sdk.yml", { content: "on:\n  workflow_call:\njobs:\n  sdk:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n", stillCalled: false }]]), "HEAD")).toEqual([]);
    expect(resolveLostCallers(new Map([[".github/workflows/sdk.yml", { content: reusableAndGating, stillCalled: false }]]), "HEAD")).toEqual([]);
  });

  it("is reported when nothing calls it any more and it has no trigger of its own", () => {
    const found = resolveLostCallers(new Map([[".github/workflows/sdk.yml", { content: reusable, stillCalled: false }]]), "HEAD");
    expect(found.map(f => f.type)).toEqual(["guard-weakened"]);
    expect(found[0].file).toBe(".github/workflows/sdk.yml");
  });
});

describe("calledTestCommands", () => {
  it("reads the test commands of a workflow regardless of its own trigger", () => {
    expect(calledTestCommands(reusable)).toHaveLength(1);
    expect(calledTestCommands("on:\n  workflow_call:\njobs:\n  sdk:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n")).toEqual([]);
  });
});

describe("read from the repository", () => {
  let dir: string;
  let base: string;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  const commit = (message: string) => { git("add", "-A"); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  const types = async () => (await reviewChanges({ cwd: dir, base })).infractions.map(found => found.type);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "roast-lost-caller-"));
    git("init", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
    write("README.md", "test repository\n");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is reported when the only caller of an untouched reusable workflow is deleted", async () => {
    write(".github/workflows/sdk.yml", reusable);
    write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
    base = commit("base");
    git("rm", "-q", ".github/workflows/ci.yml"); commit("drop the caller");
    expect(await types()).toEqual(["guard-weakened"]);
  });

  it("is reported when the caller stops calling it, in favor of its own command", async () => {
    write(".github/workflows/sdk.yml", reusable);
    write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
    base = commit("base");
    write(".github/workflows/ci.yml", "on:\n  pull_request:\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run lint\n"); commit("lint instead");
    expect(await types()).toEqual(["guard-weakened"]);
  });

  it("is not reported when another, untouched workflow still calls it", async () => {
    write(".github/workflows/sdk.yml", reusable);
    write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
    write(".github/workflows/release.yml", caller("./.github/workflows/sdk.yml").replace("pull_request:", "push:\n    tags: ['v*']\n  pull_request:"));
    base = commit("base");
    git("rm", "-q", ".github/workflows/ci.yml"); commit("drop one of two callers");
    expect(await types()).toEqual([]);
  });

  it("is not reported when the reusable workflow is deleted together with its only caller", async () => {
    write(".github/workflows/sdk.yml", reusable);
    write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
    base = commit("base");
    git("rm", "-q", ".github/workflows/sdk.yml", ".github/workflows/ci.yml"); commit("drop both");
    expect(await types()).toEqual([]);
  });

  it("is not reported when the reusable workflow also gates on its own trigger", async () => {
    write(".github/workflows/sdk.yml", reusableAndGating);
    write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
    base = commit("base");
    git("rm", "-q", ".github/workflows/ci.yml"); commit("drop the caller");
    expect(await types()).toEqual([]);
  });

  it("is reported once, not twice, when the called workflow loses its own trigger in the same change that its caller drops it", async () => {
    write(".github/workflows/sdk.yml", gating); // sdk.yml itself gates directly here (it is the 0.23 case from the other side)
    write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
    base = commit("base");
    write(".github/workflows/sdk.yml", reusable); // loses push/pull_request, becomes workflow_call-only
    git("rm", "-q", ".github/workflows/ci.yml"); // and its only caller goes too
    commit("make it reusable and drop the caller");
    const found = await types();
    expect(found).toEqual(["guard-weakened"]);
    expect(found).toHaveLength(1);
  });

  it("is reported when the caller is edited in the same change as an unrelated edit to the reusable workflow", async () => {
    write(".github/workflows/sdk.yml", reusable);
    write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
    base = commit("base");
    write(".github/workflows/sdk.yml", reusable.replace("npm test", "npm test # unit")); // touched, but still workflow_call-only with the same test command
    git("rm", "-q", ".github/workflows/ci.yml"); commit("comment the test line, drop the caller");
    expect(await types()).toEqual(["guard-weakened"]);
  });
});
