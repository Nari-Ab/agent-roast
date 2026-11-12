import { describe, expect, it } from "vitest";
import { analyzeTestFile } from "../src/tampering.js";

// A recall probe of 0.19.0 against commits whose messages said they loosened a test found one check it did not read: an exact value
// edited into a negated one (`toBe(2)` → `not.toBe(0)`). The test used to pin the value; now nearly anything passes.

const review = (before: string, after: string, file: string) => analyzeTestFile(file, file, before, after, "HEAD").immediate.map(f => f.type);
const js = (body: string) => `describe("retries", () => {\n  it("gives up", () => {\n    const run = start();\n${body.split("\n").map(line => `    ${line}`).join("\n")}\n  });\n});\n`;
const py = (body: string) => `def test_gives_up():\n    run = start()\n${body.split("\n").map(line => `    ${line}`).join("\n")}\n`;

describe("an exact check turned into a negated one (JavaScript)", () => {
  const file = "src/retries.test.ts";

  it("reports a count that is now only 'not zero'", () => {
    expect(review(js("expect(run.attempts).toBe(2);"), js("expect(run.attempts).not.toBe(0);"), file)).toEqual(["assertion-weakened"]);
  });

  it("reports an exit code that is now only 'not success'", () => {
    expect(review(js("expect(result.exitCode).toBe(124);"), js("expect(result.exitCode).not.toBe(0);"), file)).toEqual(["assertion-weakened"]);
  });

  it("reports a string that is now only 'not another string'", () => {
    expect(review(js('expect(intent.action).toBe("permission_pipeline");'), js('expect(intent.action).not.toBe("model");'), file)).toEqual(["assertion-weakened"]);
  });

  it("reads toEqual, toStrictEqual and toHaveLength the same way", () => {
    expect(review(js("expect(items).toEqual(['a', 'b']);"), js("expect(items).not.toEqual([]);"), file)).toEqual(["assertion-weakened"]);
    expect(review(js("expect(items).toStrictEqual({ id: 1 });"), js("expect(items).not.toStrictEqual({});"), file)).toEqual(["assertion-weakened"]);
    expect(review(js("expect(items).toHaveLength(3);"), js("expect(items).not.toHaveLength(0);"), file)).toEqual(["assertion-weakened"]);
  });

  it("reports it while the test gains another assertion", () => {
    const after = js("expect(run.attempts).not.toBe(0);\nexpect(run.finished).toBe(true);");
    expect(review(js("expect(run.attempts).toBe(2);"), after, file)).toEqual(["assertion-weakened"]);
  });

  it("does not report ruling out the very value the old check expected (a flipped expectation)", () => {
    expect(review(js("expect(run.attempts).toBe(2);"), js("expect(run.attempts).not.toBe(2);"), file)).toEqual([]);
    expect(review(js("expect(second.hash).toEqual(first.hash);"), js("expect(second.hash).not.toEqual(first.hash);"), file)).toEqual([]);
  });

  it("does not report an old check that expected nothing or a boolean", () => {
    expect(review(js("expect(run.attempts).toBe(0);"), js("expect(run.attempts).not.toBe(1);"), file)).toEqual([]);
    expect(review(js("expect(items).toEqual([]);"), js("expect(items).not.toEqual(['a']);"), file)).toEqual([]);
    expect(review(js("expect(run.done).toBe(true);"), js("expect(run.done).not.toBe(false);"), file)).toEqual([]);
  });

  it("does not report a value that is only named (it asks whether something changed, which is another question)", () => {
    expect(review(js("expect(run.id).toBe('first');"), js("expect(run.id).not.toBe(previousId);"), file)).toEqual([]);
  });

  it("does not report a negated check that became another negated check", () => {
    expect(review(js("expect(run.attempts).not.toBe(2);"), js("expect(run.attempts).not.toBe(0);"), file)).toEqual([]);
    expect(review(js("expect(total).not.toBe(2);"), js("expect(total).not.toBeLessThan(5);"), file)).toEqual([]);
  });

  it("does not report another expression", () => {
    expect(review(js("expect(run.attempts).toBe(2);"), js("expect(run.failures).not.toBe(0);"), file)).toEqual([]);
  });

  it("does not report an exact check that is still made on the same expression", () => {
    const after = js("expect(run.attempts).not.toBe(0);\nexpect(run.attempts).toBe(2);");
    expect(review(js("expect(run.attempts).toBe(2);"), after, file)).toEqual([]);
  });
});

describe("an exact check turned into a negated one (Python)", () => {
  const file = "tests/test_retries.py";

  it("reports a count that is now only 'not zero'", () => {
    expect(review(py("assert run.attempts == 2"), py("assert run.attempts != 0"), file)).toEqual(["assertion-weakened"]);
  });

  it("reports an exit code that is now only 'not success', with a message", () => {
    expect(review(py('assert result.exit_code == 124, "timeout"'), py('assert result.exit_code != 0, "timeout"'), file)).toEqual(["assertion-weakened"]);
  });

  it("reads assertEqual and assertNotEqual the same way", () => {
    const unit = (body: string) => `class RetryTest(unittest.TestCase):\n    def test_gives_up(self):\n        run = start()\n        ${body}\n`;
    expect(review(unit("self.assertEqual(run.attempts, 2)"), unit("self.assertNotEqual(run.attempts, 0)"), file)).toEqual(["assertion-weakened"]);
  });

  it("does not report ruling out the value the old check expected, nothing, or a boolean", () => {
    expect(review(py("assert run.attempts == 2"), py("assert run.attempts != 2"), file)).toEqual([]);
    expect(review(py("assert result.exit_code == 0"), py("assert result.exit_code != 0"), file)).toEqual([]);
    expect(review(py("assert run.done == True"), py("assert run.done != False"), file)).toEqual([]);
  });

  it("does not report a compound assertion, a named value, or a negated assertion", () => {
    expect(review(py("assert run.attempts == 2 and run.done"), py("assert run.attempts != 0 and run.done"), file)).toEqual([]);
    expect(review(py("assert run.id == 'first'"), py("assert run.id != previous_id"), file)).toEqual([]);
    expect(review(py("assert run.attempts == 2"), py("assert not run.attempts != 0"), file)).toEqual([]);
  });
});
