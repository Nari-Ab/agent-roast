import * as fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { spawnSync } from "child_process";
import { ConfigError } from "./config.js";
import { getHermeticGitEnv, HERMETIC_GIT_FLAGS, gitOutputPath } from "./git.js";
import type { HookAgent } from "./hook.js";

/** project: shared with the team (committed); local: this checkout only (Claude Code); global: every repository of this user. */
export type HookScope = "project" | "local" | "global";

export interface HookInstallOptions {
  /** Anywhere inside the repository. */
  cwd?: string;
  agents: readonly HookAgent[];
  scope?: HookScope;
  dryRun?: boolean;
  /** Replaces `npx --yes agent-roast@<version>`, for example `agent-roast` when it is installed globally. */
  command?: string;
  /** Install the hook in advisory mode: it warns the person and never sends the agent back. */
  advisory?: boolean;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export interface HookInstallChange {
  agent: HookAgent;
  scope: HookScope;
  file: string;
  action: "created" | "updated" | "unchanged" | "removed" | "absent";
  /** The command line the agent runs. */
  command?: string;
}

export const AGENT_LABELS: Record<HookAgent, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" };
const TIMEOUT_SECONDS = 60;

/** Version of this package, which the hook pins so an agent never runs unreviewed newer code. */
export function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return String(require("../package.json").version);
}

/** The command an agent runs for this agent's Stop event. */
export function hookCommand(agent: HookAgent, command = `npx --yes agent-roast@${packageVersion()}`, advisory = false): string {
  return `${command.trim()} hook run --agent ${agent}${advisory ? " --advisory" : ""}`;
}

const isAdvisory = (command: string | undefined): boolean => Boolean(command && /(^|\s)--advisory(\s|$)/.test(command));

const isOurs = (command: unknown): boolean => typeof command === "string" && /\bagent-roast\b.*\bhook\s+run\b/.test(command);

/** The top level of the repository containing `cwd`, or `cwd` itself outside a repository. */
export function repositoryRoot(cwd: string): string {
  const absolute = fs.realpathSync(path.resolve(cwd));
  const run = spawnSync("git", [...HERMETIC_GIT_FLAGS, "rev-parse", "--show-toplevel"], {
    cwd: absolute, env: { ...getHermeticGitEnv(), LC_ALL: "C" }, encoding: "utf8", timeout: 30_000, maxBuffer: 8192, windowsHide: true,
  });
  return run.status === 0 ? fs.realpathSync(gitOutputPath(run.stdout)) : absolute;
}

/** Where an agent reads its hooks from. */
export function hookConfigPath(agent: HookAgent, scope: HookScope, root: string, home: string, env: NodeJS.ProcessEnv = process.env): string {
  if (scope === "local" && agent !== "claude") throw new ConfigError(`${AGENT_LABELS[agent]} has no hook file that stays out of the repository; use the project file or --global.`);
  const claude = path.join(scope === "global" ? home : root, ".claude");
  if (agent === "claude") return path.join(claude, scope === "local" ? "settings.local.json" : "settings.json");
  if (agent === "cursor") return path.join(scope === "global" ? home : root, ".cursor", "hooks.json");
  return path.join(scope === "global" ? env.CODEX_HOME || path.join(home, ".codex") : path.join(root, ".codex"), "hooks.json");
}

interface JsonFile { data: Record<string, any>; indent: string | number; mode: number | undefined; existed: boolean }

function readJsonFile(file: string): JsonFile {
  let raw: string;
  let mode: number | undefined;
  try {
    mode = fs.statSync(file).mode & 0o777;
    raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, indent: 2, mode: undefined, existed: false };
    throw error;
  }
  if (!raw.trim()) return { data: {}, indent: 2, mode, existed: true };
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { throw new ConfigError(`${file} is not valid JSON, so it was left alone. Fix it, or add the hook by hand (see docs/integrations.md).`); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ConfigError(`${file} must contain a JSON object, so it was left alone.`);
  const indent = /^([ \t]+)"/m.exec(raw)?.[1] ?? 2;
  return { data: data as Record<string, any>, indent, mode, existed: true };
}

function writeJsonFile(link: string, json: JsonFile): void {
  // A settings file kept as a symlink into a dotfiles repository must stay a link: write through it.
  const file = json.existed ? fs.realpathSync(link) : link;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.agent-roast-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(json.data, null, json.indent) + "\n", { mode: json.mode ?? 0o644 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

/** Adds or refreshes this package's Stop hook in an agent's file. Returns whether the data changed. */
function addStopHook(agent: HookAgent, data: Record<string, any>, command: string): boolean {
  const before = JSON.stringify(data);
  data.hooks = data.hooks && typeof data.hooks === "object" && !Array.isArray(data.hooks) ? data.hooks : {};
  if (agent === "cursor") {
    data.version ??= 1;
    const handlers = asArray(data.hooks.stop);
    const ours = handlers.find(handler => isOurs(handler?.command));
    if (ours) ours.command = command;
    else handlers.push({ command, timeout: TIMEOUT_SECONDS, loop_limit: 2 });
    data.hooks.stop = handlers;
  } else {
    const groups = asArray(data.hooks.Stop);
    const ours = groups.flatMap(group => asArray(group?.hooks)).find(handler => isOurs(handler?.command));
    if (ours) ours.command = command;
    else groups.push({ hooks: [{ type: "command", command, timeout: TIMEOUT_SECONDS }] });
    data.hooks.Stop = groups;
  }
  return JSON.stringify(data) !== before;
}

/** Removes this package's Stop hook, and the containers it leaves empty. Returns whether anything was removed. */
function removeStopHook(agent: HookAgent, data: Record<string, any>): boolean {
  const before = JSON.stringify(data);
  const hooks = data.hooks;
  if (!hooks || typeof hooks !== "object") return false;
  if (agent === "cursor") {
    const kept = asArray(hooks.stop).filter(handler => !isOurs(handler?.command));
    if (kept.length) hooks.stop = kept; else delete hooks.stop;
  } else {
    const groups = asArray(hooks.Stop).map(group => ({ ...group, hooks: asArray(group?.hooks).filter(handler => !isOurs(handler?.command)) }));
    const kept = groups.filter(group => group.hooks.length);
    if (kept.length) hooks.Stop = kept; else delete hooks.Stop;
  }
  if (!Object.keys(hooks).length) delete data.hooks;
  return JSON.stringify(data) !== before;
}

function context(options: Pick<HookInstallOptions, "cwd" | "scope" | "home" | "env">) {
  return { root: repositoryRoot(options.cwd ?? "."), scope: options.scope ?? "project", home: options.home ?? os.homedir(), env: options.env ?? process.env };
}

export function installHooks(options: HookInstallOptions): HookInstallChange[] {
  const { root, scope, home, env } = context(options);
  return options.agents.map(agent => {
    const file = hookConfigPath(agent, scope, root, home, env);
    const command = hookCommand(agent, options.command, options.advisory);
    const json = readJsonFile(file);
    const changed = addStopHook(agent, json.data, command);
    if (changed && !options.dryRun) writeJsonFile(file, json);
    return { agent, scope, file, command, action: !json.existed ? "created" : changed ? "updated" : "unchanged" } as HookInstallChange;
  });
}

export function uninstallHooks(options: Omit<HookInstallOptions, "command">): HookInstallChange[] {
  const { root, scope, home, env } = context(options);
  return options.agents.map(agent => {
    const file = hookConfigPath(agent, scope, root, home, env);
    const json = readJsonFile(file);
    const removed = json.existed && removeStopHook(agent, json.data);
    if (removed && !options.dryRun) writeJsonFile(file, json);
    return { agent, scope, file, action: removed ? "removed" : "absent" } as HookInstallChange;
  });
}

/** Where the hook is installed right now, for every agent and scope that can hold one. */
export function hookStatus(options: Pick<HookInstallOptions, "cwd" | "home" | "env">): (HookInstallChange & { installed: boolean; advisory: boolean })[] {
  const { root, home, env } = context({ ...options, scope: "project" });
  const rows: (HookInstallChange & { installed: boolean; advisory: boolean })[] = [];
  for (const agent of ["claude", "codex", "cursor"] as const) {
    for (const scope of ["project", "local", "global"] as const) {
      if (scope === "local" && agent !== "claude") continue;
      const file = hookConfigPath(agent, scope, root, home, env);
      let command: string | undefined;
      try {
        const data = readJsonFile(file).data;
        const handlers = agent === "cursor" ? asArray(data.hooks?.stop) : asArray(data.hooks?.Stop).flatMap(group => asArray(group?.hooks));
        command = handlers.map(handler => handler?.command).find(isOurs);
      } catch { /* an unreadable file is reported as not installed */ }
      rows.push({ agent, scope, file, command, installed: Boolean(command), advisory: isAdvisory(command), action: command ? "unchanged" : "absent" });
    }
  }
  return rows;
}

export const INSTRUCTIONS_START = "<!-- agent-roast:start -->";
export const INSTRUCTIONS_END = "<!-- agent-roast:end -->";
export const INSTRUCTIONS_BLOCK = `${INSTRUCTIONS_START}
## Keep the checks honest

When a test, type check, linter or CI step fails, fix the code. Do not make the build green by skipping or deleting tests,
weakening assertions, lowering coverage thresholds, switching off \`strict\`, or letting a CI step fail. If you think a check
is wrong, say so and ask before changing it. Before you finish, run \`npx agent-roast review --worktree\`: it lists uncommitted
changes that weaken the checks.
${INSTRUCTIONS_END}
`;

/** Writes the guidance into AGENTS.md and CLAUDE.md (whichever exist; AGENTS.md is created when neither does). Idempotent. */
export function installInstructions(options: { cwd?: string; dryRun?: boolean } = {}): { file: string; action: "created" | "updated" | "unchanged" }[] {
  const root = repositoryRoot(options.cwd ?? ".");
  const existing = ["AGENTS.md", "CLAUDE.md"].filter(name => fs.existsSync(path.join(root, name)));
  return (existing.length ? existing : ["AGENTS.md"]).map(name => {
    const file = path.join(root, name);
    const exists = fs.existsSync(file);
    const text = exists ? fs.readFileSync(file, "utf8") : "";
    const start = text.indexOf(INSTRUCTIONS_START);
    const end = text.indexOf(INSTRUCTIONS_END);
    let next: string;
    if (start >= 0 && end > start) next = text.slice(0, start) + INSTRUCTIONS_BLOCK.trimEnd() + text.slice(end + INSTRUCTIONS_END.length);
    else next = text + (text && !text.endsWith("\n\n") ? (text.endsWith("\n") ? "\n" : "\n\n") : "") + INSTRUCTIONS_BLOCK;
    if (next === text) return { file, action: "unchanged" as const };
    if (!options.dryRun) fs.writeFileSync(file, next);
    return { file, action: exists ? "updated" as const : "created" as const };
  });
}
