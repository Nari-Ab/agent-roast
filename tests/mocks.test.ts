import { describe, expect, it } from "vitest";
import { mockedSubjects } from "../src/mocks.js";
import { analyzeTestFile } from "../src/tampering.js";

const keys = (text: string, file = "cart.test.ts") => mockedSubjects(text, file).map(item => item.key);

describe("JavaScript: a test that asserts on what its own mock returns", () => {
  const IMPORT = 'import { price } from "./price";\n';
  const test = (body: string) => `it("totals", async () => {\n${body}\n});\n`;

  it.each([
    ["a factory, asserted directly", `${IMPORT}jest.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(price(cart)).toBe(42);")}`],
    ["a factory, asserted through a variable", `${IMPORT}jest.mock("./price", () => ({ price: () => 42 }));\n${test("  const total = price(cart);\n  expect(total).toBe(42);")}`],
    ["a variable assigned with await", `${IMPORT}jest.mock("./price", () => ({ price: async () => 42 }));\n${test("  let total;\n  total = await price(cart);\n  expect(total).toEqual(42);")}`],
    ["vitest", `import { price } from "./price";\nvi.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(price(cart)).toBe(42);")}`],
    ["an aliased import", `import { price as cost } from "./price";\njest.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(cost(cart)).toBe(42);")}`],
    ["a default import", `import price from "./price";\njest.mock("./price", () => () => 42);\n${test("  expect(price(cart)).toBe(42);")}`],
    ["a namespace import", `import * as lib from "./price";\njest.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(lib.price(cart)).toBe(42);")}`],
    ["require", `const { price } = require("./price");\njest.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(price(cart)).toBe(42);")}`],
    ["an automock given a return value", `${IMPORT}jest.mock("./price");\n${test("  (price as jest.Mock).mockReturnValue(42);\n  expect(price(cart)).toBe(42);")}`],
    ["jest.mocked", `${IMPORT}jest.mock("./price");\n${test("  jest.mocked(price).mockResolvedValue(42);\n  expect(await price(cart)).toBe(42);")}`],
    ["resolves", `${IMPORT}jest.mock("./price", () => ({ price: async () => 42 }));\n${test("  await expect(price(cart)).resolves.toBe(42);")}`],
  ])("reports %s", (_name, text) => {
    expect(keys(text)).toEqual(["./price::price"].map(key => key === "./price::price" && /default/.test(_name) ? "./price::default" : key));
  });

  it.each([
    ["the module under test is called, its dependency is mocked", `import { total } from "./cart";\n${IMPORT}jest.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(total(cart)).toBe(42);")}`],
    ["the mock keeps the real module", `${IMPORT}jest.mock("./price", () => ({ ...jest.requireActual("./price"), tax: () => 1 }));\n${test("  expect(price(cart)).toBe(42);")}`],
    ["vitest importActual", `${IMPORT}vi.mock("./price", async importActual => ({ ...(await importActual()), tax: () => 1 }));\n${test("  expect(price(cart)).toBe(42);")}`],
    ["an automock nobody gave a value (a manual mock decides)", `${IMPORT}jest.mock("./price");\n${test("  expect(price(cart)).toBe(42);")}`],
    ["an assertion about the mock's calls", `${IMPORT}jest.mock("./price", () => ({ price: jest.fn(() => 42) }));\n${test("  total(cart);\n  expect(price).toHaveBeenCalledWith(cart);")}`],
    ["a different module is mocked", `${IMPORT}jest.mock("./tax", () => ({ tax: () => 1 }));\n${test("  expect(price(cart)).toBe(42);")}`],
    ["doMock comes after the import was loaded", `${IMPORT}it("totals", () => {\n  jest.doMock("./price", () => ({ price: () => 42 }));\n  expect(price(cart)).toBe(42);\n});\n`],
    ["a mock made in a hook comes after the import was loaded", `${IMPORT}beforeEach(() => {\n  jest.mock("./price", () => ({ price: () => 42 }));\n});\n${test("  expect(price(cart)).toBe(42);")}`],
    ["a mock inside describe comes after the import was loaded", `${IMPORT}describe("cart", () => {\n  jest.mock("./price", () => ({ price: () => 42 }));\n  ${test("  expect(price(cart)).toBe(42);")}});\n`],
    ["a variable that is not from the mock", `${IMPORT}jest.mock("./price", () => ({ price: () => 42 }));\n${test("  const total = compute(cart);\n  expect(total).toBe(42);")}`],
    ["a spy that calls through", `${IMPORT}import * as lib from "./price";\n${test("  jest.spyOn(lib, 'price');\n  expect(price(cart)).toBe(42);")}`],
    ["vitest's spying automock calls the real function", `${IMPORT}vi.mock("./price", { spy: true });\n${test("  expect(price(cart)).toBe(42);")}`],
    ["a mock inside a string or comment", `${IMPORT}// jest.mock("./price", () => ({ price: () => 42 }));\nconst note = 'jest.mock("./price", () => 1)';\n${test("  expect(price(cart)).toBe(42);")}`],
  ])("leaves alone: %s", (_name, text) => {
    expect(keys(text)).toEqual([]);
  });

  it("leaves the tests of mocking itself alone", () => {
    const text = `${IMPORT}jest.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(price(cart)).toBe(42);")}`;
    expect(keys(text, "src/__tests__/mock_per_test.js")).toEqual([]);
    expect(keys(text, "testing/test_monkeypatch.ts")).toEqual([]);
    expect(keys(text, "cart.test.ts")).toHaveLength(1);
  });

  it("names the line of the mock and the function asserted on", () => {
    const [item] = mockedSubjects(`${IMPORT}\njest.mock("./price", () => ({ price: () => 42 }));\n${test("  expect(price(cart)).toBe(42);")}`, "cart.test.ts");
    expect(item.line).toBe(3);
    expect(item.snippet).toContain('jest.mock("./price"');
    expect(item.reason).toBe('assertion on the output of price(), which this test replaces with a mock of "./price"');
  });
});

describe("Python: a test that asserts on what it patched", () => {
  it.each([
    ["monkeypatch.setattr on an object", 'import pkg.cart as cart\n\n\ndef test_total(monkeypatch):\n    monkeypatch.setattr(cart, "total", lambda: 42)\n    assert cart.total() == 42\n', "pkg.cart.total"],
    ["a result variable", 'import pkg.cart as cart\n\n\ndef test_total(monkeypatch):\n    monkeypatch.setattr(cart, "total", lambda: 42)\n    result = cart.total()\n    assert result == 42\n', "pkg.cart.total"],
    ["patch.object in a with block", 'from pkg import cart\n\n\ndef test_total():\n    with patch.object(cart, "total", return_value=42):\n        assert cart.total() == 42\n', "pkg.cart.total"],
    ["mocker.patch with a dotted target", 'import pkg.cart as cart\n\n\ndef test_total(mocker):\n    mocker.patch("pkg.cart.total", return_value=42)\n    assert cart.total() == 42\n', "pkg.cart.total"],
    ["a patch decorator", 'import pkg.cart as cart\n\n\n@patch("pkg.cart.total", return_value=42)\ndef test_total(mock_total):\n    assert cart.total() == 42\n', "pkg.cart.total"],
    ["unittest assertions", 'import pkg.cart as cart\n\n\nclass T(TestCase):\n    @patch("pkg.cart.total", return_value=42)\n    def test_total(self, mock_total):\n        self.assertEqual(cart.total(), 42)\n', "pkg.cart.total"],
    ["the same target patched in two tests, asserted in the second", 'import pkg.cart as cart\n\n\ndef test_a(monkeypatch):\n    monkeypatch.setattr(cart, "total", lambda: 1)\n    run()\n\n\ndef test_b(monkeypatch):\n    monkeypatch.setattr(cart, "total", lambda: 42)\n    assert cart.total() == 42\n', "pkg.cart.total"],
    ["a monkeypatch with a dotted string", 'import os\n\n\ndef test_x(monkeypatch):\n    monkeypatch.setattr("os.getcwd", lambda: "/x")\n    assert os.getcwd() == "/x"\n', "os.getcwd"],
  ])("reports %s", (_name, text, key) => {
    expect(keys(text, "test_cart.py")).toEqual([key]);
  });

  it.each([
    ["the patch is in another test", 'import pkg.cart as cart\n\n\ndef test_a(monkeypatch):\n    monkeypatch.setattr(cart, "total", lambda: 42)\n\n\ndef test_b():\n    assert cart.total() == 42\n'],
    ["a bare imported name is the real function", 'from pkg.cart import total\n\n\n@patch("pkg.cart.total", return_value=42)\ndef test_a(mock_total):\n    assert total() == 42\n'],
    ["after the with block", 'from pkg import cart\n\n\ndef test_a():\n    with patch.object(cart, "total", return_value=42):\n        pass\n    assert cart.total() == 42\n'],
    ["before the patch", 'import pkg.cart as cart\n\n\ndef test_a(monkeypatch):\n    assert cart.total() == 1\n    monkeypatch.setattr(cart, "total", lambda: 42)\n'],
    ["a patch that wraps the real function", 'import pkg.cart as cart\n\n\ndef test_a(mocker):\n    mocker.patch.object(cart, "total", wraps=cart.total)\n    assert cart.total() == 1\n'],
    ["an assertion about calls", 'import pkg.cart as cart\n\n\ndef test_a(mocker):\n    m = mocker.patch("pkg.cart.total", return_value=42)\n    run()\n    assert m.called\n    m.assert_called_once()\n'],
    ["another function is asserted on", 'import pkg.cart as cart\n\n\ndef test_a(monkeypatch):\n    monkeypatch.setattr(cart, "tax", lambda: 1)\n    assert cart.total() == 42\n'],
    ["a docstring that shows the pattern", 'import pkg.cart as cart\n\n\ndef test_a():\n    """monkeypatch.setattr(cart, "total", f); assert cart.total() == 1"""\n    assert cart.total() == 42\n'],
  ])("leaves alone: %s", (_name, text) => {
    expect(keys(text, "test_cart.py")).toEqual([]);
  });

  it("leaves the tests of monkeypatch itself alone", () => {
    const text = 'import pkg.cart as cart\n\n\ndef test_total(monkeypatch):\n    monkeypatch.setattr(cart, "total", lambda: 42)\n    assert cart.total() == 42\n';
    expect(keys(text, "testing/test_monkeypatch.py")).toEqual([]);
  });
});

describe("in a review of a change", () => {
  const analyze = (before: string | null, after: string, file = "cart.test.ts") => analyzeTestFile(file, file, before, after, "HEAD").immediate;
  const REAL = 'import { price } from "./price";\nit("totals", () => {\n  const total = price(cart);\n  expect(total).toBe(42);\n});\n';
  const MOCKED = 'import { price } from "./price";\njest.mock("./price", () => ({ price: () => 42 }));\nit("totals", () => {\n  const total = price(cart);\n  expect(total).toBe(42);\n});\n';

  it("reports a mock added to a test that checked the real thing, as an assertion that always passes", () => {
    const [finding, ...rest] = analyze(REAL, MOCKED);
    expect(rest).toEqual([]);
    expect(finding.type).toBe("trivial-assert");
    expect(finding.lineNumber).toBe(2);
    expect(finding.reason).toMatch(/replaces with a mock of "\.\/price"/);
  });

  it("reports a new test file written that way, and stays quiet about one that already was", () => {
    expect(analyze(null, MOCKED)).toHaveLength(1);
    expect(analyze(MOCKED, MOCKED + "\n// more\n")).toEqual([]);
  });

  it("reports the Python version in a test_*.py file", () => {
    const before = 'import pkg.cart as cart\n\n\ndef test_total():\n    assert cart.total() == 42\n';
    const after = 'import pkg.cart as cart\n\n\ndef test_total(monkeypatch):\n    monkeypatch.setattr(cart, "total", lambda: 42)\n    assert cart.total() == 42\n';
    expect(analyze(before, after, "test_cart.py").map(f => f.type)).toEqual(["trivial-assert"]);
  });
});
