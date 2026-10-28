import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { applyExceptions, validateExceptions } from "../src/exceptions.js";
import { findingFingerprint, writeBaseline } from "../src/baseline.js";
import { checkProject } from "../src/check.js";
import { reviewChanges, reviewStagedChanges } from "../src/review.js";
import { configFromText } from "../src/config.js";
import type { Infraction } from "../src/types.js";

const finding: Infraction = { type: "test-skip", file: "auth.test.ts", lineNumber: 1, lineSnippet: "it.skip('temporary');", commitHash: "HEAD", commitDate: "", reason: "skipped test" };
const allowance = { fingerprint: findingFingerprint(finding), count: 1, reason: "Upstream integration unavailable; tracked in ENG-42", expires: "2099-12-31" };

describe("precise, reviewable finding exceptions", () => {
  it("accepts a specific occurrence without hiding additional identical ones or different rules", () => {
    const result = applyExceptions([finding, { ...finding, lineNumber: 2 }, { ...finding, type: "test-focus" }], [allowance]);
    expect(result.suppressedFindings).toHaveLength(1); expect(result.findings).toHaveLength(2);
    expect(result.suppressedFindings[0].suppression).toEqual({ reason: allowance.reason, expires: allowance.expires });
    expect(result.findings[0].fingerprint).toBe(allowance.fingerprint);
  });
  it("is stable across line shifts but scoped to source evidence and file", () => {
    const result = applyExceptions([{ ...finding, lineNumber: 999 }, { ...finding, file: "other.test.ts" }, { ...finding, lineSnippet: "it.skip('other');" }], [allowance]);
    expect(result.suppressedFindings).toHaveLength(1); expect(result.findings).toHaveLength(2);
  });
  it("expires after the UTC calendar date, including leap-day validity", () => {
    const allowed = { ...allowance, expires: "2028-02-29" };
    expect(applyExceptions([finding], [allowed], new Date("2028-02-29T23:59:59Z")).suppressedFindings).toHaveLength(1);
    const expired = applyExceptions([finding], [allowed], new Date("2028-03-01T00:00:00Z"));
    expect(expired.findings).toHaveLength(1); expect(expired.expiredExceptionCount).toBe(1);
  });
  it.each([
    null, {}, [null], [{ ...allowance, count: 0 }], [{ ...allowance, count: 1.2 }], [{ ...allowance, count: 100001 }],
    [{ ...allowance, fingerprint: "wildcard" }], [{ ...allowance, reason: " " }], [{ ...allowance, reason: "line\nnew" }],
    [{ ...allowance, reason: "line\u2028new" }], [{ ...allowance, reason: "hidden\u202e" }], [{ ...allowance, expires: "2027-02-29" }], [{ ...allowance, expires: "2099-13-01" }],
    [{ ...allowance, expires: "2099-1-1" }], [{ ...allowance, unknown: true }], [allowance, allowance],
  ])("rejects ambiguous or invalid policy %j", value => expect(() => validateExceptions(value)).toThrow());
  it("validates configuration exceptions and leaves default rules enabled", () => {
    const config = configFromText(JSON.stringify({ exceptions: [allowance] }), "test");
    expect(config.exceptions).toEqual([allowance]); expect(config.rules?.["test-skip"]).toBe("error");
    expect(() => configFromText(JSON.stringify({ exceptions: [{ ...allowance, reason: "" }] }), "test")).toThrow();
  });
});

let dir: string;
const cli = path.resolve("dist/cli.js");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" }).trim();
const write = (file: string, value: string) => fs.writeFileSync(path.join(dir, file), value);
const commit = () => { git("add", "."); git("commit", "-m", "change"); return git("rev-parse", "HEAD"); };
const policy = (entry = allowance) => write(".agentroastrc.json", JSON.stringify({ exceptions: [entry] }));
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-exception-")); git("init", "-b", "main");
  git("config", "user.name", "Tester"); git("config", "user.email", "test@example.invalid"); git("config", "commit.gpgsign", "false");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("exception workflow in current source and trusted reviews", () => {
  it("exposes fingerprints, accepted reasons and counts without claiming the code was fixed", async () => {
    write("auth.test.ts", finding.lineSnippet! + "\n");
    const initial = await checkProject({ cwd: dir }); expect(initial.infractions[0].fingerprint).toBe(allowance.fingerprint);
    policy();
    const accepted = await checkProject({ cwd: dir, format: "markdown" });
    expect(accepted.passed).toBe(true); expect(accepted.totalFindings).toBe(1); expect(accepted.suppressedFindings).toHaveLength(1);
    expect(accepted.output).toContain(allowance.reason);
    write("auth.test.ts", (finding.lineSnippet! + "\n").repeat(2));
    const duplicate = await checkProject({ cwd: dir }); expect(duplicate.exitCode).toBe(1); expect(duplicate.infractions).toHaveLength(1);
  });
  it("lets a reviewer explicitly inspect findings despite active exceptions", async () => {
    write("auth.test.ts", finding.lineSnippet! + "\n"); policy();
    expect((await checkProject({ cwd: dir, ignoreExceptions: true })).infractions).toHaveLength(1);
    const run = spawnSync((process.env.AGENT_ROAST_TEST_NODE || process.execPath), [cli, "check", dir, "--ignore-exceptions", "--json"], { env, encoding: "utf8" });
    expect(run.status).toBe(1); expect(JSON.parse(run.stdout).suppressedFindings).toEqual([]);
  });
  it("never honors a candidate-only exception in committed or staged reviews", async () => {
    write("README.md", "baseline"); const base = commit();
    write("auth.test.ts", finding.lineSnippet! + "\n"); policy(); git("add", ".");
    const staged = await reviewStagedChanges({ cwd: dir }); expect(staged.exitCode).toBe(1); expect(staged.suppressedFindings).toEqual([]);
    commit(); const result = await reviewChanges({ cwd: dir, base }); expect(result.exitCode).toBe(1); expect(result.policyChanges).toContain(".agentroastrc.json");
  });
  it("uses trusted reviewed policy and preserves duplicate occurrence limits", async () => {
    policy(); const base = commit();
    write("auth.test.ts", (finding.lineSnippet! + "\n").repeat(2)); commit();
    const result = await reviewChanges({ cwd: dir, base, format: "sarif" });
    expect(result.exitCode).toBe(1); expect(result.infractions).toHaveLength(1); expect(result.suppressedFindings).toHaveLength(1);
    const run = JSON.parse(result.output).runs[0]; expect(run.results).toHaveLength(2);
    expect(run.results.filter((r: any) => r.suppressions?.[0].status === "accepted")).toHaveLength(1);
    expect(run.results[0].suppressions[0].justification).toContain(allowance.reason);
    expect(result.output).not.toContain("it.skip('temporary')");
  });
  it("keeps diagnostic identities stable when an exception expires or is ignored", async () => {
    write("auth.test.ts", (finding.lineSnippet! + "\n").repeat(2)); policy();
    const accepted = JSON.parse((await checkProject({ cwd: dir, format: "sarif" })).output).runs[0].results;
    const visible = JSON.parse((await checkProject({ cwd: dir, ignoreExceptions: true, format: "sarif" })).output).runs[0].results;
    const identities = (results: any[]) => results.map(row => [row.locations[0].physicalLocation.region.startLine, row.partialFingerprints]);
    expect(identities(accepted)).toEqual(identities(visible));
    writeBaseline(path.join(dir, "baseline.json"), [finding]);
    const baseline = JSON.parse((await checkProject({ cwd: dir, baseline: "baseline.json", format: "sarif" })).output).runs[0].results;
    expect(baseline[0].partialFingerprints).toEqual(visible[1].partialFingerprints);
  });
  it("does not reuse an existing occurrence allowance to hide new duplicate debt in review", async () => {
    write("auth.test.ts", finding.lineSnippet! + "\n"); policy(); const base = commit();
    write("auth.test.ts", (finding.lineSnippet! + "\n").repeat(2)); commit();
    const result = await reviewChanges({ cwd: dir, base });
    expect(result.unchangedCount).toBe(1); expect(result.exitCode).toBe(1);
    expect(result.suppressedFindings).toHaveLength(0); expect(result.infractions).toHaveLength(1);
  });
  it("does not stack baseline and exception approvals to silently accept duplicate findings", async () => {
    write("auth.test.ts", finding.lineSnippet! + "\n");
    const initial = await checkProject({ cwd: dir }); writeBaseline(path.join(dir, "baseline.json"), initial.infractions);
    policy(); write("auth.test.ts", (finding.lineSnippet! + "\n").repeat(2));
    const result = await checkProject({ cwd: dir, baseline: "baseline.json" });
    expect(result.exitCode).toBe(1); expect(result.baselineCount).toBe(1);
    expect(result.suppressedFindings).toHaveLength(0); expect(result.infractions).toHaveLength(1);
  });
  it("reopens expired exceptions and reports their count", async () => {
    write("auth.test.ts", finding.lineSnippet! + "\n"); policy({ ...allowance, expires: "2000-01-01" });
    const result = await checkProject({ cwd: dir }); expect(result.exitCode).toBe(1); expect(result.expiredExceptionCount).toBe(1);
  });
});
