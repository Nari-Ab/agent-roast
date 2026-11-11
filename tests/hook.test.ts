import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { formatAgentFeedback, hookPausedUntil, parseDuration, pauseHook, resumeHook, runHook } from "../src/hook.js";
import { reviewWorktreeChanges } from "../src/review.js";

let dir: string;
const cli = path.resolve("dist/cli.js");
const node = process.env.AGENT_ROAST_TEST_NODE || process.execPath;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const TEST = "import { add } from './calc';\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n";
const weaken = () => write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()"));
const stop = (extra: Record<string, unknown> = {}) => JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false, session_id: "s", cwd: dir, ...extra });
const cursorStop = (extra: Record<string, unknown> = {}) => JSON.stringify({ hook_event_name: "stop", status: "completed", loop_count: 0, conversation_id: "c", workspace_roots: [dir], ...extra });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-hook-"));
  git("init", "-b", "main"); git("config", "user.name", "Dev"); git("config", "user.email", "dev@example.invalid"); git("config", "commit.gpgsign", "false");
  write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", TEST);
  git("add", "."); git("commit", "-m", "base");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("the Stop hook", () => {
  it("sends Claude Code back once, with what to undo", async () => {
    weaken();
    const outcome = await runHook(stop(), { env: {} });
    expect(outcome).toMatchObject({ action: "block", exitCode: 0, stderr: "" });
    const answer = JSON.parse(outcome.stdout);
    expect(Object.keys(answer)).toEqual(["decision", "reason"]);
    expect(answer.decision).toBe("block");
    expect(answer.reason).toContain("calc.test.ts:2 [assertion-weakened]");
    expect(answer.reason).toContain("toBe(4) → expect(add(2, 2)).toBeDefined()");
    expect(answer.reason).toMatch(/Do not skip, delete, loosen or silence/);
    expect(answer.reason).toMatch(/ask the user to approve/);
  });

  it("does not block an agent that already had its chance; it tells the person instead", async () => {
    weaken();
    const outcome = await runHook(stop({ stop_hook_active: true }), { env: {} });
    expect(outcome.action).toBe("warn");
    const answer = JSON.parse(outcome.stdout);
    expect(answer.decision).toBeUndefined();
    expect(answer.systemMessage).toMatch(/finished with 1 change that weakens checks \(assertion-weakened\).*calc\.test\.ts:2/);
  });

  it("speaks Cursor's dialect: a follow-up message, once", async () => {
    weaken();
    const first = await runHook(cursorStop(), { env: {} });
    expect(first.action).toBe("block");
    expect(JSON.parse(first.stdout)).toEqual({ followup_message: expect.stringContaining("[assertion-weakened]") });
    expect((await runHook(cursorStop({ loop_count: 1 }), { env: {} })).stdout).toBe("{}\n");
    expect((await runHook(cursorStop({ status: "aborted" }), { env: {} })).action).toBe("skip");
  });

  it("answers Codex like Claude Code, whose Stop dialect it shares", async () => {
    weaken();
    const outcome = await runHook(JSON.stringify({ hook_event_name: "Stop", turn_id: "t", model: "m", session_id: "s", cwd: dir, stop_hook_active: false, permission_mode: "default", transcript_path: null, last_assistant_message: "done" }), { env: {} });
    expect(JSON.parse(outcome.stdout).decision).toBe("block");
  });

  it("says nothing when the checks are intact, so the agent finishes quietly", async () => {
    const claude = await runHook(stop(), { env: {} });
    expect(claude).toMatchObject({ action: "pass", stdout: "", exitCode: 0 });
    expect((await runHook(cursorStop(), { env: {} })).stdout).toBe("{}\n");
  });

  it("in advisory mode only tells the person: the agent is never sent back, on the option or the environment", async () => {
    weaken();
    for (const outcome of [await runHook(stop(), { env: {}, advisory: true }), await runHook(stop(), { env: { AGENT_ROAST_HOOK: "advisory" } }), await runHook(stop(), { env: { AGENT_ROAST_HOOK: "Advisory" } })]) {
      expect(outcome).toMatchObject({ action: "warn", exitCode: 0, stderr: "" });
      const answer = JSON.parse(outcome.stdout);
      expect(answer.decision).toBeUndefined();
      expect(answer.systemMessage).toMatch(/finished with 1 change that weakens checks \(assertion-weakened\).*calc\.test\.ts:2/);
    }
    expect((await runHook(stop(), { env: {}, advisory: true })).result?.failedRules).toEqual(["assertion-weakened"]);
  });

  it("in advisory mode says nothing when the checks are intact, and still honors the off switch", async () => {
    expect(await runHook(stop(), { env: {}, advisory: true })).toMatchObject({ action: "pass", stdout: "" });
    weaken();
    expect((await runHook(stop(), { env: { AGENT_ROAST_HOOK: "off" }, advisory: true })).action).toBe("skip");
  });

  it("in advisory mode Cursor gets an empty answer and the warning goes to the hook's log", async () => {
    weaken();
    const outcome = await runHook(cursorStop(), { env: {}, advisory: true });
    expect(outcome).toMatchObject({ action: "warn", stdout: "{}\n", exitCode: 0 });
    expect(outcome.stderr).toMatch(/agent-roast: the agent finished with 1 change that weakens checks.*calc\.test\.ts:2/);
  });

  it("only blocks on rules that block by default; warnings alone let the agent finish", async () => {
    write("calc.test.ts", "import { add } from './calc';\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n");
    const outcome = await runHook(stop(), { env: {} });
    expect(outcome.result?.infractions.map(finding => finding.type)).toEqual(["assertion-removed"]);
    expect(outcome.action).toBe("pass");
  });

  it("never gets in the agent's way: bad input, other events, the off switch and a non-repository all let it finish", async () => {
    weaken();
    expect(await runHook("not json", { env: {} })).toMatchObject({ action: "skip", exitCode: 0, stdout: "" });
    expect((await runHook(stop({ hook_event_name: "SubagentStop" }), { env: {} })).action).toBe("skip");
    expect((await runHook(stop(), { env: { AGENT_ROAST_HOOK: "off" } })).action).toBe("skip");
    const outside = fs.mkdtempSync(path.join(tmpdir(), "roast-hook-outside-"));
    try {
      const outcome = await runHook(stop({ cwd: outside }), { env: { GIT_CEILING_DIRECTORIES: path.dirname(outside) } });
      expect(outcome).toMatchObject({ action: "skip", exitCode: 0, stdout: "" });
      expect(outcome.stderr).toMatch(/could not check the working tree/);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it("gives up quietly when the review takes too long", async () => {
    weaken();
    const outcome = await runHook(stop(), { env: {}, timeoutMs: 0 });
    expect(outcome).toMatchObject({ action: "skip", exitCode: 0, stdout: "" });
    expect(outcome.stderr).toMatch(/cancelled/);
  });

  it("can be paused for a while by the person, and resumed", async () => {
    weaken();
    const now = new Date();
    await pauseHook(dir, new Date(now.getTime() + 60_000));
    expect(await hookPausedUntil(dir, now)).toBeInstanceOf(Date);
    expect((await runHook(stop(), { env: {}, now })).action).toBe("skip");
    expect(await resumeHook(dir)).toBe(true);
    expect(await resumeHook(dir)).toBe(false);
    expect((await runHook(stop(), { env: {} })).action).toBe("block");
    await pauseHook(dir, new Date(now.getTime() - 1000));
    expect(await hookPausedUntil(dir, now)).toBeNull();
  });

  it("parses pause durations", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    for (const bad of ["", "0h", "soon", "5", "1w"]) expect(() => parseDuration(bad)).toThrow(/duration/);
  });

  it("keeps the feedback short and lists the worst findings first", async () => {
    write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()") + Array.from({ length: 9 }, (_, i) => `it.skip('later ${i}', () => {});\n`).join(""));
    const result = await reviewWorktreeChanges({ cwd: dir });
    const message = formatAgentFeedback(result);
    expect(message).toMatch(/… and 4 more\./);
    expect(message.split("\n").filter(line => /^\d+\. /.test(line))).toHaveLength(6);
    expect(message.length).toBeLessThan(2500);
  });

  it("works as a command: JSON in, JSON out, always exit 0", () => {
    weaken();
    const run = (input: string, ...args: string[]) => spawnSync(node, [cli, "hook", "run", ...args], { input, encoding: "utf8", env, cwd: dir });
    const blocked = run(stop(), "--agent", "claude");
    expect(blocked.status).toBe(0);
    expect(JSON.parse(blocked.stdout).decision).toBe("block");
    const detected = run(cursorStop());
    expect(JSON.parse(detected.stdout)).toHaveProperty("followup_message");
    // Exit status 2 would tell an agent to block, so a setup mistake must not use it.
    expect(run("{}", "--agent", "nobody").status).toBe(1);
    git("checkout", "--", "calc.test.ts");
    expect(run(stop(), "--agent", "claude")).toMatchObject({ status: 0, stdout: "" });
  });

  it("works as a command in advisory mode: a warning for the person and exit 0", () => {
    weaken();
    const advisory = spawnSync(node, [cli, "hook", "run", "--agent", "claude", "--advisory"], { input: stop(), encoding: "utf8", env, cwd: dir });
    expect(advisory.status).toBe(0);
    expect(JSON.parse(advisory.stdout)).toEqual({ systemMessage: expect.stringContaining("weakens checks (assertion-weakened)") });
    const viaEnvironment = spawnSync(node, [cli, "hook", "run", "--agent", "claude"], { input: stop(), encoding: "utf8", env: { ...env, AGENT_ROAST_HOOK: "advisory" }, cwd: dir });
    expect(JSON.parse(viaEnvironment.stdout).decision).toBeUndefined();
  });
});
