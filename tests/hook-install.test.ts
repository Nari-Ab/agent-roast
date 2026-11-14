import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { hookCommand, hookConfigPath, hookStatus, installHooks, installInstructions, INSTRUCTIONS_END, INSTRUCTIONS_START, packageVersion, uninstallHooks } from "../src/hook-install.js";

let dir: string;
let home: string;
const cli = path.resolve("dist/cli.js");
const node = process.env.AGENT_ROAST_TEST_NODE || process.execPath;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const read = (...parts: string[]) => JSON.parse(fs.readFileSync(path.join(dir, ...parts), "utf8"));
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "roast-hook-install-")));
  home = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "roast-home-")));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env, stdio: "ignore" });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

describe("installing the agent hook", () => {
  it("pins the running version in the command the agent runs", () => {
    expect(hookCommand("claude")).toBe(`npx --yes agent-roast@${packageVersion()} hook run --agent claude`);
    expect(hookCommand("cursor", "agent-roast")).toBe("agent-roast hook run --agent cursor");
  });

  it("can install the hook in advisory mode, switch it back by installing again, and status tells the two apart", () => {
    expect(hookCommand("claude", undefined, true)).toBe(`npx --yes agent-roast@${packageVersion()} hook run --agent claude --advisory`);
    expect(hookCommand("cursor", "agent-roast", true)).toBe("agent-roast hook run --agent cursor --advisory");
    const [first] = installHooks({ cwd: dir, agents: ["claude"], home, advisory: true });
    expect(first.command).toMatch(/hook run --agent claude --advisory$/);
    expect(read(".claude/settings.json").hooks.Stop[0].hooks[0].command).toMatch(/--advisory$/);
    expect(hookStatus({ cwd: dir, home }).find(row => row.agent === "claude" && row.scope === "project")).toMatchObject({ installed: true, advisory: true });
    const [again] = installHooks({ cwd: dir, agents: ["claude"], home });
    expect(again.action).toBe("updated");
    expect(read(".claude/settings.json").hooks.Stop).toHaveLength(1);
    expect(read(".claude/settings.json").hooks.Stop[0].hooks[0].command).toBe(hookCommand("claude"));
    expect(hookStatus({ cwd: dir, home }).find(row => row.agent === "claude" && row.scope === "project")).toMatchObject({ installed: true, advisory: false });
  });

  it("says so on the command line when the hook only warns", () => {
    const run = (...args: string[]) => spawnSync(node, [cli, "hook", ...args], { cwd: dir, encoding: "utf8", env: { ...env, NO_COLOR: "1" } });
    const installed = run("install", "claude", "--advisory");
    expect(installed.status).toBe(0);
    expect(installed.stdout).toMatch(/Installed the agent-roast hook in advisory mode \(project\)/);
    expect(installed.stdout).toMatch(/hook run --agent claude --advisory/);
    expect(installed.stdout).toMatch(/never sends the agent back|the agent is never sent back/);
    expect(run("status").stdout).toMatch(/installed\s+Claude Code\s+project .*\(advisory: warns, never sends the agent back\)/);
    expect(run("install", "claude").stdout).toMatch(/only warn instead: agent-roast hook install --advisory/);
    expect(run("status").stdout).not.toMatch(/advisory/);
  });

  it("adds a Claude Code Stop hook to the project settings, keeping everything else", () => {
    write(".claude/settings.json", JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }], PostToolUse: [{ matcher: "Edit", hooks: [] }] } }, null, 4));
    const [change] = installHooks({ cwd: dir, agents: ["claude"], home });
    expect(change).toMatchObject({ agent: "claude", scope: "project", action: "updated", file: path.join(dir, ".claude/settings.json") });
    const settings = read(".claude/settings.json");
    expect(settings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[1]).toEqual({ hooks: [{ type: "command", command: hookCommand("claude"), timeout: 60 }] });
    expect(fs.readFileSync(path.join(dir, ".claude/settings.json"), "utf8")).toMatch(/^ {4}"permissions"/m);
  });

  it("is idempotent and refreshes the pinned version in place", () => {
    installHooks({ cwd: dir, agents: ["claude"], home });
    expect(installHooks({ cwd: dir, agents: ["claude"], home })[0].action).toBe("unchanged");
    const older = read(".claude/settings.json");
    older.hooks.Stop[0].hooks[0].command = "npx --yes agent-roast@0.1.0 hook run --agent claude";
    write(".claude/settings.json", JSON.stringify(older));
    expect(installHooks({ cwd: dir, agents: ["claude"], home })[0].action).toBe("updated");
    const settings = read(".claude/settings.json");
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(hookCommand("claude"));
  });

  it("writes Gemini CLI's own format: an AfterAgent group with a name, a matcher and a timeout in milliseconds, and keeps the rest of the settings", () => {
    expect(hookCommand("gemini")).toBe(`npx --yes agent-roast@${packageVersion()} hook run --agent gemini`);
    write(".gemini/settings.json", JSON.stringify({ theme: "dark", hooks: { BeforeTool: [{ matcher: "write_file", hooks: [{ type: "command", command: "./check.sh" }] }] } }, null, 2));
    const [change] = installHooks({ cwd: dir, agents: ["gemini"], home });
    expect(change).toMatchObject({ agent: "gemini", scope: "project", action: "updated", file: path.join(dir, ".gemini/settings.json") });
    const settings = read(".gemini/settings.json");
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.BeforeTool).toHaveLength(1);
    expect(settings.hooks.AfterAgent).toEqual([{ matcher: "*", hooks: [{ name: "agent-roast", type: "command", command: hookCommand("gemini"), timeout: 60000 }] }]);
    expect(installHooks({ cwd: dir, agents: ["gemini"], home })[0].action).toBe("unchanged");
    expect(hookStatus({ cwd: dir, home }).find(row => row.agent === "gemini" && row.scope === "project")).toMatchObject({ installed: true, advisory: false });
    expect(hookConfigPath("gemini", "global", dir, home)).toBe(path.join(home, ".gemini", "settings.json"));
    expect(() => hookConfigPath("gemini", "local", dir, home)).toThrow(/no hook file that stays out of the repository/);
  });

  it("writes GitHub Copilot's own file: a version, and a flat list under Stop with the timeout in seconds", () => {
    const [change] = installHooks({ cwd: dir, agents: ["copilot"], home });
    expect(change).toMatchObject({ agent: "copilot", scope: "project", action: "created", file: path.join(dir, ".github/hooks/agent-roast.json") });
    expect(read(".github/hooks/agent-roast.json")).toEqual({ version: 1, hooks: { Stop: [{ type: "command", command: hookCommand("copilot"), timeoutSec: 60 }] } });
    expect(installHooks({ cwd: dir, agents: ["copilot"], home })[0].action).toBe("unchanged");
    expect(hookStatus({ cwd: dir, home }).find(row => row.agent === "copilot" && row.scope === "project")).toMatchObject({ installed: true, advisory: false });
    expect(hookConfigPath("copilot", "global", dir, home)).toBe(path.join(home, ".copilot", "hooks", "agent-roast.json"));
    expect(hookConfigPath("copilot", "global", dir, home, { COPILOT_HOME: "/data/copilot" })).toBe(path.join("/data/copilot", "hooks", "agent-roast.json"));
    expect(uninstallHooks({ cwd: dir, agents: ["copilot"], home })[0].action).toBe("removed");
    expect(read(".github/hooks/agent-roast.json")).toEqual({ version: 1 });
  });

  it("writes Factory Droid's hooks.json keyed by event name, keeping its other events", () => {
    write(".factory/hooks.json", JSON.stringify({ PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] }));
    const [change] = installHooks({ cwd: dir, agents: ["droid"], home });
    expect(change).toMatchObject({ agent: "droid", scope: "project", action: "updated", file: path.join(dir, ".factory/hooks.json") });
    const hooks = read(".factory/hooks.json");
    expect(hooks.hooks).toBeUndefined();
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.Stop).toEqual([{ hooks: [{ type: "command", command: hookCommand("droid"), timeout: 60 }] }]);
    expect(installHooks({ cwd: dir, agents: ["droid"], home })[0].action).toBe("unchanged");
    expect(hookStatus({ cwd: dir, home }).find(row => row.agent === "droid" && row.scope === "project")).toMatchObject({ installed: true });
    expect(hookConfigPath("droid", "global", dir, home)).toBe(path.join(home, ".factory", "hooks.json"));
    expect(uninstallHooks({ cwd: dir, agents: ["droid"], home })[0].action).toBe("removed");
    expect(read(".factory/hooks.json")).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] });
  });

  it("writes Kiro's own file: one flat array of hooks, each naming its own trigger, with a string version", () => {
    const [change] = installHooks({ cwd: dir, agents: ["kiro"], home });
    expect(change).toMatchObject({ agent: "kiro", scope: "project", action: "created", file: path.join(dir, ".kiro/hooks/agent-roast.json") });
    expect(read(".kiro/hooks/agent-roast.json")).toEqual({
      version: "v1", hooks: [{ name: "agent-roast", trigger: "Stop", action: { type: "command", command: hookCommand("kiro") }, timeout: 60 }],
    });
    write(".kiro/hooks/other.json", JSON.stringify({ version: "v1", hooks: [{ name: "lint", trigger: "PostFileSave", matcher: "\\.ts$", action: { type: "command", command: "./lint.sh" } }] }));
    expect(installHooks({ cwd: dir, agents: ["kiro"], home })[0].action).toBe("unchanged");
    expect(hookStatus({ cwd: dir, home }).find(row => row.agent === "kiro" && row.scope === "project")).toMatchObject({ installed: true, advisory: false });
    expect(hookConfigPath("kiro", "global", dir, home)).toBe(path.join(home, ".kiro", "hooks", "agent-roast.json"));
    expect(uninstallHooks({ cwd: dir, agents: ["kiro"], home })[0].action).toBe("removed");
    expect(read(".kiro/hooks/agent-roast.json")).toEqual({ version: "v1" });
    expect(read(".kiro/hooks/other.json").hooks).toHaveLength(1);
  });

  it("writes Antigravity CLI's own file: a hook named for this package, with a flat list under Stop and no top-level version", () => {
    write(".agents/hooks.json", JSON.stringify({ "lint-on-save": { enabled: true, PostToolUse: [{ matcher: "write_file", hooks: [{ type: "command", command: "./lint.sh" }] }] } }));
    const [change] = installHooks({ cwd: dir, agents: ["antigravity"], home });
    expect(change).toMatchObject({ agent: "antigravity", scope: "project", action: "updated", file: path.join(dir, ".agents/hooks.json") });
    const hooks = read(".agents/hooks.json");
    expect(hooks.version).toBeUndefined();
    expect(hooks["lint-on-save"].PostToolUse).toHaveLength(1);
    expect(hooks["agent-roast"]).toEqual({ Stop: [{ type: "command", command: hookCommand("antigravity"), timeout: 60 }] });
    expect(installHooks({ cwd: dir, agents: ["antigravity"], home })[0].action).toBe("unchanged");
    expect(hookStatus({ cwd: dir, home }).find(row => row.agent === "antigravity" && row.scope === "project")).toMatchObject({ installed: true });
    expect(hookConfigPath("antigravity", "global", dir, home)).toBe(path.join(home, ".gemini", "config", "hooks.json"));
    expect(uninstallHooks({ cwd: dir, agents: ["antigravity"], home })[0].action).toBe("removed");
    expect(read(".agents/hooks.json")).toEqual({ "lint-on-save": { enabled: true, PostToolUse: [{ matcher: "write_file", hooks: [{ type: "command", command: "./lint.sh" }] }] } });
  });

  it("refreshes a pinned Gemini CLI command in place and removes it again, leaving other hooks", () => {
    installHooks({ cwd: dir, agents: ["gemini"], home });
    const older = read(".gemini/settings.json");
    older.hooks.AfterAgent[0].hooks[0].command = "npx --yes agent-roast@0.1.0 hook run --agent gemini";
    older.hooks.AfterAgent.push({ matcher: "*", hooks: [{ name: "mine", type: "command", command: "echo done" }] });
    write(".gemini/settings.json", JSON.stringify(older));
    expect(installHooks({ cwd: dir, agents: ["gemini"], home })[0].action).toBe("updated");
    expect(read(".gemini/settings.json").hooks.AfterAgent).toHaveLength(2);
    expect(read(".gemini/settings.json").hooks.AfterAgent[0].hooks[0].command).toBe(hookCommand("gemini"));
    expect(uninstallHooks({ cwd: dir, agents: ["gemini"], home })[0].action).toBe("removed");
    expect(read(".gemini/settings.json").hooks.AfterAgent).toEqual([{ matcher: "*", hooks: [{ name: "mine", type: "command", command: "echo done" }] }]);
  });

  it("writes Cursor's and Codex's own formats", () => {
    installHooks({ cwd: dir, agents: ["cursor", "codex"], home });
    expect(read(".cursor/hooks.json")).toEqual({ version: 1, hooks: { stop: [{ command: hookCommand("cursor"), timeout: 60, loop_limit: 2 }] } });
    expect(read(".codex/hooks.json")).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: hookCommand("codex"), timeout: 60 }] }] } });
  });

  it("supports a local Claude Code file and the user-level files", () => {
    installHooks({ cwd: dir, agents: ["claude"], scope: "local", home });
    expect(fs.existsSync(path.join(dir, ".claude/settings.local.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".claude/settings.json"))).toBe(false);
    installHooks({ cwd: dir, agents: ["claude", "cursor", "codex"], scope: "global", home, env: { CODEX_HOME: path.join(home, "codex-home") } });
    expect(fs.existsSync(path.join(home, ".claude/settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".cursor/hooks.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, "codex-home/hooks.json"))).toBe(true);
    expect(() => installHooks({ cwd: dir, agents: ["cursor"], scope: "local", home })).toThrow(/no hook file that stays out of the repository/);
  });

  it("resolves the repository root from a subdirectory", () => {
    fs.mkdirSync(path.join(dir, "packages/app"), { recursive: true });
    const [change] = installHooks({ cwd: path.join(dir, "packages/app"), agents: ["claude"], home });
    expect(change.file).toBe(path.join(dir, ".claude/settings.json"));
  });

  it("leaves a file it cannot parse alone", () => {
    write(".claude/settings.json", "{ // not strict JSON\n}");
    expect(() => installHooks({ cwd: dir, agents: ["claude"], home })).toThrow(/not valid JSON/);
    expect(fs.readFileSync(path.join(dir, ".claude/settings.json"), "utf8")).toBe("{ // not strict JSON\n}");
    write(".claude/settings.json", "[]");
    expect(() => installHooks({ cwd: dir, agents: ["claude"], home })).toThrow(/must contain a JSON object/);
  });

  it("does not write anything on a dry run", () => {
    const [change] = installHooks({ cwd: dir, agents: ["claude"], home, dryRun: true });
    expect(change.action).toBe("created");
    expect(fs.existsSync(path.join(dir, ".claude"))).toBe(false);
  });

  it("removes only its own hook, and the containers that leaves empty", () => {
    write(".claude/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] } }));
    installHooks({ cwd: dir, agents: ["claude", "cursor"], home });
    const removed = uninstallHooks({ cwd: dir, agents: ["claude", "cursor", "codex"], home });
    expect(removed.map(change => [change.agent, change.action])).toEqual([["claude", "removed"], ["cursor", "removed"], ["codex", "absent"]]);
    expect(read(".claude/settings.json")).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] } });
    expect(read(".cursor/hooks.json")).toEqual({ version: 1 });
    expect(uninstallHooks({ cwd: dir, agents: ["claude"], home })[0].action).toBe("absent");
  });

  it("reports where the hook is installed", () => {
    installHooks({ cwd: dir, agents: ["codex", "gemini", "copilot", "droid"], home });
    const rows = hookStatus({ cwd: dir, home });
    expect(rows.filter(row => row.installed).map(row => [row.agent, row.scope])).toEqual([["codex", "project"], ["gemini", "project"], ["copilot", "project"], ["droid", "project"]]);
    expect(rows).toHaveLength(17);
    expect(hookConfigPath("claude", "project", dir, home)).toBe(path.join(dir, ".claude/settings.json"));
  });
});

describe("the keep-the-checks-honest paragraph", () => {
  it("creates AGENTS.md when no instruction file exists, and is idempotent", () => {
    expect(installInstructions({ cwd: dir })).toEqual([{ file: path.join(dir, "AGENTS.md"), action: "created" }]);
    expect(installInstructions({ cwd: dir })[0].action).toBe("unchanged");
    const text = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(text.split(INSTRUCTIONS_START)).toHaveLength(2);
    expect(text).toContain("agent-roast review --worktree");
  });

  it("appends to the files that exist and replaces its own block in place", () => {
    write("CLAUDE.md", "# Project notes\n\nUse pnpm.\n");
    write("AGENTS.md", `Intro\n\n${INSTRUCTIONS_START}\nold text\n${INSTRUCTIONS_END}\n\nOutro\n`);
    const changes = installInstructions({ cwd: dir });
    expect(changes.map(change => [path.basename(change.file), change.action])).toEqual([["AGENTS.md", "updated"], ["CLAUDE.md", "updated"]]);
    const claude = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    expect(claude).toMatch(/^# Project notes\n\nUse pnpm\.\n\n<!-- agent-roast:start -->/);
    const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/^Intro\n\n<!-- agent-roast:start -->\n## Keep the checks honest[\s\S]*<!-- agent-roast:end -->\n\nOutro\n$/);
    expect(agents).not.toContain("old text");
  });
});

describe("hook commands", () => {
  const run = (...args: string[]) => spawnSync(node, [cli, "hook", ...args], { cwd: dir, encoding: "utf8", env: { ...env, HOME: home, USERPROFILE: home, NO_COLOR: "1" } });

  it("installs for the agents that already have a folder, reports it, and uninstalls", () => {
    fs.mkdirSync(path.join(dir, ".claude"));
    const installed = run("install");
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("Claude Code: .claude/settings.json (created)");
    expect(installed.stdout).toContain(hookCommand("claude"));
    expect(run("status").stdout).toMatch(/installed\s+Claude Code\s+project/);
    expect(run("uninstall").stdout).toContain("Claude Code: .claude/settings.json (removed)");
    expect(run("status").stdout).toContain("Install it with: agent-roast hook install");
  });

  it("finds the agent folders at the repository root when run from a subdirectory", () => {
    fs.mkdirSync(path.join(dir, ".cursor")); fs.mkdirSync(path.join(dir, "packages/app"), { recursive: true });
    const result = spawnSync(node, [cli, "hook", "install"], { cwd: path.join(dir, "packages/app"), encoding: "utf8", env: { ...env, HOME: home, USERPROFILE: home, NO_COLOR: "1" } });
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, ".cursor/hooks.json"))).toBe(true);
  });

  it("writes through a symlinked settings file instead of replacing the link", () => {
    if (process.platform === "win32") return;
    const real = path.join(home, "dotfiles-settings.json");
    fs.writeFileSync(real, JSON.stringify({ model: "x" }));
    fs.mkdirSync(path.join(home, ".claude")); fs.symlinkSync(real, path.join(home, ".claude/settings.json"));
    installHooks({ cwd: dir, agents: ["claude"], scope: "global", home });
    expect(fs.lstatSync(path.join(home, ".claude/settings.json")).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(real, "utf8"))).toMatchObject({ model: "x", hooks: { Stop: [expect.anything()] } });
  });

  it("asks which agent when it cannot tell, and rejects unknown ones", () => {
    expect(run("install")).toMatchObject({ status: 2 });
    expect(run("install").stderr).toMatch(/Name the agent to guard/);
    expect(run("install", "emacs").stderr).toMatch(/Unknown agent 'emacs'/);
    expect(run("install", "claude", "--global", "--local").status).toBe(2);
  });

  it("shows a dry run, and mentions Codex's trust step", () => {
    const dry = run("install", "codex", "--dry-run");
    expect(dry.stdout).toContain("Would install");
    expect(dry.stdout).toContain("/hooks");
    expect(fs.existsSync(path.join(dir, ".codex"))).toBe(false);
  });

  it("pauses and resumes", () => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "--allow-empty", "-m", "x"], { cwd: dir, env, stdio: "ignore" });
    expect(run("pause", "--for", "30m").stdout).toMatch(/paused in this repository until/);
    expect(run("status").stdout).toMatch(/Paused in this repository until/);
    expect(run("resume").stdout).toContain("active again");
    expect(run("resume").stdout).toContain("was not paused");
    expect(run("pause", "--for", "soon").status).toBe(2);
  });
});
