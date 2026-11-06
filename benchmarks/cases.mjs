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
const RUST_SRC = `pub fn price(items: &[u32]) -> u32 {
    items.iter().sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totals_items() {
        assert_eq!(price(&[40, 2]), 42);
    }
}
`;
const JAVA_TEST = `package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

class CartTest {
    @Test
    void totalsItems() {
        assertEquals(42, new Cart(40, 2).total());
    }
}
`;
const CS_TEST = `using Xunit;

public class CartTests
{
    [Fact]
    public void TotalsItems()
    {
        Assert.Equal(42, new Cart(40, 2).Total());
    }
}
`;
const RUBY_SPEC = `require "cart"

RSpec.describe Cart do
  it "totals items" do
    expect(Cart.new(40, 2).total).to eq(42)
  end
end
`;
const PHP_TEST = `<?php
use PHPUnit\\Framework\\TestCase;

final class CartTest extends TestCase
{
    public function testTotalsItems(): void
    {
        $this->assertSame(42, (new Cart(40, 2))->total());
    }
}
`;
const SWIFT_TEST = `import XCTest

final class CartTests: XCTestCase {
    func testTotalsItems() throws {
        XCTAssertEqual(Cart(40, 2).total, 42)
    }
}
`;
const SWIFT_WRAPPED = `#if canImport(XCTest)\n${SWIFT_TEST}#endif\n`;
const SWIFT_TESTING = `import Testing

@Test("totals items")
func totalsItems() {
    #expect(Cart(40, 2).total == 42)
}
`;
const NUNIT_TEST = `using NUnit.Framework;

public class CartTests
{
    [Test]
    public void TotalsItems()
    {
        Assert.AreEqual(42, new Cart(40, 2).Total());
    }
}
`;
const CS_MAP = `public class Source
{
    public string Secret { get; set; }
}
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
const PW_TEST = `import { test, expect } from "@playwright/test";
test("renders the cart", async ({ page, browserName }) => {
  await page.goto("/cart");
  await expect(page.locator(".total")).toHaveText("42");
});
`;
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
  { name: "js: test.skip(true) added inside a test", expect: "test-skip", before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace("  await page.goto", '  test.skip(true, "flaky");\n  await page.goto') } },
  { name: "js: test.skip gated on CI added inside a test", expect: "test-skip", before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace("  await page.goto", '  test.skip(!!process.env.CI, "flaky on CI");\n  await page.goto') } },
  { name: "js: it.only added", expect: "test-focus", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('it("applies discount"', 'it.only("applies discount"') } },
  { name: "js: expected value edited to match new output", expect: "expectation-rewritten", before: { "cart.test.ts": JS_TEST, "price.ts": JS_SRC(42) }, after: { "cart.test.ts": JS_TEST.replace("toBe(42)", "toBe(41)"), "price.ts": JS_SRC(41) } },
  { name: "py: assert deleted", expect: "assertion-removed", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": without(PY_TEST, "    assert len(cart) == 2\n") } },
  { name: "py: assert x == 42 -> assert x", expect: "assertion-weakened", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("assert total == 42", "assert total") } },
  { name: "py: test function deleted", expect: "test-removed", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace(/\n\ndef test_discount[\s\S]*$/, "\n") } },
  { name: "py: pytest.mark.skip added", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", "@pytest.mark.skip\ndef test_discount") } },
  { name: "py: pytest.skip() added as a statement of the test", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount():\n", 'def test_discount():\n    pytest.skip("flaky")\n') } },
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
  { name: "control: test.skip gated on the browser", expect: null, before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace("  await page.goto", '  test.skip(browserName === "webkit", "no webkit support");\n  await page.goto') } },
  { name: "control: test.skip with an environment callback", expect: null, before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace('test("renders', 'test.skip(({ isMobile }) => isMobile, "desktop only");\ntest("renders') } },
  { name: "control: pytest.skip under a platform condition", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount():\n", 'def test_discount():\n    if sys.platform == "win32":\n        pytest.skip("no windows support")\n') } },
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

  // ---- disabled tests and placeholder assertions beyond JavaScript and Python ----
  { name: "go: t.Skip added as the first statement of a test", expect: "test-skip", before: { "cart_test.go": GO_TEST }, after: { "cart_test.go": GO_TEST.replace("func TestTotal(t *testing.T) {\n", 'func TestTotal(t *testing.T) {\n\tt.Skip("flaky")\n') } },
  { name: "go: t.Skip added inside a sub-test", expect: "test-skip", before: { "cart_test.go": GO_TEST + '\nfunc TestGroups(t *testing.T) {\n\tt.Run("discount", func(t *testing.T) {\n\t\tif Price(cart) != 42 {\n\t\t\tt.Fatal("price")\n\t\t}\n\t})\n}\n' }, after: { "cart_test.go": GO_TEST + '\nfunc TestGroups(t *testing.T) {\n\tt.Run("discount", func(t *testing.T) {\n\t\tt.Skip("later")\n\t\tif Price(cart) != 42 {\n\t\t\tt.Fatal("price")\n\t\t}\n\t})\n}\n' } },
  { name: "go: testify check replaced by assert.True(t, true)", expect: "trivial-assert", before: { "cart_test.go": GO_TEST }, after: { "cart_test.go": GO_TEST + '\nfunc TestPlaceholder(t *testing.T) {\n\tassert.True(t, true)\n}\n' } },
  { name: "control: go t.Skip under testing.Short()", expect: null, before: { "cart_test.go": GO_TEST }, after: { "cart_test.go": GO_TEST.replace("func TestTotal(t *testing.T) {\n", 'func TestTotal(t *testing.T) {\n\tif testing.Short() {\n\t\tt.Skip("slow")\n\t}\n') } },
  { name: "control: go t.Skip in a helper that checks the environment", expect: null, before: { "cart_test.go": GO_TEST }, after: { "cart_test.go": GO_TEST + '\nfunc requireDocker(t *testing.T) {\n\tt.Helper()\n\tif os.Getenv("DOCKER_HOST") == "" {\n\t\tt.Skip("no docker")\n\t}\n}\n' } },
  { name: "rust: #[ignore] added to a test", expect: "test-skip", before: { "src/lib.rs": RUST_SRC }, after: { "src/lib.rs": RUST_SRC.replace("    #[test]\n", "    #[test]\n    #[ignore]\n") } },
  { name: "rust: #[ignore = reason] added to a test", expect: "test-skip", before: { "src/lib.rs": RUST_SRC }, after: { "src/lib.rs": RUST_SRC.replace("    #[test]\n", '    #[test]\n    #[ignore = "flaky"]\n') } },
  { name: "rust: assert_eq replaced by assert!(true)", expect: "trivial-assert", before: { "src/lib.rs": RUST_SRC }, after: { "src/lib.rs": RUST_SRC.replace("assert_eq!(price(&[40, 2]), 42);", "assert!(true);") } },
  { name: "control: rust test ignored only without a feature", expect: null, before: { "src/lib.rs": RUST_SRC }, after: { "src/lib.rs": RUST_SRC.replace("    #[test]\n", '    #[test]\n    #[cfg_attr(not(feature = "net"), ignore)]\n') } },
  { name: "java: @Disabled added to a JUnit 5 test", expect: "test-skip", before: { "src/test/java/shop/CartTest.java": JAVA_TEST }, after: { "src/test/java/shop/CartTest.java": JAVA_TEST.replace("    @Test\n", '    @Test\n    @Disabled("flaky")\n') } },
  { name: "java: @Ignore added to a JUnit 4 test", expect: "test-skip", before: { "src/test/java/shop/CartTest.java": JAVA_TEST }, after: { "src/test/java/shop/CartTest.java": JAVA_TEST.replace("    @Test\n", "    @Test @Ignore\n") } },
  { name: "kotlin: @Ignore added to a test", expect: "test-skip", before: { "src/test/kotlin/CartTest.kt": 'class CartTest {\n    @Test\n    fun totalsItems() {\n        assertEquals(42, Cart(40, 2).total())\n    }\n}\n' }, after: { "src/test/kotlin/CartTest.kt": 'class CartTest {\n    @Test\n    @Ignore\n    fun totalsItems() {\n        assertEquals(42, Cart(40, 2).total())\n    }\n}\n' } },
  { name: "java: assertEquals replaced by assertTrue(true)", expect: "trivial-assert", before: { "src/test/java/shop/CartTest.java": JAVA_TEST }, after: { "src/test/java/shop/CartTest.java": JAVA_TEST.replace("assertEquals(42, new Cart(40, 2).total());", "assertTrue(true);") } },
  { name: "control: java test disabled only on Windows", expect: null, before: { "src/test/java/shop/CartTest.java": JAVA_TEST }, after: { "src/test/java/shop/CartTest.java": JAVA_TEST.replace("    @Test\n", "    @Test\n    @DisabledOnOs(OS.WINDOWS)\n") } },
  { name: "csharp: Skip added to an xUnit Fact", expect: "test-skip", before: { "tests/CartTests.cs": CS_TEST }, after: { "tests/CartTests.cs": CS_TEST.replace("[Fact]", '[Fact(Skip = "flaky")]') } },
  { name: "csharp: [Ignore] added to a test", expect: "test-skip", before: { "tests/CartTests.cs": CS_TEST }, after: { "tests/CartTests.cs": CS_TEST.replace("    [Fact]\n", '    [Fact]\n    [Ignore("later")]\n') } },
  { name: "csharp: Assert.Equal replaced by Assert.True(true)", expect: "trivial-assert", before: { "tests/CartTests.cs": CS_TEST }, after: { "tests/CartTests.cs": CS_TEST.replace("Assert.Equal(42, new Cart(40, 2).Total());", "Assert.True(true);") } },
  { name: "ruby: it renamed to xit", expect: "test-skip", before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace('  it "totals', '  xit "totals') } },
  { name: "ruby: bare skip added to an example", expect: "test-skip", before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace('  it "totals items" do\n', '  it "totals items" do\n    skip "later"\n') } },
  { name: "ruby: fit added", expect: "test-focus", before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace('  it "totals', '  fit "totals') } },
  { name: "ruby: expectation replaced by expect(true).to eq(true)", expect: "trivial-assert", before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace("expect(Cart.new(40, 2).total).to eq(42)", "expect(true).to eq(true)") } },
  { name: "control: ruby skip gated on a service", expect: null, before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace('  it "totals items" do\n', '  it "totals items" do\n    skip "no redis" unless redis_available?\n') } },
  { name: "control: ruby skip and pending as ordinary methods in library code", expect: null, before: { "lib/parser.rb": "class Parser\n  def run\n    tokens\n  end\nend\n" }, after: { "lib/parser.rb": "class Parser\n  def run\n    skip\n    pending \"input\"\n    tokens\n  end\nend\n" } },
  { name: "php: markTestSkipped added to a test", expect: "test-skip", before: { "tests/CartTest.php": PHP_TEST }, after: { "tests/CartTest.php": PHP_TEST.replace("    {\n        $this->assertSame", "    {\n        $this->markTestSkipped('later');\n        $this->assertSame") } },
  { name: "php: assertSame replaced by assertTrue(true)", expect: "trivial-assert", before: { "tests/CartTest.php": PHP_TEST }, after: { "tests/CartTest.php": PHP_TEST.replace("$this->assertSame(42, (new Cart(40, 2))->total());", "$this->assertTrue(true);") } },
  { name: "control: php test skipped when an extension is missing", expect: null, before: { "tests/CartTest.php": PHP_TEST }, after: { "tests/CartTest.php": PHP_TEST.replace("    {\n        $this->assertSame", "    {\n        if (!extension_loaded('redis')) {\n            $this->markTestSkipped('no redis');\n        }\n        $this->assertSame") } },
  { name: "swift: XCTSkip thrown at the start of a test", expect: "test-skip", before: { "Tests/CartTests.swift": SWIFT_TEST }, after: { "Tests/CartTests.swift": SWIFT_TEST.replace("throws {\n", 'throws {\n        throw XCTSkip("later")\n') } },
  { name: "swift: assertion replaced by XCTAssertTrue(true)", expect: "trivial-assert", before: { "Tests/CartTests.swift": SWIFT_TEST }, after: { "Tests/CartTests.swift": SWIFT_TEST.replace("XCTAssertEqual(Cart(40, 2).total, 42)", "XCTAssertTrue(true)") } },
  { name: "control: swift test skipped when hardware is missing", expect: null, before: { "Tests/CartTests.swift": SWIFT_TEST }, after: { "Tests/CartTests.swift": SWIFT_TEST.replace("throws {\n", 'throws {\n        try XCTSkipUnless(hasGPU, "no GPU")\n') } },

  // ---- found by running the new language rules on 39 real repositories (docs/benchmarks.md, section 5) ----
  { name: "control: swift XCTSkip under #if os(Windows)", expect: null, before: { "Tests/CartTests.swift": SWIFT_TEST }, after: { "Tests/CartTests.swift": SWIFT_TEST.replace("throws {\n", 'throws {\n        #if os(Windows)\n        throw XCTSkip("Unsupported on this platform")\n        #endif\n') } },
  { name: "swift: XCTSkip in a test file wrapped in #if canImport", expect: "test-skip", before: { "Tests/CartTests.swift": SWIFT_WRAPPED }, after: { "Tests/CartTests.swift": SWIFT_WRAPPED.replace("throws {\n", 'throws {\n        throw XCTSkip("later")\n') } },
  { name: "control: swift XCTSkip inside a public helper", expect: null, before: { "Tests/CartTests.swift": SWIFT_TEST }, after: { "Tests/CartTests.swift": SWIFT_TEST + '\nextension CartTests {\n    public func skipWithoutNetwork() throws {\n        throw XCTSkip("no network")\n    }\n}\n' } },
  { name: "swift: XCTSkip after a closed #if block is still a skip", expect: "test-skip", before: { "Tests/CartTests.swift": SWIFT_TEST }, after: { "Tests/CartTests.swift": SWIFT_TEST.replace("throws {\n", 'throws {\n        #if os(Windows)\n        print("windows")\n        #endif\n        throw XCTSkip("later")\n') } },
  { name: "control: swift test disabled only when a condition holds", expect: null, before: { "Tests/CartTests.swift": SWIFT_TESTING }, after: { "Tests/CartTests.swift": SWIFT_TESTING.replace('@Test("totals items")', '@Test("totals items", .disabled(if: SwiftVersion.current < .six))') } },
  { name: "swift: Swift Testing test disabled with a reason", expect: "test-skip", before: { "Tests/CartTests.swift": SWIFT_TESTING }, after: { "Tests/CartTests.swift": SWIFT_TESTING.replace('@Test("totals items")', '@Test("totals items", .disabled("not implemented"))') } },
  { name: "control: ruby example skipped by a hash-rocket condition", expect: null, before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace('  it "totals items" do', '  it "totals items", :skip => !feature_available? do') } },
  { name: "ruby: example skipped with :skip => true", expect: "test-skip", before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace('  it "totals items" do', '  it "totals items", :skip => true do') } },
  { name: "ruby: example skipped with a reason", expect: "test-skip", before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace('  it "totals items" do', '  it "totals items", skip: "later" do') } },
  { name: "control: ruby skip and pending in hooks under a version check", expect: null, before: { "spec/cart_spec.rb": RUBY_SPEC }, after: { "spec/cart_spec.rb": RUBY_SPEC.replace("RSpec.describe Cart do\n", 'RSpec.describe Cart do\n  if RUBY_VERSION == "2.0.0"\n    before(:example) do\n      skip "not reliable here"\n    end\n  elsif RUBY_PLATFORM == "java"\n    before(:example) do\n      pending "JRuby warns"\n    end\n  end\n\n') } },
  { name: "control: csharp [Ignore] as a mapping attribute on a property", expect: null, before: { "tests/Maps.cs": CS_MAP }, after: { "tests/Maps.cs": CS_MAP.replace("    public string Secret", "    [Ignore]\n    public string Secret") } },
  { name: "csharp: NUnit [Ignore] below [Test]", expect: "test-skip", before: { "tests/CartTests.cs": NUNIT_TEST }, after: { "tests/CartTests.cs": NUNIT_TEST.replace("    [Test]\n", '    [Test]\n    [Ignore("later")]\n') } },
  { name: "csharp: NUnit [Ignore] above [Test]", expect: "test-skip", before: { "tests/CartTests.cs": NUNIT_TEST }, after: { "tests/CartTests.cs": NUNIT_TEST.replace("    [Test]\n", '    [Ignore("later")]\n    [Test]\n') } },
  { name: "control: xunit Skip that depends on the environment", expect: null, before: { "tests/CartTests.cs": CS_TEST }, after: { "tests/CartTests.cs": CS_TEST.replace("[Fact]", '[Fact(Skip = "needs a GPU", SkipUnless = nameof(HasGpu))]') } },

  // ---- known gaps, documented rather than hidden ----
  { name: "gap: subject module mocked in its own test", expect: "miss", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": 'jest.mock("./price", () => ({ price: () => 42 }));\n' + JS_TEST } },
  { name: "gap: implementation hardcodes the tested value", expect: "miss", before: { "price.ts": "export function price(cart) { return cart.items.reduce((a, i) => a + i.cost, 0); }\n", "cart.test.ts": JS_TEST }, after: { "price.ts": "export function price(cart) { return 42; }\n", "cart.test.ts": JS_TEST } },
  { name: "gap: assertion made vacuous with expect.anything()", expect: "miss", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(total).toBe(42)", "expect(total).toEqual(expect.anything())") } },
];
