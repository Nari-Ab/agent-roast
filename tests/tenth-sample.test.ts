import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { auditFileDiffs } from "../src/metrics.js";
import { reviewChanges } from "../src/review.js";
import { ciTestSteps, gatingCalls, gatingTestCommands, resolveCiTestSteps } from "../src/tampering.js";

// False alarms that turned up while reading a tenth sample of 40 repositories (docs/benchmarks.md, section 15). The builds that were measured on it, 0.20.0 as published and 0.21.0 as shipped,
// are not changed by these fixes, so they are not part of that measurement: the fixes are fitted to the sample.

const FILE = ".github/workflows/ci.yml";
const workflow = (step: string) => `on:\n  push:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${step}\n`;
const commands = (step: string) => gatingTestCommands(FILE, workflow(step));
const lost = (before: string, after: string | null) => resolveCiTestSteps([ciTestSteps(FILE, before, after)!], "HEAD").map(found => found.type);

describe("a target of a task runner that has the word test among its words is a test run", () => {
  it("reads the targets of make, just and the package managers", () => {
    for (const step of ["make unit-test", "make acceptance-test", "make -j4 integration-tests", "just test-asyncio py314 1", "pnpm run docs:test", "pnpm run ci:test:rspack", "yarn run unit-test", "make test_all"]) {
      expect(commands(step), step).toHaveLength(1);
    }
    expect(commands("make test")).toHaveLength(1);
    expect(commands("yarn test:unit")).toHaveLength(1);
  });

  it("does not read a target that sets up, installs, builds or type-checks, or a word that only contains test", () => {
    for (const step of ["make setup-tests", "make teardown-tests", "pnpm run typecheck:tests", "pnpm run build:native:test", "make build-test-image", "npm run lint:test", "make latest", "make contest", "make install-test-deps"]) {
      expect(commands(step), step).toEqual([]);
    }
  });

  it("reads a package script that runs them with coverage, so that `npm run unit-tests` into `npm run cover` is no lost step", () => {
    expect(commands("npm run cover")).toHaveLength(1);
    expect(commands("yarn cover")).toHaveLength(1);
    expect(commands("npm run covering")).toEqual([]);
    expect(lost(workflow("npm run unit-tests"), workflow("npm run cover"))).toEqual([]);
  });

  it("is not a lost test step when the tests move into a make target, and is one when the target is swapped for a linter", () => {
    expect(lost(workflow("poetry run pytest -v tests/unit"), workflow("make unit-test"))).toEqual([]);
    expect(lost(workflow("make unit-test"), workflow("make lint"))).toEqual(["guard-weakened"]);
  });
});

describe("a skip marker only counts in a file that holds tests", () => {
  const scan = (file: string) => auditFileDiffs([{ path: file, addedLines: [{ line: "@pytest.mark.skip", lineNumber: 1 }, { line: "def test_prompt(prompt):", lineNumber: 2 }] }]).infractions.map(found => found.type);

  it("does not report a library function that is called test_prompt and marked skip so that pytest does not collect it", () => {
    expect(scan("transformer_lens/utils.py")).toEqual([]);
    expect(scan("pkg/latest.py")).toEqual([]);
    expect(scan("pkg/contest/helpers.py")).toEqual([]);
  });

  it("still reports it in every kind of test file", () => {
    for (const file of ["tests/test_utils.py", "tests.py", "conftest.py", "pkg/helpers_test.py", "testing/helpers.py", "test_utils.py", "spec/helpers.py"]) {
      expect(scan(file), file).toEqual(["test-skip"]);
    }
  });
});

describe("a workflow that another workflow calls runs on every change that the caller runs on", () => {
  const reusable = "on:\n  workflow_call:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
  const gating = "on:\n  push:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
  const caller = (target: string) => `on:\n  pull_request:\njobs:\n  sdk:\n    uses: ${target}\n`;

  it("lists the local workflows that a workflow which gates calls", () => {
    expect(gatingCalls(FILE, caller("./.github/workflows/sdk.yml"))).toEqual([".github/workflows/sdk.yml"]);
    expect(gatingCalls(FILE, caller("./.github/workflows/sdk.yml").replace("pull_request:", "workflow_dispatch:"))).toEqual([]);
    expect(gatingCalls(FILE, caller("owner/repo/.github/workflows/sdk.yml@v1"))).toEqual([]);
    expect(gatingCalls(FILE, workflow("npm test"))).toEqual([]);
  });

  it("is not reported when the workflow that lost its own triggers is called by one that is not in the change", () => {
    const count = ciTestSteps(".github/workflows/sdk.yml", gating, reusable)!;
    expect(resolveCiTestSteps([count], "HEAD").map(found => found.type)).toEqual(["guard-weakened"]);
    expect(resolveCiTestSteps([count], "HEAD", new Set(), new Set([".github/workflows/sdk.yml"]))).toEqual([]);
    expect(resolveCiTestSteps([count], "HEAD", new Set(), new Set([".github/workflows/other.yml"])).map(found => found.type)).toEqual(["guard-weakened"]);
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
      dir = fs.mkdtempSync(path.join(tmpdir(), "roast-called-"));
      git("init", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
      write("README.md", "test repository\n");
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("is not reported when a workflow that was not touched calls it", async () => {
      write(".github/workflows/sdk.yml", gating);
      write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml"));
      base = commit("base");
      write(".github/workflows/sdk.yml", reusable); commit("make it reusable");
      expect(await types()).toEqual([]);
    });

    it("is not reported when a workflow of the same change calls it", async () => {
      write(".github/workflows/sdk.yml", gating);
      write(".github/workflows/ci.yml", workflow("npm run lint"));
      base = commit("base");
      write(".github/workflows/sdk.yml", reusable);
      write(".github/workflows/ci.yml", caller("./.github/workflows/sdk.yml")); commit("make it reusable and call it");
      expect(await types()).toEqual([]);
    });

    it("is reported when nothing calls it", async () => {
      write(".github/workflows/sdk.yml", gating);
      write(".github/workflows/ci.yml", workflow("npm run lint"));
      base = commit("base");
      write(".github/workflows/sdk.yml", reusable); commit("make it reusable");
      expect(await types()).toEqual(["guard-weakened"]);
    });
  });
});
