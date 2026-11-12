import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync, spawn } from "child_process";
import { createMcpServer, MCP_TOOLS } from "../src/mcp.js";
import type { McpServerOptions } from "../src/mcp.js";

let dir: string;
let extra: string[] = [];
const cli = path.resolve("dist/cli.js");
const node = process.env.AGENT_ROAST_TEST_NODE || process.execPath;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string) => { const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const TEST = "import { add } from './calc';\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n";
const weaken = () => write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()"));
const scratch = (prefix: string) => { const made = fs.mkdtempSync(path.join(tmpdir(), prefix)); extra.push(made); return made; };
const MODERN = { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } };

const serve = (options: Partial<McpServerOptions> = {}) => createMcpServer({ version: "9.9.9", cwd: dir, env: {}, ...options });
let nextId = 1;
const request = (method: string, params?: Record<string, unknown>) => ({ jsonrpc: "2.0", id: nextId++, method, params });
const errorOf = (response: unknown) => (response as { error?: { code: number; message: string; data?: unknown } }).error;
const ask = async (server: ReturnType<typeof serve>, method: string, params?: Record<string, unknown>): Promise<any> => server.handle(request(method, params));
const tool = async (name: string, args: Record<string, unknown> = {}, options: Partial<McpServerOptions> = {}) => {
  const answer = await ask(serve(options), "tools/call", { name, arguments: args });
  return { text: answer.result.content[0].text as string, isError: answer.result.isError as boolean };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "roast-mcp-"));
  git("init", "-b", "main"); git("config", "user.name", "Dev"); git("config", "user.email", "dev@example.invalid"); git("config", "commit.gpgsign", "false");
  write("calc.ts", "export const add = (a: number, b: number) => a + b;\n"); write("calc.test.ts", TEST);
  git("add", "."); git("commit", "-m", "base");
});
afterEach(() => {
  for (const made of [dir, ...extra]) fs.rmSync(made, { recursive: true, force: true });
  extra = [];
});

describe("the MCP server, protocol", () => {
  it("answers the initialize handshake of the earlier protocol versions and ignores the notification that follows", async () => {
    const server = serve();
    const answer = await ask(server, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "client", version: "1" } });
    expect(answer.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "agent-roast", version: "9.9.9" } });
    expect(answer.result.instructions).toMatch(/review_worktree/);
    expect(answer.result.resultType).toBeUndefined();
    expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect((await ask(server, "initialize", { protocolVersion: "2099-01-01" })).result.protocolVersion).toBe("2025-11-25");
    expect((await ask(server, "ping")).result).toEqual({});
  });

  it("lists read-only tools that carry the annotations a directory asks for", async () => {
    const answer = await ask(serve(), "tools/list");
    expect(answer.result.tools.map((entry: { name: string }) => entry.name)).toEqual(["review_worktree", "review_changes", "stop_hook"]);
    for (const entry of answer.result.tools) {
      expect(entry.name.length).toBeLessThanOrEqual(64);
      expect(entry.title).toBeTruthy();
      expect(entry.inputSchema.type).toBe("object");
      expect(entry.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: entry.title });
    }
    expect(answer.result.resultType).toBeUndefined();
    expect(MCP_TOOLS.find(entry => entry.name === "review_changes")?.inputSchema.required).toEqual(["base"]);
  });

  it("speaks the 2026-07-28 era without a handshake, and says which versions it supports", async () => {
    const server = serve();
    const discover = await ask(server, "server/discover", MODERN);
    expect(discover.result).toMatchObject({ resultType: "complete", capabilities: { tools: {} }, cacheScope: "public", ttlMs: expect.any(Number) });
    expect(discover.result.supportedVersions).toEqual(expect.arrayContaining(["2026-07-28", "2025-11-25"]));
    const list = await ask(server, "tools/list", MODERN);
    expect(list.result).toMatchObject({ resultType: "complete", cacheScope: "public", ttlMs: expect.any(Number) });
    expect(list.result.tools).toHaveLength(3);
    const call = await ask(server, "tools/call", { name: "review_worktree", arguments: {}, ...MODERN });
    expect(call.result).toMatchObject({ resultType: "complete", isError: false });
    const old = await ask(server, "tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" } });
    expect(old.error).toMatchObject({ code: -32022, data: { requested: "1900-01-01", supported: expect.arrayContaining(["2026-07-28"]) } });
  });

  it("reports protocol mistakes as JSON-RPC errors and tool mistakes as results the model can read", async () => {
    const server = serve();
    expect((await ask(server, "tools/call", { name: "rm_rf", arguments: {} })).error).toMatchObject({ code: -32602, message: "Unknown tool: rm_rf" });
    expect((await ask(server, "tools/call", {})).error.code).toBe(-32602);
    expect((await ask(server, "resources/list")).error).toMatchObject({ code: -32601 });
    expect(errorOf(await server.handle({ method: "ping", id: 1 }))?.code).toBe(-32600);
    expect(errorOf(await server.handle("nonsense"))?.code).toBe(-32600);
    expect(await server.handle({ jsonrpc: "2.0", id: 9, result: {} })).toBeUndefined();
    expect(await tool("review_changes", {})).toMatchObject({ isError: true, text: expect.stringMatching(/base is required/) });
    const bad = await ask(server, "tools/call", { name: "review_worktree", arguments: ["not", "an object"] });
    expect(bad.result).toMatchObject({ isError: true, content: [{ type: "text", text: "arguments must be an object." }] });
  });

  it("answers a batch with a batch, and a batch of notifications with nothing", async () => {
    const server = serve();
    const answers = await server.handle([request("ping"), { jsonrpc: "2.0", method: "notifications/initialized" }, request("ping")]);
    expect(Array.isArray(answers) ? answers : []).toHaveLength(2);
    expect(await server.handle([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toBeUndefined();
    expect(errorOf(await server.handle([]))?.code).toBe(-32600);
  });

  it("sends nothing for a request the client cancelled", async () => {
    const server = serve();
    const message = request("tools/call", { name: "review_worktree", arguments: {} });
    const pending = server.handle(message);
    await server.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: message.id } });
    expect(await pending).toBeUndefined();
  });

  it("stops a check that takes too long and says so", async () => {
    weaken();
    const answer = await tool("review_worktree", {}, { timeoutMs: 1 });
    expect(answer).toMatchObject({ isError: true, text: expect.stringMatching(/took longer than 1 ms and was stopped/) });
  });
});

describe("the MCP server, tools", () => {
  it("review_worktree sends back what to undo, in the words the Stop hook uses", async () => {
    weaken();
    write("calc.test.ts", TEST.replace("toBe(4)", "toBeDefined()") + "it.only('later', () => {});\n");
    const answer = await tool("review_worktree");
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("agent-roast: the uncommitted changes make the checks easier to pass");
    expect(answer.text).toContain("calc.test.ts:2 [assertion-weakened]");
    expect(answer.text).toContain("[test-focus]");
    expect(answer.text).toMatch(/Do not skip, delete, loosen or silence/);
  });

  it("review_worktree says when nothing changed and when the changes are fine", async () => {
    expect((await tool("review_worktree")).text).toMatch(/nothing changed in the uncommitted changes, so there is nothing to review/);
    write("calc.ts", "export const add = (a: number, b: number) => b + a;\n");
    const fine = await tool("review_worktree");
    expect(fine).toMatchObject({ isError: false, text: expect.stringMatching(/no weakened checks in the uncommitted changes \(1 of 1 changed files compared\)/) });
  });

  it("review_changes compares committed revisions and names them", async () => {
    weaken(); git("commit", "-am", "make it pass");
    const answer = await tool("review_changes", { base: "HEAD~1" });
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("the changes between HEAD~1 and HEAD make the checks easier to pass");
    expect(answer.text).toContain("[assertion-weakened]");
    expect((await tool("review_changes", { base: "HEAD~1", head: "HEAD~1" })).text).toMatch(/nothing changed/);
    expect(await tool("review_changes", { base: "no-such-branch" })).toMatchObject({ isError: true, text: expect.stringMatching(/^agent-roast: /) });
    expect(await tool("review_changes", { base: "--output=/tmp/x" })).toMatchObject({ isError: true });
  });

  it("stop_hook answers with the hook's own JSON: block once, then warn, and nothing when clean", async () => {
    expect((await tool("stop_hook", { cwd: dir })).text).toBe("{}");
    weaken();
    const first = JSON.parse((await tool("stop_hook", { cwd: dir, stop_hook_active: "false" })).text);
    expect(first.decision).toBe("block");
    expect(first.reason).toContain("calc.test.ts:2 [assertion-weakened]");
    const second = JSON.parse((await tool("stop_hook", { cwd: dir, stop_hook_active: "true" })).text);
    expect(second.decision).toBeUndefined();
    expect(second.systemMessage).toMatch(/finished with 1 change that weakens checks/);
    expect(JSON.parse((await tool("stop_hook", { stop_hook_active: true })).text).systemMessage).toBeTruthy();
    expect((await tool("stop_hook", { cwd: dir }, { env: { AGENT_ROAST_HOOK: "off" } })).text).toBe("{}");
  });
});

describe("the MCP server, where it may look", () => {
  it("refuses a directory outside the project, by path, by .. and through a symlink", async () => {
    const elsewhere = scratch("roast-mcp-elsewhere-");
    for (const requested of [elsewhere, path.join(dir, "..")]) {
      expect(await tool("review_worktree", { path: requested })).toMatchObject({ isError: true, text: expect.stringMatching(/outside the project this server was started in/) });
    }
    fs.symlinkSync(elsewhere, path.join(dir, "link"));
    expect((await tool("review_worktree", { path: "link" })).text).toMatch(/outside the project/);
    expect((await tool("review_worktree", { path: "missing" })).text).toMatch(/does not exist/);
    expect((await tool("review_worktree", { path: 7 })).isError).toBe(true);
  });

  it("accepts a subdirectory, another worktree of the same repository, and a root it was told about", async () => {
    write("src/inner.ts", "export {};\n");
    expect((await tool("review_worktree", { path: "src" })).isError).toBe(false);
    const linked = path.join(scratch("roast-mcp-wt-"), "linked");
    git("worktree", "add", "--detach", linked);
    expect((await tool("review_worktree", { path: linked })).isError).toBe(false);
    const other = scratch("roast-mcp-other-");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: other, env });
    expect((await tool("review_worktree", { path: other })).text).toMatch(/outside the project/);
    expect((await tool("review_worktree", { path: other }, { roots: [dir, other] })).text).not.toMatch(/outside the project/);
  });

  it("will not run from the filesystem root unless it is given a root", async () => {
    const answer = await tool("review_worktree", {}, { cwd: path.parse(dir).root });
    expect(answer).toMatchObject({ isError: true, text: expect.stringMatching(/started outside a project.*--root/) });
  });

  it("takes the project from CLAUDE_PROJECT_DIR when it is set", async () => {
    weaken();
    const answer = await tool("review_worktree", {}, { cwd: undefined, env: { CLAUDE_PROJECT_DIR: dir } });
    expect(answer.text).toContain("[assertion-weakened]");
  });
});

describe("agent-roast mcp, as a process", () => {
  const converse = (lines: string[], args: string[] = [], cwd = dir) => new Promise<{ out: string[]; err: string; code: number | null }>(resolve => {
    const child = spawn(node, [cli, "mcp", ...args], { cwd, env: { ...env, CLAUDE_PROJECT_DIR: "", CURSOR_PROJECT_DIR: "" }, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", chunk => { out += chunk; });
    child.stderr.on("data", chunk => { err += chunk; });
    child.on("close", code => resolve({ out: out.split("\n").filter(Boolean), err, code }));
    child.stdin.end(lines.join("\n") + "\n");
  });

  it("writes nothing but one JSON message per line, answers every request, and exits when its input closes", async () => {
    weaken();
    const { out, err, code } = await converse([
      JSON.stringify(request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } })),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "",
      "not json",
      JSON.stringify(request("tools/list")),
      JSON.stringify(request("tools/call", { name: "review_worktree", arguments: {} })),
    ]);
    const messages = out.map(line => JSON.parse(line));
    expect(messages).toHaveLength(4);
    expect(messages.find(message => message.error?.code === -32700)).toBeTruthy();
    expect(messages.find(message => message.result?.tools)?.result.tools).toHaveLength(3);
    expect(messages.find(message => message.result?.content)?.result.content[0].text).toContain("[assertion-weakened]");
    expect(err).toBe("");
    expect(code).toBe(0);
  });

  it("reviews a project outside its working directory when it is started with --root", async () => {
    weaken();
    const outside = scratch("roast-mcp-cwd-");
    const call = JSON.stringify(request("tools/call", { name: "review_worktree", arguments: { path: dir } }));
    const refused = await converse([call], [], outside);
    expect(JSON.parse(refused.out[0]).result.content[0].text).toMatch(/outside the project/);
    const allowed = await converse([call], ["--root", dir], outside);
    expect(JSON.parse(allowed.out[0]).result.content[0].text).toContain("[assertion-weakened]");
  });
});
