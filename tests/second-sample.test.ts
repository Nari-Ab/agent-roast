import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { mockedSubjects } from "../src/mocks.js";
import { analyzeGuardFile, analyzeTestFile, ciTestSteps, newTestMarkers, resolveCiTestSteps } from "../src/tampering.js";

// False alarms that turned up when 0.18.0 was replayed on 40 repositories that had not been read before (docs/benchmarks.md, section 9, sample 4).

const scan = (text: string, file: string) =>
  auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const review = (before: string, after: string, file: string) => analyzeTestFile(file, file, before, after, "HEAD").immediate.map(f => f.type);
/** The markers a change put on tests that were already there, found the way a review finds them: from the whole old and new file. */
const markers = (before: string, after: string, file: string) => newTestMarkers(scan(before, file), scan(after, file), before, after).map(f => f.type);

describe("test.skip(true, ...) that an if decides at run time is a conditional skip", () => {
  const test1 = (inner: string) => `test("renders the tab", async ({ page }) => {\n${inner}\n  await page.click("#tab");\n});\n`;

  it.each([
    "  if (!isAdmin) {\n    test.skip(true, 'needs an admin');\n    return;\n  }",
    "  if (!(await billing.isPaywallEnabled())) {\n    test.skip(true, 'show_paywall=false on this tenant');\n    return;\n  }",
    "  if (!isAdmin) test.skip(true, 'Requires admin access');",
    "  if (!isAdmin) {\n    test.skip(\n      true,\n      'Requires admin access to seed the toggle',\n    );\n    return;\n  }",
    "  if (ready) {\n    run();\n  } else {\n    test.skip(true, 'no device');\n  }",
    "  if (ready) {\n    run();\n  } else if (!fallback) {\n    test.skip(true, 'no device');\n  }",
    "  switch (platform) {\n    case 'win32':\n      test.skip(true, 'not on windows');\n  }",
    "  try {\n    await connect();\n  } catch {\n    test.skip(true, 'no server');\n  }",
    "  if (\n    !isAdmin &&\n    !isOwner\n  ) {\n    test.skip(true, 'needs more rights');\n  }",
    "  isHeadless && test.skip(true, 'needs a screen');",
    "  if (!isAdmin) {\n    for (const step of steps) {\n      test.skip(true, 'needs an admin');\n    }\n  }",
  ])("leaves %j alone", (inner) => {
    expect(scan(test1(inner), "e2e/a.spec.ts").map(f => f.type)).toEqual([]);
  });

  it("leaves a helper that asks before it skips alone", () => {
    const helper = "async function skipIfNotAdmin(page: Page): Promise<void> {\n  const isAdmin = await checkAdminStatus(page);\n  if (!isAdmin) test.skip(true, 'Requires admin access');\n}\n";
    expect(scan(helper, "e2e/helpers.spec.ts").map(f => f.type)).toEqual([]);
  });

  it.each([
    "  test.skip(true, 'flaky');",
    "  test.skip();",
    "  setup();\n  test.skip(true, 'flaky');",
    "  if (process.env.CI) {\n    test.skip(true, 'flaky on CI');\n  }",
    "  if (process.env['CI']) test.skip(true, 'flaky on CI');",
    "  if (isCI) {\n    test.skip(true, 'flaky on CI');\n  }",
    "  if (true) {\n    test.skip(true, 'later');\n  }",
    "  if (ready) {\n    run();\n  }\n  test.skip(true, 'flaky');",
    "  const run = async () => {\n    test.skip(true, 'flaky');\n  };",
  ])("still reports %j", (inner) => {
    expect(scan(test1(inner), "e2e/a.spec.ts").map(f => f.type)).toEqual(["test-skip"]);
  });

  it("still reports a skip written straight into a describe or a hook", () => {
    expect(scan("test.describe('billing', () => {\n  test.skip(true, 'broken');\n  test('a', () => {});\n});\n", "e2e/a.spec.ts").map(f => f.type)).toEqual(["test-skip"]);
    expect(scan("test.beforeEach(async () => {\n  test.skip(true, 'broken');\n});\n", "e2e/a.spec.ts").map(f => f.type)).toEqual(["test-skip"]);
  });

  it("still reports a skip whose guard lies outside the lines it can see", () => {
    const lines = ["    test.skip(true, 'needs an admin');"];
    expect(auditFileDiffs([{ path: "e2e/a.spec.ts", addedLines: lines.map(line => ({ line, lineNumber: 40 })) }]).infractions.map(f => f.type)).toEqual(["test-skip"]);
  });

  it("applies to fixme and fail as well", () => {
    expect(scan(test1("  if (!isAdmin) {\n    test.fixme(true, 'not built yet');\n  }"), "e2e/a.spec.ts").map(f => f.type)).toEqual([]);
    expect(scan(test1("  test.fixme(true, 'not built yet');"), "e2e/a.spec.ts").map(f => f.type)).toEqual(["test-skip"]);
  });
});

describe("a registration that a formatter wrapped after its opening bracket still has a title", () => {
  const file = "e2e/a.spec.ts";
  const plain = "test('opens the menu', async ({ page }) => {\n  await page.click('#menu');\n});\n";
  const wrapped = (title: string, marker = "test") => `${marker}(\n  '${title}',\n  async ({ page }) => {\n    await page.click('#tab');\n  },\n);\n`;

  it("does not count a wrapped fixme on a test the change adds", () => {
    expect(markers(plain, `${plain}\n${wrapped("opens the history tab", "test.fixme")}`, file)).toEqual([]);
    expect(markers(plain, `${plain}\n${wrapped("opens the history tab", "test.skip")}`, file)).toEqual([]);
  });

  it("does not count a wrapped fixme that was already there", () => {
    const before = `${plain}\n${wrapped("opens the history tab", "test.fixme")}`;
    expect(markers(before, `${before}\n${wrapped("opens the billing tab")}`, file)).toEqual([]);
    expect(markers(before, before.replace("'#tab'", "'#tab2'"), file)).toEqual([]);
  });

  it("still counts a wrapped fixme on a test that was running", () => {
    const before = `${plain}\n${wrapped("opens the history tab")}`;
    expect(markers(before, `${plain}\n${wrapped("opens the history tab", "test.fixme")}`, file)).toEqual(["test-skip"]);
  });

  it("reads the test around a skip inside a wrapped registration", () => {
    const body = (skip: string) => `${plain}\ntest(\n  'opens the billing tab',\n  async ({ page }) => {\n${skip}    await page.click('#tab');\n  },\n);\n`;
    expect(markers(body(""), body("    test.skip(true, 'broken');\n"), file)).toEqual(["test-skip"]);
    expect(markers(plain, body("    test.skip(true, 'broken');\n"), file)).toEqual([]);
  });

  it("does not take a step or a describe for the test", () => {
    const inStep = (skip: string) => `${plain}\ntest('opens the billing tab', async ({ page }) => {\n  await test.step('click', async () => {\n${skip}    await page.click('#tab');\n  });\n});\n`;
    expect(markers(inStep(""), inStep("    test.skip(true, 'broken');\n"), file)).toEqual(["test-skip"]);
    expect(markers(plain, inStep("    test.skip(true, 'broken');\n"), file)).toEqual([]);
  });
});

describe("a job or step that is switched off in a workflow that gates nothing", () => {
  const file = ".github/workflows/notes.yml";
  const workflow = (on: string, job = "", step = "", run = "./post-comment.sh") =>
    `name: notes\non:\n${on}\njobs:\n  post:\n    runs-on: ubuntu-latest\n${job}    steps:\n      - name: Post\n        run: ${run}\n${step}      - name: Tidy\n        run: ./tidy.sh\n`;
  const reasons = (before: string, after: string, path = file) => analyzeGuardFile(path, before, after, "HEAD").map(f => f.reason);
  const triggers = {
    "a completed workflow": "  workflow_run:\n    workflows: [release]\n    types: [completed]\n  workflow_dispatch:",
    "a schedule": "  schedule:\n    - cron: '0 3 * * *'",
    "a release": "  release:\n    types: [published]",
    "a manual dispatch": "  workflow_dispatch:",
  };

  it.each(Object.entries(triggers))("leaves a job that is not a check, switched off in a workflow that runs on %s alone", (_, on) => {
    expect(reasons(workflow(on), workflow(on, "    if: false\n"))).toEqual([]);
    expect(reasons(workflow(on), workflow(on, "", "        continue-on-error: true\n"))).toEqual([]);
  });

  it.each(Object.entries(triggers))("still reads a test command that is switched off or allowed to fail in a workflow that runs on %s alone", (_, on) => {
    expect(reasons(workflow(on, "", "", "npm test"), workflow(on, "    if: false\n", "", "npm test"))).toEqual(["CI step is now switched off"]);
    expect(reasons(workflow(on, "", "", "npm test"), workflow(on, "", "", "npm test").replace("run: npm test", "run: npm test\n        continue-on-error: true"))).toEqual(["CI step is now allowed to fail"]);
    expect(reasons(workflow(on, "", "", "npm test"), workflow(on, "", "", "npm test || true"))).toEqual(["Test command can no longer fail the CI step"]);
  });

  it.each([
    ["a push", "  push:\n    branches: [main]"],
    ["a pull request", "  pull_request:"],
    ["a pull request and a schedule", "  pull_request:\n  schedule:\n    - cron: '0 3 * * *'"],
    ["a reusable workflow", "  workflow_call:"],
    ["a flow list of triggers", "  [push, workflow_dispatch]"],
  ])("still reads a job that is not a check, switched off in a workflow that runs on %s", (_, on) => {
    expect(reasons(workflow(on), workflow(on, "    if: false\n"))).toEqual(["CI step is now switched off"]);
    expect(reasons(workflow(on), workflow(on, "", "        continue-on-error: true\n"))).toEqual(["CI step is now allowed to fail"]);
  });

  it("reads a workflow that was gating before the change as gating", () => {
    const gating = workflow("  push:\n    branches: [main]"), manual = workflow("  workflow_dispatch:", "    if: false\n");
    expect(reasons(gating, manual)).toEqual(["CI step is now switched off"]);
  });

  it("reads a file with no trigger section it can parse, and a GitLab pipeline, as gating", () => {
    const bare = "jobs:\n  post:\n    steps:\n      - name: Post\n        run: ./post.sh\n";
    expect(reasons(bare, bare.replace("    steps:", "    if: false\n    steps:"))).toEqual(["CI step is now switched off"]);
    const gitlab = "test:\n  script:\n    - ./post.sh\n";
    expect(reasons(gitlab, `${gitlab}  allow_failure: true\n`, ".gitlab-ci.yml")).toEqual(["CI step is now allowed to fail"]);
  });
});

describe("`push: true` in a Docker build step is not a trigger", () => {
  const manual = [
    "name: Build latest release", "", "on:", "  workflow_dispatch:", "", "jobs:", "  run_tests:", "    runs-on: ubuntu-latest", "    steps:",
    "    - run: npm install", "    - run: npm run test", "  build_docker:", "    needs: [run_tests]", "    steps:",
    "      - name: Build and push", "        uses: docker/build-push-action@v4", "        with:", "          push: true", "          tags: user/app:latest", "",
  ].join("\n");
  const checks = ["name: Test", "on:", "  push:", "    branches: [main]", "  pull_request:", "jobs:", "  test:", "    steps:", "    - run: npm run test", ""].join("\n");
  const counts = (...files: [string, string | null, string | null][]) => files.map(([file, before, after]) => ciTestSteps(file, before, after)!);

  it("does not read a deleted manual workflow as lost tests while the tests still run on every push", () => {
    expect(resolveCiTestSteps(counts([".github/workflows/release-v1.yml", manual, null], [".github/workflows/test.yml", checks, checks]), "HEAD")).toEqual([]);
  });

  it("does not count the manual workflow's test step as one that gates", () => {
    expect(ciTestSteps(".github/workflows/release-v1.yml", manual, manual)?.before).toBe(0);
    expect(ciTestSteps(".github/workflows/test.yml", checks, checks)?.before).toBe(1);
  });

  it("still reports tests that stopped running on pushes and pull requests", () => {
    const found = resolveCiTestSteps(counts([".github/workflows/test.yml", checks, checks.replace("npm run test", "npm run lint")]), "HEAD");
    expect(found.map(f => f.reason)).toEqual(["Test step removed from CI"]);
  });

  it("reads the triggers of a workflow written on one line", () => {
    const oneLine = "on: [push, pull_request]\njobs:\n  t:\n    steps:\n    - run: npm test\n";
    expect(ciTestSteps(".github/workflows/t.yml", oneLine, oneLine)?.before).toBe(1);
    expect(ciTestSteps(".github/workflows/t.yml", "on: push\njobs:\n  t:\n    steps:\n    - run: npm test\n", null)?.before).toBe(1);
  });
});

describe("a patched function that a call in the test wraps again is not what the assertion reads back", () => {
  const subjects = (text: string) => mockedSubjects(text, "tests/test_kernels.py").map(item => item.key);
  const test1 = (middle: string) => `import q35\n\ndef test_other_devices_keep_the_original(monkeypatch):\n    from pkg import kernels\n\n    def original(x, *args):\n        return x\n\n    monkeypatch.setattr(q35, "conv_fn", original)\n${middle}    x = object()\n    assert q35.conv_fn(x) is x\n`;

  it.each([
    "    assert kernels.install()\n",
    "    kernels.install_hooks()\n",
    "    wrap_model(q35)\n",
    "    instrument(app)\n",
    "    reload_kernels()\n",
  ])("leaves the assertion alone after %j", (middle) => {
    expect(subjects(test1(middle))).toEqual([]);
  });

  it("still reads the same test without the call that rewires it", () => {
    expect(subjects(test1(""))).toEqual(["q35.conv_fn"]);
    expect(subjects(test1("    total = compute(3)\n"))).toEqual(["q35.conv_fn"]);
  });
});

describe("a mock that another test configures does not fake what this test calls", () => {
  const subjects = (text: string) => mockedSubjects(text, "test/remote.test.ts").map(item => item.key);
  const head = "import { activate, fetchAndActivate } from '../src/api';\nimport * as api from '../src/api';\nvi.mock('../src/api', { spy: true });\n\n";
  const real = "describe('activate', () => {\n  it('is false without a response', async () => {\n    expect(await activate(rc)).toBe(false);\n  });\n});\n\n";

  it("leaves a test that calls the real function of a spied module alone", () => {
    const other = "describe('both steps in one call', () => {\n  it('calls activate', async () => {\n    vi.spyOn(api, 'activate').mockResolvedValue(true);\n    expect(await fetchAndActivate(rc)).toBe(true);\n  });\n});\n";
    expect(subjects(head + real + other)).toEqual([]);
  });

  it("still reads a test that configures the mock itself", () => {
    const same = "describe('activate', () => {\n  it('is true', async () => {\n    vi.spyOn(api, 'activate').mockResolvedValue(true);\n    expect(await activate(rc)).toBe(true);\n  });\n});\n";
    expect(subjects(head + same)).toEqual(["../src/api::activate"]);
  });

  it("does not take a hook of another describe for a configuration of this one", () => {
    const hooked = "describe('both steps in one call', () => {\n  beforeEach(() => {\n    vi.spyOn(api, 'activate').mockResolvedValue(true);\n  });\n  it('calls activate', async () => {\n    expect(await both(rc)).toBe(true);\n  });\n});\n\n";
    expect(subjects(head + hooked + real)).toEqual([]);
    expect(subjects(head + real + hooked)).toEqual([]);
    expect(subjects(`${head}describe('activate', () => {\n  beforeEach(() => {\n    vi.spyOn(api, 'activate').mockResolvedValue(true);\n  });\n  it('is true', async () => {\n    expect(await activate(rc)).toBe(true);\n  });\n});\n`)).toEqual(["../src/api::activate"]);
  });

  it("still reads a mock that a hook or the top of the file configures", () => {
    const hook = "beforeEach(() => {\n  vi.spyOn(api, 'activate').mockResolvedValue(true);\n});\n\n";
    expect(subjects(head + hook + real)).toEqual(["../src/api::activate"]);
    expect(subjects(`${head}vi.mocked(activate).mockResolvedValue(true);\n\n${real}`)).toEqual(["../src/api::activate"]);
  });
});

describe("a unittest assertion turned into a pytest assert is the same check", () => {
  const py = (assertion: string) => `def test_progressive(self):\n    ${assertion}\n`;

  it.each([
    ["self.assertTrue(details is not None)", "assert details is not None"],
    ["self.assertTrue(result)", "assert result"],
    ["self.assertIsNotNone(details)", "assert details is not None"],
    ["self.assertGreater(len(rows), 0)", "assert len(rows) > 0"],
    ["self.assertGreaterEqual(count, 1)", "assert count >= 1"],
  ])("leaves %j turned into %j alone", (before, after) => {
    expect(review(py(before), py(after), "test_a.py")).toEqual([]);
  });

  it.each([
    ["assert details == {'a': 1}", "assert details is not None"],
    ["assert len(rows) == 3", "assert len(rows) > 0"],
    ["assert result == 5", "assert result"],
  ])("still reads %j turned into %j", (before, after) => {
    expect(review(py(before), py(after), "test_a.py")).toEqual(["assertion-weakened"]);
  });
});
