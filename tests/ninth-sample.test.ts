import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { ciTestSteps, gatingTestCommands, newTestMarkers, resolveCiTestSteps } from "../src/tampering.js";

// False alarms that turned up while reading a ninth sample of 39 repositories that no earlier measurement had used (docs/benchmarks.md, section 14).
// The build that was measured on it, 0.21.0 as it was frozen, is not changed by these fixes, so they are not part of that measurement.

const workflow = (step: string) => `on:\n  push:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - ${step}\n`;
const FILE = ".github/workflows/ci.yml";
const commands = (step: string) => gatingTestCommands(FILE, workflow(step));
const lost = (before: string, after: string | null) => resolveCiTestSteps([ciTestSteps(FILE, before, after)!], "HEAD").map(found => found.type);

describe("a command that installs dependencies, or runs a tool that is not the tests, is not a test run", () => {
  it("does not read a dependency group, an extra or a package named test or pytest", () => {
    expect(commands("run: uv sync --group test --frozen")).toEqual([]);
    expect(commands("run: uv pip install -e '.[test]'")).toEqual([]);
    expect(commands("run: pip install -e .[test]")).toEqual([]);
    expect(commands("run: python -m pip install pytest pytest-cov")).toEqual([]);
    expect(commands("run: poetry install --with test")).toEqual([]);
    expect(commands("run: npm install --save-dev vitest")).toEqual([]);
  });

  it("still reads the command that follows an installer", () => {
    expect(commands("run: npm ci && npm test")).toHaveLength(1);
    expect(commands("run: pip install -e .[test] && pytest -q")).toHaveLength(1);
    expect(commands("run: uv sync --group test; uv run pytest")).toHaveLength(1);
    expect(commands("run: pip install tox | tee log && tox -e py312")).toHaveLength(1);
  });

  it("does not read tox or nox on an environment that lints, builds or documents", () => {
    expect(commands("run: tox run -e lint")).toEqual([]);
    expect(commands("run: tox -e type")).toEqual([]);
    expect(commands("run: nox -s docs")).toEqual([]);
    expect(commands("run: tox -e py312")).toHaveLength(1);
    expect(commands("run: tox -e lint,py312")).toHaveLength(1);
    expect(commands("run: tox")).toHaveLength(1);
    expect(commands("run: nox -s tests")).toHaveLength(1);
  });

  it("is not a lost test step when the dependency group that is installed is renamed, or a lint environment is swapped for a linter", () => {
    expect(lost(workflow("run: uv sync --group test --frozen"), workflow("run: uv sync --group citations --frozen"))).toEqual([]);
    expect(lost(workflow("run: tox run -e lint"), workflow("run: ruff check"))).toEqual([]);
    expect(lost(workflow("run: pytest"), workflow("run: uv sync --group test"))).toEqual(["guard-weakened"]);
  });
});

describe("the name of a step is not a command", () => {
  it("does not read the words of a step name or an artifact name", () => {
    expect(commands("name: Test with tox\n        run: ruff check")).toEqual([]);
    expect(commands("name: Upload coverage\n        uses: actions/upload-artifact@v4\n        with:\n          name: pytest-results")).toEqual([]);
    expect(commands("name: Run pytest\n        run: pytest -q")).toHaveLength(1);
  });

  it("is not a lost test step when a step that only had the word in its name is renamed", () => {
    expect(lost(workflow("name: Test with tox\n        run: tox run -e lint"), workflow("name: Lint with Ruff\n        run: ruff check"))).toEqual([]);
    expect(lost(workflow("name: Test with tox\n        run: tox -e py312"), workflow("name: Lint with Ruff\n        run: ruff check"))).toEqual(["guard-weakened"]);
  });
});

describe("a test step that was already allowed to fail or switched off is no check that is lost when it goes", () => {
  const step = (extra: string) => `name: Run tests\n        run: uv run pytest\n        ${extra}`;

  it("is not reported when the step goes", () => {
    expect(lost(workflow(step("continue-on-error: true # Remove once the tests are working")), workflow("run: ruff check"))).toEqual([]);
    expect(lost(workflow(step("if: false")), workflow("run: ruff check"))).toEqual([]);
  });

  it("is reported when a step that gates goes", () => {
    expect(lost(workflow("name: Run tests\n        run: uv run pytest"), workflow("run: ruff check"))).toEqual(["guard-weakened"]);
  });

  it("is reported when another step of the same workflow still gates and then goes", () => {
    const both = `${workflow(step("continue-on-error: true"))}      - run: pytest tests/unit\n`;
    expect(lost(both, workflow("run: ruff check"))).toEqual(["guard-weakened"]);
  });
});

describe("a registration with a table is a new test when its table was not in the old file", () => {
  const file = "src/macro.test.ts";
  const scan = (text: string) => auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
  const markers = (before: string, after: string) => newTestMarkers(scan(before), scan(after), before, after).map(found => found.type);
  const table = (kind: string) => `describe("macro", () => {\n  ${kind}([\n    ["a", 1],\n    ["b", 2],\n  ])("%s is %i", (name, value) => {\n    expect(transform(name)).toBe(value);\n  });\n});\n`;
  const other = `describe("other", () => {\n  it("works", () => {\n    expect(1).toBe(1);\n  });\n});\n`;

  it("reports a table that was running and is skipped now", () => {
    expect(markers(table("it.each"), table("it.skip.each"))).toEqual(["test-skip"]);
  });

  it("does not report a table that the change adds, written as an expected failure", () => {
    expect(markers(other, other + table("it.fails.each"))).toEqual([]);
  });

  it("does not report single skipped tests that are regrouped into one table", () => {
    const singles = `describe("macro", () => {\n  it.skip("a is 1", () => {\n    expect(transform("a")).toBe(1);\n  });\n  it.skip("b is 2", () => {\n    expect(transform("b")).toBe(2);\n  });\n});\n`;
    expect(markers(singles, table("it.skip.each"))).toEqual([]);
  });
});
