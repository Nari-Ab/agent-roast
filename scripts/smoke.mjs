#!/usr/bin/env node
// Smoke test of the built CLI on any operating system: the commands a new user runs first, in a disposable repository.
// Usage: node scripts/smoke.mjs [dist/cli.js]
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = path.resolve(process.argv[2] || "dist/cli.js");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-roast-smoke-")));
// An empty file is a portable "no global Git configuration" (a device name is not, on every system).
const gitConfig = path.join(workspace, "empty-gitconfig");
fs.writeFileSync(gitConfig, "");
const env = { ...process.env, HOME: workspace, USERPROFILE: workspace, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1", NO_COLOR: "1" };
for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"].includes(key)) delete env[key];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: repo, env, encoding: "utf8", timeout: 60_000, ...options });
  if (result.error) throw result.error;
  return result;
};
const git = (...args) => { const result = run("git", args); assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`); return result.stdout.trim(); };
const roast = (...args) => run(process.execPath, [cli, ...args]);
const write = (file, text) => { const destination = path.join(repo, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, text); };
const step = (name, check) => { check(); console.log(`ok  ${name}`); };

const TEST = "import { add } from './calc';\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n";
const repo = path.join(workspace, "project");
fs.mkdirSync(repo);

try {
  git("init", "-b", "main"); git("config", "user.name", "Smoke"); git("config", "user.email", "smoke@example.invalid"); git("config", "commit.gpgsign", "false");
  write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", TEST);
  git("add", "-A"); git("commit", "-m", "base");

  step("demo runs without a repository of its own", () => {
    const result = run(process.execPath, [cli, "demo"], { cwd: workspace });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /working tree review: BLOCKED/);
    assert.match(result.stdout, /\[guard-weakened\] vitest\.config\.ts/);
  });

  step("a clean tree is not an error", () => {
    const result = roast("review", "--worktree");
    assert.equal(result.status, 0, result.stderr);
  });

  write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()"));

  step("the bare command blocks an uncommitted weakened assertion", () => {
    const result = roast();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /\[assertion-weakened\] calc\.test\.ts:2/);
    assert.equal(roast("--advisory").status, 0);
  });

  step("review --worktree reports JSON and leaves the repository alone", () => {
    const before = git("status", "--porcelain");
    const result = roast("review", "--worktree", "--json");
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).source, "worktree");
    assert.equal(git("status", "--porcelain"), before);
    assert.deepEqual(fs.readdirSync(path.join(repo, ".git")).filter(name => name.startsWith("agent-roast-")), []);
  });

  step("the agent hook sends Claude Code back, and Cursor too", () => {
    const input = JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false, cwd: repo, session_id: "smoke" });
    const blocked = run(process.execPath, [cli, "hook", "run", "--agent", "claude"], { input });
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).decision, "block");
    const cursor = run(process.execPath, [cli, "hook", "run"], { input: JSON.stringify({ hook_event_name: "stop", status: "completed", loop_count: 0, conversation_id: "c", workspace_roots: [repo] }) });
    assert.match(JSON.parse(cursor.stdout).followup_message, /assertion-weakened/);
  });

  step("hook install writes the agent's settings, status sees them, uninstall removes them", () => {
    assert.equal(roast("hook", "install", "claude").status, 0);
    const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"));
    assert.match(settings.hooks.Stop[0].hooks[0].command, /agent-roast@\S+ hook run --agent claude/);
    assert.match(roast("hook", "status").stdout, /installed\s+Claude Code\s+project/);
    assert.equal(roast("hook", "uninstall", "claude").status, 0);
    assert.doesNotMatch(roast("hook", "status").stdout, /installed\s+Claude Code/);
  });

  step("the MCP server answers a client with the same findings", () => {
    const messages = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "review_worktree", arguments: {} } },
    ];
    const result = run(process.execPath, [cli, "mcp"], { input: messages.map(message => JSON.stringify(message)).join("\n") + "\n", env: { ...env, CLAUDE_PROJECT_DIR: "", CURSOR_PROJECT_DIR: "" } });
    assert.equal(result.status, 0, result.stderr);
    const answers = result.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
    assert.equal(answers.length, 3);
    assert.equal(answers[0].result.serverInfo.name, "agent-roast");
    assert.equal(answers[1].result.tools.length, 3);
    assert.match(answers[2].result.content[0].text, /calc\.test\.ts:2 \[assertion-weakened\]/);
  });

  step("the staged review and the replay agree with it", () => {
    git("add", "calc.test.ts");
    assert.equal(roast("review", "--staged").status, 1);
    git("commit", "-m", "make it green");
    const replay = roast("replay");
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stdout, /make it green/);
  });

  console.log("smoke ok");
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
