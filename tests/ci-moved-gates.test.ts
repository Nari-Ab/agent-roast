import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewChanges, reviewStagedChanges, reviewWorktreeChanges } from "../src/review.js";
import { ciTestSteps, commandTargets, gatingTestCommands, isTestDirectory, resolveCiTestSteps } from "../src/tampering.js";

// Six 0.27.0 false alarms of the CI rule on a twelfth sample of 40 repositories (docs/benchmarks.md, section 21), and the older ones that look like them: a workflow was deleted with the code
// it tested, or its tests are listed by name in another workflow, or it already ran only when its own file changed. A test step that is lost is a check that nothing runs any more.

const checkout = "- uses: actions/checkout@v4";
const ON = "on:\n  push:\n    branches: [main]\n  pull_request:\n";

describe("the test files that a command names", () => {
  it("are the files of the arguments, without the runner, the flags and the test inside a file", () => {
    expect(commandTargets("JARVIS_TEST_GITHUB_ENGINE=1 bun test src/workflows/github-engine.test.ts @")).toEqual(["src/workflows/github-engine.test.ts"]);
    expect(commandTargets("pytest tests/test_a.py::test_x tests/test_b.py -v -n auto @")).toEqual(["tests/test_a.py", "tests/test_b.py"]);
    expect(commandTargets("vitest run ./src/a.spec.ts src/b.spec.ts:12")).toEqual(["src/a.spec.ts", "src/b.spec.ts"]);
    expect(commandTargets('bun test "src/a.test.ts" \\')).toEqual(["src/a.test.ts"]);
  });

  it("are none for a command that runs a whole suite", () => {
    expect(commandTargets("npm test @")).toEqual([]);
    expect(commandTargets("go test ./... @cli")).toEqual([]);
    expect(commandTargets("pytest tests @")).toEqual([]);
    expect(commandTargets("pytest -rA -n auto --cov=src @")).toEqual([]);
  });

  it("leave out what a flag excludes, spelled with a space or an equals sign", () => {
    expect(commandTargets("pytest tests/test_a.py --ignore tests/test_b.py --deselect tests/test_c.py")).toEqual(["tests/test_a.py"]);
    expect(commandTargets("pytest --ignore=tests/test_b.py tests/test_a.py")).toEqual(["tests/test_a.py"]);
  });

  it("do not take a file that is no test", () => {
    expect(commandTargets("python scripts/build.py --out dist/app.js")).toEqual([]);
  });
});

describe("a place for tests, by its name", () => {
  it("is a directory with a word of tests, specs, e2e or integration in any part of its path", () => {
    for (const name of ["tests", "e2e", "packages/api/spec", "cube-tests", "integration_tests", "apps/web/__tests__", "cypress", "qa"]) expect(isTestDirectory(name), name).toBe(true);
  });

  it("is not a directory that only has the letters in a longer word", () => {
    for (const name of ["cli", "converters/cube", "latest", "contest", "packages/specifications", "attestation"]) expect(isTestDirectory(name), name).toBe(false);
  });
});

describe("the trigger of a workflow that fires only when a workflow file is edited", () => {
  const body = "jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pytest\n";

  it("gates no code change: its tests are no test step of the project", () => {
    const selfOnly = "on:\n  push:\n    paths:\n      - '.github/workflows/docker.yml'\n  workflow_dispatch:\n";
    expect(gatingTestCommands(".github/workflows/docker.yml", selfOnly + body)).toEqual([]);
    // the leftover of a workflow whose code paths were commented out
    const commented = "on:\n  push:\n    # branches: [ \"main\" ]\n    paths:\n      # - 'ghidriff/**'\n      # - 'tests/**'\n      - '.github/workflows/pytest-docker.yml'\n  # pull_request:\n  workflow_dispatch:\n";
    expect(gatingTestCommands(".github/workflows/pytest-docker.yml", commented + body)).toEqual([]);
    expect(gatingTestCommands(".github/workflows/x.yml", "on:\n  pull_request:\n    paths: ['.github/workflows/**', '.github/workflows/x.yml']\n" + body)).toEqual([]);
  });

  it("still gates when one path is code, or when there is no filter", () => {
    expect(gatingTestCommands(".github/workflows/a.yml", "on:\n  push:\n    paths:\n      - 'src/**'\n      - '.github/workflows/a.yml'\n" + body)).toEqual(["pytest @"]);
    expect(gatingTestCommands(".github/workflows/a.yml", "on:\n  push:\n    paths-ignore:\n      - '.github/**'\n" + body)).toEqual(["pytest @"]);
    // the tests of the scripts beside the workflows (a self-test of CI tooling) gate changes to those scripts
    expect(gatingTestCommands(".github/workflows/selftest.yml", "on:\n  pull_request:\n    paths:\n      - '.github/scripts/**'\n      - '.github/workflows/selftest.yml'\n" + body)).toEqual(["pytest @"]);
    expect(gatingTestCommands(".github/workflows/a.yml", "on:\n  pull_request:\n    paths: ['.github/**']\n" + body)).toEqual(["pytest @"]);
    expect(gatingTestCommands(".github/workflows/a.yml", "on:\n  push:\n" + body)).toEqual(["pytest @"]);
    // a filter that only excludes names no file of the workflows
    expect(gatingTestCommands(".github/workflows/a.yml", "on:\n  push:\n    paths:\n      - '!docs/**'\n" + body)).toEqual(["pytest @"]);
    expect(gatingTestCommands(".github/workflows/a.yml", "on:\n  push:\n    paths:\n      - '.github/workflows/a.yml'\n  pull_request:\n" + body)).toEqual(["pytest @"]);
  });

  it("is a loss for the CI rule when a change narrows a workflow down to it, and none when it was already so", () => {
    const wide = "on:\n  push:\n    paths:\n      - 'src/**'\n      - '.github/workflows/a.yml'\n" + body;
    const narrow = "on:\n  push:\n    paths:\n      - '.github/workflows/a.yml'\n" + body;
    const narrowed = ciTestSteps(".github/workflows/a.yml", wide, narrow)!;
    expect([narrowed.before, narrowed.after, narrowed.ungatedAfter]).toEqual([1, 0, 1]);
    expect(resolveCiTestSteps([narrowed], "HEAD").map(found => found.reason)).toEqual(["Workflow keeps its tests but no longer runs on pushes or pull requests"]);
    const already = ciTestSteps(".github/workflows/a.yml", narrow, narrow.replace("push:", "# push:"))!;
    expect(resolveCiTestSteps([already], "HEAD")).toEqual([]);
  });
});

describe("the directory that a test command works in", () => {
  const dirs = (text: string) => ciTestSteps(".github/workflows/a.yml", text, null)!.directoriesBefore;
  const wrap = (job: string, top = "") => `on:\n  push:\n${top}jobs:\n${job}`;

  it("is the working-directory of its step, wherever the command stands in it", () => {
    expect(dirs(wrap("  t:\n    steps:\n      - name: Unit\n        working-directory: converters/cube\n        run: |\n          uv run pytest\n"))).toEqual(["converters/cube"]);
    expect(dirs(wrap("  t:\n    steps:\n      - working-directory: ./web/\n        run: npm test\n"))).toEqual(["web"]);
    expect(dirs(wrap("  t:\n    steps:\n    - name: Unit\n      working-directory: 'api'\n      # a comment\n      run: npm test\n"))).toEqual(["api"]);
  });

  it("is the defaults of its job, then the defaults of the workflow", () => {
    expect(dirs(wrap("  python:\n    defaults:\n      run:\n        working-directory: svc/python\n    steps:\n      - run: pytest\n  java:\n    defaults:\n      run:\n        working-directory: svc/java\n    steps:\n      - run: mvn test\n")))
      .toEqual(["svc/python", "svc/java"]);
    expect(dirs(wrap("  t:\n    steps:\n      - run: go test ./...\n", "defaults:\n  run:\n    working-directory: cli\n"))).toEqual(["cli"]);
    expect(dirs(wrap("  t:\n    defaults:\n      run:\n        working-directory: job\n    steps:\n      - run: go test ./...\n", "defaults:\n  run:\n    working-directory: top\n"))).toEqual(["job"]);
  });

  it("is that of the step first: the step overrides the defaults", () => {
    expect(dirs(wrap("  t:\n    defaults:\n      run:\n        working-directory: job\n    steps:\n      - working-directory: step\n        run: npm test\n      - run: npm test\n"))).toEqual(["step", "job"]);
  });

  it("is none for the root, for an expression, or when none is named", () => {
    expect(dirs(wrap("  t:\n    steps:\n      - run: npm test\n"))).toEqual([null]);
    expect(dirs(wrap("  t:\n    steps:\n      - working-directory: .\n        run: npm test\n"))).toEqual([null]);
    expect(dirs(wrap("  t:\n    steps:\n      - working-directory: ${{ matrix.package }}\n        run: npm test\n"))).toEqual([null]);
    // the step with an expression does not run in the default of its job
    expect(dirs(wrap("  t:\n    defaults:\n      run:\n        working-directory: job\n    steps:\n      - working-directory: ${{ matrix.package }}\n        run: npm test\n"))).toEqual([null]);
    expect(dirs(wrap("  t:\n    steps:\n      - working-directory: ../outside\n        run: npm test\n"))).toEqual([null]);
    // a value that Git would read as a pathspec names no directory
    expect(dirs(wrap("  t:\n    steps:\n      - working-directory: ':(icase)cli'\n        run: npm test\n"))).toEqual([null]);
    // the defaults of a job that an expression fills in are not the defaults of the workflow
    expect(dirs(wrap("  t:\n    defaults:\n      run:\n        working-directory: ${{ matrix.dir }}\n    steps:\n      - run: npm test\n", "defaults:\n  run:\n    working-directory: top\n"))).toEqual([null]);
  });

  it("is read in one pass, so that a workflow with thousands of commands is not slow", () => {
    const steps = Array.from({ length: 4000 }, (_, i) => `      - name: step ${i}\n        working-directory: pkg${i % 7}\n        run: |\n          npm test -- src/file${i}.test.ts\n`).join("");
    const started = Date.now();
    const count = ciTestSteps(".github/workflows/big.yml", wrap("  big:\n    steps:\n" + steps), null)!;
    expect(count.before).toBe(4000);
    expect(count.directoriesBefore!.slice(0, 3)).toEqual(["pkg0", "pkg1", "pkg2"]);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("is not an input of an action, and not a key of a matrix", () => {
    expect(dirs(wrap("  t:\n    strategy:\n      matrix:\n        include:\n          - working-directory: other\n    steps:\n      - uses: ./.github/actions/setup\n        with:\n          working-directory: web\n      - run: npm test\n"))).toEqual([null]);
  });

  it("names the files of the command, with the lines that continue it", () => {
    const folded = "jobs:\n  t:\n    steps:\n      - run: >-\n          JARVIS_TEST_ENGINE_BUILD=1 bun test --retry=2\n          src/a.test.ts\n          src/b.test.ts\n      - run: bun test src/c.test.ts\n      - run: |\n          bun test src/d.test.ts \\\n            src/e.test.ts\n          echo done\n";
    const count = ciTestSteps(".github/workflows/a.yml", "on:\n  push:\n" + folded, null)!;
    expect(count.filesBefore).toEqual([["src/a.test.ts", "src/b.test.ts"], ["src/c.test.ts"], ["src/d.test.ts", "src/e.test.ts"]]);
  });
});

describe("a workflow that lost its tests, judged by what is left to run", () => {
  const count = (before: string, after: string | null = null, file = ".github/workflows/old.yml") => ciTestSteps(file, before, after)!;
  const job = (command: string, directory = "") => `${ON}jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      ${checkout}\n      - ${directory ? `working-directory: ${directory}\n        ` : ""}run: ${command}\n`;
  const reasons = (counts: ReturnType<typeof count>[], ...rest: [ReadonlySet<string>?, ReadonlySet<string>?, ReadonlySet<string>?, ReadonlySet<string>?]) => resolveCiTestSteps(counts, "HEAD", ...rest).map(found => found.file);

  it("is not reported when its directory is gone", () => {
    const old = count(job("go test ./...", "cli"));
    expect(reasons([old], new Set(), new Set(), new Set(["cli"]))).toEqual([]);
    expect(reasons([old], new Set(), new Set(), new Set(["web"]))).toEqual([".github/workflows/old.yml"]);
    expect(reasons([old])).toEqual([".github/workflows/old.yml"]);
  });

  it("is reported when a command of it worked in no directory that is gone", () => {
    const old = count(job("go test ./...", "cli").replace(/\n$/, "\n      - run: npm test\n"));
    expect(reasons([old], new Set(), new Set(), new Set(["cli"]))).toEqual([".github/workflows/old.yml"]);
  });

  it("is not reported when the files its command names are named by a workflow of the change", () => {
    const old = count(job("bun test src/a.test.ts src/b.test.ts"));
    const main = count(job("bun test --retry=2 src/a.test.ts src/b.test.ts src/c.test.ts"), job("bun test --retry=2 src/a.test.ts src/b.test.ts src/c.test.ts src/d.test.ts"), ".github/workflows/test.yml");
    expect(reasons([old, main])).toEqual([]);
    // one file of two is not named
    const partial = count(job("bun test src/a.test.ts"), job("bun test src/a.test.ts src/z.test.ts"), ".github/workflows/test.yml");
    expect(reasons([count(job("bun test src/a.test.ts src/b.test.ts")), partial])).toEqual([".github/workflows/old.yml"]);
  });

  it("is not reported when the files are named by a workflow that the change did not touch, and is when they are not", () => {
    const old = count(job("pytest tests/test_a.py"));
    expect(reasons([old], new Set(), new Set(), new Set(), new Set(["tests/test_a.py"]))).toEqual([]);
    expect(reasons([old], new Set(), new Set(), new Set(), new Set(["tests/test_b.py"]))).toEqual([".github/workflows/old.yml"]);
  });

  it("is reported when the command that names the files leaves them out", () => {
    const old = count(job("pytest tests/test_a.py"));
    const other = count(job("pytest tests/test_x.py"), job("pytest tests --ignore tests/test_a.py"), ".github/workflows/test.yml");
    expect(reasons([old, other])).toEqual([".github/workflows/old.yml"]);
  });

  it("is reported when the other workflow names the same relative path in another directory", () => {
    const old = count(job("bun test tests/a.test.ts", "web"));
    const other = count(job("bun test tests/b.test.ts", "api"), job("bun test tests/a.test.ts tests/b.test.ts", "api"), ".github/workflows/api.yml");
    expect(reasons([old, other])).toEqual([".github/workflows/old.yml"]);
    // ... and is not when the path from the root of the repository is the same
    const root = count(job("bun test tests/b.test.ts"), job("bun test web/tests/a.test.ts tests/b.test.ts"), ".github/workflows/all.yml");
    expect(reasons([old, root])).toEqual([]);
  });

  it("is reported when the command names no file: a whole suite is not named by another one", () => {
    const old = count(job("pytest"));
    const other = count(job("pytest tests/test_a.py"), job("pytest tests/test_a.py tests/test_b.py"), ".github/workflows/test.yml");
    expect(reasons([old, other])).toEqual([".github/workflows/old.yml"]);
  });
});

describe("a workflow deleted or cut down, in a repository", () => {
  let dir: string;
  let base: string;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  const commit = (message = "change") => { git("add", "-A"); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  /** The findings that the CI rule makes: the files of the workflows, by their reason. */
  const lost = async () => (await reviewChanges({ cwd: dir, base })).infractions.filter(found => found.type === "guard-weakened").map(found => `${found.file}: ${found.reason}`);

  const GO_WORKFLOW = `name: CLI\n${ON.replace("branches: [main]", "branches: [main]\n    paths:\n      - 'cli/**'\n      - '.github/workflows/cli.yml'")}jobs:\n  test:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: cli\n    steps:\n      ${checkout}\n      - run: go test ./...\n`;
  const addCli = () => {
    write("cli/main.go", "package main\n\nfunc main() {}\n");
    write("cli/util.go", "package main\n\nfunc add(a, b int) int { return a + b }\n");
    write("cli/main_test.go", "package main\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n\tif add(1, 2) != 3 {\n\t\tt.Fatal(\"no\")\n\t}\n}\n");
    write(".github/workflows/cli.yml", GO_WORKFLOW);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "roast-moved-gates-"));
    git("init", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
    write("README.md", "test repository\n");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe("together with the code it tested", () => {
    it("is not reported: the component and its workflow are removed in one change", async () => {
      addCli();
      base = commit("base");
      git("rm", "-rq", "cli", ".github/workflows/cli.yml"); commit("remove the Go CLI");
      expect(await lost()).toEqual([]);
    });

    it("is not reported in a review of the working tree or of the index either (what the hook reads)", async () => {
      addCli();
      base = commit("base");
      fs.rmSync(path.join(dir, "cli"), { recursive: true });
      fs.rmSync(path.join(dir, ".github/workflows/cli.yml"));
      const kinds = (result: Awaited<ReturnType<typeof reviewWorktreeChanges>>) => result.infractions.filter(found => found.type === "guard-weakened").map(found => found.type);
      expect(kinds(await reviewWorktreeChanges({ cwd: dir }))).toEqual([]);
      git("add", "-A");
      expect(kinds(await reviewStagedChanges({ cwd: dir }))).toEqual([]);
    });

    it("is reported when part of the directory stays", async () => {
      addCli();
      write("cli/docs.go", "package main\n");
      base = commit("base");
      git("rm", "-q", "cli/main.go", "cli/util.go", "cli/main_test.go", ".github/workflows/cli.yml"); commit("remove most of the CLI");
      expect(await lost()).toEqual([".github/workflows/cli.yml: Test step removed from CI"]);
    });

    it("is reported when the code moved to another directory: it lives on and so do its tests", async () => {
      addCli();
      base = commit("base");
      git("mv", "cli", "tools-cli"); git("rm", "-q", ".github/workflows/cli.yml"); commit("move the CLI and drop the workflow");
      expect(await lost()).toEqual([".github/workflows/cli.yml: Test step removed from CI"]);
    });

    it("is reported when the directory held tests and nothing else: the suite is what went", async () => {
      write("e2e/login.spec.ts", "import { test } from '@playwright/test';\ntest('logs in', async ({ page }) => { await page.goto('/'); });\n");
      write("e2e/helpers.ts", "export const wait = () => 1;\n");
      write(".github/workflows/e2e.yml", `name: e2e\n${ON}jobs:\n  e2e:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: e2e\n    steps:\n      ${checkout}\n      - run: npx playwright test\n`);
      base = commit("base");
      git("rm", "-rq", "e2e", ".github/workflows/e2e.yml"); commit("drop the failing end-to-end suite");
      expect(await lost()).toEqual([".github/workflows/e2e.yml: Test step removed from CI"]);
    });

    it("is reported when the workflow names no directory: nothing says which code it tested", async () => {
      addCli();
      write(".github/workflows/cli.yml", GO_WORKFLOW.replace("    defaults:\n      run:\n        working-directory: cli\n", "").replace("go test ./...", "go test ./cli/..."));
      base = commit("base");
      git("rm", "-rq", "cli", ".github/workflows/cli.yml"); commit("remove the Go CLI");
      expect(await lost()).toEqual([".github/workflows/cli.yml: Test step removed from CI"]);
    });

    it("is not reported for the job of a directory that went, in a workflow that keeps another job", async () => {
      const both = (python: boolean) => `name: svc\n${ON}jobs:\n${python ? "  python:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: svc/python\n    steps:\n      " + checkout + "\n      - run: pytest\n" : ""}  java:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: svc/java\n    steps:\n      ${checkout}\n      - run: mvn -B verify\n`;
      write("svc/python/app.py", "def run():\n    return 1\n");
      write("svc/python/tests/test_app.py", "from app import run\n\ndef test_run():\n    assert run() == 1\n");
      write("svc/java/App.java", "class App {}\n");
      write(".github/workflows/svc.yml", both(true));
      base = commit("base");
      git("rm", "-rq", "svc/python"); write(".github/workflows/svc.yml", both(false)); commit("remove the Python part");
      expect(await lost()).toEqual([]);
    });

    it("is reported for that job when its directory stays", async () => {
      const both = (python: boolean) => `name: svc\n${ON}jobs:\n${python ? "  python:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: svc/python\n    steps:\n      " + checkout + "\n      - run: pytest\n" : ""}  java:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: svc/java\n    steps:\n      ${checkout}\n      - run: mvn -B verify\n`;
      write("svc/python/app.py", "def run():\n    return 1\n");
      write("svc/java/App.java", "class App {}\n");
      write(".github/workflows/svc.yml", both(true));
      base = commit("base");
      write(".github/workflows/svc.yml", both(false)); commit("stop testing the Python part");
      expect(await lost()).toEqual([".github/workflows/svc.yml: Test step removed from CI"]);
    });
  });

  describe("while another workflow names its test files", () => {
    const qualification = (name: string, file: string) => `name: ${name}\non:\n  pull_request:\n    paths:\n      - 'src/**'\njobs:\n  engine:\n    runs-on: ubuntu-latest\n    steps:\n      ${checkout}\n      - run: ${name.toUpperCase()}=1 bun test src/pieces/${file}\n`;
    const main = (...files: string[]) => `name: Tests\n${ON}jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      ${checkout}\n      - run: bun test\n      - run: >-\n          ENGINE_BUILD=1 bun test --retry=2\n${files.map(file => `          src/pieces/${file}\n`).join("")}`;

    it("is not reported when they are listed in the main workflow, whether it is touched or not", async () => {
      write(".github/workflows/trello.yml", qualification("trello", "trello-engine.test.ts"));
      write(".github/workflows/github.yml", qualification("github", "github-engine.test.ts"));
      write(".github/workflows/test.yml", main("notion-engine.test.ts"));
      base = commit("base");
      git("rm", "-q", ".github/workflows/trello.yml", ".github/workflows/github.yml");
      write(".github/workflows/test.yml", main("notion-engine.test.ts", "trello-engine.test.ts", "github-engine.test.ts")); commit("require the engine qualifications in the main workflow");
      expect(await lost()).toEqual([]);

      write(".github/workflows/mailchimp.yml", qualification("mailchimp", "mailchimp-engine.test.ts"));
      write(".github/workflows/test.yml", main("notion-engine.test.ts", "trello-engine.test.ts", "github-engine.test.ts", "mailchimp-engine.test.ts"));
      base = commit("add one more");
      git("rm", "-q", ".github/workflows/mailchimp.yml"); commit("drop the redundant workflow");
      expect(await lost()).toEqual([]);
    });

    it("is reported when the main workflow does not list one of them", async () => {
      write(".github/workflows/trello.yml", qualification("trello", "trello-engine.test.ts"));
      write(".github/workflows/test.yml", main("notion-engine.test.ts"));
      base = commit("base");
      git("rm", "-q", ".github/workflows/trello.yml"); commit("drop the qualification");
      expect(await lost()).toEqual([".github/workflows/trello.yml: Test step removed from CI"]);
    });

    it("is reported when the workflow that lists them is one that gates nothing", async () => {
      write(".github/workflows/trello.yml", qualification("trello", "trello-engine.test.ts"));
      write(".github/workflows/nightly.yml", main("trello-engine.test.ts").replace(ON, "on:\n  schedule:\n    - cron: '0 3 * * *'\n"));
      base = commit("base");
      git("rm", "-q", ".github/workflows/trello.yml"); commit("drop the qualification");
      expect(await lost()).toEqual([".github/workflows/trello.yml: Test step removed from CI"]);
    });
  });

  describe("that already ran only when its own file changed", () => {
    const docker = (trigger: string) => `name: docker\n${trigger}jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      ${checkout}\n      - run: pytest -rAv\n`;
    const selfOnly = "on:\n  push:\n    # branches: [ \"main\" ]\n    paths:\n      # - 'ghidriff/**'\n      - '.github/workflows/docker.yml'\n  workflow_dispatch:\n";
    const manual = "on:\n  # push:\n  #   paths:\n  #     - '.github/workflows/docker.yml'\n  workflow_dispatch:\n";

    it("is not reported when it is made manual-only", async () => {
      write(".github/workflows/docker.yml", docker(selfOnly));
      write(".github/workflows/test.yml", `name: Tests\n${ON}jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      ${checkout}\n      - run: pytest -rA -n auto\n`);
      base = commit("base");
      write(".github/workflows/docker.yml", docker(manual)); commit("make the docker run manual");
      expect(await lost()).toEqual([]);
    });

    it("is reported when a change narrows the paths of a workflow that ran on code down to its own file", async () => {
      write(".github/workflows/docker.yml", docker("on:\n  push:\n    paths:\n      - 'src/**'\n      - '.github/workflows/docker.yml'\n"));
      base = commit("base");
      write(".github/workflows/docker.yml", docker("on:\n  push:\n    paths:\n      # - 'src/**'\n      - '.github/workflows/docker.yml'\n")); commit("only run when the workflow changes");
      expect(await lost()).toEqual([".github/workflows/docker.yml: Workflow keeps its tests but no longer runs on pushes or pull requests"]);
    });

    it("is reported when it ran on code and is made manual-only, with nothing else that runs the tests", async () => {
      write(".github/workflows/docker.yml", docker("on:\n  push:\n    paths:\n      - 'src/**'\n"));
      base = commit("base");
      write(".github/workflows/docker.yml", docker(manual)); commit("make it manual");
      expect(await lost()).toEqual([".github/workflows/docker.yml: Workflow keeps its tests but no longer runs on pushes or pull requests"]);
    });
  });
});
