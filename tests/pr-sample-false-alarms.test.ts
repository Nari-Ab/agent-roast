import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewChanges } from "../src/review.js";
import { mentionsCi } from "../src/ci-condition.js";
import { mockedSubjects } from "../src/mocks.js";
import { analyzeGuardFile, analyzeTestFile, commandPaths, gatingCalls, lostCalls } from "../src/tampering.js";

// Eleven 0.28.0 false alarms of 18 blocks on 8,584 recent pull requests of 58 repositories (docs/benchmarks.md, section 22): a workflow call written `$/.github/workflows/x.yml`, an assertion
// about how a spy was called, a skip that only happens off CI, a presence check written another way, and a workflow deleted with its unittest discovery directory.

describe("a workflow called through GitHub's self-repository reference", () => {
  const caller = (reference: string) => `on:\n  push:\njobs:\n  checks:\n    uses: ${reference}\n`;

  it("is a workflow that is called, as `./` is", () => {
    expect(gatingCalls(".github/workflows/main.yml", caller("$/.github/workflows/shared.yml"))).toEqual([".github/workflows/shared.yml"]);
    expect(gatingCalls(".github/workflows/main.yml", caller("./.github/workflows/shared.yml"))).toEqual([".github/workflows/shared.yml"]);
    expect(gatingCalls(".github/workflows/main.yml", caller("org/repo/.github/workflows/shared.yml@main"))).toEqual([]);
    expect(gatingCalls(".github/workflows/main.yml", caller('"$/.github/workflows/shared.yml" # same repository'))).toEqual([".github/workflows/shared.yml"]);
    expect(gatingCalls(".github/workflows/main.yml", caller("$/.github/workflows/shared.yml").replace("jobs:\n  checks:", "'jobs':\n  \"checks\":"))).toEqual([".github/workflows/shared.yml"]);
    expect(gatingCalls(".github/workflows/main.yml", caller("$/.github/workflows/shared.yml@main"))).toEqual([]);
    expect(gatingCalls(".github/workflows/main.yml", caller("$/.github/workflows/shared.yml.bak"))).toEqual([]);
  });

  it("is not a caller that went away when the spelling changes", () => {
    expect(lostCalls(".github/workflows/main.yml", caller("./.github/workflows/shared.yml"), caller("$/.github/workflows/shared.yml"))).toEqual([]);
    expect(lostCalls(".github/workflows/main.yml", caller("./.github/workflows/shared.yml"), caller("./.github/workflows/other.yml"))).toEqual([".github/workflows/shared.yml"]);
  });

  it("counts only job-level uses, excluding action steps and shell text", () => {
    const workflow = "on:\n  push:\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: $/.github/workflows/shared.yml\n      - run: |\n          uses: $/.github/workflows/shared.yml\n";
    expect(lostCalls(".github/workflows/main.yml", caller("./.github/workflows/shared.yml"), workflow)).toEqual([".github/workflows/shared.yml"]);
  });
});

describe("an assertion about how a spy of a mocked module was called", () => {
  const file = (assertion: string) => `import { useToast } from "@n8n/composables/useToast";\nvi.mock("@n8n/composables/useToast", () => {\n  const showMessage = vi.fn();\n  return { useToast: () => ({ showMessage }) };\n});\nit("shows the toast", async () => {\n  await run();\n  ${assertion}\n});\n`;

  it("is not a test that cannot fail", () => {
    expect(mockedSubjects(file("expect(useToast().showMessage).toHaveBeenCalledWith({ title: 'x', type: 'info' });"), "toast.test.ts")).toEqual([]);
    expect(mockedSubjects(file("expect(useToast().showMessage).not.toHaveBeenCalled();"), "toast.test.ts")).toEqual([]);
    expect(mockedSubjects(file("expect(useToast().showMessage).toHaveBeenCalledTimes(2);"), "toast.test.ts")).toEqual([]);
  });

  it("is still reported when the assertion reads what the mock returns", () => {
    expect(mockedSubjects(file("expect(useToast().showMessage).toBe(undefined);"), "toast.test.ts")).toHaveLength(1);
    expect(mockedSubjects(file("expect(useToast()).toEqual({ showMessage: undefined });"), "toast.test.ts")).toHaveLength(1);
  });
});

describe("a check that a property is there, written another way", () => {
  const test = (assertion: string) => `describe("schema", () => {\n  it("keeps the key", () => {\n    run();\n    ${assertion}\n    expect(done).toBe(true);\n  });\n});\n`;
  const weakened = (before: string, after: string) => {
    const found = analyzeTestFile("schema.test.ts", "schema.test.ts", test(before), test(after), "HEAD");
    return found.immediate.concat(found.rewritten).filter(item => item.type === "assertion-weakened");
  };

  it("is not weaker when a boolean about an own property becomes the descriptor of the same key, defined", () => {
    expect(weakened("expect(hasOwn(schema as Record<string, unknown>, 'additionalProperties')).toBe(true);", "expect(Object.getOwnPropertyDescriptor(schema, 'additionalProperties')).toBeDefined();")).toEqual([]);
    expect(weakened("expect(Object.hasOwn(schema, 'a')).toBe(true);", "expect(Object.getOwnPropertyDescriptor(schema, 'a')).toBeTruthy();")).toEqual([]);
    expect(weakened("expect(schema.hasOwnProperty('a')).toBe(true);", "expect(Object.getOwnPropertyDescriptor(schema, 'a')).not.toBeUndefined();")).toEqual([]);
  });

  it("is weaker when the key is another one, when `null` is what is ruled out, or when the boolean itself is only defined", () => {
    expect(weakened("expect(hasOwn(schema, 'a')).toBe(true);", "expect(Object.getOwnPropertyDescriptor(schema, 'b')).toBeDefined();").length).toBeGreaterThan(0);
    expect(weakened("expect(hasOwn(schema, 'a')).toBe(true);", "expect(Object.getOwnPropertyDescriptor(schema, 'a')).not.toBeNull();").length).toBeGreaterThan(0);
    expect(weakened("expect(hasOwn(schema, 'a')).toBe(true);", "expect(hasOwn(schema, 'a')).toBeDefined();").length).toBeGreaterThan(0);
  });

  it("still reports a different receiver or a descriptor wrapped in an always-defined array", () => {
    const before = "expect(hasOwn(schema, 'a')).toBe(true);";
    expect(weakened(before, "expect(Object.getOwnPropertyDescriptor(other, 'a')).toBeDefined();")).toHaveLength(1);
    expect(weakened(before, "expect([Object.getOwnPropertyDescriptor(schema, 'a')]).toBeDefined();")).toHaveLength(1);
  });

  it("an exact check into a bare `toBeDefined()` still is", () => {
    expect(weakened("expect(result.count).toBe(42);", "expect(result.count).toBeDefined();").length).toBeGreaterThan(0);
  });
});

describe("a skip that happens only off CI", () => {
  it("is not a condition that holds on CI", () => {
    expect(mentionsCi("not os.environ.get('GITHUB_ACTIONS')")).toBe(false);
    expect(mentionsCi("!process.env.CI")).toBe(false);
  });

  it("is one that holds on CI when the mention is positive, or a negation may not govern it", () => {
    expect(mentionsCi("os.environ.get('GITHUB_ACTIONS')")).toBe(true);
    expect(mentionsCi("process.env.CI")).toBe(true);
    expect(mentionsCi("!!process.env.CI && platform === 'linux'")).toBe(true);
    expect(mentionsCi("not flaky and os.environ.get('CI')")).toBe(true);
    expect(mentionsCi("process.env.CI !== 'true'")).toBe(true);
    expect(mentionsCi("!(process.env.CI && enabled)")).toBe(true);
    expect(mentionsCi("!process.env.CI || enabled")).toBe(true);
    expect(mentionsCi("not os.getenv('CI') is None")).toBe(true);
    expect(mentionsCi("sys.platform == 'win32'")).toBe(false);
  });
});

describe("a step that may fail because a later step reads its outcome", () => {
  const workflow = (read: boolean, tolerated: boolean) => `on:\n  push:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: Release\n        id: release\n${tolerated ? "        continue-on-error: true\n" : ""}        run: npm run release\n${read ? "      - name: Retry the release\n        if: steps.release.outcome == 'failure'\n        run: npm run release\n" : ""}`;
  const found = (before: string, after: string) => analyzeGuardFile(".github/workflows/release.yml", before, after, "HEAD").map(item => item.reason);

  it("still reports tolerance when a later step checks the outcome", () => {
    expect(found(workflow(false, false), workflow(true, true))).toEqual(["CI step is now allowed to fail"]);
  });

  it("is still reported when nothing reads the outcome", () => {
    expect(found(workflow(false, false), workflow(false, true))).toEqual(["CI step is now allowed to fail"]);
  });

  it("is still reported when the step that reads an outcome reads another step's", () => {
    const other = workflow(true, true).replace("steps.release.outcome", "steps.other.outcome");
    expect(found(workflow(false, false), other)).toEqual(["CI step is now allowed to fail"]);
  });

  it("still reports tolerance with multiline conditions", () => {
    const folded = workflow(false, true) + "      - name: Retry the release\n        id: retry\n        if: >-\n          steps.release.outcome == 'failure' &&\n          github.event_name == 'push'\n        run: npm run release\n";
    const plain = workflow(false, true) + "      - name: Retry the release\n        if: steps.other.outcome == 'success' ||\n          steps.release.outcome == 'failure'\n        run: npm run release\n";
    expect(found(workflow(false, false), folded)).toEqual(["CI step is now allowed to fail"]);
    expect(found(workflow(false, false), plain)).toEqual(["CI step is now allowed to fail"]);
  });

  it("is still reported when the outcome is only printed: a summary decides nothing", () => {
    const printed = workflow(false, true) + "      - name: Summary\n        if: always()\n        env:\n          RELEASE: ${{ steps.release.outcome }}\n        run: echo \"release: $RELEASE\" >> \"$GITHUB_STEP_SUMMARY\"\n";
    expect(found(workflow(false, false), printed)).toEqual(["CI step is now allowed to fail"]);
  });
});

describe("the directories that the arguments of a test command name", () => {
  it("recognize explicit unittest discovery directories", () => {
    expect(commandPaths("python3 -m unittest discover -s scripts/castiron -p 'test_custom_code*.py'")).toEqual(["scripts/castiron"]);
    expect(commandPaths("PYTHONPATH=tools/x/worker python -m unittest discover -s tools/x/worker/tests -t tools/x/worker")).toEqual(["tools/x/worker"]);
  });

  it("ignore other commands, shell chains, absolute paths and parent paths", () => {
    expect(commandPaths("pytest tests/test_a.py -k 'not slow' --cov=src/pkg ../shared /abs/dir $DIR/x ./... https://example.org/a/b")).toEqual([]);
    expect(commandPaths("python -m unittest discover -s ./")).toEqual([]);
    expect(commandPaths("python -m unittest discover -s ../shared")).toEqual([]);
    expect(commandPaths("python -m unittest discover -s /abs/dir")).toEqual([]);
    expect(commandPaths("python -m unittest discover -s scripts/castiron && npm test")).toEqual([]);
    expect(commandPaths("go test ./cli/... ./...")).toEqual([]);
  });
});

describe("a workflow deleted with the code that its arguments name", () => {
  let dir: string;
  let base: string;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  const commit = (message = "change") => { git("add", "-A"); git("commit", "-q", "-m", message); return git("rev-parse", "HEAD"); };
  const lost = async () => (await reviewChanges({ cwd: dir, base })).infractions.filter(found => found.type === "guard-weakened").map(found => `${found.file}: ${found.reason}`);
  const workflow = (command: string) => `name: tests\non:\n  push:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: ${command}\n`;
  const budget = "python3 -m unittest discover -s scripts/castiron -p 'test_custom_code*.py'";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "roast-args-"));
    git("init", "-q", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
    write("README.md", "test repository\n");
    write("scripts/castiron/report.py", "def report():\n    return 1\n");
    write("scripts/castiron/test_custom_code.py", "from report import report\n\ndef test_report():\n    assert report() == 1\n");
    write("scripts/castiron/generated-files.json", "{}\n");
    write("scripts/other.py", "print('other')\n");
    write(".github/workflows/castiron.yml", workflow(budget));
    base = commit("base");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is not reported when the code goes and only a data file stays", async () => {
    git("rm", "-q", "scripts/castiron/report.py", "scripts/castiron/test_custom_code.py", ".github/workflows/castiron.yml"); commit("retire the budget");
    expect(await lost()).toEqual([]);
  });

  it("is not reported when the arguments name the tests of a directory that goes whole, with a PYTHONPATH and a top-level directory", async () => {
    write("tools/caretaker/worker/app.py", "def app():\n    return 1\n");
    write("tools/caretaker/worker/tests/test_app.py", "from app import app\n\ndef test_app():\n    assert app() == 1\n");
    write("tools/bot/README.md", "kept\n");
    write(".github/workflows/tools.yml", workflow("|\n          PYTHONPATH=tools/caretaker/worker python -m unittest discover -s tools/caretaker/worker/tests -t tools/caretaker/worker"));
    base = commit("add the tool");
    git("rm", "-rq", "tools/caretaker", ".github/workflows/tools.yml"); commit("remove the unused tool");
    expect(await lost()).toEqual([]);
  });

  it("is reported when code stays in the directory", async () => {
    git("rm", "-q", "scripts/castiron/test_custom_code.py", ".github/workflows/castiron.yml"); commit("drop the tests and the workflow");
    expect(await lost()).toEqual([".github/workflows/castiron.yml: Test step removed from CI"]);
  });

  it("is reported when the code moved to another directory", async () => {
    git("mv", "scripts/castiron/report.py", "scripts/budget-report.py"); git("rm", "-q", "scripts/castiron/test_custom_code.py", ".github/workflows/castiron.yml"); commit("move the report");
    expect(await lost()).toEqual([".github/workflows/castiron.yml: Test step removed from CI"]);
  });

  it("is reported when one of two directories that the command names stays", async () => {
    write("scripts/a/a.py", "def a():\n    return 1\n");
    write("scripts/b/b.py", "def b():\n    return 1\n");
    write(".github/workflows/castiron.yml", workflow("python3 -m unittest discover -s scripts/a && python3 -m unittest discover -s scripts/b"));
    base = commit("two directories");
    git("rm", "-rq", "scripts/a", ".github/workflows/castiron.yml"); commit("remove one");
    expect(await lost()).toEqual([".github/workflows/castiron.yml: Test step removed from CI"]);
  });

  it("still reports a workflow when an earlier shell line changes where discovery runs", async () => {
    write(".github/workflows/castiron.yml", workflow(budget).replace(`run: ${budget}`, `run: |
          cd another-project
          ${budget}`));
    base = commit("use a multi-line script");
    git("rm", "-rq", "scripts/castiron", ".github/workflows/castiron.yml"); commit("remove the report");
    expect(await lost()).toEqual([".github/workflows/castiron.yml: Test step removed from CI"]);
  });

  it("is reported when the directory is a place for tests by its name", async () => {
    write("e2e/helpers.py", "def wait():\n    return 1\n");
    write(".github/workflows/e2e.yml", workflow("python3 -m unittest discover -s ./e2e"));
    base = commit("an end-to-end suite");
    git("rm", "-rq", "e2e", ".github/workflows/e2e.yml"); commit("drop the suite");
    expect(await lost()).toEqual([".github/workflows/e2e.yml: Test step removed from CI"]);
  });
});
