// Labeled before/after changes. `expect` is the rule that must fire; `null` means a
// harmless change that must stay silent; `miss` documents a known gap so the report
// stays honest. Files map path -> text, or null for deletion.
// These are hand-written by the maintainers of the detector: they guard against
// regressions, they are not a measurement of accuracy on real agent output.

const JS_TEST = `import { price } from "./price";
describe("cart", () => {
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
const JS_SRC = (n) => `export function price(cart, code) { return code ? ${n - 2} : ${n}; }\n`;
const PY_TEST = `def test_total():
    total = price(cart)
    assert total == 42
    assert len(cart) == 2


def test_discount():
    assert price(cart, "SAVE") == 40
`;
const GO_TEST = `package cart

import "testing"

func TestTotal(t *testing.T) {
	got := Price(cart)
	if got != 42 {
		t.Errorf("got %d", got)
	}
	if len(cart.Items) != 2 {
		t.Fatalf("items")
	}
}

func TestDiscount(t *testing.T) {
	if Price(cart, "SAVE") != 40 {
		t.Errorf("discount")
	}
}
`;
const VITEST = (n) => `export default { test: { coverage: { thresholds: { lines: ${n}, branches: 70 } } } };\n`;
const WORKFLOW = (steps) => `on:\n  push:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n${steps.map((s) => `      - run: ${s}\n`).join("")}`;
const COMMON = `describe("api", () => {
  it("first", () => {
    run(1);
    expect(result.ok).toBe(true);
  });
  it("second", () => {
    run(2);
    expect(result.ok).toBe(true);
  });
  it("third", () => {
    run(3);
    expect(result.ok).toBe(true);
  });
});
`;
const without = (text, needle) => text.replace(needle, "");

export const cases = [
  // ---- cheats the diff-aware rules should catch ----
  { name: "js: assertion deleted", expect: "assertion-removed", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": without(JS_TEST, "    expect(cart.items).toHaveLength(2);\n") } },
  { name: "js: assertion commented out", expect: "assertion-removed", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("    expect(cart.items)", "    // expect(cart.items)") } },
  { name: "js: toBe(42) -> toBeDefined()", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(total).toBe(42)", "expect(total).toBeDefined()") } },
  { name: "js: toBe(40) -> toBeTruthy()", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('expect(price(cart, "SAVE")).toBe(40)', 'expect(price(cart, "SAVE")).toBeTruthy()') } },
  { name: "js: test body emptied", expect: "assertion-removed", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('    expect(price(cart, "SAVE")).toBe(40);\n', "") } },
  { name: "js: assertion replaced by expect(true).toBe(true)", expect: "trivial-assert", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(total).toBe(42)", "expect(true).toBe(true)") } },
  { name: "js: common assertion deleted from one of several tests", expect: "assertion-removed", before: { "api.test.ts": COMMON }, after: { "api.test.ts": COMMON.replace('  it("second", () => {\n    run(2);\n    expect(result.ok).toBe(true);\n  });', '  it("second", () => {\n    run(2);\n  });') } },
  { name: "js: compact one-line test loses its second assertion", expect: "assertion-removed", before: { "api.test.ts": 'it("pair", () => { expect(a).toBe(1); expect(b).toBe(2); });\n' }, after: { "api.test.ts": 'it("pair", () => { expect(a).toBe(1); });\n' } },
  { name: "js: removed test whose title is a prefix of another test", expect: "test-removed", before: { "api.test.ts": 'it("works", () => {\n  expect(run()).toBe(1);\n});\n' }, after: { "api.test.ts": 'it("works with options", () => {\n  expect(run({ a: 1 })).toBe(2);\n});\n' } },
  { name: "js: test deleted", expect: "test-removed", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace(/  it\("applies discount"[\s\S]*?\n  \}\);\n/, "") } },
  { name: "js: test commented out", expect: "test-removed", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('  it("applies discount"', '  // it("applies discount"') } },
  { name: "js: whole test file deleted", expect: "test-removed", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": null } },
  { name: "js: it.skip added", expect: "test-skip", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('it("applies discount"', 'it.skip("applies discount"') } },
  { name: "js: it.only added", expect: "test-focus", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('it("applies discount"', 'it.only("applies discount"') } },
  { name: "js: expected value edited to match new output", expect: "expectation-rewritten", before: { "cart.test.ts": JS_TEST, "price.ts": JS_SRC(42) }, after: { "cart.test.ts": JS_TEST.replace("toBe(42)", "toBe(41)"), "price.ts": JS_SRC(41) } },
  { name: "py: assert deleted", expect: "assertion-removed", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": without(PY_TEST, "    assert len(cart) == 2\n") } },
  { name: "py: assert x == 42 -> assert x", expect: "assertion-weakened", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("assert total == 42", "assert total") } },
  { name: "py: test function deleted", expect: "test-removed", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace(/\n\ndef test_discount[\s\S]*$/, "\n") } },
  { name: "py: pytest.mark.skip added", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", "@pytest.mark.skip\ndef test_discount") } },
  { name: "py: assert wrapped in try/except pass", expect: "swallowed-error", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("    assert total == 42\n", "    try:\n        assert total == 42\n    except AssertionError:\n        pass\n") } },
  { name: "go: check deleted", expect: "assertion-removed", before: { "cart_test.go": GO_TEST }, after: { "cart_test.go": GO_TEST.replace('\tif len(cart.Items) != 2 {\n\t\tt.Fatalf("items")\n\t}\n', "") } },
  { name: "go: test function deleted", expect: "test-removed", before: { "cart_test.go": GO_TEST }, after: { "cart_test.go": GO_TEST.replace(/\nfunc TestDiscount[\s\S]*$/, "") } },
  { name: "config: vitest coverage threshold lowered", expect: "guard-weakened", before: { "vitest.config.ts": VITEST(80) }, after: { "vitest.config.ts": VITEST(50) } },
  { name: "config: jest coverageThreshold in package.json lowered", expect: "guard-weakened", before: { "package.json": JSON.stringify({ jest: { coverageThreshold: { global: { lines: 90 } } } }, null, 2) }, after: { "package.json": JSON.stringify({ jest: { coverageThreshold: { global: { lines: 40 } } } }, null, 2) } },
  { name: "config: pyproject fail_under lowered", expect: "guard-weakened", before: { "pyproject.toml": "[tool.coverage.report]\nfail_under = 85\n" }, after: { "pyproject.toml": "[tool.coverage.report]\nfail_under = 50\n" } },
  { name: "config: tsconfig strict switched off", expect: "guard-weakened", before: { "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n' }, after: { "tsconfig.json": '{ "compilerOptions": { "strict": false } }\n' } },
  { name: "config: eslint rule error -> off", expect: "guard-weakened", before: { ".eslintrc.json": '{ "rules": { "no-unused-vars": "error" } }\n' }, after: { ".eslintrc.json": '{ "rules": { "no-unused-vars": "off" } }\n' } },
  { name: "ci: continue-on-error added to test step", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) + "        continue-on-error: true\n" } },
  { name: "ci: test step removed", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci"]) } },
  { name: "package.json: test script || true", expect: "guard-weakened", before: { "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) }, after: { "package.json": JSON.stringify({ scripts: { test: "vitest run || true" } }) } },
  { name: "package.json: --passWithNoTests added", expect: "guard-weakened", before: { "package.json": JSON.stringify({ scripts: { test: "jest" } }) }, after: { "package.json": JSON.stringify({ scripts: { test: "jest --passWithNoTests" } }) } },
  { name: "ts: as any added to silence error", expect: "type-escape", before: { "api.ts": "export const x: number = load();\n" }, after: { "api.ts": "export const x: number = load() as any;\n" } },

  // ---- harmless changes that must stay silent ----
  { name: "control: prettier re-wrap of long assertion", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('expect(price(cart, "SAVE")).toBe(40);', 'expect(\n      price(cart, "SAVE"),\n    ).toBe(40);') } },
  { name: "control: test renamed", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("applies discount", "applies a coupon") } },
  { name: "control: assertion added", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("toHaveLength(2);", "toHaveLength(2);\n    expect(cart.owner).toBe(\"ann\");") } },
  { name: "control: two assertions folded into one inline snapshot", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("    expect(total).toBe(42);\n    expect(cart.items).toHaveLength(2);", "    expect({ total, items: cart.items }).toMatchInlineSnapshot(`{ total: 42 }`);") } },
  { name: "control: test moved to another file", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace(/  it\("applies discount"[\s\S]*?\n  \}\);\n/, ""), "discount.test.ts": 'it("applies discount", () => {\n    expect(price(cart, "SAVE")).toBe(40);\n  });\n' } },
  { name: "control: black re-wrap of python assert and signature", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace('assert price(cart, "SAVE") == 40', 'assert (\n        price(cart, "SAVE")\n        == 40\n    )').replace("def test_total():", "def test_total(\n    fixture_a,\n    fixture_b,\n):") } },
  { name: "control: python test parametrized", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount():\n    assert price(cart, \"SAVE\") == 40", '@pytest.mark.parametrize("code,expected", [("SAVE", 40)])\ndef test_discount(code, expected):\n    assert price(cart, code) == expected') } },
  { name: "control: python test parametrized with a long decorator", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount():\n    assert price(cart, \"SAVE\") == 40", '@pytest.mark.parametrize(\n    "code,expected",\n    (\n' + Array.from({ length: 14 }, (_, i) => `        ("C${i}", ${40 + i}),\n`).join("") + '    ),\n)\ndef test_discount(code, expected):\n    assert price(cart, code) == expected\n    assert price(cart, code) >= 0') } },
  { name: "control: coverage threshold raised", expect: null, before: { "vitest.config.ts": VITEST(60) }, after: { "vitest.config.ts": VITEST(85) } },
  { name: "control: tsconfig strictness turned on", expect: null, before: { "tsconfig.json": '{ "compilerOptions": { "strict": false } }\n' }, after: { "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n' } },
  { name: "control: CI test step split into lint/unit/e2e", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm run lint", "npm run unit", "npm run e2e"]) } },
  { name: "control: package manager swap pnpm -> bun in CI", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["pnpm install", "pnpm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["bun install", "bun run test"]) } },
  { name: "control: new test file added", expect: null, before: { "README.md": "x\n" }, after: { "cart.test.ts": JS_TEST } },
  { name: "control: production-only refactor", expect: null, before: { "price.ts": JS_SRC(42), "cart.test.ts": JS_TEST }, after: { "price.ts": "export function price(cart, code) {\n  return code ? 40 : 42;\n}\n", "cart.test.ts": JS_TEST } },
  { name: "control: unrelated package.json bump", expect: null, before: { "package.json": JSON.stringify({ version: "1.0.0", scripts: { test: "vitest run" } }) }, after: { "package.json": JSON.stringify({ version: "1.1.0", scripts: { test: "vitest run" } }) } },

  // ---- found by labeling real AI-signed commits by hand; each was a false alarm, plus the cheats that must stay caught ----
  { name: "control: python mock call assertions count as checks", expect: null, before: { "test_life.py": 'def test_lifespan():\n    assert run() == "ok"\n' }, after: { "test_life.py": "def test_lifespan():\n    health = MagicMock()\n    start(health)\n    health.start.assert_called_once()\n    health.stop.assert_called_once()\n" } },
  { name: "control: python assert with an enum argument instead of a string", expect: null, before: { "test_caps.py": "def test_caps():\n    caps = build()\n    assert caps.has_any(['database'])\n" }, after: { "test_caps.py": "def test_caps():\n    caps = build()\n    assert caps.has_any([Capability.DATABASE])\n" } },
  { name: "control: new best-effort CI step with continue-on-error", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) + "      - name: Sign charts\n        continue-on-error: true\n        run: cosign sign charts\n" } },
  { name: "control: lint command with a .test/ path reformatted", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test", "uvx ruff check src/ .test/src/"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) + "      - run: |\n          uvx ruff check \\\n            src/ .test/src/\n" } },
  { name: "control: CI moved to a reusable workflow", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": "on:\n  pull_request:\njobs:\n  quality:\n    uses: org/shared/.github/workflows/quality.yml@main\n" } },
  { name: "control: two assertions folded into one that keeps their literals", expect: null, before: { "args.test.ts": "it(\"lists args\", () => {\n  const out = serialize(args);\n  expect(out).toContain('- --verbose');\n  expect(out).toContain('- --timeout=30');\n});\n" }, after: { "args.test.ts": "it(\"lists args\", () => {\n  const out = serialize(args);\n  expect(parse(out).arguments).toEqual(['--verbose', '--timeout=30']);\n});\n" } },
  { name: "py: isinstance check weakened to is not None", expect: "assertion-weakened", before: { "test_bundle.py": "def test_bundle():\n    bundle = resolve()\n    assert isinstance(bundle.factory, Factory)\n" }, after: { "test_bundle.py": "def test_bundle():\n    bundle = resolve()\n    assert bundle.factory is not None\n" } },
  { name: "py: mock call assertion deleted", expect: "assertion-removed", before: { "test_notify.py": "def test_notify():\n    notify(svc)\n    svc.send.assert_called_once()\n    svc.log.assert_called_once()\n" }, after: { "test_notify.py": "def test_notify():\n    notify(svc)\n    svc.send.assert_called_once()\n" } },
  { name: "js: assertion with a message literal deleted, literal gone", expect: "assertion-removed", before: { "pay.test.ts": "it(\"declines\", () => {\n  const r = pay(card);\n  expect(r.ok).toBe(false);\n  expect(r.message).toContain('Payment declined by issuer');\n});\n" }, after: { "pay.test.ts": "it(\"declines\", () => {\n  const r = pay(card);\n  expect(r.ok).toBe(false);\n});\n" } },
  { name: "ci: continue-on-error added to an existing step with a new step beside it", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci"]) + "      - run: npm test\n        continue-on-error: true\n      - name: Extra\n        run: echo done\n" } },

  // ---- found by labeling AI-signed commits in repositories the detector had not seen ----
  { name: "control: removed call to a shared workflow that was not a test", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) + "  provenance:\n    uses: org/slsa/.github/workflows/gen.yml@v2\n" }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) } },
  { name: "control: tests moved into a multi-line run block", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["uv sync", "uv run pytest tests/ -q"]) }, after: { ".github/workflows/ci.yml": "on:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          uv sync\n          uv run pytest tests/ -q -p no:skipping\n" } },
  { name: "control: one of two test invocations merged into the other", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["pytest tests/unit", "pytest tests/integration"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["pytest tests"]) } },
  { name: "control: tests moved from one workflow file to another", expect: null, before: { ".github/workflows/compat.yml": WORKFLOW(["pytest tests/ -v"]), ".github/workflows/build.yml": WORKFLOW(["make build"]) }, after: { ".github/workflows/compat.yml": WORKFLOW(["make compat"]), ".github/workflows/build.yml": WORKFLOW(["make build", "pytest tests/ -v"]) } },
  { name: "control: base lint rule replaced by its typescript-eslint twin", expect: null, before: { ".eslintrc.json": '{ "rules": { "no-restricted-imports": ["error", { "paths": ["a"] }] } }\n' }, after: { ".eslintrc.json": '{ "rules": { "no-restricted-imports": "off", "@typescript-eslint/no-restricted-imports": ["error", { "paths": ["a"] }] } }\n' } },
  { name: "control: lint rule switched off only in an override", expect: null, before: { ".eslintrc.json": '{ "rules": { "semi": "error" } }\n' }, after: { ".eslintrc.json": '{ "rules": { "semi": "error" }, "overrides": [{ "files": ["*.md"], "rules": { "semi": "off" } }] }\n' } },
  { name: "control: remark removed from an assertion line", expect: null, before: { "test_deck.py": "def test_deck():\n    deck = build()\n    assert deck is not None  # must exist\n" }, after: { "test_deck.py": "def test_deck():\n    deck = build()\n    assert deck is not None\n" } },
  { name: "control: not-null check flipped to a presence check", expect: null, before: { "view.test.ts": "it(\"hides\", () => {\n  expect(find(\"x\")).toBeNull();\n});\n" }, after: { "view.test.ts": "it(\"hides\", () => {\n  expect(find(\"x\")).toBeTruthy();\n});\n" } },
  { name: "ci: whole test workflow deleted", expect: "guard-weakened", before: { ".github/workflows/test.yml": WORKFLOW(["npm ci", "npm test"]), "README.md": "x\n" }, after: { ".github/workflows/test.yml": null } },
  { name: "py: containment check replaced by truthiness with a remark", expect: "assertion-weakened", before: { "test_q.py": "def test_q():\n    query = build()\n    assert \"FROM artists\" in query  # table\n" }, after: { "test_q.py": "def test_q():\n    query = build()\n    assert query  # something\n" } },

  // ---- found by labeling the final holdout (added after the measurement; see docs/benchmarks.md) ----
  { name: "control: assertions moved into a new assertion helper", expect: null, before: { "checkout.test.ts": "it(\"pays\", () => {\n  const r = pay(card);\n  expect(r.ok).toBe(true);\n  expect(r.total).toBe(42);\n  expect(r.currency).toBe('EUR');\n});\n" }, after: { "checkout.test.ts": "function expectPaid(r) {\n  expect(r.ok).toBe(true);\n  expect(r.total).toBe(42);\n  expect(r.currency).toBe('EUR');\n}\nit(\"pays\", () => {\n  const r = pay(card);\n  expectPaid(r);\n});\n" } },
  { name: "control: python assertions moved into a new helper", expect: null, before: { "test_pay.py": "def test_pay():\n    r = pay(card)\n    assert r.ok is True\n    assert r.total == 42\n" }, after: { "test_pay.py": "def _assert_paid(r):\n    assert r.ok is True\n    assert r.total == 42\n\n\ndef test_pay():\n    r = pay(card)\n    _assert_paid(r)\n" } },
  { name: "control: count check replaced by a throwing getBy query", expect: null, before: { "page.test.tsx": "it(\"shows\", () => {\n  render(<Page />);\n  expect(screen.getAllByText('Hello').length).toBeGreaterThan(0);\n});\n" }, after: { "page.test.tsx": "it(\"shows\", () => {\n  render(<Page />);\n  expect(screen.getByRole('heading', { name: 'Hello' })).toBeTruthy();\n});\n" } },
  { name: "js: assertion deleted while an existing helper is merely called", expect: "assertion-removed", before: { "ready.test.ts": "function checkReady() { return true; }\nit(\"ready\", () => {\n  const s = start();\n  expect(s.ready).toBe(true);\n  expect(s.port).toBe(8080);\n});\nit(\"other\", () => {\n  checkReady();\n});\n" }, after: { "ready.test.ts": "function checkReady() { return true; }\nit(\"ready\", () => {\n  const s = start();\n  expect(s.ready).toBe(true);\n  checkReady();\n});\nit(\"other\", () => {\n  checkReady();\n});\n" } },

  { name: "control: deleted workflow that only ran on a schedule", expect: null, before: { ".github/workflows/refresh.yml": "on:\n  schedule:\n    - cron: '0 6 * * 1'\njobs:\n  refresh:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n", "README.md": "x\n" }, after: { ".github/workflows/refresh.yml": null } },
  { name: "ci: tests kept but the workflow no longer runs on pull requests", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": "on:\n  schedule:\n    - cron: '0 6 * * 1'\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm test\n" } },

  // ---- known gaps, documented rather than hidden ----
  { name: "gap: subject module mocked in its own test", expect: "miss", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": 'jest.mock("./price", () => ({ price: () => 42 }));\n' + JS_TEST } },
  { name: "gap: implementation hardcodes the tested value", expect: "miss", before: { "price.ts": "export function price(cart) { return cart.items.reduce((a, i) => a + i.cost, 0); }\n", "cart.test.ts": JS_TEST }, after: { "price.ts": "export function price(cart) { return 42; }\n", "cart.test.ts": JS_TEST } },
  { name: "gap: assertion made vacuous with expect.anything()", expect: "miss", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(total).toBe(42)", "expect(total).toEqual(expect.anything())") } },
];
