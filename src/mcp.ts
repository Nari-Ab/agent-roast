import * as fs from "fs/promises";
import path from "path";
import readline from "readline";
import type { Readable, Writable } from "stream";
import { gitOutputPath } from "./git.js";
import { formatAgentFeedback, runHook } from "./hook.js";
import { isCheckRule, terminalText } from "./renderer.js";
import { reviewChanges, reviewWorktreeChanges } from "./review.js";
import { readGit } from "./snapshot.js";
import type { ReviewResult } from "./types.js";

/**
 * A small MCP server over stdio, so any agent that speaks MCP can ask "did my changes weaken a check?" before it says it is
 * done. It is read-only and offline like the rest of agent-roast, and written without a dependency on purpose: the built files
 * contain no network code, which a test checks. It answers both protocol eras: the initialize handshake of 2025-11-25 and
 * earlier, and the per-request metadata of 2026-07-28 (modelcontextprotocol.io/specification/2026-07-28/basic/versioning).
 */

type RpcId = string | number;
type RpcResponse = { jsonrpc: "2.0"; id: RpcId | null } & ({ result: unknown } | { error: { code: number; message: string; data?: unknown } });

const MODERN_VERSIONS = ["2026-07-28"];
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const TOOL_TIMEOUT_MS = 25_000;
const CACHE_MS = 3_600_000;
const MAX_TEXT = 6_000;
const LISTED_NOTES = 3;

const INSTRUCTIONS =
  "Call review_worktree before you tell the user a task is done. It compares your uncommitted changes with HEAD and reports any test, " +
  "assertion, coverage threshold, lint rule or CI step that was made weaker instead of fixing the code. If it reports findings, fix the " +
  "code and leave the checks as they were; if a change to a check is really intended, ask the user first.";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const PATH_SCHEMA = { type: "string", description: "A directory inside the project. Defaults to the project the server was started in." } as const;

export const MCP_TOOLS = [
  {
    name: "review_worktree",
    title: "Review uncommitted changes",
    description: "Compare everything not committed yet (staged, unstaged and untracked files) with HEAD and report changes that make tests, assertions, " +
      "coverage thresholds, lint rules or CI easier to pass instead of fixing the code. Read-only and offline: nothing is run, written or sent.",
    inputSchema: { type: "object", properties: { path: PATH_SCHEMA }, additionalProperties: false },
    annotations: { title: "Review uncommitted changes", ...READ_ONLY },
  },
  {
    name: "review_changes",
    title: "Review a range of commits",
    description: "Compare two committed revisions, for example a branch against main, and report changes that weaken tests, assertions, coverage " +
      "thresholds, lint rules or CI. The rules come from the base revision, so the change under review cannot switch them off. Read-only and offline.",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string", description: "The revision to compare against, for example main or origin/main." },
        head: { type: "string", description: "The revision under review. Defaults to HEAD." },
        path: PATH_SCHEMA,
      },
      required: ["base"],
      additionalProperties: false,
    },
    annotations: { title: "Review a range of commits", ...READ_ONLY },
  },
  {
    name: "stop_hook",
    title: "Stop hook adapter",
    description: "Runs the same check as `agent-roast hook run` for plugin hooks of type mcp_tool and answers with the hook's JSON: it sends an agent " +
      "back once when its changes weaken checks. Meant to be called by a hook, not by hand.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: PATH_SCHEMA,
        stop_hook_active: { type: "string", description: "\"true\" when the agent is already continuing because of a Stop hook." },
        loop_count: { type: "string", description: "How many times the agent was already sent back, for agents that count." },
      },
      additionalProperties: true,
    },
    annotations: { title: "Stop hook adapter", ...READ_ONLY },
  },
] as const;

class ToolInputError extends Error {}

export interface McpServerOptions {
  /** The version reported to clients. */
  version: string;
  /** Directories the tools may read. Defaults to the project the server was started in. */
  roots?: string[];
  /** The project directory when the server was started; defaults to CLAUDE_PROJECT_DIR, CURSOR_PROJECT_DIR, then the working directory. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** How long one tool call may take before it is stopped. */
  timeoutMs?: number;
}

export interface McpServer {
  /** Answers one JSON-RPC message (or a batch), or nothing for a notification. */
  handle(message: unknown): Promise<RpcResponse | RpcResponse[] | undefined>;
}

const ok = (id: RpcId, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: RpcId | null, code: number, message: string, data?: unknown): RpcResponse =>
  ({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });

const clip = (text: string): string => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 300 || value.includes("\0")) throw new ToolInputError(`${name} must be a revision name of at most 300 characters.`);
  return value;
}

/** What the agent reads back: the findings to undo, or one line saying the changes are clean. */
function summarize(result: ReviewResult, subject: string): string {
  const blocking = result.infractions.filter(finding => result.failedRules.includes(finding.type));
  const lines: string[] = [];
  if (blocking.length) lines.push(formatAgentFeedback(result, subject));
  else {
    lines.push(result.filesChanged
      ? `agent-roast: no weakened checks in ${subject} (${result.filesInspected} of ${result.filesChanged} changed files compared).`
      : `agent-roast: nothing changed in ${subject}, so there is nothing to review.`);
    const notes = result.infractions.filter(finding => isCheckRule(finding.type));
    if (notes.length) {
      lines.push("Worth a second look (these do not block):");
      for (const note of notes.slice(0, LISTED_NOTES)) {
        const where = `${terminalText(note.file ?? "unknown location")}${note.lineNumber ? `:${note.lineNumber}` : ""}`;
        lines.push(`- ${where} [${note.type}] ${terminalText(note.lineSnippet || note.reason).replace(/\s+/g, " ").trim().slice(0, 120)}`);
      }
      if (notes.length > LISTED_NOTES) lines.push(`- … and ${notes.length - LISTED_NOTES} more.`);
    }
  }
  if (!result.complete) {
    const first = result.skippedFiles[0];
    lines.push(`agent-roast could not compare ${result.skippedFiles.length} changed file${result.skippedFiles.length === 1 ? "" : "s"}` +
      `${first ? ` (for example ${terminalText(first.file)}: ${terminalText(first.reason).slice(0, 120)})` : ""}, so this result may be incomplete.`);
  }
  return lines.join("\n");
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? TOOL_TIMEOUT_MS;
  const serverInfo = { name: "agent-roast", title: "Agent Roast", version: options.version };
  const inflight = new Map<RpcId, AbortController>();
  const cancelled = new Set<RpcId>();
  let allowed: Promise<string[]> | undefined;

  const startDirectory = () => path.resolve(options.cwd ?? (env.CLAUDE_PROJECT_DIR || env.CURSOR_PROJECT_DIR || process.cwd()));
  const roots = (): Promise<string[]> => (allowed ??= Promise.all(
    (options.roots?.length ? options.roots : [startDirectory()]).map(root => fs.realpath(path.resolve(root)).catch(() => path.resolve(root)))));

  async function gitCommonDirectory(directory: string): Promise<string | null> {
    try {
      const output = gitOutputPath((await readGit(directory, ["rev-parse", "--git-common-dir"], undefined, 8192)).toString());
      return await fs.realpath(path.resolve(directory, output));
    } catch { return null; }
  }

  /** A directory the tools may read: inside an allowed root, or another worktree of the same repository. */
  async function permitted(real: string, list: string[]): Promise<boolean> {
    for (const root of list) {
      const relative = path.relative(root, real);
      if (relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) return true;
    }
    const common = await gitCommonDirectory(real);
    if (!common) return false;
    for (const root of list) if (common === await gitCommonDirectory(root)) return true;
    return false;
  }

  async function project(requested: unknown): Promise<string> {
    if (requested !== undefined && requested !== null && requested !== "" && (typeof requested !== "string" || requested.includes("\0"))) throw new ToolInputError("path must be a directory path.");
    const list = await roots();
    if (!options.roots?.length && list.every(root => path.parse(root).root === root)) {
      throw new ToolInputError("The server was started outside a project (its working directory is the filesystem root). Add --root <directory> to the server's command line.");
    }
    const target = typeof requested === "string" && requested ? path.resolve(list[0], requested) : list[0];
    let real: string;
    try { real = await fs.realpath(target); }
    catch { throw new ToolInputError(`${terminalText(typeof requested === "string" && requested ? requested : target)} does not exist.`); }
    if (!await permitted(real, list)) throw new ToolInputError("That path is outside the project this server was started in. Add --root <directory> to the server's command line to allow another location.");
    return real;
  }

  async function callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    switch (name) {
      case "review_worktree":
        return summarize(await reviewWorktreeChanges({ cwd: await project(args.path), signal }), "the uncommitted changes");
      case "review_changes": {
        const base = optionalText(args.base, "base");
        if (!base) throw new ToolInputError("base is required, for example main or origin/main.");
        const head = optionalText(args.head, "head");
        const cwd = await project(args.path);
        return summarize(await reviewChanges({ cwd, base, head, signal }), `the changes between ${terminalText(base)} and ${terminalText(head ?? "HEAD")}`);
      }
      case "stop_hook": {
        const cwd = await project(args.cwd);
        const input: Record<string, unknown> = { hook_event_name: "Stop", cwd, stop_hook_active: args.stop_hook_active === true || args.stop_hook_active === "true" };
        const loops = Number(args.loop_count);
        if (args.loop_count !== undefined && args.loop_count !== "" && Number.isFinite(loops)) input.loop_count = loops;
        const outcome = await runHook(JSON.stringify(input), { agent: "claude", cwd, env, timeoutMs });
        if (outcome.stderr) process.stderr.write(outcome.stderr);
        return outcome.stdout.trim() || "{}";
      }
      default:
        throw new ToolInputError(`Unknown tool: ${terminalText(name).slice(0, 100)}`);
    }
  }

  /** Runs a tool call. Resolves to null when the client cancelled it, since nothing may be sent for a cancelled request. */
  async function toolResult(id: RpcId, name: string, rawArguments: unknown): Promise<{ text: string; isError: boolean } | null> {
    const controller = new AbortController();
    inflight.set(id, controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const args = rawArguments ?? {};
      if (typeof args !== "object" || Array.isArray(args)) throw new ToolInputError("arguments must be an object.");
      return { text: clip(await callTool(name, args as Record<string, unknown>, controller.signal)), isError: false };
    } catch (error) {
      if (cancelled.has(id)) return null;
      if (controller.signal.aborted) {
        const limit = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} seconds` : `${timeoutMs} ms`;
        return { text: `agent-roast: the check took longer than ${limit} and was stopped. Nothing was changed.`, isError: true };
      }
      const message = terminalText(error instanceof Error ? error.message : String(error));
      return { text: clip(error instanceof ToolInputError ? message : `agent-roast: ${message}`), isError: true };
    } finally {
      clearTimeout(timer);
      inflight.delete(id);
      cancelled.delete(id);
    }
  }

  async function dispatch(id: RpcId, method: string, params: Record<string, unknown>): Promise<RpcResponse | undefined> {
    const meta = params._meta && typeof params._meta === "object" ? params._meta as Record<string, unknown> : {};
    const requested = meta[VERSION_KEY];
    const modern = typeof requested === "string";
    if (modern && !MODERN_VERSIONS.includes(requested)) {
      return fail(id, -32022, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested });
    }
    const capabilities = { tools: { listChanged: false } };
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const protocolVersion = typeof asked === "string" && LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0];
        return ok(id, { protocolVersion, capabilities, serverInfo, instructions: INSTRUCTIONS });
      }
      case "ping":
        return ok(id, {});
      case "server/discover":
        return ok(id, { resultType: "complete", supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], capabilities, serverInfo, instructions: INSTRUCTIONS, ttlMs: CACHE_MS, cacheScope: "public" });
      case "tools/list":
        return ok(id, modern ? { resultType: "complete", tools: MCP_TOOLS, ttlMs: CACHE_MS, cacheScope: "public" } : { tools: MCP_TOOLS });
      case "tools/call": {
        const name = params.name;
        if (typeof name !== "string" || !MCP_TOOLS.some(tool => tool.name === name)) {
          return fail(id, -32602, `Unknown tool: ${typeof name === "string" ? terminalText(name).slice(0, 100) : "(no name)"}`);
        }
        const outcome = await toolResult(id, name, params.arguments);
        if (!outcome) return undefined;
        const content = [{ type: "text", text: outcome.text }];
        return ok(id, modern ? { resultType: "complete", content, isError: outcome.isError } : { content, isError: outcome.isError });
      }
      default:
        return fail(id, -32601, `Method not found: ${terminalText(method).slice(0, 100)}`);
    }
  }

  async function handleOne(message: unknown): Promise<RpcResponse | undefined> {
    if (!message || typeof message !== "object" || Array.isArray(message) || (message as { jsonrpc?: unknown }).jsonrpc !== "2.0") return fail(null, -32600, "Invalid Request");
    const request = message as { id?: unknown; method?: unknown; params?: unknown };
    if (typeof request.method !== "string") return undefined; // a response from the client: this server never sends requests
    const params = request.params && typeof request.params === "object" && !Array.isArray(request.params) ? request.params as Record<string, unknown> : {};
    if (typeof request.id !== "string" && typeof request.id !== "number") {
      const target = params.requestId;
      if (request.method === "notifications/cancelled" && (typeof target === "string" || typeof target === "number") && inflight.has(target)) {
        cancelled.add(target);
        inflight.get(target)?.abort();
      }
      return undefined;
    }
    return dispatch(request.id, request.method, params);
  }

  return {
    async handle(message) {
      if (!Array.isArray(message)) return handleOne(message);
      if (!message.length) return fail(null, -32600, "Invalid Request");
      const responses = (await Promise.all(message.map(handleOne))).filter((response): response is RpcResponse => response !== undefined);
      return responses.length ? responses : undefined;
    },
  };
}

export interface ServeMcpOptions extends McpServerOptions {
  input?: Readable;
  output?: Writable;
}

/** Reads newline-delimited JSON-RPC from the input and writes responses to the output until the input closes. */
export async function serveMcp(options: ServeMcpOptions): Promise<void> {
  const server = createMcpServer(options);
  const output = options.output ?? process.stdout;
  output.on("error", () => { /* the client went away */ });
  const write = (message: unknown) => { output.write(JSON.stringify(message) + "\n"); };
  const lines = readline.createInterface({ input: options.input ?? process.stdin, crlfDelay: Infinity });
  const running = new Set<Promise<void>>();
  lines.on("line", line => {
    if (!line.trim()) return;
    let message: unknown;
    try { message = JSON.parse(line); }
    catch { write(fail(null, -32700, "Parse error")); return; }
    const task: Promise<void> = server.handle(message)
      .then(response => { if (response !== undefined) write(response); })
      .catch(error => { process.stderr.write(`agent-roast mcp: ${terminalText(error instanceof Error ? error.message : String(error))}\n`); })
      .finally(() => { running.delete(task); });
    running.add(task);
  });
  await new Promise<void>(resolve => lines.once("close", () => resolve()));
  await Promise.allSettled([...running]);
}
