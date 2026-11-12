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
const PW_SPEC = 'import { test } from "@playwright/test";\ntest("lists albums", async ({ page }) => {\n  await page.goto("/");\n});\n';
const PW_WRAPPED = (marker, title) => `import { test } from "@playwright/test";\n${marker}(\n  "${title}",\n  async ({ page }) => {\n    await page.goto("/");\n  },\n);\n`;
const AFTER_RELEASE = (extra) => `on:\n  workflow_run:\n    workflows: [release]\n    types: [completed]\njobs:\n  post:\n${extra}    runs-on: ubuntu-latest\n    steps:\n      - run: ./post-comment.sh\n`;
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
const PY_MODULE_TEST = `import shop.pricing as pricing


def test_total():
    total = pricing.price(CART)
    assert total == 42
`;
const PY_PARAM = `@pytest.mark.parametrize("code,expected", [("SAVE", 40), ("HALF", 21)])
def test_discount(code, expected):
    assert price(cart, code) == expected
`;
const CONFTEST = `import pytest


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call" and report.outcome == "failed":
        item.config.failed_names.append(item.name)
`;
const PY_RAISES = `import pytest


def test_parse_rejects_garbage():
    with pytest.raises(ValueError, match="bad input"):
        parse("x")
`;
const UNIT_RAISES = `import unittest


class ParseTests(unittest.TestCase):
    def test_parse_rejects_garbage(self):
        with self.assertRaisesRegex(ValueError, "bad input"):
            parse("x")
`;
const JS_THROWS = `it("rejects garbage", () => {
  expect(() => parse("x")).toThrow(TypeError);
});
`;
const JS_CALLS = `it("notifies", () => {
  notify(svc);
  expect(svc.send).toHaveBeenCalledWith("hello", 3);
});
`;
const RUFF = '[tool.ruff.lint]\nselect = ["E", "F", "B"]\nignore = ["E501"]\n';
const MYPY = "[tool.mypy]\nstrict = true\n";
const PRICE_PY = `def price(cart, code=None):
    if code is None:
        return sum(cart)
    return sum(cart) - 2
`;

// A pull-request workflow with a test step and one more step (`extra` is the text of that step's lines after its `name`).
const CI_STEP = (extra) => `on:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n      - name: Evidence\n${extra}`;
// A release pipeline that runs when a version tag is pushed, with the job's own lines (`extra`) before its steps.
const TAGGED = (extra, on = "  push:\n    tags:\n      - 'v*'\n  workflow_dispatch:") => `on:\n${on}\njobs:\n  images:\n${extra}    runs-on: ubuntu-latest\n    steps:\n      - run: ./build-images.sh\n`;
const VUE_MENU = (assertion) => `describe("menu", () => {\n  it("closes on Escape", async () => {\n    await open();\n    ${assertion}\n  });\n});\n`;

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

  // ---- known-failure markers, test-harness tampering and coverage exclusions (0.15.0) ----
  { name: "py: pytest.mark.xfail with a reason added to a failing test", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", '@pytest.mark.xfail(reason="flaky")\ndef test_discount') } },
  { name: "py: bare pytest.mark.xfail added", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", "@pytest.mark.xfail\ndef test_discount") } },
  { name: "py: strict xfail spread over several lines", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", '@pytest.mark.xfail(\n    reason="pricing rewrite",\n    strict=True,\n)\ndef test_discount') } },
  { name: "py: xfail whose condition mentions CI", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", '@pytest.mark.xfail(os.environ.get("CI"), reason="slow")\ndef test_discount') } },
  { name: "py: pytest.xfail() called as a statement of the test", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount():\n", 'def test_discount():\n    pytest.xfail("later")\n') } },
  { name: "py: unittest.expectedFailure added", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", "@unittest.expectedFailure\ndef test_discount") } },
  { name: "py: pytestmark skips the whole module", expect: "test-skip", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": 'pytestmark = pytest.mark.skip(reason="rewrite")\n\n' + PY_TEST } },
  { name: "py: one parametrized case marked xfail", expect: "test-skip", before: { "test_cart.py": PY_PARAM }, after: { "test_cart.py": PY_PARAM.replace('("HALF", 21)', 'pytest.param("HALF", 21, marks=pytest.mark.xfail(reason="rounding"))') } },
  { name: "control: xfail only on one platform", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", '@pytest.mark.xfail(sys.platform == "win32", reason="paths")\ndef test_discount') } },
  { name: "control: xfail whose condition sits on the next line", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount", '@pytest.mark.xfail(\n    sys.platform == "win32",\n    reason="paths",\n)\ndef test_discount') } },
  { name: "control: pytest.xfail under an environment check", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("def test_discount():\n", 'def test_discount():\n    if not has_gpu():\n        pytest.xfail("no GPU")\n') } },
  { name: "js: it.fails added (Vitest)", expect: "test-skip", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('it("applies discount"', 'it.fails("applies discount"') } },
  { name: "js: it.failing added (Jest)", expect: "test-skip", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('it("applies discount"', 'it.failing("applies discount"') } },
  { name: "js: test.fixme added (Playwright)", expect: "test-skip", before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace('test("renders the cart"', 'test.fixme("renders the cart"') } },
  { name: "js: test.fail() called inside a Playwright test", expect: "test-skip", before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace("  await page.goto", "  test.fail();\n  await page.goto") } },
  { name: "control: test.fixme gated on the browser", expect: null, before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace("  await page.goto", "  test.fixme(browserName === 'webkit', 'not supported yet');\n  await page.goto") } },
  { name: "control: test.fail under a platform condition", expect: null, before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST.replace("  await page.goto", "  test.fail(process.platform === 'win32', 'paths');\n  await page.goto") } },
  { name: "config: pytest xfail_strict switched off", expect: "guard-weakened", before: { "pytest.ini": "[pytest]\nxfail_strict = true\n" }, after: { "pytest.ini": "[pytest]\nxfail_strict = false\n" } },
  { name: "config: pyproject xfail_strict switched off", expect: "guard-weakened", before: { "pyproject.toml": "[tool.pytest.ini_options]\nxfail_strict = true\n" }, after: { "pyproject.toml": "[tool.pytest.ini_options]\nxfail_strict = false\n" } },
  { name: "control: xfail_strict switched on", expect: null, before: { "pytest.ini": "[pytest]\nxfail_strict = false\n" }, after: { "pytest.ini": "[pytest]\nxfail_strict = true\n" } },
  { name: "py: conftest hook sets every report to passed", expect: "guard-weakened", before: { "conftest.py": CONFTEST }, after: { "conftest.py": CONFTEST.replace('    if report.when == "call" and report.outcome == "failed":\n        item.config.failed_names.append(item.name)\n', '    if report.when == "call":\n        report.outcome = "passed"\n') } },
  { name: "py: pytest_sessionfinish forces the exit status to 0", expect: "guard-weakened", before: { "conftest.py": CONFTEST }, after: { "conftest.py": CONFTEST + "\n\ndef pytest_sessionfinish(session, exitstatus):\n    session.exitstatus = 0\n" } },
  { name: "control: conftest hook that only reads the report outcome", expect: null, before: { "conftest.py": "import pytest\n" }, after: { "conftest.py": CONFTEST } },
  { name: "control: conftest hook that marks a report as rerun", expect: null, before: { "conftest.py": CONFTEST }, after: { "conftest.py": CONFTEST.replace('    if report.when == "call" and report.outcome == "failed":\n        item.config.failed_names.append(item.name)\n', '    if report.when == "call" and report.outcome == "failed" and retries_left(item):\n        report.outcome = "rerun"\n') } },
  { name: "py: pragma: no cover added to a branch", expect: "type-escape", before: { "price.py": PRICE_PY }, after: { "price.py": PRICE_PY.replace("    return sum(cart) - 2", "    return sum(cart) - 2  # pragma: no cover") } },
  { name: "ts: istanbul ignore added above a function", expect: "type-escape", before: { "price.ts": JS_SRC(42) }, after: { "price.ts": "/* istanbul ignore next */\n" + JS_SRC(42) } },
  { name: "ts: v8 ignore added above a branch", expect: "type-escape", before: { "price.ts": JS_SRC(42) }, after: { "price.ts": "// v8 ignore next\n" + JS_SRC(42) } },
  { name: "control: coverage pragma quoted inside a string", expect: null, before: { "price.py": PRICE_PY }, after: { "price.py": PRICE_PY + 'HINT = "add  # pragma: no cover  to skip a line"\n' } },

  // ---- weaker ways to say the same thing, CI and script shortcuts, Python lint and type-checker settings (0.15.0) ----
  { name: "js: assertion made vacuous with expect.anything()", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(total).toBe(42)", "expect(total).toEqual(expect.anything())") } },
  { name: "py: pytest.raises(ValueError) broadened to Exception", expect: "assertion-weakened", before: { "test_parse.py": PY_RAISES }, after: { "test_parse.py": PY_RAISES.replace('ValueError, match="bad input"', "Exception, match=\"bad input\"") } },
  { name: "py: pytest.raises loses its match=", expect: "assertion-weakened", before: { "test_parse.py": PY_RAISES }, after: { "test_parse.py": PY_RAISES.replace(', match="bad input"', "") } },
  { name: "py: assertRaisesRegex relaxed to assertRaises", expect: "assertion-weakened", before: { "test_parse.py": UNIT_RAISES }, after: { "test_parse.py": UNIT_RAISES.replace('assertRaisesRegex(ValueError, "bad input")', "assertRaises(ValueError)") } },
  { name: "py: exact count relaxed to > 0", expect: "assertion-weakened", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("assert len(cart) == 2", "assert len(cart) > 0") } },
  { name: "js: toThrow(TypeError) relaxed to toThrow()", expect: "assertion-weakened", before: { "parse.test.ts": JS_THROWS }, after: { "parse.test.ts": JS_THROWS.replace("toThrow(TypeError)", "toThrow()") } },
  { name: "js: toThrow(TypeError) relaxed to toThrow(Error)", expect: "assertion-weakened", before: { "parse.test.ts": JS_THROWS }, after: { "parse.test.ts": JS_THROWS.replace("toThrow(TypeError)", "toThrow(Error)") } },
  { name: "js: toHaveBeenCalledWith relaxed to toHaveBeenCalled()", expect: "assertion-weakened", before: { "notify.test.ts": JS_CALLS }, after: { "notify.test.ts": JS_CALLS.replace('toHaveBeenCalledWith("hello", 3)', "toHaveBeenCalled()") } },
  { name: "js: toHaveLength(2) relaxed to a bound of zero", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2)", "expect(cart.items.length).toBeGreaterThan(0)") } },
  { name: "control: toThrow narrowed from Error to a class", expect: null, before: { "parse.test.ts": JS_THROWS.replace("toThrow(TypeError)", "toThrow(Error)") }, after: { "parse.test.ts": JS_THROWS } },
  { name: "control: pytest.raises narrowed from Exception to ValueError", expect: null, before: { "test_parse.py": PY_RAISES.replace("ValueError", "Exception") }, after: { "test_parse.py": PY_RAISES } },
  { name: "control: emptiness check flipped to a non-empty check", expect: null, before: { "cart.test.ts": JS_TEST.replace("toHaveLength(2)", "toHaveLength(0)") }, after: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2)", "expect(cart.items.length).toBeGreaterThan(0)") } },
  { name: "control: python emptiness check flipped to a non-empty check", expect: null, before: { "test_cart.py": PY_TEST.replace("assert len(cart) == 2", "assert len(cart) == 0") }, after: { "test_cart.py": PY_TEST.replace("assert len(cart) == 2", "assert len(cart) > 0") } },
  { name: "ci: test command made to ignore failure with || true", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test || true"]) } },
  { name: "ci: pytest followed by exit 0", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["pip install -e .", "pytest -q"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["pip install -e .", "pytest -q; exit 0"]) } },
  { name: "ci: test step switched off with if: false", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci"]) + "      - if: false\n        run: npm test\n" } },
  { name: "ci: job switched off with if: false", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]).replace("  ci:\n", "  ci:\n    if: false\n") } },
  { name: "control: cleanup step that ends in || true", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm cache clean --force || true", "npm test"]) } },
  { name: "pkg: lint script replaced by echo", expect: "guard-weakened", before: { "package.json": JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run" } }) }, after: { "package.json": JSON.stringify({ scripts: { lint: "echo skipped", test: "vitest run" } }) } },
  { name: "pkg: typecheck script ends in || true", expect: "guard-weakened", before: { "package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }) }, after: { "package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit || true" } }) } },
  { name: "control: lint script gains --fix", expect: null, before: { "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }) }, after: { "package.json": JSON.stringify({ scripts: { lint: "eslint . --fix" } }) } },
  { name: "control: test script switched from jest to vitest", expect: null, before: { "package.json": JSON.stringify({ scripts: { test: "jest" } }) }, after: { "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) } },
  { name: "config: ruff ignore list grows", expect: "guard-weakened", before: { "pyproject.toml": RUFF }, after: { "pyproject.toml": RUFF.replace('ignore = ["E501"]', 'ignore = ["E501", "F401", "B008"]') } },
  { name: "config: ruff select narrowed", expect: "guard-weakened", before: { "pyproject.toml": RUFF }, after: { "pyproject.toml": RUFF.replace('["E", "F", "B"]', '["E", "F"]') } },
  { name: "config: ruff per-file-ignores added for a package", expect: "guard-weakened", before: { "pyproject.toml": RUFF }, after: { "pyproject.toml": RUFF + '\n[tool.ruff.lint.per-file-ignores]\n"src/billing/*" = ["F841", "B006"]\n' } },
  { name: "config: flake8 ignore list grows", expect: "guard-weakened", before: { ".flake8": "[flake8]\nignore = E501\n" }, after: { ".flake8": "[flake8]\nignore = E501,F401,W503\n" } },
  { name: "config: pylint disable list grows", expect: "guard-weakened", before: { ".pylintrc": "[MESSAGES CONTROL]\ndisable=C0114\n" }, after: { ".pylintrc": "[MESSAGES CONTROL]\ndisable=C0114,R0913,W0612\n" } },
  { name: "config: pylint fail-under lowered", expect: "guard-weakened", before: { ".pylintrc": "[MASTER]\nfail-under=9.5\n" }, after: { ".pylintrc": "[MASTER]\nfail-under=7.0\n" } },
  { name: "config: mypy strict switched off", expect: "guard-weakened", before: { "pyproject.toml": MYPY }, after: { "pyproject.toml": MYPY.replace("true", "false") } },
  { name: "config: mypy ignore_errors for a module", expect: "guard-weakened", before: { "mypy.ini": "[mypy]\nstrict = True\n" }, after: { "mypy.ini": "[mypy]\nstrict = True\n\n[mypy-app.billing.*]\nignore_errors = True\n" } },
  { name: "control: ruff adopted with its first ignore list", expect: null, before: { "pyproject.toml": "[project]\nname = \"x\"\n" }, after: { "pyproject.toml": "[project]\nname = \"x\"\n\n" + RUFF } },
  { name: "control: ruff ignore list shrinks", expect: null, before: { "pyproject.toml": RUFF.replace('["E501"]', '["E501", "F401"]') }, after: { "pyproject.toml": RUFF } },
  { name: "control: ruff select widened", expect: null, before: { "pyproject.toml": RUFF }, after: { "pyproject.toml": RUFF.replace('["E", "F", "B"]', '["E", "F", "B", "S"]') } },
  { name: "control: ruff select narrowed to codes a prefix still covers", expect: null, before: { "pyproject.toml": RUFF.replace('["E", "F", "B"]', '["E501", "F401", "B"]') }, after: { "pyproject.toml": RUFF } },
  { name: "control: flake8 ignore list reordered", expect: null, before: { ".flake8": "[flake8]\nignore = E501,W503\n" }, after: { ".flake8": "[flake8]\nignore = W503, E501\n" } },
  { name: "control: mypy override relaxes annotations for tests only", expect: null, before: { "pyproject.toml": MYPY }, after: { "pyproject.toml": MYPY + '\n[[tool.mypy.overrides]]\nmodule = "tests.*"\ndisallow_untyped_defs = false\n' } },
  { name: "control: mypy strict switched on", expect: null, before: { "pyproject.toml": MYPY.replace("true", "false") }, after: { "pyproject.toml": MYPY } },
  { name: "control: new test born with xfail in an existing file", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST + '\n\n@pytest.mark.xfail(reason="rounding bug #12")\ndef test_rounding():\n    assert price(cart, "HALF") == 21\n' } },
  { name: "control: new test file whose tests are marked xfail", expect: null, before: { "README.md": "x\n" }, after: { "test_known_bugs.py": '@pytest.mark.xfail(reason="bug #7")\ndef test_a():\n    assert f() == 1\n\n\n@pytest.mark.xfail(strict=True)\ndef test_b():\n    assert g() == 2\n' } },
  { name: "control: new Playwright test marked fixme", expect: null, before: { "cart.spec.ts": PW_TEST }, after: { "cart.spec.ts": PW_TEST + 'test.fixme("shows the total in euros", async ({ page }) => {\n  await expect(page.locator(".eur")).toHaveText("42");\n});\n' } },
  { name: "control: existing fixme test retitled", expect: null, before: { "cart.spec.ts": 'test.fixme("renders the cart", async ({ page }) => {\n  await page.goto("/cart");\n});\n' }, after: { "cart.spec.ts": 'test.fixme("CT-001 renders the cart", async ({ page }) => {\n  await page.goto("/cart");\n});\n' } },

  { name: "config: tsconfig noImplicitAny false added under strict", expect: "guard-weakened", before: { "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n' }, after: { "tsconfig.json": '{ "compilerOptions": { "strict": true, "noImplicitAny": false } }\n' } },
  { name: "control: tsconfig strict removed in a TypeScript 6 upgrade, where it is the default", expect: null, before: { "tsconfig.json": '{ "compilerOptions": { "strict": true, "target": "es2022" } }\n' }, after: { "tsconfig.json": '{ "compilerOptions": { "target": "es2022" } }\n' } },
  { name: "control: tsconfig for tests relaxes one check without strict of its own", expect: null, before: { "tsconfig.test.json": '{ "extends": "./tsconfig.json", "compilerOptions": { "target": "es2022" } }\n' }, after: { "tsconfig.test.json": '{ "extends": "./tsconfig.json", "compilerOptions": { "target": "es2022", "noImplicitAny": false } }\n' } },

  // ---- the module under test replaced by a mock in its own test (0.16.0) ----
  { name: "js: the function under test is mocked in its own test", expect: "trivial-assert", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": 'jest.mock("./price", () => ({ price: () => 42 }));\n' + JS_TEST } },
  { name: "js: vitest mock added above a direct assertion", expect: "trivial-assert", before: { "price.test.ts": 'import { price } from "./price";\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n' }, after: { "price.test.ts": 'import { price } from "./price";\nvi.mock("./price", () => ({ price: () => 42 }));\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n' } },
  { name: "js: automock given the expected return value", expect: "trivial-assert", before: { "price.test.ts": 'import { price } from "./price";\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n' }, after: { "price.test.ts": 'import { price } from "./price";\njest.mock("./price");\nit("prices", () => {\n  (price as jest.Mock).mockReturnValue(42);\n  expect(price(cart)).toBe(42);\n});\n' } },
  { name: "py: the function under test is patched in its own test", expect: "trivial-assert", before: { "test_price.py": PY_MODULE_TEST }, after: { "test_price.py": PY_MODULE_TEST.replace("def test_total():\n", "def test_total(monkeypatch):\n    monkeypatch.setattr(pricing, \"price\", lambda cart: 42)\n") } },
  { name: "py: patch.object around the call under test", expect: "trivial-assert", before: { "test_price.py": PY_MODULE_TEST }, after: { "test_price.py": PY_MODULE_TEST.replace("    total = pricing.price(CART)\n    assert total == 42\n", "    with patch.object(pricing, \"price\", return_value=42):\n        total = pricing.price(CART)\n        assert total == 42\n") } },
  { name: "control: a dependency is mocked and the code under test is asserted", expect: null, before: { "cart.test.ts": 'import { total } from "./cart";\nit("totals", () => {\n  expect(total(cart)).toBe(42);\n});\n' }, after: { "cart.test.ts": 'import { total } from "./cart";\nimport { price } from "./price";\njest.mock("./price", () => ({ price: () => 42 }));\nit("totals", () => {\n  expect(total(cart)).toBe(42);\n  expect(price).toHaveBeenCalledWith(cart);\n});\n' } },
  { name: "control: a partial mock keeps the real function under test", expect: null, before: { "price.test.ts": 'import { price } from "./price";\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n' }, after: { "price.test.ts": 'import { price } from "./price";\njest.mock("./price", () => ({ ...jest.requireActual("./price"), tax: () => 1 }));\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n' } },
  { name: "control: python patch in one test, the real function asserted in another", expect: null, before: { "test_price.py": PY_MODULE_TEST }, after: { "test_price.py": PY_MODULE_TEST + '\n\ndef test_other(monkeypatch):\n    monkeypatch.setattr(pricing, "price", lambda cart: 1)\n    run()\n' } },
  { name: "control: python imported name is the real function while the module attribute is patched", expect: null, before: { "test_price.py": "from shop.pricing import price\n\n\ndef test_total():\n    assert price(CART) == 42\n" }, after: { "test_price.py": 'from shop.pricing import price\n\n\n@patch("shop.pricing.price", return_value=1)\ndef test_total(mock_price):\n    assert price(CART) == 42\n' } },

  // ---- an exact check relaxed on the same expression, found by reading edited assertions in AI-signed commits (0.17.0) ----
  { name: "js: exact count relaxed to a lower bound on the same value", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2)", "expect(cart.items.length).toBeGreaterThanOrEqual(2)") } },
  { name: "js: toEqual loosened to toMatchObject with the same argument", expect: "assertion-weakened", before: { "build.test.ts": 'it("builds", () => {\n  expect(build()).toEqual({ id: 1, name: "x" });\n});\n' }, after: { "build.test.ts": 'it("builds", () => {\n  expect(build()).toMatchObject({ id: 1, name: "x" });\n});\n' } },
  { name: "js: node assert.equal on a count relaxed to assert.ok(count > 0)", expect: "assertion-weakened", before: { "weak.test.js": 'it("finds", () => {\n  assert.equal(weak.length, 3);\n});\n' }, after: { "weak.test.js": 'it("finds", () => {\n  assert.ok(weak.length > 0);\n});\n' } },
  { name: "py: equality relaxed to a lower bound on the same expression", expect: "assertion-weakened", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("assert len(cart) == 2", "assert len(cart) >= 2") } },
  { name: "py: set equality relaxed to a subset check", expect: "assertion-weakened", before: { "test_skills.py": "def test_skills():\n    assert set(catalog) == set(RECIPES)\n" }, after: { "test_skills.py": "def test_skills():\n    assert set(catalog) <= set(RECIPES)\n" } },
  { name: "control: a lower bound made exact", expect: null, before: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2)", "expect(cart.items.length).toBeGreaterThanOrEqual(2)") }, after: { "cart.test.ts": JS_TEST } },
  { name: "control: toMatchObject given new fields to check", expect: null, before: { "build.test.ts": 'it("builds", () => {\n  expect(build()).toEqual({ id: 1 });\n});\n' }, after: { "build.test.ts": 'it("builds", () => {\n  expect(build()).toMatchObject({ id: 1, name: "x", tags: [] });\n});\n' } },
  { name: "control: python equality kept on another expression", expect: null, before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("assert len(cart) == 2", "assert len(cart) == 2\n    assert total >= 40") } },
  { name: "js: exact count relaxed while the test gained another assertion", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2);", "expect(cart.items.length).toBeGreaterThanOrEqual(2);\n    expect(cart.items[0]).toBeDefined();") } },
  { name: "py: equality relaxed to a bound while the test lost another assertion", expect: "assertion-weakened", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("    assert total == 42\n    assert len(cart) == 2\n", "    assert len(cart) >= 2\n") } },
  { name: "control: python empty value expected before, a non-empty one now (flipped, not loosened)", expect: null, before: { "test_tags.py": "def test_tags():\n    result = build()\n    assert result.tags == {}\n" }, after: { "test_tags.py": "def test_tags():\n    result = build()\n    assert len(result.tags) > 0\n" } },
  { name: "control: a negated exact check turned into a negated bound", expect: null, before: { "neg.test.ts": 'it("x", () => {\n  expect(total).not.toBe(2);\n});\n' }, after: { "neg.test.ts": 'it("x", () => {\n  expect(total).not.toBeLessThan(5);\n});\n' } },
  { name: "control: the exact check moved to another test while a bound was added", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2);", "expect(cart.items.length).toBeGreaterThanOrEqual(1);\n    expect(cart.items[0]).toBeDefined();").replace('expect(price(cart, "SAVE")).toBe(40);', 'expect(price(cart, "SAVE")).toBe(40);\n    expect(cart.items).toHaveLength(2);') } },

  // ---- false alarms found by replaying 0.17.0 on 40 repositories that no earlier measurement used (0.18.0) ----
  { name: "control: a new test that needs a server is ignored with a reason (Rust)", expect: null, before: { "src/lib.rs": RUST_SRC }, after: { "src/lib.rs": RUST_SRC.replace("        assert_eq!(price(&[40, 2]), 42);\n    }\n", '        assert_eq!(price(&[40, 2]), 42);\n    }\n\n    #[test]\n    #[ignore = "requires KVM"]\n    fn boots_a_vm() {\n        assert_eq!(price(&[1]), 1);\n    }\n') } },
  { name: "control: a new skipped test next to the old ones (JavaScript)", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST + 'it.skip("handles a coupon — deferred to the next spec", () => {});\n' } },
  { name: "control: a new test file whose test needs a database is skipped (Python)", expect: null, before: { "README.md": "bench\n" }, after: { "tests/test_db.py": 'import pytest\n\n\n@pytest.mark.skip(reason="needs DATABASE_URL_TEST")\ndef test_db():\n    assert connect()\n' } },
  { name: "control: a method called fit() in a test double is not a focused test", expect: null, before: { "term.test.ts": 'it("renders", () => { expect(render()).toBe(1); });\n' }, after: { "term.test.ts": 'class FitAddon {\n  fit() {}\n}\nit("renders", () => { expect(render()).toBe(1); });\n' } },
  { name: "control: a mock factory that is handed the real module and calls it keeps the real function", expect: null, before: { "price.test.ts": 'import { price } from "./price";\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n' }, after: { "price.test.ts": 'import { price } from "./price";\nvi.mock("./price", async (original) => ({ ...(await original()), price: () => 42 }));\nit("prices", () => {\n  expect(price(cart)).toBe(42);\n});\n' } },
  { name: "control: the brackets around a whole Python assertion are added and dropped", expect: null, before: { "test_m.py": "def test_m():\n    assert (m[0, 1] == 3.0)\n" }, after: { "test_m.py": "def test_m():\n    assert m[0, 1] == 3.0\n" } },
  { name: "control: a regular expression with an apostrophe in a multi-line assertion", expect: null, before: { "ci.test.ts": 'it("checks", () => {\n  expect(step).not.toMatch(\n    /\'\\.github\\/shared\\(/,\n  );\n  expect(lock).toContain(\'name: Checkout\');\n});\n' }, after: { "ci.test.ts": 'it("checks", () => {\n  expect(step).not.toMatch(\n    /\'\\.github\\/shared\\(/,\n  );\n  expect(lock).toContain(\'name: Checkout\');\n  expect(extra).toBeUndefined();\n});\n' } },
  { name: "control: a rejection that must not carry the redirect URI", expect: null, before: { "oauth.test.ts": 'it("fails", async () => {\n  await expect(start()).rejects.toThrow(/CLIENT_ID/);\n});\n' }, after: { "oauth.test.ts": 'it("fails", async () => {\n  await expect(start()).rejects.not.toThrow(/redirect/);\n});\n' } },
  { name: "control: a bound against a variable turned into a bound against zero after the subtraction moved", expect: null, before: { "grow.test.ts": 'it("grows", () => {\n  expect(after.height).toBeGreaterThan(before.height);\n});\n' }, after: { "grow.test.ts": 'it("grows", () => {\n  expect(growth).toBeGreaterThan(0);\n});\n' } },
  { name: "control: a compound Python assertion with a subset test", expect: null, before: { "test_enc.py": 'def test_enc():\n    assert S.ID == "st4" and "st3" in S.LEGACY\n' }, after: { "test_enc.py": 'def test_enc():\n    assert S.ID != "st3" and {"st3", "st4"} <= set(S.LEGACY)\n' } },
  { name: "control: the tests moved to a monorepo runner in another workflow", expect: null, before: { ".github/workflows/check-pr.yml": "on:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: yarn test\n" }, after: { ".github/workflows/check-pr.yml": null, ".github/workflows/nx.yml": "on:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: yarn nx affected --target=test --parallel\n" } },
  { name: "control: a helper called fit() inside an expression is not a focused test", expect: null, before: { "place.test.ts": 'it("places", () => {\n  expect(place(a)).toEqual({ left: 1 });\n});\n' }, after: { "place.test.ts": 'it("places", () => {\n  expect(fit({ x: 100 })).toEqual({ left: 1 });\n});\n' } },
  { name: "control: an exact value that was removed is now asserted undefined", expect: null, before: { "theme.test.ts": 'it("themes", () => {\n  expect(config.color).toBe("#4dc4e6");\n});\n' }, after: { "theme.test.ts": 'it("themes", () => {\n  expect(config.color).toBeUndefined();\n});\n' } },
  { name: "control: a patcher that is only assigned and entered later (Python)", expect: null, before: { "test_cart.py": "import pkg.cart as cart\n\n\ndef test_a():\n    run()\n    assert cart.total() == 1\n" }, after: { "test_cart.py": 'import pkg.cart as cart\n\n\ndef test_a():\n    stuck = patch.object(cart, "total", return_value=42)\n    with stuck:\n        run()\n    assert cart.total() == 1\n' } },
  { name: "control: the patched object is handed to the code under test, which wraps it again (Python)", expect: null, before: { "test_gw.py": "def test_a():\n    install(gw, rule)\n    assert gw.req() == []\n" }, after: { "test_gw.py": 'def test_a(monkeypatch):\n    monkeypatch.setattr(gw, "req", broker)\n    install(gw, rule)\n    assert gw.req() == []\n' } },
  { name: "js: an exact value turned into toBeTruthy()", expect: "assertion-weakened", before: { "theme.test.ts": 'it("themes", () => {\n  expect(config.color).toBe("#4dc4e6");\n});\n' }, after: { "theme.test.ts": 'it("themes", () => {\n  expect(config.color).toBeTruthy();\n});\n' } },
  { name: "control: an equality turned into a strict inequality against the same value (Python)", expect: null, before: { "test_gen.py": "def test_gen():\n    assert asset_db.generation == before\n" }, after: { "test_gen.py": "def test_gen():\n    assert asset_db.generation > before\n" } },
  { name: "control: an exact count turned into a minimum that is above it", expect: null, before: { "attempts.test.ts": 'it("retries", () => {\n  expect(attempts).toBe(2);\n});\n' }, after: { "attempts.test.ts": 'it("retries", () => {\n  expect(attempts).toBeGreaterThanOrEqual(3);\n});\n' } },
  { name: "control: brackets around the message of a Python assertion", expect: null, before: { "test_out.py": 'def test_out():\n    assert (len(out) > 0), "empty"\n' }, after: { "test_out.py": 'def test_out():\n    assert len(out) > 0, ("empty")\n' } },
  { name: "control: a known failure marked inside a test the change adds (Playwright)", expect: null, before: { "albums.spec.ts": 'import { test } from "@playwright/test";\ntest("lists albums", async ({ page }) => {\n  await page.goto("/");\n});\n' }, after: { "albums.spec.ts": 'import { test } from "@playwright/test";\ntest("lists albums", async ({ page }) => {\n  await page.goto("/");\n});\ntest("opens an empty album", async ({ page }) => {\n  test.fail(true, "Not implemented yet #1312");\n  await page.goto("/x");\n});\n' } },
  { name: "control: a method of the patched object runs after the patch and wires the patched attribute again (Python)", expect: null, before: { "test_ops.py": "def test_ops():\n    Op.register()\n    assert Op.forward(None) is False\n" }, after: { "test_ops.py": 'def test_ops(monkeypatch):\n    monkeypatch.setattr(Op, "forward", compute)\n    Op.register()\n    assert Op.forward(None) is False\n' } },
  { name: "js: an exact count turned into a minimum that still admits it", expect: "assertion-weakened", before: { "attempts.test.ts": 'it("retries", () => {\n  expect(attempts).toBe(2);\n});\n' }, after: { "attempts.test.ts": 'it("retries", () => {\n  expect(attempts).toBeGreaterThanOrEqual(1);\n});\n' } },
  { name: "js: a known failure marked inside a test that was already there (Playwright)", expect: "test-skip", before: { "albums.spec.ts": 'import { test } from "@playwright/test";\ntest("lists albums", async ({ page }) => {\n  await page.goto("/");\n});\n' }, after: { "albums.spec.ts": 'import { test } from "@playwright/test";\ntest("lists albums", async ({ page }) => {\n  test.fail(true, "Not implemented yet #1312");\n  await page.goto("/");\n});\n' } },
  { name: "py: an exact check on an indexed table turned into a bare subscript", expect: "assertion-weakened", before: { "test_m.py": "def test_m():\n    assert m[0, 1] == 3.0\n" }, after: { "test_m.py": "def test_m():\n    assert m[0, 1]\n" } },
  { name: "rust: an existing test is ignored with a reason", expect: "test-skip", before: { "src/lib.rs": RUST_SRC }, after: { "src/lib.rs": RUST_SRC.replace("    #[test]\n", '    #[test]\n    #[ignore = "flaky"]\n') } },

  // ---- false alarms found by replaying 0.18.0 on 40 repositories that no earlier measurement had used (0.19.0) ----
  { name: "control: a skip that an if decides at run time (Playwright)", expect: null, before: { "albums.spec.ts": PW_SPEC }, after: { "albums.spec.ts": PW_SPEC.replace('  await page.goto("/");\n', '  if (!isAdmin) {\n    test.skip(true, "needs an admin");\n    return;\n  }\n  await page.goto("/");\n') } },
  { name: "control: a skip written on one line after an if (Playwright)", expect: null, before: { "albums.spec.ts": PW_SPEC }, after: { "albums.spec.ts": PW_SPEC.replace('  await page.goto("/");\n', '  if (!isAdmin) test.skip(true, "needs an admin");\n  await page.goto("/");\n') } },
  { name: "js: a skip under an if whose condition mentions CI (Playwright)", expect: "test-skip", before: { "albums.spec.ts": PW_SPEC }, after: { "albums.spec.ts": PW_SPEC.replace('  await page.goto("/");\n', '  if (process.env.CI) {\n    test.skip(true, "flaky on CI");\n  }\n  await page.goto("/");\n') } },
  { name: "js: an unconditional skip in a test that was already there (Playwright)", expect: "test-skip", before: { "albums.spec.ts": PW_SPEC }, after: { "albums.spec.ts": PW_SPEC.replace('  await page.goto("/");\n', '  test.skip(true, "flaky");\n  await page.goto("/");\n') } },
  { name: "control: a fixme with its title on the next line, on a test the change adds (Playwright)", expect: null, before: { "albums.spec.ts": PW_SPEC }, after: { "albums.spec.ts": PW_SPEC + PW_WRAPPED("test.fixme", "opens the history tab").replace('import { test } from "@playwright/test";\n', "") } },
  { name: "js: a fixme with its title on the next line, on a test that was running (Playwright)", expect: "test-skip", before: { "albums.spec.ts": PW_WRAPPED("test", "lists albums") }, after: { "albums.spec.ts": PW_WRAPPED("test.fixme", "lists albums") } },
  { name: "control: a job switched off in a workflow that runs after a release", expect: null, before: { ".github/workflows/post.yml": AFTER_RELEASE("") }, after: { ".github/workflows/post.yml": AFTER_RELEASE("    if: false\n") } },
  { name: "control: a manual workflow deleted although its Docker step says push: true, the tests still run on every push", expect: null, before: { ".github/workflows/release.yml": "on:\n  workflow_dispatch:\njobs:\n  run_tests:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run test\n  build:\n    steps:\n      - uses: docker/build-push-action@v4\n        with:\n          push: true\n", ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) }, after: { ".github/workflows/release.yml": null, ".github/workflows/ci.yml": WORKFLOW(["npm ci", "npm test"]) } },
  { name: "ci: a job switched off in a workflow that runs on every push", expect: "guard-weakened", before: { ".github/workflows/post.yml": AFTER_RELEASE("").replace("workflow_run:\n    workflows: [release]\n    types: [completed]", "push:") }, after: { ".github/workflows/post.yml": AFTER_RELEASE("    if: false\n").replace("workflow_run:\n    workflows: [release]\n    types: [completed]", "push:") } },
  { name: "control: a unittest assertion rewritten as a pytest assert", expect: null, before: { "test_wamp.py": "def test_progressive(self):\n    self.assertTrue(details is not None)\n" }, after: { "test_wamp.py": "def test_progressive(self):\n    assert details is not None\n" } },
  { name: "py: an exact check turned into a not-None check", expect: "assertion-weakened", before: { "test_wamp.py": "def test_progressive(self):\n    assert details == {'a': 1}\n" }, after: { "test_wamp.py": "def test_progressive(self):\n    assert details is not None\n" } },
  { name: "control: a patched function that a call in the test wraps again (Python)", expect: null, before: { "test_kernels.py": "def test_kernels():\n    kernels.install()\n    assert q35.conv_fn(x) is x\n" }, after: { "test_kernels.py": 'def test_kernels(monkeypatch):\n    monkeypatch.setattr(q35, "conv_fn", original)\n    assert kernels.install()\n    assert q35.conv_fn(x) is x\n' } },
  { name: "control: a spied module whose function another test mocks (Vitest)", expect: null, before: { "remote.test.ts": 'import { activate } from "../src/api";\nit("is false", async () => {\n  expect(await activate(rc)).toBe(false);\n});\n' }, after: { "remote.test.ts": 'import { activate, both } from "../src/api";\nimport * as api from "../src/api";\nvi.mock("../src/api", { spy: true });\nit("is false", async () => {\n  expect(await activate(rc)).toBe(false);\n});\nit("calls activate", async () => {\n  vi.spyOn(api, "activate").mockResolvedValue(true);\n  expect(await both(rc)).toBe(true);\n});\n' } },
  { name: "js: a test that checks the function it mocked itself", expect: "trivial-assert", before: { "remote.test.ts": 'import { activate } from "../src/api";\nit("is false", async () => {\n  expect(await activate(rc)).toBe(false);\n});\n' }, after: { "remote.test.ts": 'import { activate } from "../src/api";\nimport * as api from "../src/api";\nvi.mock("../src/api", { spy: true });\nit("is true", async () => {\n  vi.spyOn(api, "activate").mockResolvedValue(true);\n  expect(await activate(rc)).toBe(true);\n});\n' } },

  // ---- false alarms found by replaying 0.18.0 and 0.19.0 on 40 repositories that no earlier measurement had used (0.19.0, sample 5) ----
  { name: "control: a todo with its title on the next line, on a test the change adds (Jest)", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST + 'it.todo(\n  "applies a coupon once the endpoint accepts it"\n);\n' } },
  { name: "js: a todo with its title on the next line that takes the place of a running test (Jest)", expect: "test-skip", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('  it("totals items", () => {\n    const total = price(cart);\n    expect(total).toBe(42);\n    expect(cart.items).toHaveLength(2);\n  });', '  it.todo(\n    "totals items"\n  );') } },
  { name: "control: an artifact upload allowed to fail in a pull-request workflow", expect: null, before: { ".github/workflows/ci.yml": CI_STEP("        uses: actions/upload-artifact@v6\n") }, after: { ".github/workflows/ci.yml": CI_STEP("        continue-on-error: true\n        uses: actions/upload-artifact@v6\n") } },
  { name: "control: a cloud login allowed to fail in a pull-request workflow", expect: null, before: { ".github/workflows/ci.yml": CI_STEP("        if: env.SIGNING == 'true'\n        uses: azure/login@v3\n") }, after: { ".github/workflows/ci.yml": CI_STEP("        if: env.SIGNING == 'true'\n        continue-on-error: true\n        uses: azure/login@v3\n") } },
  { name: "control: a release attachment allowed to fail in a pull-request workflow", expect: null, before: { ".github/workflows/ci.yml": CI_STEP("        uses: softprops/action-gh-release@v3\n") }, after: { ".github/workflows/ci.yml": CI_STEP("        continue-on-error: true\n        uses: softprops/action-gh-release@v3\n") } },
  { name: "ci: a step of an unknown action allowed to fail in a pull-request workflow", expect: "guard-weakened", before: { ".github/workflows/ci.yml": CI_STEP("        uses: acme/checker@v1\n") }, after: { ".github/workflows/ci.yml": CI_STEP("        continue-on-error: true\n        uses: acme/checker@v1\n") } },
  { name: "ci: the test step itself allowed to fail next to an upload", expect: "guard-weakened", before: { ".github/workflows/ci.yml": CI_STEP("        uses: actions/upload-artifact@v6\n") }, after: { ".github/workflows/ci.yml": CI_STEP("        uses: actions/upload-artifact@v6\n").replace("      - run: npm test\n", "      - run: npm test\n        continue-on-error: true\n") } },
  { name: "control: a build job allowed to fail in a workflow that runs when a version tag is pushed", expect: null, before: { ".github/workflows/release.yml": TAGGED("") }, after: { ".github/workflows/release.yml": TAGGED("    continue-on-error: true\n") } },
  { name: "ci: a build job allowed to fail in a workflow that runs on a push to main and on tags", expect: "guard-weakened", before: { ".github/workflows/release.yml": TAGGED("", "  push:\n    branches: [main]\n    tags:\n      - 'v*'") }, after: { ".github/workflows/release.yml": TAGGED("    continue-on-error: true\n", "  push:\n    branches: [main]\n    tags:\n      - 'v*'") } },
  { name: "ci: the tests moved from every push to version tags only", expect: "guard-weakened", before: { ".github/workflows/test.yml": "on:\n  push:\n    branches: [main]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n" }, after: { ".github/workflows/test.yml": "on:\n  push:\n    tags: ['v*']\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n" } },
  { name: "control: npm test replaced by python -m unittest in the same workflow", expect: null, before: { ".github/workflows/poc.yml": WORKFLOW(["npm test"]) }, after: { ".github/workflows/poc.yml": WORKFLOW(["python3 -m unittest tests.test_a tests.test_b"]) } },
  { name: "ci: python -m unittest removed from the workflow", expect: "guard-weakened", before: { ".github/workflows/poc.yml": WORKFLOW(["python3 -m unittest tests.test_a"]) }, after: { ".github/workflows/poc.yml": WORKFLOW(["python3 -m build"]) } },
  { name: "control: a summary step written with the shell builtin test -f, ending in || true", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["npm test", 'test -f out/summary.md && cat out/summary.md >> "$GITHUB_STEP_SUMMARY" || true']) } },
  { name: "ci: a test run that ends in || true after a test -f", expect: "guard-weakened", before: { ".github/workflows/ci.yml": WORKFLOW(["test -f package.json && npm test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["test -f package.json && npm test || true"]) } },
  { name: "control: a presence check written as a DOM query instead of a wrapper predicate", expect: null, before: { "menu.test.ts": VUE_MENU("expect(wrapper.find('.menu').exists()).toBe(true);") }, after: { "menu.test.ts": VUE_MENU("expect(document.querySelector('.menu')).not.toBeNull();") } },
  { name: "js: a presence check turned into a check of a variable", expect: "assertion-weakened", before: { "menu.test.ts": VUE_MENU("expect(wrapper.find('.menu').exists()).toBe(true);") }, after: { "menu.test.ts": VUE_MENU("expect(menu).toBeDefined();") } },
  { name: "control: an assertion on a mock's output next to an assertion on the code under test (Vitest)", expect: null, before: { "env.test.ts": 'import { getEnv } from "./index";\nit("uses the venv", () => {\n  expect(getEnv("/x")).toEqual({ pip: "/x/venv/bin/python3" });\n});\n' }, after: { "env.test.ts": 'import { venvPython } from "../lib";\nimport { getEnv } from "./index";\nvi.mock("../lib", () => ({ venvPython: vi.fn((p) => `${p}/venv/bin/python3`) }));\nit("uses the venv", () => {\n  const python = venvPython("/x");\n  expect(getEnv("/x")).toEqual({ pip: python });\n  expect(python).not.toContain("standalone-env");\n});\n' } },

  { name: "js: an exact value turned into 'not another value'", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(total).toBe(42);", "expect(total).not.toBe(0);") } },
  { name: "js: an exact count turned into 'not empty' with the negated matcher", expect: "assertion-weakened", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2);", "expect(cart.items).not.toHaveLength(0);") } },
  { name: "py: equality turned into inequality with another value", expect: "assertion-weakened", before: { "test_cart.py": PY_TEST }, after: { "test_cart.py": PY_TEST.replace("assert len(cart) == 2", "assert len(cart) != 0") } },
  { name: "control: an exact check turned into ruling out that very value (a flipped expectation)", expect: null, before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace("expect(total).toBe(42);", "expect(total).not.toBe(42);") } },
  { name: "control: a pinned value turned into 'not the previous value'", expect: null, before: { "id.test.ts": 'it("renews", () => {\n  expect(session.id).toBe("first");\n});\n' }, after: { "id.test.ts": 'it("renews", () => {\n  expect(session.id).not.toBe(previousId);\n});\n' } },
  { name: "control: an emptiness check turned into ruling out one other value", expect: null, before: { "cart.test.ts": JS_TEST.replace("toHaveLength(2)", "toHaveLength(0)") }, after: { "cart.test.ts": JS_TEST.replace("expect(cart.items).toHaveLength(2);", "expect(cart.items).not.toHaveLength(1);") } },

  { name: "control: a duplicate test workflow deleted while another workflow runs the same tests", expect: null, before: { ".github/workflows/test.yml": WORKFLOW(["npm ci", "npm test"]), ".github/workflows/production.yml": WORKFLOW(["npm test", "npm publish"]) }, after: { ".github/workflows/production.yml": null } },
  { name: "ci: the workflow that ran the tests deleted while the other one only lints", expect: "guard-weakened", before: { ".github/workflows/lint.yml": WORKFLOW(["npm run lint"]), ".github/workflows/production.yml": WORKFLOW(["npm test", "npm publish"]) }, after: { ".github/workflows/production.yml": null } },
  { name: "ci: one service's test workflow deleted while another service runs the same command in its own directory", expect: "guard-weakened", before: { ".github/workflows/api.yml": WORKFLOW(["npm test"]).replace("      - run:", "      - working-directory: api\n        run:"), ".github/workflows/web.yml": WORKFLOW(["npm test"]).replace("      - run:", "      - working-directory: web\n        run:") }, after: { ".github/workflows/web.yml": null } },

  { name: "control: ruff ignores added together with a Python version bump", expect: null, before: { "pyproject.toml": '[project]\nrequires-python = ">=3.8"\n\n' + RUFF.replace('["E", "F", "B"]', '["E", "F", "B", "UP"]') }, after: { "pyproject.toml": '[project]\nrequires-python = ">=3.9"\n\n' + RUFF.replace('["E", "F", "B"]', '["E", "F", "B", "UP"]').replace('["E501"]', '["E501", "UP006", "UP035"]') } },
  { name: "control: a commented-out ruff selector enabled, with the family ignored for the examples", expect: null, before: { "pyproject.toml": '[tool.ruff.lint]\nselect = [\n  "E",\n  # "ANN", # flake8-annotations\n]\n' }, after: { "pyproject.toml": '[tool.ruff.lint]\nselect = [\n  "E",\n  "ANN2", # flake8-annotations\n]\n\n[tool.ruff.lint.per-file-ignores]\n"examples/*.py" = [\n  "ANN", # missing type annotations in examples is fine\n]\n' } },
  { name: "control: the test command replaced by a task alias inside a block of commands", expect: null, before: { ".github/workflows/ci.yml": WORKFLOW(["deno run test"]) }, after: { ".github/workflows/ci.yml": WORKFLOW(["|\n          deno lint\n          deno task test\n          deno task build"]) } },
  { name: "control: a call to a function named fit in a test file", expect: null, before: { "layout.test.ts": 'it("lays out", () => {\n  expect(measure()).toBe(1);\n});\n' }, after: { "layout.test.ts": 'it("lays out", () => {\n  const run = () =>\n    fit(line, width, available);\n  expect(run()).toBe(1);\n});\n' } },
  { name: "control: a job allowed to fail merged into another job, where the same step is allowed to fail", expect: null, before: { ".github/workflows/ci.yml": "on: push\njobs:\n  report:\n    continue-on-error: true\n    steps:\n      - name: Report\n        run: bun run compat:report\n  check:\n    steps:\n      - run: bun run test\n" }, after: { ".github/workflows/ci.yml": "on: push\njobs:\n  check:\n    steps:\n      - run: bun run test\n      - name: Report\n        continue-on-error: true\n        run: bun run compat:report\n" } },
  { name: "ci: the test step made allowed to fail while another job was already allowed to fail", expect: "guard-weakened", before: { ".github/workflows/ci.yml": "on: push\njobs:\n  report:\n    continue-on-error: true\n    steps:\n      - name: Report\n        run: bun run compat:report\n  check:\n    steps:\n      - name: Test\n        run: bun run test\n" }, after: { ".github/workflows/ci.yml": "on: push\njobs:\n  report:\n    continue-on-error: true\n    steps:\n      - name: Report\n        run: bun run compat:report\n  check:\n    steps:\n      - name: Test\n        continue-on-error: true\n        run: bun run test\n" } },
  { name: "js: fit with a title added to a test", expect: "test-focus", before: { "cart.test.ts": JS_TEST }, after: { "cart.test.ts": JS_TEST.replace('it("applies discount"', 'fit("applies discount"') } },

  // ---- known gaps, documented rather than hidden ----
  { name: "gap: implementation hardcodes the tested value", expect: "miss", before: { "price.ts": "export function price(cart) { return cart.items.reduce((a, i) => a + i.cost, 0); }\n", "cart.test.ts": JS_TEST }, after: { "price.ts": "export function price(cart) { return 42; }\n", "cart.test.ts": JS_TEST } },
];
