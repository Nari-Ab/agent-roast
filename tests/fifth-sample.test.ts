import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { mockedSubjects } from "../src/mocks.js";
import { analyzeGuardFile, analyzeTestFile, ciTestSteps, newTestMarkers, resolveCiTestSteps } from "../src/tampering.js";

// False alarms that turned up when 0.18.0 and 0.19.0 were replayed on 40 repositories that had not been read before (docs/benchmarks.md, section 10, sample 5).

const scan = (text: string, file: string) =>
  auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const review = (before: string, after: string, file: string) => analyzeTestFile(file, file, before, after, "HEAD").immediate.map(f => f.type);
const markers = (before: string, after: string, file: string) => newTestMarkers(scan(before, file), scan(after, file), before, after).map(f => f.type);
const reasons = (before: string, after: string, file: string) => analyzeGuardFile(file, before, after, "HEAD").map(f => f.reason);

describe("a todo whose title a formatter put on the next line", () => {
  const file = "src/gateway.test.ts";
  const before = "describe('gateway', () => {\n  it('sends the model', () => {\n    expect(1).toBe(1);\n  });\n});\n";

  it("is not a test switched off when it is the title of a test the change adds", () => {
    const after = before.replace("});\n});\n", '});\n\n  // TODO: needs the gateway to forward the header\n  it.todo(\n    "sends the beta header to /run, and the gateway passes it on"\n  );\n});\n');
    expect(markers(before, after, file)).toEqual([]);
  });

  it("is reported when it takes the place of a test that was running", () => {
    const after = before.replace("it('sends the model', () => {\n    expect(1).toBe(1);\n  });", "it.todo(\n    'sends the model'\n  );");
    expect(markers(before, after, file)).toEqual(["test-skip"]);
  });

  it("is read the same on one line", () => {
    expect(markers(before, before.replace("});\n});\n", '});\n  it.todo("sends the beta header");\n});\n'), file)).toEqual([]);
  });
});

describe("a workflow that runs when a version tag is pushed gates no change", () => {
  const file = ".github/workflows/release.yml";
  const tagged = "  push:\n    tags:\n      - 'v*'";
  const release = (on: string, job = "", run = "./build-images.sh") => `name: release\non:\n${on}\njobs:\n  images:\n${job}    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;

  it("leaves a build job that is allowed to fail alone, with a manual dispatch next to the tag", () => {
    const on = `${tagged}\n  workflow_dispatch:`;
    expect(reasons(release(on), release(on, "    continue-on-error: true\n"), file)).toEqual([]);
  });

  it("leaves it alone when the tag is the only trigger", () => {
    expect(reasons(release(tagged), release(tagged, "    if: false\n"), file)).toEqual([]);
  });

  it("still reads a test command that is allowed to fail in such a workflow", () => {
    const tests = release(tagged, "", "npm test");
    expect(reasons(tests, tests.replace("run: npm test", "run: npm test\n        continue-on-error: true"), file)).toEqual(["CI step is now allowed to fail"]);
  });

  it.each([
    ["branches and tags", "  push:\n    branches: [main]\n    tags: ['v*']"],
    ["branches to ignore", "  push:\n    branches-ignore: [wip]"],
    ["every push", "  push:"],
    ["a pull request next to the tag", `${tagged}\n  pull_request:`],
  ])("still reads a build job that is allowed to fail when it runs on %s", (_, on) => {
    expect(reasons(release(on), release(on, "    continue-on-error: true\n"), file)).toEqual(["CI step is now allowed to fail"]);
  });

  it("reads tests that moved from every push to tags as no longer running on a push", () => {
    const branches = "on:\n  push:\n    branches: [main]\njobs:\n  t:\n    steps:\n    - run: npm test\n";
    const tags = "on:\n  push:\n    tags: ['v*']\njobs:\n  t:\n    steps:\n    - run: npm test\n";
    const found = resolveCiTestSteps([ciTestSteps(".github/workflows/t.yml", branches, tags)!], "HEAD");
    expect(found.map(f => f.reason)).toEqual(["Workflow keeps its tests but no longer runs on pushes or pull requests"]);
  });

  it("does not count the test step of a release pipeline as one that gates", () => {
    expect(ciTestSteps(".github/workflows/t.yml", "on:\n  push:\n    tags: ['v*']\njobs:\n  t:\n    steps:\n    - run: npm test\n", null)?.before).toBe(0);
  });
});

describe("a step that only uploads, signs in or publishes is not a check", () => {
  const file = ".github/workflows/ci.yml";
  const ci = (step: string) => `on:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n      - name: Step\n${step}`;

  it.each([
    "actions/upload-artifact@v6", "actions/download-artifact@v4", "actions/cache/save@v4", "azure/login@v3", "docker/login-action@v3", "docker/build-push-action@v7",
    "softprops/action-gh-release@v3", "codecov/codecov-action@v5", "peter-evans/create-or-update-comment@v4", "aws-actions/configure-aws-credentials@v4",
  ])("leaves %s allowed to fail, or switched off, alone", (action) => {
    const plain = `        uses: ${action}\n        with:\n          name: evidence\n`;
    expect(reasons(ci(plain), ci(`        continue-on-error: true\n${plain}`), file)).toEqual([]);
    expect(reasons(ci(plain), ci(`        if: false\n${plain}`), file)).toEqual([]);
  });

  it.each(["acme/checker@v1", "github/codeql-action/analyze@v3", "golangci/golangci-lint-action@v6"])("still reads %s allowed to fail", (action) => {
    const plain = `        uses: ${action}\n`;
    expect(reasons(ci(plain), ci(`        continue-on-error: true\n${plain}`), file)).toEqual(["CI step is now allowed to fail"]);
  });

  it("still reads a run step and a test step allowed to fail", () => {
    expect(reasons(ci("        run: ./scripts/check.sh\n"), ci("        continue-on-error: true\n        run: ./scripts/check.sh\n"), file)).toEqual(["CI step is now allowed to fail"]);
    const tests = ci("        uses: actions/upload-artifact@v6\n");
    expect(reasons(tests, tests.replace("      - run: npm test\n", "      - run: npm test\n        continue-on-error: true\n"), file)).toEqual(["CI step is now allowed to fail"]);
  });

  it("does not let a job that holds an upload hide a test step in it", () => {
    const job = (extra: string) => `on:\n  pull_request:\njobs:\n  ci:\n${extra}    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n      - uses: actions/upload-artifact@v6\n`;
    expect(reasons(job(""), job("    continue-on-error: true\n"), file)).toEqual(["CI step is now allowed to fail"]);
  });
});

describe("the shell builtin test is not a test run", () => {
  const file = ".github/workflows/nightly.yml";
  const summary = 'test -f out/summary.md && cat out/summary.md >> "$GITHUB_STEP_SUMMARY" || true';
  const nightly = (steps: string[], on = "  pull_request:") => `on:\n${on}\njobs:\n  eval:\n    steps:\n${steps.map(step => `      - run: ${step}\n`).join("")}`;

  it("does not read a summary step that ends in || true as a test command that can no longer fail", () => {
    expect(reasons(nightly(["./eval.sh"]), nightly(["./eval.sh", summary]), file)).toEqual([]);
    expect(reasons(nightly([summary]), nightly([summary, summary]), file)).toEqual([]);
  });

  it.each([
    "if test -d build; then ./pack.sh; fi || true",
    "[ -f out/summary.md ] && cat out/summary.md || true",
    "! test -s report.txt || true",
  ])("does not read %j as a test run", (line) => {
    expect(reasons(nightly(["./eval.sh"]), nightly(["./eval.sh", line]), file)).toEqual([]);
  });

  it("does not read a file test inside a multi-line script as a test run", () => {
    const script = (body: string) => `on:\n  pull_request:\njobs:\n  eval:\n    steps:\n      - name: Summary\n        run: |\n${body}`;
    const before = script('          echo "done"\n'), after = script('          echo "done"\n          test -f out/summary.md && cat out/summary.md >> "$GITHUB_STEP_SUMMARY" || true\n');
    expect(reasons(before, after, file)).toEqual([]);
    expect(reasons(before, script('          echo "done"\n          test -f package.json && npm test || true\n'), file)).toEqual(["Test command can no longer fail the CI step"]);
  });

  it("still reads a test run that follows a file test", () => {
    expect(reasons(nightly(["test -f package.json && npm test"]), nightly(["test -f package.json && npm test || true"]), file)).toEqual(["Test command can no longer fail the CI step"]);
    expect(reasons(nightly(["./ci.sh test -v"]), nightly(["./ci.sh test -v || true"]), file)).toEqual(["Test command can no longer fail the CI step"]);
  });
});

describe("python -m unittest is a test command", () => {
  const workflow = (command: string) => `on:\n  pull_request:\njobs:\n  probe:\n    steps:\n      - run: ${command}\n`;
  const count = (before: string, after: string | null) => ciTestSteps(".github/workflows/poc.yml", before, after)!;

  it("does not read npm test replaced by python3 -m unittest as lost tests", () => {
    expect(resolveCiTestSteps([count(workflow("npm test"), workflow("python3 -m unittest tests.test_a tests.test_b"))], "HEAD")).toEqual([]);
  });

  it.each([
    "python -m unittest discover", "python3.12 -m pytest -q", "python3 -m nose2", "nosetests -v", "playwright test --project=chromium", "cypress run", "karma start --single-run",
    "swift test", "hatch run test",
  ])("counts %s as a test step", (command) => {
    expect(count(workflow(command), workflow(command)).before).toBe(1);
  });

  it("still reports the step when it is removed", () => {
    expect(resolveCiTestSteps([count(workflow("python -m unittest"), workflow("python -m build"))], "HEAD").map(f => f.reason)).toEqual(["Test step removed from CI"]);
  });

  it("does not read python -m pip or a module named test_ as a test run", () => {
    expect(count(workflow("python -m pip install -e ."), workflow("python -m pip install -e .")).before).toBe(0);
  });
});

describe("a presence check written another way", () => {
  const file = "src/menu.test.ts";
  const test1 = (assertion: string) => `describe('menu', () => {\n  it('closes on Escape', async () => {\n    await open();\n    ${assertion}\n  });\n});\n`;
  const menu = "expect(wrapper.find('.menu').exists()).toBe(true);";

  it.each([
    "expect(document.querySelector('.menu')).not.toBeNull();",
    "expect(screen.queryByRole('menu')).toBeInTheDocument();",
    "expect(wrapper.find('.menu').exists()).toBeTruthy();",
    "expect(wrapper.get('.menu').exists()).toBeDefined();",
  ])("leaves the existence of an element turned into %s alone", (after) => {
    expect(review(test1(menu), test1(after), file)).toEqual([]);
  });

  it.each([
    "expect(menu).toBeDefined();",
    "expect(items).toBeTruthy();",
    "expect(wrapper.vm.open).toBeTruthy();",
  ])("still reads the existence of an element turned into %s", (after) => {
    expect(review(test1(menu), test1(after), file)).toEqual(["assertion-weakened"]);
  });

  it("still reads an exact count turned into a query that finds something", () => {
    expect(review(test1("expect(items.length).toBe(3);"), test1("expect(document.querySelector('.item')).not.toBeNull();"), file)).toEqual(["assertion-weakened"]);
  });
});

describe("an assertion on a mock's output next to an assertion on the code under test", () => {
  const head = "import { describe, expect, it, vi } from 'vitest'\nimport { venvPython } from '../lib'\nimport { getEnv } from './index'\n\nvi.mock('../lib', () => ({ venvPython: vi.fn((p: string) => `${p}/venv/bin/python3`) }))\n\n";
  const subjects = (body: string) => mockedSubjects(`${head}describe('env', () => {\n${body}})\n`, "src/index.test.ts").map(item => item.key);
  const test1 = (inner: string) => `  it('uses the venv', () => {\n${inner}  })\n`;

  it("is a redundant check, not a test that cannot fail", () => {
    expect(subjects(test1("    const python = venvPython('/x')\n    expect(getEnv('/x')).toEqual({ pip: python })\n    expect(python).not.toContain('standalone-env')\n"))).toEqual([]);
  });

  it("is still reported when every assertion of the test reads the mock", () => {
    expect(subjects(test1("    const python = venvPython('/x')\n    expect(python).not.toContain('standalone-env')\n"))).toEqual(["../lib::venvPython"]);
    expect(subjects(test1("    expect(venvPython('/x')).toBe('/x/venv/bin/python3')\n    expect(venvPython).toHaveBeenCalledWith('/x')\n"))).toEqual(["../lib::venvPython"]);
  });

  it("is still reported when the assertion on the code under test is in another test", () => {
    const body = `${test1("    expect(venvPython('/x')).toBe('/x/venv/bin/python3')\n")}${test1("    expect(getEnv('/x')).toEqual({})\n")}`;
    expect(subjects(body)).toEqual(["../lib::venvPython"]);
  });

  it("counts an assertion in a hook as no help either way", () => {
    expect(subjects(`  beforeEach(() => {\n    expect(getEnv('/x')).toEqual({})\n  })\n${test1("    expect(venvPython('/x')).toBe('/x/venv/bin/python3')\n")}`)).toEqual(["../lib::venvPython"]);
  });
});
