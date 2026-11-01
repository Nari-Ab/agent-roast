import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { reviewChanges } from "../src/review.js";

let dir: string;
let base: string;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const commit = (message = "change") => { git("add", "-A"); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
const types = (result: { infractions: { type: string }[] }) => result.infractions.map(finding => finding.type);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-tamper-"));
  git("init", "-b", "main"); git("config", "user.name", "Reviewer"); git("config", "user.email", "review@example.invalid"); git("config", "commit.gpgsign", "false");
  write("README.md", "test repository\n"); base = commit("base");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const SUITE = `describe("cart", () => {
  it("totals items", () => {
    const total = price(cart);
    expect(total).toBe(42);
    expect(cart.items).toHaveLength(2);
  });
  it("applies discount", () => {
    expect(price(cart, "SAVE")).toBe(40);
  });
});
`;

describe("assertion-weakened", () => {
  it("blocks a test that loses an assertion", async () => {
    write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace("    expect(cart.items).toHaveLength(2);\n", "")); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(types(result)).toEqual(["assertion-weakened"]);
    expect(result.exitCode).toBe(1);
    expect(result.infractions[0]).toMatchObject({ file: "cart.test.ts", lineSnippet: "totals items: 2 → 1 assertions" });
  });
  it("blocks replacing an exact check by a weaker one", async () => {
    write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace("expect(price(cart, \"SAVE\")).toBe(40);", "expect(price(cart, \"SAVE\")).toBeDefined();")); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(types(result)).toEqual(["assertion-weakened"]);
    expect(result.infractions[0].reason).toMatch(/weaker/);
  });
  it("blocks python tests that drop an assert or weaken it to a truthiness check", async () => {
    write("test_cart.py", "def test_total():\n    total = price(cart)\n    assert total == 42\n    assert len(cart) == 2\n"); base = commit();
    write("test_cart.py", "def test_total():\n    total = price(cart)\n    assert total\n    assert len(cart) == 2\n"); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual(["assertion-weakened"]);
  });
  it("does not flag added assertions, reordered tests or an unrelated edit", async () => {
    write("cart.test.ts", SUITE); base = commit();
    const reordered = `describe("cart", () => {
  it("applies discount", () => {
    expect(price(cart, "SAVE")).toBe(40);
    expect(price(cart, "NONE")).toBe(42);
  });
  it("totals items", () => {
    const total = price(cart);
    expect(total).toBe(42);
    expect(cart.items).toHaveLength(2);
  });
});
`;
    write("cart.test.ts", reordered); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual([]);
  });
  it("treats a commented-out assertion as removed", async () => {
    write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace("    expect(cart.items).toHaveLength(2);", "    // expect(cart.items).toHaveLength(2);")); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual(["assertion-weakened"]);
  });
  it("respects rule: off in the base policy", async () => {
    write(".agentroastrc.json", JSON.stringify({ rules: { "assertion-weakened": "off" } }));
    write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace("    expect(cart.items).toHaveLength(2);\n", "")); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(types(result)).toEqual([]); expect(result.exitCode).toBe(0);
  });
});

describe("test-removed", () => {
  it("reports a deleted test without blocking by default", async () => {
    write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace(/  it\("applies discount"[\s\S]*?\n  \}\);\n/, "")); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(types(result)).toEqual(["test-removed"]);
    expect(result.exitCode).toBe(0);
    expect((await reviewChanges({ cwd: dir, base, failOn: ["test-removed"] })).exitCode).toBe(1);
  });
  it("reports every test of a deleted test file", async () => {
    write("cart.test.ts", SUITE); base = commit();
    fs.rmSync(path.join(dir, "cart.test.ts")); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual(["test-removed", "test-removed"]);
  });
  it("does not report a renamed test or a test moved to another file", async () => {
    write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace('it("applies discount"', 'it("applies a coupon"')); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual([]);
    const moved = `import { price } from "./price";\nit("applies a coupon", () => {\n    expect(price(cart, "SAVE")).toBe(40);\n  });\n`;
    write("cart.test.ts", SUITE.replace(/  it\("applies discount"[\s\S]*?\n  \}\);\n/, ""));
    write("coupon.test.ts", moved); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual([]);
  });
  it("treats a commented-out test as removed", async () => {
    write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace('  it("applies discount"', '  // it("applies discount"')); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toContain("test-removed");
  });
});

describe("expectation-rewritten", () => {
  const code = (value: number) => `export function price(cart) { return ${value}; }\n`;
  it("flags an edited expected value when production code changed in the same review", async () => {
    write("src/price.ts", code(42)); write("cart.test.ts", SUITE); base = commit();
    write("src/price.ts", code(41)); write("cart.test.ts", SUITE.replace("toBe(42)", "toBe(41)")); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(types(result)).toEqual(["expectation-rewritten"]);
    expect(result.exitCode).toBe(0);
  });
  it("stays quiet when only the test changed or the inputs changed too", async () => {
    write("src/price.ts", code(42)); write("cart.test.ts", SUITE); base = commit();
    write("cart.test.ts", SUITE.replace("toBe(42)", "toBe(41)")); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual([]);
    write("src/price.ts", code(41));
    write("cart.test.ts", SUITE.replace("toBe(42)", "toBe(41)").replace("price(cart);", "price(bigCart);")); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual([]);
  });
});

describe("guard-weakened", () => {
  it("blocks lowered coverage thresholds", async () => {
    write("vitest.config.ts", "export default { test: { coverage: { thresholds: { lines: 80, branches: 70 } } } };\n"); base = commit();
    write("vitest.config.ts", "export default { test: { coverage: { thresholds: { lines: 60, branches: 70 } } } };\n"); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(types(result)).toEqual(["guard-weakened"]);
    expect(result.exitCode).toBe(1);
    expect(result.infractions[0]).toMatchObject({ file: "vitest.config.ts", lineSnippet: "lines: 80 → 60" });
    expect(result.unsupportedFiles).toBe(0);
  });
  it("blocks switching off compiler strictness but not turning it on", async () => {
    write("tsconfig.json", '{ "compilerOptions": { "strict": true, "noImplicitAny": true } }\n'); base = commit();
    write("tsconfig.json", '{ "compilerOptions": { "strict": true, "noImplicitAny": false } }\n'); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual(["guard-weakened"]);
    write("tsconfig.json", '{ "compilerOptions": { "strict": false } }\n'); base = commit();
    write("tsconfig.json", '{ "compilerOptions": { "strict": true } }\n'); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual([]);
  });
  it("blocks downgraded lint rules", async () => {
    write(".eslintrc.json", '{ "rules": { "no-floating-promises": "error", "semi": "warn" } }\n'); base = commit();
    write(".eslintrc.json", '{ "rules": { "no-floating-promises": "off", "semi": "warn" } }\n'); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(types(result)).toEqual(["guard-weakened"]);
    expect(result.infractions[0].lineSnippet).toBe("no-floating-promises: error → off");
  });
  it("blocks CI tolerating failures or dropping the test step", async () => {
    const workflow = (extra: string, test: string) => `jobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n${test}${extra}`;
    write(".github/workflows/ci.yml", workflow("", "      - run: npm test\n")); base = commit();
    write(".github/workflows/ci.yml", workflow("", "      - run: npm test\n        continue-on-error: true\n")); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual(["guard-weakened"]);
    write(".github/workflows/ci.yml", workflow("", "      - run: npm test\n")); base = commit();
    write(".github/workflows/ci.yml", workflow("", "")); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual(["guard-weakened"]);
  });
  it("blocks a test script that can no longer fail", async () => {
    write("package.json", JSON.stringify({ scripts: { test: "vitest run" } })); base = commit();
    write("package.json", JSON.stringify({ scripts: { test: "vitest run || true" } })); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual(["guard-weakened"]);
  });
  it("ignores raised thresholds, unrelated package.json edits and invalid JSON", async () => {
    write("vitest.config.ts", "export default { test: { coverage: { thresholds: { lines: 60 } } } };\n");
    write("package.json", JSON.stringify({ name: "x", scripts: { test: "vitest run" } })); base = commit();
    write("vitest.config.ts", "export default { test: { coverage: { thresholds: { lines: 90 } } } };\n");
    write("package.json", JSON.stringify({ name: "y", version: "2.0.0", scripts: { test: "vitest run" } })); commit();
    expect(types(await reviewChanges({ cwd: dir, base }))).toEqual([]);
    write("package.json", "{ not json"); commit();
    expect((await reviewChanges({ cwd: dir, base })).complete).toBe(true);
  });
  it("lets a trusted exception accept one precise guard change", async () => {
    write("tsconfig.json", '{ "compilerOptions": { "strict": true } }\n'); base = commit();
    write("tsconfig.json", '{ "compilerOptions": { "strict": false } }\n'); commit();
    const first = await reviewChanges({ cwd: dir, base, format: "json" });
    const fingerprint = first.infractions[0].fingerprint!;
    write(".agentroastrc.json", JSON.stringify({ exceptions: [{ fingerprint, count: 1, reason: "Migrating module by module", expires: "2099-01-01" }] }));
    write("tsconfig.json", '{ "compilerOptions": { "strict": true } }\n'); base = commit("policy");
    write("tsconfig.json", '{ "compilerOptions": { "strict": false } }\n'); commit();
    const accepted = await reviewChanges({ cwd: dir, base });
    expect(accepted.exitCode).toBe(0);
    expect(accepted.suppressedFindings).toHaveLength(1);
  });
});

describe("parser robustness", () => {
  it("handles a test file with tens of thousands of tests in linear time", async () => {
    const suite = (assertions: number) => Array.from({ length: 20_000 }, (_, i) => `it("case ${i}", () => { ${"expect(a).toBe(1); ".repeat(i === 19_999 ? assertions : 1)}});\n`).join("");
    write("big.test.ts", suite(2)); base = commit();
    write("big.test.ts", suite(1)); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.complete).toBe(true);
    expect(result.infractions).toEqual([expect.objectContaining({ type: "assertion-weakened", lineSnippet: "case 19999: 2 → 1 assertions" })]);
  }, 30_000);
  it("does not let unbalanced quotes inside one test swallow the tests after it", async () => {
    const suite = (second: string) => `it("first", () => {\n  run(); // don't panic\n  expect(a).toBe(1);\n  expect(/\`/.test(s)).toBe(true);\n});\nit("second", () => {\n${second}});\nit("third", () => {\n  expect(c).toBe(3);\n});\n`;
    write("quotes.test.ts", suite("  expect(b).toBe(2);\n  expect(b2).toBe(2);\n")); base = commit();
    write("quotes.test.ts", suite("  expect(b).toBe(2);\n")); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.infractions).toEqual([expect.objectContaining({ type: "assertion-weakened", lineSnippet: "second: 2 → 1 assertions" })]);
  });
});
