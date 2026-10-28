import { createHash } from "crypto";
import * as fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { ConfigError, CONFIG_FILENAMES, configFromText } from "./config.js";
import { getHermeticGitEnv, HERMETIC_GIT_FLAGS, GitError, gitOutputPath } from "./git.js";
import type { AgentRoastConfig } from "./config.js";

export interface TreeChange {
  status: string;
  oldPath: string;
  newPath: string;
  oldMode: string;
  newMode: string;
  oldOid: string;
  newOid: string;
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ConfigError("Review cancelled; no complete result was produced.");
}

/** Bounded async Git reads. Never check out code, run project hooks or lazily fetch objects. */
export async function readGit(cwd: string, args: string[], signal?: AbortSignal, limit = 8 * 1024 * 1024, indexFile?: string): Promise<Buffer> {
  assertNotAborted(signal);
  const env = getHermeticGitEnv({ GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" });
  if (indexFile) env.GIT_INDEX_FILE = indexFile;
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...HERMETIC_GIT_FLAGS, ...args], {
      cwd, env,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) { child.kill(); reject(error); }
      else resolve(Buffer.concat(chunks));
    };
    const abort = () => finish(new ConfigError("Review cancelled; no complete result was produced."));
    const timer = setTimeout(() => finish(new ConfigError("Git review read timed out after 30 seconds.")), 30_000);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limit) finish(new ConfigError(`Git read exceeds the ${limit} byte limit.`));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8").slice(0, 64 * 1024 - stderr.length); });
    child.on("error", error => finish(error));
    child.on("close", code => finish(code === 0 ? undefined : new GitError(stderr, code)));
    if (signal?.aborted) abort();
  });
}

async function requireLocalObjects(cwd: string, signal?: AbortSignal): Promise<void> {
  // Old Git versions may not honor GIT_NO_LAZY_FETCH. Refuse promisor repos
  // rather than risk a network request from a supposedly offline review.
  try {
    const promises = (await readGit(cwd, ["config", "--type=bool", "--get-regexp", "^remote\\..*\\.promisor$"], signal, 64 * 1024)).toString();
    if (promises.split("\n").some(line => /\s+(?:true|yes|on|1)\s*$/i.test(line))) {
      throw new ConfigError("Offline review requires a non-partial clone with local objects; promisor remotes are unsupported.");
    }
  } catch (error) {
    if (!(error instanceof GitError && error.code === 1)) throw error;
  }
}

export async function reviewRefs(cwd: string, base: string, head: string, signal?: AbortSignal): Promise<{ baseSha: string; headSha: string; mergeBaseSha: string }> {
  const resolve = async (ref: string) => {
    if (!ref.trim()) throw new ConfigError("Review refs must not be empty.");
    try {
      return (await readGit(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], signal, 1024)).toString().trim();
    } catch (error) {
      assertNotAborted(signal);
      throw new ConfigError(`Cannot resolve review ref '${ref}'. Use valid commits and fetch complete history (actions/checkout fetch-depth: 0). ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await requireLocalObjects(cwd, signal);
  const baseSha = await resolve(base);
  const headSha = await resolve(head);
  let ancestors: string[];
  try {
    ancestors = (await readGit(cwd, ["merge-base", "--all", "--end-of-options", baseSha, headSha], signal, 8192)).toString().trim().split("\n");
  } catch (error) {
    assertNotAborted(signal);
    throw new ConfigError(`Cannot find review merge-base. Fetch full shared history (fetch-depth: 0). ${error instanceof Error ? error.message : String(error)}`);
  }
  if (ancestors.length !== 1 || !/^[a-f0-9]{40,64}$/.test(ancestors[0])) throw new ConfigError("Review needs exactly one merge base; ambiguous merge ancestry is unsupported.");
  return { baseSha, headSha, mergeBaseSha: ancestors[0] };
}

export async function changedTreeFiles(cwd: string, before: string, after: string, signal?: AbortSignal): Promise<TreeChange[]> {
  const buffer = await readGit(cwd, ["diff", "--raw", "-z", "--no-relative", "--no-abbrev", "--no-ext-diff", "--no-textconv", "--find-renames=50%", "-l1000", "--end-of-options", before, after, "--"], signal);
  return parseTreeChanges(buffer);
}

function parseTreeChanges(buffer: Buffer): TreeChange[] {
  const tokens = new TextDecoder("utf-8", { fatal: true }).decode(buffer).split("\0");
  if (tokens.pop() !== "") throw new ConfigError("Truncated Git change inventory.");
  const changes: TreeChange[] = [];
  for (let i = 0; i < tokens.length;) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]{40,64}) ([a-f0-9]{40,64}) ([AMDRT]\d*)$/.exec(tokens[i++]);
    if (!match) throw new ConfigError("Unsupported Git change inventory entry.");
    const oldPath = tokens[i++];
    const newPath = match[5].startsWith("R") ? tokens[i++] : oldPath;
    if (!oldPath || !newPath) throw new ConfigError("Incomplete Git path inventory.");
    changes.push({ oldMode: match[1], newMode: match[2], oldOid: match[3], newOid: match[4], status: match[5], oldPath, newPath });
    if (changes.length > 1000) throw new ConfigError("Review exceeds the 1000 changed-file limit; split the change into smaller reviews.");
  }
  return changes;
}

export async function readBlob(cwd: string, oid: string, signal?: AbortSignal, limit = 2 * 1024 * 1024): Promise<Buffer> {
  if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new ConfigError("Invalid Git blob identity.");
  const sizeText = (await readGit(cwd, ["cat-file", "-s", oid], signal, 128)).toString().trim();
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) throw new ConfigError(`Source blob exceeds the ${limit} byte limit or has an invalid size.`);
  const buffer = await readGit(cwd, ["cat-file", "blob", oid], signal, limit);
  if (buffer.length !== size) throw new ConfigError("Git blob size differs from the recorded object.");
  return buffer;
}

/** Policy comes from the explicitly supplied base branch tip, not the candidate tree. */
export async function reviewPolicy(cwd: string, baseSha: string, signal?: AbortSignal): Promise<{ config: AgentRoastConfig; filename: string | null }> {
  const raw = await readGit(cwd, ["ls-tree", "--full-tree", "-z", baseSha, "--", ...CONFIG_FILENAMES], signal, 8192);
  const entries = raw.toString().split("\0").filter(Boolean);
  for (const filename of CONFIG_FILENAMES) {
    const entry = entries.find(line => line.slice(line.indexOf("\t") + 1) === filename);
    if (!entry) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t/.exec(entry);
    if (!match) throw new ConfigError(`Base policy '${filename}' must be a regular Git blob.`);
    const content = await readBlob(cwd, match[2], signal, 64 * 1024);
    return { config: configFromText(new TextDecoder("utf-8", { fatal: true }).decode(content), `${filename} in base ${baseSha.slice(0, 7)}`), filename };
  }
  return { config: configFromText("{}", "default review policy"), filename: null };
}

/** Pin cached diff blob IDs. Git loads one index snapshot per invocation; no
 * checkout, write-tree, index refresh, filter or project hook is needed. */
export async function stagedSnapshot(cwd: string, signal?: AbortSignal): Promise<{
  baseSha: string; headSha: string; mergeBaseSha: string; changes: TreeChange[];
  verify: () => Promise<void>;
}> {
  await requireLocalObjects(cwd, signal);
  let indexFile: string | undefined;
  if (process.env.GIT_INDEX_FILE) {
    // Git commit -a/--only creates an index.lock/next-index candidate for hooks.
    // Reading the ordinary index would approve a different commit. Confine an
    // explicit candidate to this checkout's real Git directory; never follow it
    // to another repository or an arbitrary outside file.
    const gitDirectory = await fs.realpath(gitOutputPath((await readGit(cwd, ["rev-parse", "--absolute-git-dir"], signal, 8192)).toString()));
    const requested = path.resolve(cwd, process.env.GIT_INDEX_FILE);
    const stat = await fs.lstat(requested);
    const resolved = await fs.realpath(requested);
    const relative = path.relative(gitDirectory, resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || !relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      throw new ConfigError("GIT_INDEX_FILE must be a regular candidate index inside this repository's Git directory; refusing to review another index.");
    }
    indexFile = resolved;
  }
  const head = async (): Promise<string> => {
    try {
      return (await readGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], signal, 1024)).toString().trim();
    } catch (error) {
      if (!(error instanceof GitError && error.code === 1)) throw error;
      // Only a genuine unborn branch can use an empty baseline.
      const ref = (await readGit(cwd, ["symbolic-ref", "--quiet", "HEAD"], signal, 1024)).toString().trim();
      try { await readGit(cwd, ["show-ref", "--verify", "--quiet", ref], signal, 1024); }
      catch (missing) { if (missing instanceof GitError && missing.code === 1) return "EMPTY"; throw missing; }
      throw new ConfigError("HEAD exists but cannot be resolved to a commit.");
    }
  };
  const baseSha = await head();
  const inventory = () => readGit(cwd, ["diff", "--cached", "--raw", "-z", "--no-relative", "--no-abbrev", "--no-ext-diff", "--no-textconv",
    "--ignore-submodules=none", "--ita-invisible-in-index", "--find-renames=50%", "-l1000", "--end-of-options",
    ...(baseSha === "EMPTY" ? [] : [baseSha]), "--"], signal, 8 * 1024 * 1024, indexFile);
  // Detect conflicts explicitly, including paths that are not supported source.
  const conflicts = await readGit(cwd, ["ls-files", "--unmerged", "-z", "--full-name"], signal, 8 * 1024 * 1024, indexFile);
  if (conflicts.length) throw new ConfigError("Resolve unmerged index entries before reviewing staged changes.");
  const pinned = await inventory();
  const changes = parseTreeChanges(pinned);
  const headSha = "INDEX:" + createHash("sha256").update(baseSha).update(pinned).digest("hex");
  return { baseSha, headSha, mergeBaseSha: baseSha, changes,
    verify: async () => {
      assertNotAborted(signal);
      if (await head() !== baseSha || !(await inventory()).equals(pinned)) {
        throw new ConfigError("HEAD or staged changes changed during review; rerun before committing. No complete result was produced.");
      }
    },
  };
}
