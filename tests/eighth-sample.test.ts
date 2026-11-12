import { describe, expect, it } from "vitest";
import { mockedSubjects } from "../src/mocks.js";
import { analyzeGuardFile, analyzeTestFile, ciTestSteps, resolveCiTestSteps } from "../src/tampering.js";

// False alarms that turned up while reading an eighth sample of 39 repositories that no earlier measurement had used (docs/benchmarks.md, section 12).
// The build that was measured on it, 0.20.0, was frozen before it was read, so these fixes are not part of that measurement.

const keys = (text: string) => mockedSubjects(text, "stdout.test.ts").map(item => item.key);
const review = (before: string, after: string, file: string) => analyzeTestFile(file, file, before, after, "HEAD").immediate.map(found => found.type);
const guard = (file: string, before: string, after: string) => analyzeGuardFile(file, before, after, "HEAD").map(found => found.lineSnippet);

describe("a mock of a namespace import is in force for the member that the test configures", () => {
  const spy = "import * as filesystem from 'node:fs/promises';\nimport { it, expect, vi } from 'vitest';\nvi.mock('node:fs/promises', { spy: true });\n";
  const test = (body: string) => `it("writes the receipt", async () => {\n${body}\n});\n`;

  it("does not read the real stat() of a module that is spied on as a mock because another member is configured", () => {
    const text = spy + test("  vi.mocked(filesystem.open).mockImplementation(async (...args) => actual.open(...args));\n  expect(await filesystem.stat(artifact)).toEqual({ size: 0 });");
    expect(keys(text)).toEqual([]);
  });

  it("does not read an automock whose configured member is another one", () => {
    const text = "import * as filesystem from 'node:fs/promises';\nvi.mock('node:fs/promises');\n" + test("  vi.mocked(filesystem.open).mockResolvedValue(handle);\n  expect(await filesystem.stat(artifact)).toEqual({ size: 0 });");
    expect(keys(text)).toEqual([]);
  });

  it("still reads the member that the test configures and asserts on", () => {
    const text = spy + test("  vi.mocked(filesystem.stat).mockResolvedValue({ size: 0 } as never);\n  expect(await filesystem.stat(artifact)).toEqual({ size: 0 });");
    expect(keys(text)).toEqual(["node:fs/promises::stat"]);
  });

  it("still reads a named import that the test configures", () => {
    const text = "import { stat } from 'node:fs/promises';\nvi.mock('node:fs/promises');\n" + test("  vi.mocked(stat).mockResolvedValue({ size: 0 } as never);\n  expect(await stat(artifact)).toEqual({ size: 0 });");
    expect(keys(text)).toEqual(["node:fs/promises::stat"]);
  });
});

describe("a Python expectation of nothing turned into its opposite is flipped, not weaker", () => {
  const file = "tests/test_memory.py";
  const py = (assertion: string) => `def test_batch_store_preserves_imported_created_at():\n    memory = load()\n    ${assertion}\n`;

  it("does not report `is None` turned into `is not None`, or `== 0` turned into a bare name", () => {
    expect(review(py("assert memory.created_at.tzinfo is None"), py("assert memory.created_at.tzinfo is not None"), file)).toEqual([]);
    expect(review(py("assert memory.count == 0"), py("assert memory.count"), file)).toEqual([]);
    expect(review(py("assert not memory.items"), py("assert memory.items is not None"), file)).toEqual([]);
  });

  it("does not read the negation of a compound condition as a compound check", () => {
    expect(review(py("assert not (cap > 0 and used + 50 >= cap)"), py("assert admitted.unlimited"), file)).toEqual([]);
  });

  it("still reports a compound check that lost a clause, whatever the clause says", () => {
    expect(review(py("assert data is not None and not data.refresh_pending"), py("assert data is not None"), file)).toEqual(["assertion-weakened"]);
  });

  it("still reports an exact value turned into a presence check", () => {
    expect(review(py("assert memory.count == 2"), py("assert memory.count is not None"), file)).toEqual(["assertion-weakened"]);
    expect(review(py("assert memory.created_at.tzinfo == timezone.utc"), py("assert memory.created_at.tzinfo is not None"), file)).toEqual(["assertion-weakened"]);
  });
});

describe("ruff ignores when an explicit target-version is dropped", () => {
  const file = "pyproject.toml";
  const config = (target: string | null, required: string, ignore: string[]) =>
    `[project]\nrequires-python = ">=${required}"\n\n[tool.ruff]\n${target ? `target-version = "${target}"\n` : ""}\n[tool.ruff.lint]\nselect = ["E", "UP"]\nignore = [\n${ignore.map(code => `  "${code}",`).join("\n")}\n]\n`;

  it("are not reported when ruff now reads a higher target from requires-python", () => {
    expect(guard(file, config("py39", "3.11", ["E501"]), config(null, "3.11", ["E501", "UP041", "UP042"]))).toEqual([]);
  });

  it("are reported when the target it falls back to is not higher", () => {
    expect(guard(file, config("py311", "3.9", ["E501"]), config(null, "3.9", ["E501", "UP041"]))).toEqual(["ruff ignore: +UP041"]);
    expect(guard(file, config("py39", "3.9", ["E501"]), config(null, "3.9", ["E501", "UP041"]))).toEqual(["ruff ignore: +UP041"]);
  });
});

describe("a test command written inside a block of commands", () => {
  const workflow = (step: string) => `on:\n  push:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - ${step}\n`;
  const count = (before: string, after: string | null, file = ".github/workflows/ci.yml") => ciTestSteps(file, before, after)!;
  const folded = "run: >-\n          xvfb-run --auto-servernum\n          --server-args=\"-screen 0 1280x720x24\"\n          hvigorw test\n          -p module=dimina,entry\n          --no-daemon";
  const block = (...lines: string[]) => workflow(`run: |\n${lines.map(line => `          ${line}`).join("\n")}`);

  it("is a test step in a folded block, and the lines of the block are one command", () => {
    expect(count(workflow("run: hvigorw test -p module=dimina,entry --no-daemon"), workflow(folded)).after).toBe(1);
    expect(resolveCiTestSteps([count(workflow("run: hvigorw test -p module=dimina,entry --no-daemon"), workflow(folded))], "HEAD")).toEqual([]);
  });

  it("is a test step in a GitLab script list", () => {
    const gitlab = "test:\n  script:\n    - npm ci\n    - hvigorw test\n";
    expect(count(gitlab, gitlab, ".gitlab-ci.yml").after).toBe(1);
  });

  it("is a line of a literal block that runs a tool with `test` as its first argument, or a runner that is known by name", () => {
    expect(count(block("npm ci", "pytest -x"), null).before).toBe(1);
    expect(count(block("set -euo pipefail", "hvigorw test \\", "  -p module=dimina", "  --no-daemon"), null).before).toBe(1);
    expect(count(block("terraform test", "time go test ./..."), null).before).toBe(2);
    expect(count(block("sudo -E hvigorw test", "CI=1 dart test"), null).before).toBe(2);
  });

  it("is not read from a literal block that only has the word, as a directory, a message, an argument or a file", () => {
    expect(count(block("mkdir test", "echo \"ZIP test PASS\"", "cd test", "rm -rf test", "ls test"), null).before).toBe(0);
    expect(count(block("kubectl -n test get pods", "docker build -t app/test .", "git checkout test", "cp -r test dist"), null).before).toBe(0);
    expect(count(block("cat test", "grep -r todo test", "tar czf out.tgz test", "zip -r test.zip test"), null).before).toBe(0);
  });

  it("is not read from the code of a script in a literal block, an assignment of a message, or an argument", () => {
    expect(count(block("FAILED_TESTS=\"- Compatibility test command completed with $OUTCOME. Check the log\"", "for test in tests:", "for test in backend/sql/*.sql; do", "assert test['status'] == 'passed', test"), null).before).toBe(0);
    expect(count(block("-expect test=1 --expect web=1", "  -entry test"), null).before).toBe(0);
  });

  it("is the same test step in a folded block and in a literal block", () => {
    const folded = workflow("run: >-\n          xvfb-run --auto-servernum\n          hvigorw test\n          -p module=dimina");
    const literal = workflow("run: |\n          set -euo pipefail\n          hvigorw test \\\n            -p module=dimina\n          test -s result.txt");
    expect(resolveCiTestSteps([count(folded, literal)], "HEAD")).toEqual([]);
    expect(resolveCiTestSteps([count(literal, folded)], "HEAD")).toEqual([]);
  });

  it("is an item of a script list that stands at the indent of its key, and the list ends with it", () => {
    const gitlab = "test:\n  script:\n  - npm ci\n  - hvigorw test\n  after_script:\n  - hvigorw build\n";
    expect(count(gitlab, gitlab, ".gitlab-ci.yml").after).toBe(1);
    expect(count("test:\n  script:\n  - npm ci\n", "test:\n  script:\n  - npm ci\n  - hvigorw build\n", ".gitlab-ci.yml").after).toBe(0);
  });

  it("is not an item of a script list that only prints a message", () => {
    expect(count("test:\n  script:\n    - echo \"Running tests\"\n    - ./ci/scripts/gitlab/tests.sh\n", null, ".gitlab-ci.yml").before).toBe(1);
  });

  it("is not read from the steps of a job that is called `run`, or from a github-script step", () => {
    const job = "on:\n  push:\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Add server log to artifact\n        run: |\n          zip -ur export.zip server.log\n      - name: Upload test artifacts\n        uses: actions/upload-artifact@v4\n";
    expect(count(job, null).before).toBe(0);
    const script = workflow("uses: actions/github-script@v7\n        with:\n          script: |\n            core.setOutput('test', 'unit')");
    expect(count(script, null).before).toBe(0);
  });

  it("is not taken from the shell builtin with a string or a variable", () => {
    expect(count(workflow("run: test \"$(git rev-parse HEAD)\" = \"$EXPECTED\""), null).before).toBe(0);
    expect(count(workflow("run: if test $RESULT = success; then echo ok; fi"), null).before).toBe(0);
  });

  it("is not taken from a block that only mentions a test file or a test directory name", () => {
    expect(count(workflow("run: |\n          echo hi\n          npm run lint\n          rm -rf build/test-output"), null).before).toBe(0);
  });

  it("is still a removal when the block has no test command", () => {
    expect(resolveCiTestSteps([count(workflow("run: hvigorw test"), workflow("run: >-\n          xvfb-run\n          hvigorw build"))], "HEAD").map(found => found.type)).toEqual(["guard-weakened"]);
  });
});
