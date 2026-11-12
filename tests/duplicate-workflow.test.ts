import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewChanges, reviewStagedChanges, reviewWorktreeChanges } from "../src/review.js";
import { ciTestSteps, gatingTestCommands, resolveCiTestSteps } from "../src/tampering.js";

// Two 0.19.0 false alarms on a sixth sample of 40 repositories (docs/benchmarks.md, section 10): a workflow was deleted, or merged into another one, and
// the tests it ran still run in a second workflow. A step that is lost is a step no workflow runs any more.

const workflow = (steps: string[], trigger = "on:\n  push:\n    branches: [main]\n  pull_request:\n") =>
  `name: ci\n${trigger}jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n${steps.map(step => `      - ${step}`).join("\n")}\n`;
const checkout = "uses: actions/checkout@v4";

describe("the test commands of a workflow", () => {
  it("are normalized, so a step written another way is the same command", () => {
    expect(gatingTestCommands(".github/workflows/a.yml", workflow([checkout, "run: npm  test # unit"]))).toEqual(["npm test @"]);
    expect(gatingTestCommands(".github/workflows/b.yml", workflow([checkout, "run: |\n          npm ci\n          npm test"]))).toEqual(["npm test @"]);
  });

  it("carry the directories the workflow works in, so the same command in two services of a monorepo is two checks", () => {
    const web = workflow([checkout, "working-directory: web\n        run: npm test"]);
    const api = workflow([checkout, "working-directory: api\n        run: npm test"]);
    expect(gatingTestCommands(".github/workflows/web.yml", web)).toEqual(["npm test @web"]);
    expect(gatingTestCommands(".github/workflows/api.yml", api)).toEqual(["npm test @api"]);
  });

  it("are none for a workflow that gates nothing", () => {
    expect(gatingTestCommands(".github/workflows/nightly.yml", workflow(["run: npm test"], "on:\n  schedule:\n    - cron: '0 3 * * *'\n"))).toEqual([]);
  });
});

describe("a workflow that lost its tests, judged against the others of the same change", () => {
  const counts = (...files: [string, string | null, string | null][]) => files.map(([file, before, after]) => ciTestSteps(file, before, after)!);

  it("is not reported when another workflow of the change still runs the same command (two workflows merged into one)", () => {
    const merged = counts(
      [".github/workflows/ci-pr-prerelease.yml", workflow([checkout, "run: npm test"]), null],
      [".github/workflows/ci-pr.yml", workflow([checkout, "run: npm test"]), workflow([checkout, "run: npm ci", "run: npm test"])],
    );
    expect(resolveCiTestSteps(merged, "HEAD")).toEqual([]);
  });

  it("is reported when the command that is left is another one", () => {
    const changed = counts(
      [".github/workflows/old.yml", workflow([checkout, "run: npm test"]), null],
      [".github/workflows/ci.yml", workflow([checkout, "run: pytest", "run: pytest tests/slow"]), workflow([checkout, "run: pytest"])],
    );
    expect(resolveCiTestSteps(changed, "HEAD").map(found => found.type)).toEqual(["guard-weakened"]);
  });

  it("is reported when the same command is left in another directory", () => {
    const changed = counts(
      [".github/workflows/web.yml", workflow([checkout, "working-directory: web\n        run: npm test"]), null],
      [".github/workflows/api.yml", workflow([checkout, "working-directory: api\n        run: npm test"]), workflow([checkout, "working-directory: api\n        run: npm test"])],
    );
    expect(resolveCiTestSteps(changed, "HEAD").map(found => found.type)).toEqual(["guard-weakened"]);
  });

  it("is not reported when the command still runs in a workflow the change did not touch", () => {
    const removed = counts([".github/workflows/old.yml", workflow([checkout, "run: npm test"]), null]);
    expect(resolveCiTestSteps(removed, "HEAD", new Set(["npm test @"]))).toEqual([]);
    expect(resolveCiTestSteps(removed, "HEAD", new Set(["pytest @"])).map(found => found.type)).toEqual(["guard-weakened"]);
    expect(resolveCiTestSteps(removed, "HEAD")).toHaveLength(1);
  });
});

describe("a workflow deleted while another one that the change did not touch runs the same tests", () => {
  let dir: string;
  let base: string;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  const commit = (message = "change") => { git("add", "-A"); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  const types = async () => (await reviewChanges({ cwd: dir, base })).infractions.map(found => found.type);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "roast-duplicate-"));
    git("init", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
    write("README.md", "test repository\n");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is not reported", async () => {
    write(".github/workflows/test.yml", workflow([checkout, "run: npm ci", "run: npm test"]));
    write(".github/workflows/production.yml", workflow([checkout, "run: npm test", "run: npm publish"]));
    base = commit("base");
    git("rm", "-q", ".github/workflows/production.yml"); commit("drop the duplicate");
    expect(await types()).toEqual([]);
  });

  it("is reported when the other workflow runs another test command", async () => {
    write(".github/workflows/test.yml", workflow([checkout, "run: pytest"]));
    write(".github/workflows/production.yml", workflow([checkout, "run: npm test"]));
    base = commit("base");
    git("rm", "-q", ".github/workflows/production.yml"); commit("drop it");
    expect(await types()).toEqual(["guard-weakened"]);
  });

  it("is reported when the other workflow runs the same command in another directory", async () => {
    write(".github/workflows/api.yml", workflow([checkout, "working-directory: api\n        run: npm test"]));
    write(".github/workflows/web.yml", workflow([checkout, "working-directory: web\n        run: npm test"]));
    base = commit("base");
    git("rm", "-q", ".github/workflows/web.yml"); commit("drop web");
    expect(await types()).toEqual(["guard-weakened"]);
  });

  it("is not reported in a review of the working tree or of the index either (what the hook reads)", async () => {
    write(".github/workflows/test.yml", workflow([checkout, "run: npm ci", "run: npm test"]));
    write(".github/workflows/production.yml", workflow([checkout, "run: npm test", "run: npm publish"]));
    base = commit("base");
    fs.rmSync(path.join(dir, ".github/workflows/production.yml"));
    const types = (result: Awaited<ReturnType<typeof reviewWorktreeChanges>>) => result.infractions.map(found => found.type);
    expect(types(await reviewWorktreeChanges({ cwd: dir }))).toEqual([]);
    git("add", "-A");
    expect(types(await reviewStagedChanges({ cwd: dir }))).toEqual([]);
  });

  it("is reported in a review of the working tree when the other workflow runs another command", async () => {
    write(".github/workflows/test.yml", workflow([checkout, "run: pytest"]));
    write(".github/workflows/production.yml", workflow([checkout, "run: npm test"]));
    base = commit("base");
    fs.rmSync(path.join(dir, ".github/workflows/production.yml"));
    expect((await reviewWorktreeChanges({ cwd: dir })).infractions.map(found => found.type)).toEqual(["guard-weakened"]);
  });

  it("is reported when the other workflow only runs on a schedule", async () => {
    write(".github/workflows/nightly.yml", workflow([checkout, "run: npm test"], "on:\n  schedule:\n    - cron: '0 3 * * *'\n"));
    write(".github/workflows/production.yml", workflow([checkout, "run: npm test"]));
    base = commit("base");
    git("rm", "-q", ".github/workflows/production.yml"); commit("drop it");
    expect(await types()).toEqual(["guard-weakened"]);
  });
});
