import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import { pathToFileURL } from "url";
import { tmpdir } from "os";
import { createBaseline, loadBaseline, writeBaseline, applyBaseline } from "../src/baseline.js";
import type { Infraction } from "../src/types.js";

let dir: string;
const finding = (lineNumber = 1, lineSnippet = "it.skip('auth');", file = "auth.test.ts"): Infraction => ({ type: "test-skip", file, lineNumber, lineSnippet, commitHash: "WORKTREE", commitDate: "", reason: "skip" });
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "roast-baseline-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("baseline adoption without hiding newly added problems", () => {
  it("ignores line shifts but catches a second identical occurrence", () => {
    const baseline = createBaseline([finding()]);
    const result = applyBaseline([finding(20), finding(40)], baseline);
    expect(result.baselineCount).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].lineNumber).toBe(40);
  });
  it("treats a different snippet or file as a new finding", () => {
    const result = applyBaseline([finding(1, "it.skip('new behavior');"), finding(2, undefined, "other.test.ts")], createBaseline([finding()]));
    expect(result.findings).toHaveLength(2); expect(result.staleBaselineCount).toBe(1);
  });
  it("saves only hashes and counts, without source code or absolute paths", () => {
    const filename = path.join(dir, "baseline.json"); writeBaseline(filename, [finding(), finding(2)]);
    const serialized = readFileSync(filename, "utf8");
    expect(serialized).not.toContain("auth"); expect(serialized).not.toContain(dir);
    const loaded = loadBaseline(filename); expect(loaded.entries[0].count).toBe(2);
    expect(loaded).toEqual(createBaseline([finding(), finding(2)]));
  });
  it("preserves an existing baseline and cleans temporary files on failed publication", () => {
    const filename = path.join(dir, "baseline.json"); writeBaseline(filename, [finding()]);
    const original = readFileSync(filename, "utf8");
    expect(() => writeBaseline(filename, [finding(1, "changed")])).toThrow(/preserved/);
    expect(readFileSync(filename, "utf8")).toBe(original);
    expect(readdirSync(dir)).toEqual(["baseline.json"]);
  });
  it.each([null, [], {}, { schemaVersion: "9", entries: [] }, { schemaVersion: "1.0.0", fingerprintVersion: 1, entries: [{ fingerprint: "bad", count: 1 }] }, { schemaVersion: "1.0.0", fingerprintVersion: 1, entries: [{ fingerprint: "a".repeat(64), count: 0 }] }, { schemaVersion: "1.0.0", fingerprintVersion: 1, entries: [{ fingerprint: "a".repeat(64), count: 1 }, { fingerprint: "a".repeat(64), count: 1 }] }])("rejects invalid baseline %j", value => {
    const filename = path.join(dir, "baseline.json"); writeFileSync(filename, JSON.stringify(value));
    expect(() => loadBaseline(filename)).toThrow(/baseline/);
  });
  it("refuses to create a baseline that its bounded loader cannot read", () => {
    const filename = path.join(dir, "too-large.json");
    const manyFindings = Array.from({ length: 50_000 }, (_, index) => finding(index + 1, `it.skip('case-${index}');`));
    expect(() => writeBaseline(filename, manyFindings)).toThrow(/read limits/);
    expect(readdirSync(dir)).toEqual([]);
  });
  it("allows exactly one concurrent publication", async () => {
    const filename = path.join(dir, "baseline.json");
    const moduleUrl = pathToFileURL(path.resolve("dist/index.js")).href;
    const script = `import { writeBaseline } from ${JSON.stringify(moduleUrl)}; try { writeBaseline(process.argv[1], ${JSON.stringify([finding()])}); } catch { process.exitCode = 2; }`;
    const attempt = () => new Promise<number | null>((resolve, reject) => {
      const child = spawn((process.env.AGENT_ROAST_TEST_NODE || process.execPath), ["--input-type=module", "-e", script, filename], { stdio: "ignore" });
      child.on("error", reject); child.on("close", resolve);
    });
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    expect(results.filter(code => code === 0)).toHaveLength(1);
    expect(results.filter(code => code === 2)).toHaveLength(3);
    expect(loadBaseline(filename).entries).toHaveLength(1);
  });
});
