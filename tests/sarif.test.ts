import { afterEach, beforeEach, describe, it, expect } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { checkProject } from "../src/check.js";
import { reviewChanges } from "../src/review.js";
import { formatSarif } from "../src/sarif.js";

let dir: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-sarif-")); git("init", "-b", "main");
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid"); git("config", "commit.gpgsign", "false");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("portable SARIF reporting", () => {
  it("has actionable rule metadata, encoded relative locations, severity and no embedded source", async () => {
    fs.writeFileSync(path.join(dir, "auth #1.test.ts"), "it.skip('private behavior');\n");
    const result = await checkProject({ cwd: dir, format: "sarif" });
    const sarif = JSON.parse(result.output); const run = sarif.runs[0];
    expect(sarif.version).toBe("2.1.0"); expect(run.tool.driver.name).toBe("agent-roast");
    expect(run.tool.driver.rules.length).toBe(7);
    expect(run.results[0]).toMatchObject({ ruleId: "test-skip", level: "error", ruleIndex: 0 });
    expect(run.results[0].locations[0].physicalLocation).toMatchObject({ artifactLocation: { uri: "auth%20%231.test.ts" }, region: { startLine: 1 } });
    expect(run.results[0].message.text).toContain("Re-enable");
    expect(result.output).not.toContain(dir); expect(result.output).not.toContain("private behavior");
    expect(run.invocations[0].executionSuccessful).toBe(true);
  });
  it("uses stable fingerprints across clean line shifts and unique occurrence keys", async () => {
    fs.writeFileSync(path.join(dir, "auth.test.ts"), "it.skip('auth');\nit.skip('auth');\n");
    const first = JSON.parse((await checkProject({ cwd: dir, format: "sarif" })).output).runs[0].results;
    fs.writeFileSync(path.join(dir, "auth.test.ts"), "// clean line shift\nit.skip('auth');\nit.skip('auth');\n");
    const second = JSON.parse((await checkProject({ cwd: dir, format: "sarif" })).output).runs[0].results;
    expect(first.map((f: any) => f.partialFingerprints)).toEqual(second.map((f: any) => f.partialFingerprints));
    expect(first[0].partialFingerprints).not.toEqual(first[1].partialFingerprints);
  });
  it("keeps incomplete analysis explicitly unsuccessful", async () => {
    fs.symlinkSync("missing", path.join(dir, "linked.ts"));
    const result = await checkProject({ cwd: dir, format: "sarif" }); const run = JSON.parse(result.output).runs[0];
    expect(result.exitCode).toBe(2); expect(run.invocations[0].executionSuccessful).toBe(false);
    expect(run.invocations[0].toolExecutionNotifications[0].level).toBe("error");
  });
  it("emits only introduced review findings and records committed comparison scope", async () => {
    fs.writeFileSync(path.join(dir, "auth.test.ts"), "it.skip('old');\n"); git("add", "."); git("commit", "-m", "base"); const base = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(dir, "auth.test.ts"), "it.skip('old');\nit.skip('new');\n"); git("add", "."); git("commit", "-m", "head");
    const result = await reviewChanges({ cwd: dir, base, format: "sarif" }); const run = JSON.parse(result.output).runs[0];
    expect(run.results).toHaveLength(1); expect(run.results[0].baselineState).toBe("new");
    expect(run.properties).toMatchObject({ scope: "introduced findings in changed files", unchangedFindings: 1, baseSha: base });
  });
  it("reports advisory severity when policy is advisory", async () => {
    fs.writeFileSync(path.join(dir, "auth.test.ts"), "it.skip('auth');\n");
    const result = await checkProject({ cwd: dir, failOn: [], format: "sarif" });
    expect(JSON.parse(result.output).runs[0].results[0].level).toBe("warning");
    expect(result.exitCode).toBe(0);
  });
  it("refuses absolute and parent-traversing finding paths", async () => {
    fs.writeFileSync(path.join(dir, "auth.test.ts"), "it.skip('auth');\n"); const result = await checkProject({ cwd: dir });
    for (const file of ["/secret.ts", "../secret.ts", "C:/secret.ts"]) {
      result.infractions[0].file = file; expect(() => formatSarif(result)).toThrow(/relative/);
    }
  });
  it("emits valid JSON via the compiled check CLI", () => {
    fs.writeFileSync(path.join(dir, "auth.test.ts"), "it.skip('auth');\n");
    const result = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [path.resolve("dist/cli.js"), "check", dir, "--format", "sarif"], { encoding: "utf8" });
    expect(result.status).toBe(1); expect(JSON.parse(result.stdout).version).toBe("2.1.0");
  });
});
