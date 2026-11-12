import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { mockedSubjects } from "../src/mocks.js";
import { analyzeGuardFile, ciTestSteps, newTestMarkers, resolveCiTestSteps } from "../src/tampering.js";

// Defects that showed up while reading a sixth sample of 40 repositories that no earlier measurement had used (docs/benchmarks.md, section 10).
// They were found after the build that was measured on it had been frozen, so the fixes are not part of that measurement.

const scan = (text: string, file: string) =>
  auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const markers = (before: string, after: string, file: string) => newTestMarkers(scan(before, file), scan(after, file), before, after).map(f => f.type);

describe("each [[tool.mypy.overrides]] element is a table of its own", () => {
  const file = "pyproject.toml";
  const override = (module: string, ...settings: string[]) => `\n[[tool.mypy.overrides]]\nmodule = ["${module}"]\n${settings.join("\n")}\n`;
  const config = (version: string, overrides = [
    override("tests.*", "check_untyped_defs = false", "disallow_untyped_calls = false"),
    override("examples.*", "check_untyped_defs = false", "disallow_untyped_calls = false"),
    override("examples.fastapi.*", "check_untyped_defs = true", "disallow_untyped_calls = true"),
  ], global = "true") =>
    `[tool.poetry]\nname = "x"\nversion = "${version}"\n\n[tool.mypy]\npretty = true\ncheck_untyped_defs = ${global}\ndisallow_untyped_calls = true\n${overrides.join("")}`;
  const reports = (before: string, after: string) => analyzeGuardFile(file, before, after, "HEAD").map(f => f.lineSnippet);

  it("does not read an override that relaxes a check next to one that keeps it as a switch that was turned off", () => {
    expect(reports(config("0.1"), config("0.2"))).toEqual([]);
  });

  it("does not depend on the order of the overrides", () => {
    const [tests, examples, fastapi] = [
      override("tests.*", "check_untyped_defs = false"), override("examples.*", "check_untyped_defs = false"), override("examples.fastapi.*", "check_untyped_defs = true"),
    ];
    expect(reports(config("0.1", [tests, examples, fastapi]), config("0.2", [fastapi, tests, examples]))).toEqual([]);
    expect(reports(config("0.1", [fastapi, tests, examples]), config("0.1", [examples, fastapi, tests]))).toEqual([]);
  });

  it("still reads the global switch turned off", () => {
    expect(reports(config("0.1"), config("0.1", undefined, "false"))).toEqual(["mypy check_untyped_defs: true → false"]);
  });

  it("still reads one override switched from true to false", () => {
    const strict = [override("examples.fastapi.*", "check_untyped_defs = true")];
    const relaxed = [override("examples.fastapi.*", "check_untyped_defs = false")];
    expect(reports(config("0.1", strict), config("0.1", relaxed))).toEqual(["mypy check_untyped_defs: true → false"]);
  });

  it("still reads a module whose errors are now ignored", () => {
    const more = [...[override("tests.*", "check_untyped_defs = false")], override("legacy.*", "ignore_errors = true")];
    expect(analyzeGuardFile(file, config("0.1", [override("tests.*", "check_untyped_defs = false")]), config("0.1", more), "HEAD").map(f => f.reason)).toEqual(["Type errors ignored for a module"]);
  });
});

describe("a comment at the end of a CI line is not part of the command", () => {
  const file = ".github/workflows/snyk.yml";
  const snyk = "name: Snyk\non:\n  pull_request:\njobs:\n  check:\n    steps:\n      - if: github.actor == 'dependabot[bot]'\n        run: exit 0 # Skip unnecessary test runs for dependabot and merge queues\n      - uses: actions/checkout@v4\n";

  it("does not count a line that only says test in its comment", () => {
    expect(ciTestSteps(file, snyk, null)?.before).toBe(0);
    expect(resolveCiTestSteps([ciTestSteps(file, snyk, null)!], "HEAD")).toEqual([]);
  });

  it("still counts a test command that has a comment after it", () => {
    const workflow = "on:\n  pull_request:\njobs:\n  t:\n    steps:\n      - run: npm test # the unit tests\n";
    expect(ciTestSteps(".github/workflows/t.yml", workflow, workflow)?.before).toBe(1);
    expect(resolveCiTestSteps([ciTestSteps(".github/workflows/t.yml", workflow, snyk)!], "HEAD").map(f => f.reason)).toEqual(["Test step removed from CI"]);
  });
});

describe("a script that runs the tests with coverage is a test step", () => {
  const workflow = (command: string) => `on:\n  pull_request:\njobs:\n  t:\n    steps:\n      - run: ${command}\n`;
  const count = (before: string, after: string | null) => ciTestSteps(".github/workflows/test.yml", before, after)!;

  it("does not read yarn test turned into yarn coverage as a removed test step", () => {
    expect(resolveCiTestSteps([count(workflow("yarn test"), workflow("yarn coverage"))], "HEAD")).toEqual([]);
  });

  it.each(["yarn coverage", "npm run coverage", "pnpm coverage", "bun run coverage"])("counts %s", (command) => {
    expect(count(workflow(command), workflow(command)).before).toBe(1);
  });

  it("does not count a coverage report script", () => {
    expect(count(workflow("yarn coverage-report"), workflow("yarn coverage-report")).before).toBe(0);
    expect(count(workflow("yarn run build:coverage"), workflow("yarn run build:coverage")).before).toBe(0);
  });
});

describe("a mock factory whose only parameter has no brackets keeps the real module", () => {
  const subjects = (factory: string) => mockedSubjects(
    `import { it, expect, vi } from "vitest";\nimport { groupStatus, groupList } from "../group-client";\nvi.mock("../group-client", ${factory});\nit("reports the status", () => {\n  expect(groupStatus("a")).toBe("ready");\n});\n`,
    "src/group-store.test.ts",
  ).map(item => item.key);

  it.each([
    'async original => ({ ...await original<typeof import("../group-client")>(), groupList: vi.fn() })',
    "async (original) => ({ ...(await original()), groupList: vi.fn() })",
    "original => ({ ...original(), groupList: vi.fn() })",
    "async function (original) { return { ...(await original()), groupList: vi.fn() }; }",
  ])("leaves %s alone", (factory) => {
    expect(subjects(factory)).toEqual([]);
  });

  it("still reads a factory that replaces the module", () => {
    expect(subjects("() => ({ groupStatus: () => 'ready', groupList: vi.fn() })")).toEqual(["../group-client::groupStatus"]);
    expect(subjects("async original => ({ groupStatus: () => 'ready', groupList: vi.fn() })")).toEqual(["../group-client::groupStatus"]);
  });
});

describe("expectedFailure under the name of another module is the same marker", () => {
  const file = "tests/backends/test_capabilities.py";
  const unittestStyle = "class TestCapabilities(test.TestCase):\n    def test_str(self):\n        self.assertTrue(True)\n\n    @test.expectedFailure\n    def test_connection_name(self):\n        pass\n";
  const pytestStyle = "def test_str():\n    assert True\n\n\n@pytest.mark.xfail(reason=\"Connection 'other' does not exist\")\nasync def test_connection_name(db):\n    pass\n";

  it("is not a new marker when a test is rewritten from unittest to pytest with the same expectation", () => {
    expect(markers(unittestStyle, pytestStyle, file)).toEqual([]);
  });

  it("is found on a test that was running", () => {
    const plain = unittestStyle.replace("    @test.expectedFailure\n", "");
    expect(markers(plain, unittestStyle, file)).toEqual(["test-skip"]);
    expect(markers(plain, unittestStyle.replace("@test.expectedFailure", "@unittest.expectedFailure"), file)).toEqual(["test-skip"]);
    expect(markers(plain, unittestStyle.replace("@test.expectedFailure", "@expectedFailure"), file)).toEqual(["test-skip"]);
  });

  it("does not take a name that merely ends in expectedFailure", () => {
    expect(scan("def test_a():\n    my_expectedFailure = 1\n", file)).toEqual([]);
  });
});
