import path from "path";
import * as fs from "fs/promises";
import { ConfigError } from "./config.js";
import { gitOutputPath } from "./git.js";
import { isCheckRule, mostImportantFirst, terminalText } from "./renderer.js";
import { reviewWorktreeChanges } from "./review.js";
import { readGit } from "./snapshot.js";
import type { Infraction, ReviewResult } from "./types.js";

/** Coding agents that can run a command when they are about to finish and feed its answer back. */
export type HookAgent = "claude" | "codex" | "cursor" | "gemini" | "copilot" | "droid" | "kiro" | "antigravity";
export const HOOK_AGENTS: readonly HookAgent[] = ["claude", "codex", "cursor", "gemini", "copilot", "droid", "kiro", "antigravity"];

export interface HookOptions {
  /** Which agent is calling. Detected from its input when omitted. */
  agent?: HookAgent;
  /** Repository to review. Defaults to the directory the agent reports. */
  cwd?: string;
  /** Only tell the person: the agent is never sent back. AGENT_ROAST_HOOK=advisory does the same. */
  advisory?: boolean;
  env?: NodeJS.ProcessEnv;
  /** The agent is waiting, so a slow review gives up and lets it finish. */
  timeoutMs?: number;
  now?: Date;
}

export interface HookOutcome {
  /** pass: nothing to say; block: the agent was sent back; warn: the user is told, the agent is not; skip: nothing could be checked. */
  action: "pass" | "block" | "warn" | "skip";
  stdout: string;
  stderr: string;
  exitCode: number;
  result?: ReviewResult;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const PAUSE_FILE = "agent-roast-hook-paused";
const LISTED = 6;
const LISTED_WARNINGS = 3;

/** Cursor identifies its workspace, Gemini CLI's AfterAgent input carries the final text of the model, Antigravity CLI's Stop input has `conversationId`/`fullyIdle`;
 * Claude Code and Codex use the same JSON dialect for Stop hooks, and so do GitHub Copilot (registered under `Stop`, its VS Code-compatible event) and Factory Droid:
 * their hook files always say which agent is calling, because nothing in that input does. Kiro's Stop input is undocumented beyond the fields it shares with Claude
 * Code's own, so it is not sniffed either: `hook install` always writes `--agent kiro` into the command it installs. */
function detectAgent(input: Record<string, unknown>): HookAgent {
  if ("workspace_roots" in input || "cursor_version" in input || "conversation_id" in input) return "cursor";
  if (input.hook_event_name === "AfterAgent" || "prompt_response" in input) return "gemini";
  if ("conversationId" in input || "fullyIdle" in input) return "antigravity";
  if ("turn_id" in input) return "codex";
  return "claude";
}

function inputCwd(agent: HookAgent, input: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  const roots = input.workspace_roots;
  if (agent === "cursor" && Array.isArray(roots) && typeof roots[0] === "string") return roots[0];
  // Antigravity CLI's Stop input has no single `cwd`, only the mounted workspace directories.
  if (agent === "antigravity" && Array.isArray(input.workspacePaths) && typeof input.workspacePaths[0] === "string") return input.workspacePaths[0];
  if (typeof input.cwd === "string" && input.cwd) return input.cwd;
  return env.CLAUDE_PROJECT_DIR || env.CURSOR_PROJECT_DIR || env.GEMINI_PROJECT_DIR || env.FACTORY_PROJECT_DIR || env.KIRO_PROJECT_DIR || env.ANTIGRAVITY_PROJECT_DIR || process.cwd();
}

function clip(text: string, limit: number): string {
  const flat = terminalText(text).replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function describe(finding: Infraction, index: number): string[] {
  const where = finding.file ? `${terminalText(finding.file)}${finding.lineNumber ? `:${finding.lineNumber}` : ""}` : "unknown location";
  const evidence = clip(finding.lineSnippet || finding.reason, 220);
  return [`${index}. ${where} [${finding.type}]`, `   ${evidence}`];
}

/**
 * What the agent reads when it is sent back: the offending changes, then the instruction to fix the code rather than the
 * checks. Short on purpose, since it is added to the agent's context. `subject` names what was reviewed.
 */
export function formatAgentFeedback(result: ReviewResult, subject = "the uncommitted changes"): string {
  const ranked = mostImportantFirst(result.infractions, result.failedRules);
  const blocking = ranked.filter(finding => result.failedRules.includes(finding.type));
  const notes = ranked.filter(finding => !result.failedRules.includes(finding.type) && isCheckRule(finding.type));
  const lines = [`agent-roast: ${subject} make the checks easier to pass instead of making the code correct.`, ""];
  blocking.slice(0, LISTED).forEach((finding, index) => lines.push(...describe(finding, index + 1)));
  if (blocking.length > LISTED) lines.push(`   … and ${blocking.length - LISTED} more.`);
  if (notes.length) {
    lines.push("", "Also worth a second look (these do not block):");
    notes.slice(0, LISTED_WARNINGS).forEach(finding => lines.push(`- ${describe(finding, 0)[0].slice(3)}: ${clip(finding.lineSnippet || finding.reason, 120)}`));
    if (notes.length > LISTED_WARNINGS) lines.push(`- … and ${notes.length - LISTED_WARNINGS} more.`);
  }
  lines.push("",
    "Make the original checks pass by fixing the code. Do not skip, delete, loosen or silence tests, assertions, coverage gates, type checks or CI steps to get a green run.",
    "If a change to a check is really intended, stop and ask the user to approve it explicitly rather than keeping it quietly.");
  return lines.join("\n");
}

/** One line for the person, used when the agent already had its chance and finished anyway. */
function formatUserWarning(result: ReviewResult): string {
  const blocking = result.infractions.filter(finding => result.failedRules.includes(finding.type));
  const first = blocking[0];
  return `agent-roast: the agent finished with ${blocking.length} change${blocking.length === 1 ? "" : "s"} that weaken${blocking.length === 1 ? "s" : ""} checks (${result.failedRules.join(", ")})` +
    `${first ? `, for example ${terminalText(first.file ?? "unknown")}:${first.lineNumber ?? "?"}` : ""}. Review them before you commit: npx agent-roast review --worktree`;
}

async function gitDirectory(cwd: string, signal?: AbortSignal): Promise<string> {
  return fs.realpath(gitOutputPath((await readGit(cwd, ["rev-parse", "--absolute-git-dir"], signal, 8192)).toString()));
}

/** The time a pause lasts until, or null when the hook is active. Expired pauses are cleaned up. */
export async function hookPausedUntil(cwd: string, now = new Date()): Promise<Date | null> {
  try {
    const file = path.join(await gitDirectory(cwd), PAUSE_FILE);
    const until = new Date((await fs.readFile(file, "utf8")).trim());
    if (!Number.isNaN(until.getTime()) && until > now) return until;
    await fs.rm(file, { force: true });
  } catch { /* not a repository, or no pause file */ }
  return null;
}

export async function pauseHook(cwd: string, until: Date): Promise<string> {
  const file = path.join(await gitDirectory(cwd), PAUSE_FILE);
  await fs.writeFile(file, until.toISOString() + "\n");
  return file;
}

export async function resumeHook(cwd: string): Promise<boolean> {
  const file = path.join(await gitDirectory(cwd), PAUSE_FILE);
  const existed = await fs.stat(file).then(() => true, () => false);
  await fs.rm(file, { force: true });
  return existed;
}

/** "30m", "2h", "1d": how long a pause lasts. */
export function parseDuration(text: string): number {
  const match = /^(\d+)\s*([mhd])$/i.exec(text.trim());
  if (!match || Number(match[1]) < 1) throw new ConfigError("Use a duration such as 30m, 2h or 1d.");
  return Number(match[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase() as "m" | "h" | "d"];
}

// Every dialect but Kiro's reads a JSON decision on stdout, whatever the exit code; exit 0 only ever means "this tool itself did not crash". Kiro reads no JSON at all:
// an exit of 0 adds its stdout to the agent's context, and any other exit sends its stderr to the agent as an error notice, so Kiro alone needs a real exit code.
const outcome = (action: HookOutcome["action"], stdout = "", stderr = "", result?: ReviewResult, exitCode = 0): HookOutcome => ({ action, stdout, stderr, exitCode, result });

/**
 * The command an agent runs when it is about to finish. It reviews everything uncommitted against HEAD and, when that
 * weakens the checks, sends the agent back once with a plain account of what to undo. It never fails the agent's run:
 * anything it cannot check lets the agent finish, and an agent that already had its chance is not blocked a second time,
 * so the person decides instead of the two looping. In advisory mode the agent is never sent back at all.
 */
export async function runHook(rawInput: string, options: HookOptions = {}): Promise<HookOutcome> {
  const env = options.env ?? process.env;
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = rawInput.trim() ? JSON.parse(rawInput) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
  } catch {
    return outcome("skip", "", "agent-roast hook: input was not JSON; nothing was checked.\n");
  }
  const mode = (env.AGENT_ROAST_HOOK ?? "").toLowerCase();
  if (["off", "0", "false"].includes(mode)) return outcome("skip");
  const advisory = options.advisory === true || mode === "advisory";
  const agent = options.agent ?? detectAgent(input);
  // The event that fires when the agent is about to finish: `Stop` for Claude Code and Codex, `stop` for Cursor, `AfterAgent` for Gemini CLI.
  const finishing = agent === "gemini" ? "afteragent" : "stop";
  if (String(input.hook_event_name ?? finishing).toLowerCase() !== finishing) return outcome("skip");
  if (agent === "cursor" && typeof input.status === "string" && input.status !== "completed") return outcome("skip");

  const cwd = options.cwd ?? inputCwd(agent, input, env);
  if (await hookPausedUntil(cwd, options.now)) return outcome("skip");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let result: ReviewResult;
  try {
    result = await reviewWorktreeChanges({ cwd, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return outcome("skip", "", `agent-roast hook: could not check the working tree (${clip(reason, 200)}); the agent was allowed to finish.\n`);
  } finally {
    clearTimeout(timer);
  }
  if (!result.failedRules.length) {
    const fine = agent === "cursor" || agent === "gemini" ? "{}\n" : agent === "antigravity" ? '{"decision":"stop"}\n' : "";
    return outcome("pass", fine, "", result);
  }

  // Claude Code, Codex, Gemini CLI, GitHub Copilot and Factory Droid set stop_hook_active when the agent is already continuing because of a hook of this kind; Cursor counts follow-ups.
  // Kiro's and Antigravity CLI's documented Stop input has no such field, so on their own neither ever looks "already asked": without --advisory every blocking run sends them back again.
  const alreadyAsked = input.stop_hook_active === true || (typeof input.loop_count === "number" && input.loop_count > 0);
  if (alreadyAsked || advisory) {
    const warning = formatUserWarning(result);
    // Kiro reads stderr as an error notice for the agent only on a non-zero exit, so an exit of 0 with the warning on stderr reaches no one it is documented to reach;
    // like Cursor, it is kept there anyway as a best effort, only when the person asked for advisory mode.
    if (agent === "kiro") return outcome("warn", "", advisory ? `${warning}\n` : "", result);
    // Antigravity CLI's `reason` is only read when `decision` is `"continue"` (which sends the agent back); there is no field for a message meant for the person alone.
    if (agent === "antigravity") return outcome("warn", '{"decision":"stop"}\n', advisory ? `${warning}\n` : "", result);
    // Cursor has no channel for a message to the person, so an advisory warning goes to the hook's log.
    // GitHub Copilot documents no field for a message to the person, only a display-only progress line.
    const notice = agent === "copilot" ? { type: "progress", message: warning } : { systemMessage: warning };
    return outcome("warn", agent === "cursor" ? "{}\n" : JSON.stringify(notice) + "\n", agent === "cursor" && advisory ? `${warning}\n` : "", result);
  }
  const message = formatAgentFeedback(result);
  // Kiro's Stop hook reads no JSON: a non-zero exit sends its stderr to the agent as the reason the hook failed.
  if (agent === "kiro") return outcome("block", "", `${message}\n`, result, 1);
  // Gemini CLI documents `deny` (and accepts `block` as an alias): the reason goes back to the model as a new prompt and the turn is retried.
  // Antigravity CLI inverts the usual naming: `"continue"` is the decision that blocks the stop and re-enters the loop, with `reason` injected as a system message.
  const answer = agent === "cursor" ? { followup_message: message }
    : agent === "antigravity" ? { decision: "continue", reason: message }
    : { decision: agent === "gemini" ? "deny" : "block", reason: message };
  return outcome("block", JSON.stringify(answer) + "\n", "", result);
}
