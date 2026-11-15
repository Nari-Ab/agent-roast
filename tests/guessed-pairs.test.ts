import { describe, expect, it } from "vitest";
import { auditFileDiffs } from "../src/metrics.js";
import { analyzeTestFile, newTestMarkers } from "../src/tampering.js";

// False alarms of sample 11 (docs/benchmarks.md, section 18) that came from guessing. The assertions an edit left over in a test with as many
// assertions as before were paired in order, so an exact check could be paired with an unrelated line and reported as weakened
// (`ekzhang/resin` `d60e4b73f4`); a marker that is not part of a decorator was given to whichever `def` happened to follow it within 80 lines,
// so a reformatting that moved that `def` across the window made an old marker look new (`gumyr/build123d` `aa05d578f0`).

const py = (body: string) => `def test_scores():\n${body.split("\n").map(line => `    ${line}`).join("\n")}\n`;
const review = (before: string, after: string, file = "tests/test_scoring.py") => analyzeTestFile(file, file, before, after, "HEAD").immediate;
const scan = (text: string, file: string) =>
  auditFileDiffs([{ path: file, addedLines: text.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })) }]).infractions;
const markers = (before: string, after: string, file: string) => newTestMarkers(scan(before, file), scan(after, file), before, after).map(f => f.type);

describe("the assertions an edit left over are paired by what they are about", () => {
  it("does not pair an exact check with an unrelated weak one", () => {
    // In order, `x == 1` would be paired with `y is not None` and reported as weakened; by what they are about, `x == 2` is what replaced it.
    expect(review(py("assert x == 1\nassert bool(y)"), py("assert y is not None\nassert x == 2")).map(f => f.type)).toEqual([]);
  });

  it("does not read a clause of a compound check as lost when the same expression is pinned to another value (the shape of resin d60e4b73f4)", () => {
    const before = py([
      "first = score(plan)",
      "assert first is not None",
      "assert max(sizes) == CHUNK",
      "assert set(sizes) == {1, CHUNK}",
      "result = score(plan)",
      "assert result is not None and sizes == []",
    ].join("\n"));
    const after = py([
      "first = score(plan)",
      "assert first is not None",
      "assert sizes == [CHUNK, CHUNK, 1]",
      "result = score(plan)",
      "assert result is not None",
      "assert sizes == [CHUNK, CHUNK, 1]",
    ].join("\n"));
    expect(review(before, after).map(f => f.type)).toEqual([]);
  });

  it("still reports a compound check whose dropped clause is not pinned anywhere", () => {
    const found = review(py("assert result is not None and sizes == [1, 2]"), py("assert result is not None"));
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
  });

  it("still reports a compound check whose dropped clause is only checked weakly elsewhere", () => {
    const found = review(py("assert result is not None and sizes == [1, 2]\nassert other == 1"), py("assert result is not None\nassert sizes"));
    expect(found.map(f => f.type)).toContain("assertion-weakened");
  });

  it("still reports an exact check edited in place into a weaker one", () => {
    const found = review(py("result = total(cart)\nassert result == 42"), py("result = total(cart)\nassert result is not None"));
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
  });

  it("names the pair that is about the same thing when several were edited and reordered", () => {
    const found = review(py("assert a == 1\nassert b == 2"), py("assert b > 0\nassert a == 3"));
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
    expect(found[0].lineSnippet).toContain("assert b == 2 → assert b > 0");
  });

  it("does not call two checks about the same object the same thing", () => {
    const found = review(
      py("assert cart.total == 10\nassert cart.items == [1, 2]"),
      py("assert cart.items == [1, 2, 3]\nassert cart.total >= 0"),
    );
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
    expect(found[0].lineSnippet).toContain("assert cart.total == 10 → assert cart.total >= 0");
  });

  it("pairs an exact check with the new one about the same thing (the shape of AgileRL 1a6500383f)", () => {
    // `scores.shape == (2, 5, 9)` became `scores.shape == (2, 9)`: an exact check kept exact. In order it was paired with `len(past) > 0`, which stands in its place.
    const before = py("scores, logits = score(tokens)\nassert isinstance(scores, Tensor)\nassert scores.shape == (2, 5, 9)\nassert logits is not None");
    const after = py("scores, past = initial(items)\nassert isinstance(scores, Tensor)\nassert len(past) > 0\nassert scores.shape == (2, 9)");
    expect(review(before, after).map(f => f.type)).toEqual([]);
  });

  it("reads `needle in haystack` as being about the haystack (the shape of wyrd 6520bc7f66)", () => {
    // `"water" in tags` was edited into `tag in tags`, with a message; in order it would be paired with the new `assert exercised` and reported as weakened.
    const found = review(py('assert "water" in (out.get("tags") or [])\nassert y'), py('assert exercised, "found one"\nassert tag in (out.get("tags") or []), (f"re-roll of {tag}")'));
    expect(found.map(f => f.type)).toEqual([]);
  });

  it("does not pair an old check whose subject the new test still has with an unrelated line (the shape of xpert c77c8aaf51)", () => {
    // The second element of `where` is gone together with the code that built it; `where` is now checked as a whole. `where[1]` is not paired with
    // `where[0].organizationId` just because both stand where nothing else was left.
    const js = (body: string) => `describe("find", () => {\n  it("scopes", () => {\n${body.split("\n").map(line => `    ${line}`).join("\n")}\n  });\n});\n`;
    const found = review(
      js("expect(where[0]).toMatchObject({ tenantId: 1 });\nexpect(where[1]).toMatchObject({ tenantId: 2, enabled: true });\nexpect(where[1].organizationId).toBeDefined();"),
      js("expect(where).toHaveLength(1);\nexpect(where[0]).toMatchObject({ tenantId: 1 });\nexpect(where[0].organizationId).toBeDefined();"),
      "src/find.test.ts",
    );
    expect(found.map(f => f.type)).toEqual([]);
  });

  it("does not take the prefix of a string for a name", () => {
    const found = review(py('assert x == 1, "m"\nassert y'), py('assert exercised, f"found {x}"\nassert x == 2'));
    expect(found.map(f => f.type)).toEqual([]);
  });

  it("does not take the inputs of a call for what is checked (the shape of crust 7d72b4cfd2)", () => {
    // Both lines pass `{ flags: ... }` to a call; that makes them about different things, not the same one.
    const js = (body: string) => `describe("run", () => {\n  it("omits empty arrays", async () => {\n${body.split("\n").map(line => `    ${line}`).join("\n")}\n  });\n});\n`;
    const found = review(
      js('expect(await app.run([], { flags: { optional: [] } })).toEqual({ status: "completed" });\nawait expect(required.run([], { flags: { tag: [] } })).rejects.toThrow("Missing");'),
      js('expect(await app.run([], { flags: { optional: [] } })).toMatchObject({ status: "completed" });\nawait expect(unwrap(required.run([], { flags: { tag: [] } }))).rejects.toThrow("Missing");'),
      "src/run.test.ts",
    );
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
    expect(found[0].lineSnippet).toMatch(/app\.run.*\.toEqual\(.* → expect\(await app\.run.*\.toMatchObject\(/);
  });

  it("reads through a function that only looks at its argument", () => {
    const found = review(py("assert set(sizes) == {1, 2}\nassert other == 1"), py("assert sizes\nassert other == 2"));
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
    expect(found[0].lineSnippet).toContain("assert set(sizes) == {1, 2} → assert sizes");
  });

  it("still pairs one old check with one new one that share nothing, when nothing else is left", () => {
    const found = review(py("assert compute(x) == 5"), py("assert result is not None"));
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
  });

  it("works the same way in JavaScript", () => {
    const js = (body: string) => `describe("cart", () => {\n  it("totals", () => {\n${body.split("\n").map(line => `    ${line}`).join("\n")}\n  });\n});\n`;
    const found = review(js("expect(a).toBe(1);\nexpect(b).toBe(2);"), js("expect(b).toBeGreaterThan(0);\nexpect(a).toBe(3);"), "src/cart.test.ts");
    expect(found.map(f => f.type)).toEqual(["assertion-weakened"]);
    expect(found[0].lineSnippet).toContain("expect(b).toBe(2) → expect(b).toBeGreaterThan(0)");
  });
});

describe("a Python marker belongs to the def below it only when it is part of a decorator", () => {
  const file = "tests/test_intersection.py";
  const helper = [
    "import pytest",
    "",
    "def make_params(matrix):",
    "    params = []",
    "    for case in matrix:",
    "        marks = []",
    "        if case.xfail:",
    "            marks = [pytest.mark.xfail(reason=case.xfail)]",
    "        params.append(pytest.param(case.a, marks=marks))",
    "    return params",
    "",
  ].join("\n");
  const filler = (count: number) => `matrix = [\n${Array.from({ length: count }, (_, i) => `    Case(${i}),`).join("\n")}\n]\n`;
  const test = '\n@pytest.mark.parametrize("a", make_params(matrix))\ndef test_intersect(a):\n    assert a\n';

  it("does not call a marker new because a reformatting moved the next def across the window (the shape of build123d aa05d578f0)", () => {
    expect(markers(`${helper}${filler(40)}${test}`, `${helper}${filler(90)}${test}`, file)).toEqual([]);
    expect(markers(`${helper}${filler(90)}${test}`, `${helper}${filler(40)}${test}`, file)).toEqual([]);
  });

  it("still reports a marker put on a decorator of a test that was running", () => {
    const before = 'import pytest\n\ndef test_x():\n    assert 1\n';
    expect(markers(before, 'import pytest\n\n@pytest.mark.skip\ndef test_x():\n    assert 1\n', file)).toEqual(["test-skip"]);
    expect(markers(before, 'import pytest\n\n@pytest.mark.xfail(reason="later")\ndef test_x():\n    assert 1\n', file)).toEqual(["test-skip"]);
  });

  it("still reads a marks= argument inside a decorator, on one line or over several", () => {
    const before = 'import pytest\n\n@pytest.mark.parametrize("a", [1, 2])\ndef test_x(a):\n    assert a\n';
    const one = 'import pytest\n\n@pytest.mark.parametrize("a", [1, pytest.param(2, marks=pytest.mark.skip)])\ndef test_x(a):\n    assert a\n';
    const several = 'import pytest\n\n@pytest.mark.parametrize(\n    "a",\n    [\n        1,\n        pytest.param(2, marks=pytest.mark.skip),\n    ],\n)\ndef test_x(a):\n    assert a\n';
    expect(markers(before, one, file)).toEqual(["test-skip"]);
    expect(markers(before, several, file)).toEqual(["test-skip"]);
  });

  it("still counts a new marker that is in a helper, by number, as a marker that names no single test", () => {
    const withMarker = `${helper}${filler(10)}${test}`;
    const without = withMarker.replace("            marks = [pytest.mark.xfail(reason=case.xfail)]\n", "            marks = []\n");
    expect(markers(without, withMarker, file)).toEqual(["test-skip"]);
    expect(markers(withMarker, withMarker, file)).toEqual([]);
  });
});
