import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { analyzeGuardFile, ciTestSteps, resolveCiTestSteps } from "../src/tampering.js";

// Defects and false alarms that turned up while reading a seventh sample of 40 repositories that no earlier measurement had used
// (docs/benchmarks.md, section 11). They were found after the published 0.19.0 had been replayed on it, so the fixes are not part of that measurement.

const scan = (text: string, file: string) =>
  auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const guard = (file: string, before: string, after: string) => analyzeGuardFile(file, before, after, "HEAD").map(found => found.lineSnippet);

describe("a word in a comment of a TOML list is not a rule code", () => {
  const file = "pyproject.toml";
  const lint = (select: string, extra = "") => `[tool.ruff.lint]\nselect = ${select}\n${extra}`;

  it("does not read the quoted word of a comment next to a per-file ignore as an ignored code", () => {
    const before = lint('["E", "F"]', '\n[tool.ruff.lint.per-file-ignores]\n"docs/*.py" = [\n  "E501",\n]\n');
    const after = lint('["E", "F"]', '\n[tool.ruff.lint.per-file-ignores]\n"docs/*.py" = [\n  "E501",\n  "ANN001", # unused imports ("F401") fire here too\n]\n');
    expect(guard(file, before, after)).toEqual([]);
  });

  it("does not read a commented-out selector as a selected rule", () => {
    const before = lint('[\n  "E",\n  # "ANN", # flake8-annotations\n]');
    const after = lint('[\n  "E",\n  "ANN2", # flake8-annotations\n]', '\n[tool.ruff.lint.per-file-ignores]\n"examples/*.py" = [\n  "ANN", # missing type annotations in examples is fine\n]\n');
    expect(guard(file, before, after)).toEqual([]);
  });

  it("keeps a # that is inside a string", () => {
    const before = lint('["E", "F"]', "ignore = []\n");
    const after = lint('["E", "F"]', 'ignore = [\n  "F401", # unused import\n]\n');
    expect(guard(file, before, after)).toEqual(["ruff ignore: +F401"]);
  });

  it("still reads a code that is ignored", () => {
    const before = lint('["E", "F"]', 'ignore = [\n  "E501",\n]\n');
    const after = lint('["E", "F"]', 'ignore = [\n  "E501",\n  "F401", # the ("text") of a comment is not a code\n]\n');
    expect(guard(file, before, after)).toEqual(["ruff ignore: +F401"]);
  });
});

describe("ruff ignores added together with a bump of the Python version or of ruff", () => {
  const file = "pyproject.toml";
  const config = (python: string, ignore: string[], dev = '"ruff==0.3.4"') =>
    `[project]\nrequires-python = ">=${python}"\n\n[dependency-groups]\ndev = [${dev}]\n\n[tool.ruff.lint]\nselect = ["E", "UP"]\nignore = [\n${ignore.map(code => `  "${code}",`).join("\n")}\n]\n`;

  it("are not reported when the Python version goes up in the same change", () => {
    expect(guard(file, config("3.8", ["E501"]), config("3.9", ["E501", "UP006", "UP035"]))).toEqual([]);
  });

  it("are not reported when the pinned ruff version goes up in the same change", () => {
    expect(guard(file, config("3.9", ["E501"]), config("3.9", ["E501", "UP007"], '"ruff==0.8.0"'))).toEqual([]);
    expect(guard(file, config("3.9", ["E501"], '"ruff>=0.3"'), config("3.9", ["E501", "UP007"], '"ruff>=0.8"'))).toEqual([]);
  });

  it("are reported when nothing was bumped", () => {
    expect(guard(file, config("3.9", ["E501"]), config("3.9", ["E501", "UP006"]))).toEqual(["ruff ignore: +UP006"]);
  });

  it("are reported when the version is only written in the change for the first time", () => {
    const before = "[tool.ruff.lint]\nselect = [\"E\", \"UP\"]\nignore = [\"E501\"]\n";
    expect(guard(file, before, config("3.9", ["E501", "UP006"]))).toEqual(["ruff ignore: +UP006"]);
  });

  it("are reported when the version went down, or when only another key was added", () => {
    expect(guard(file, config("3.9", ["E501"], '"ruff>=0.15.10"'), config("3.9", ["E501", "UP007"], '"ruff>=0.4"'))).toEqual(["ruff ignore: +UP007"]);
    expect(guard(file, config("3.10", ["E501"]), config("3.9", ["E501", "UP007"]))).toEqual(["ruff ignore: +UP007"]);
    const targeted = (target: string, ignore: string[]) => `[tool.ruff]\ntarget-version = "${target}"\n\n[tool.ruff.lint]\nselect = ["E", "UP"]\nignore = [\n${ignore.map(code => `  "${code}",`).join("\n")}\n]\n`;
    expect(guard(file, targeted("py38", ["E501"]), targeted("py311", ["E501", "UP006"]))).toEqual([]);
    expect(guard(file, targeted("py311", ["E501"]), targeted("py38", ["E501", "UP006"]))).toEqual(["ruff ignore: +UP006"]);
  });

  it("read a pin that is written twice by the newest of them, and a version with more digits as higher", () => {
    expect(guard(file, config("3.9", ["E501"], '"ruff==0.9.3", "ruff==0.2.0"'), config("3.9", ["E501", "UP007"], '"ruff==0.12.11"'))).toEqual([]);
  });
});

describe("fit and fdescribe with a title are focused tests; a call to a function named fit is not", () => {
  const focused = (code: string) => scan(code, "src/layout.test.ts").filter(found => found.type === "test-focus").length;

  it("does not read a helper called with arguments as a focused test", () => {
    expect(focused("const run = () =>\n  fit(\n    line,\n    texts.length,\n    12\n  );\n")).toBe(0);
    expect(focused("fit(line, width, available);\n")).toBe(0);
  });

  it("still reads a focused test with a quoted or template title", () => {
    expect(focused("fit(\"keeps the band\", () => {\n  expect(1).toBe(1);\n});\n")).toBe(1);
    expect(focused("fdescribe('layout', () => {});\n")).toBe(1);
    expect(focused("fit(`${name} fits`, () => {});\n")).toBe(1);
  });
});

describe("test commands that CI did not know", () => {
  const workflow = (steps: string[]) => `on:\n  push:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n${steps.map(step => `      - ${step}`).join("\n")}\n`;
  const count = (before: string, after: string | null) => ciTestSteps(".github/workflows/ci.yml", before, after)!;

  it("are test steps: a task alias, a project's own script, Node's runner, a task runner, a test file run directly", () => {
    for (const command of ["deno task test", "uv run python scripts/run_tests.py tests/test_x.py", "./scripts/test.sh", "bash scripts/run-tests.sh", "node --test", "just test", "composer test", "./gradlew test", "python tests/test_cli.py"]) {
      expect(count(workflow(["run: npm test"]), workflow([`run: ${command}`])).after, command).toBe(1);
    }
  });

  it("are test steps inside a block of commands", () => {
    expect(count(workflow(["run: npm test"]), workflow(["run: |\n          deno lint\n          deno task test\n          deno task build"])).after).toBe(1);
  });

  it("are not taken from a command that only mentions a script", () => {
    for (const command of ["chmod +x scripts/test.sh", "cat tests.py", "shellcheck scripts/test.sh", "npm run lint"]) {
      expect(count(workflow(["run: npm test"]), workflow([`run: ${command}`])).after, command).toBe(0);
    }
  });

  it("make a test command replaced by one of them not a removal", () => {
    expect(resolveCiTestSteps([count(workflow(["run: deno run test"]), workflow(["run: |\n          deno task test"]))], "HEAD")).toEqual([]);
    expect(resolveCiTestSteps([count(workflow(["run: python -m unittest"]), workflow(["run: uv run python scripts/run_tests.py"]))], "HEAD")).toEqual([]);
    expect(resolveCiTestSteps([count(workflow(["run: npm test"]), workflow(["run: npm run lint"]))], "HEAD").map(found => found.type)).toEqual(["guard-weakened"]);
  });
});

describe("a tolerance that only moved is not a step that was made easier to pass", () => {
  const file = ".github/workflows/ci.yml";
  const separate = "on: push\njobs:\n  report:\n    continue-on-error: true\n    steps:\n      - name: Report\n        run: bun run compat:report\n  check:\n    steps:\n      - run: bun run test\n";
  const merged = "on: push\njobs:\n  check:\n    steps:\n      - run: bun run test\n      - name: Report\n        continue-on-error: true\n        run: bun run compat:report\n";

  it("is not reported when a job that was allowed to fail is merged into another job, where the same step is", () => {
    expect(guard(file, separate, merged)).toEqual([]);
  });

  it("is reported when the step that is allowed to fail now runs another command", () => {
    const another = merged.replace("      - run: bun run test\n", "      - name: Test\n        continue-on-error: true\n        run: bun run test\n").replace("      - name: Test\n        continue-on-error: true", "      - name: Test\n        continue-on-error: true");
    expect(guard(file, separate.replace("      - run: bun run test\n", "      - name: Test\n        run: bun run test\n"), another)).toEqual(["continue-on-error: true"]);
  });

  it("is reported when the places that are allowed to fail grow, even for the same command", () => {
    const grown = merged.replace("  check:\n", "  report:\n    continue-on-error: true\n    steps:\n      - name: Report\n        run: bun run compat:report\n  check:\n");
    expect(guard(file, separate, grown)).toEqual(["continue-on-error: true"]);
  });
});
