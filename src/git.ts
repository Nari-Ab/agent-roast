import { spawn, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { PassThrough, Readable } from "stream";
import { CommitInfo } from "./types.js";
import { detectAiAttribution } from "./detector.js";

export interface ParsedDiffLine {
  line: string;
  lineNumber: number;
}

export interface ParsedFileDiff {
  path: string;
  addedLines: ParsedDiffLine[];
  deleted?: boolean;
  binary?: boolean;
}

export interface ParsedCommit extends CommitInfo {
  files: ParsedFileDiff[];
  totalAddedCount: number;
}

export interface ParseDiffResult {
  files: ParsedFileDiff[];
  totalAdded: number;
  skippedLongLines: number;
  skippedUnknownFiles: number;
}

export const RECORD_SEPARATOR = "\x1e__ROAST_REC__\x1e";
export const FIELD_SEPARATOR = "\x1f__ROAST_FIELD__\x1f";
const LOG_FRAMING = Symbol("agent-roast Git log framing");
type FramedLog = Readable & { [LOG_FRAMING]?: { record: string; field: string } };

export class GitError extends Error {
  constructor(public stderr: string, public code: number | null) {
    super(`git exited with code ${code}: ${stderr.trim() || "unknown error"}`);
    this.name = "GitError";
  }
}

export const HERMETIC_GIT_FLAGS = [
  "-c", "core.quotepath=false",
  "-c", "core.fsmonitor=false",
  "-c", "diff.noprefix=false",
  "-c", "diff.mnemonicPrefix=false",
  "--no-pager",
] as const;

export function getHermeticGitEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  // Explicit repository paths must not be redirected by a parent Git command.
  // A validated hook index can be supplied explicitly by stagedSnapshot only.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_DIFF_OPTS"]) delete inherited[key];
  return {
    ...inherited,
    ...extraEnv,
    GIT_PAGER: "cat",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: extraEnv?.GIT_CONFIG_GLOBAL || process.env.GIT_CONFIG_GLOBAL || "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/** Git path output has one record-terminating LF. Spaces, CR and extra LFs may
 * belong to the actual pathname and must not be removed with trim(). */
export function gitOutputPath(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

const MAX_RECORD_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB protection against OOM

export async function parseGitLogStream(
  stream: Readable,
  onCommit: (commit: ParsedCommit, stats: { skippedLongLines: number; skippedUnknownFiles: number }) => void
): Promise<{ totalSkippedLongLines: number; totalSkippedUnknownFiles: number }> {
  let buffer = "";
  let bufferedBytes = 0;
  let totalSkippedLongLines = 0;
  let totalSkippedUnknownFiles = 0;
  let scanFrom = 0;
  const framing = (stream as FramedLog)[LOG_FRAMING];
  let activeRecSep: string | null = framing?.record ?? null;
  let activeFieldSep: string | null = framing?.field ?? null;

  const processBlock = (block: string) => {
    if (!block.trim()) return;

    const fieldSep = activeFieldSep || (block.includes(FIELD_SEPARATOR) ? FIELD_SEPARATOR : "\x1f");
    const parts = block.split(fieldSep);
    if (parts.length !== 6) throw new GitError("Malformed or ambiguous Git log record; no complete history result was produced.", 2);

    const hash = parts[0].trim();
    const date = parts[1].trim();
    const authorName = parts[2].trim();
    const authorEmail = parts[3].trim();
    const message = parts[4].trim();
    const rawDiff = parts.slice(5).join(fieldSep);
    if (framing && (!/^[a-f0-9]{40,64}$/.test(hash) || !Number.isFinite(Date.parse(date)))) {
      throw new GitError("Invalid Git log header; no complete history result was produced.", 2);
    }

    const attribution = detectAiAttribution(authorName, authorEmail, message);

    const { files, totalAdded, skippedLongLines, skippedUnknownFiles } = parseDiff(rawDiff);
    totalSkippedLongLines += skippedLongLines;
    totalSkippedUnknownFiles += skippedUnknownFiles;

    onCommit(
      {
        hash,
        date,
        authorName,
        authorEmail,
        message,
        isAiAttributed: attribution.isAiAttributed,
        aiSignatures: attribution.signatures,
        files,
        totalAddedCount: totalAdded,
      },
      { skippedLongLines, skippedUnknownFiles }
    );
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val: { totalSkippedLongLines: number; totalSkippedUnknownFiles: number }) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const safeReject = (err: any) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const decoder = new TextDecoder("utf-8", { fatal: true });

    stream.on("data", (chunk: Buffer | string) => {
      let chunkStr: string;
      try { chunkStr = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }); }
      catch {
        const error = new GitError("Git history contains invalid UTF-8; no complete result was produced.", 2);
        stream.destroy(error); safeReject(error); return;
      }
      buffer += chunkStr;
      bufferedBytes += Buffer.byteLength(chunkStr, "utf8");

      if (bufferedBytes > MAX_RECORD_BUFFER_SIZE) {
        const oomErr = new GitError(`Git log record exceeded maximum buffer limit (${MAX_RECORD_BUFFER_SIZE} bytes).`, 2);
        stream.destroy(oomErr);
        safeReject(oomErr);
        return;
      }

      if (activeRecSep === null) {
        if (buffer.includes(RECORD_SEPARATOR)) {
          activeRecSep = RECORD_SEPARATOR;
          activeFieldSep = FIELD_SEPARATOR;
          scanFrom = 0;
        } else if (buffer.includes("\x1e")) {
          const first1e = buffer.indexOf("\x1e");
          const remaining = buffer.slice(first1e);
          if (remaining.length >= RECORD_SEPARATOR.length || !RECORD_SEPARATOR.startsWith(remaining)) {
            activeRecSep = "\x1e";
            activeFieldSep = "\x1f";
            scanFrom = 0;
          }
        }
      }

      if (activeRecSep === null) {
        // Still ambiguous prefix, wait for next chunk
        return;
      }

      const recSep = activeRecSep;

      let idx: number;
      while ((idx = buffer.indexOf(recSep, scanFrom)) !== -1) {
        const completeBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + recSep.length);
        bufferedBytes -= Buffer.byteLength(completeBlock, "utf8") + Buffer.byteLength(recSep, "utf8");
        scanFrom = 0;
        try {
          processBlock(completeBlock);
        } catch (err) {
          const errObj = err instanceof Error ? err : new Error(String(err));
          stream.destroy(errObj);
          safeReject(errObj);
          return;
        }
      }
      scanFrom = Math.max(0, buffer.length - recSep.length + 1);
    });

    stream.on("end", () => {
      try {
        buffer += decoder.decode();
        if (buffer.trim()) {
          processBlock(buffer);
        }
      } catch (err) {
        safeReject(err); return;
      }
      safeResolve({ totalSkippedLongLines, totalSkippedUnknownFiles });
    });

    stream.on("error", safeReject);

    stream.on("close", () => {
      if (!settled) {
        safeReject(new Error("Git log stream was closed prematurely before completion."));
      }
    });
  });
}

const HUNK_REGEX = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_LINE_LENGTH = 4096;

/**
 * Unquotes git C-style escaped path (e.g. "b/foo\"bar.ts" or "b/\321\202\320\265\321\201\321\202.ts")
 * decoding octal escape sequences and full Unicode code points safely without surrogate splitting.
 */
export function unquoteGitPath(pathStr: string): string {
  let s = pathStr;
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
    const bytes: number[] = [];
    let i = 0;
    while (i < s.length) {
      if (s[i] === "\\" && i + 1 < s.length) {
        const next = s[i + 1];
        if (next >= "0" && next <= "7") {
          let octal = next;
          let j = i + 2;
          while (j < s.length && j < i + 4 && s[j] >= "0" && s[j] <= "7") {
            octal += s[j];
            j++;
          }
          bytes.push(parseInt(octal, 8));
          i = j;
        } else if (next === "a") {
          bytes.push(0x07);
          i += 2;
        } else if (next === "b") {
          bytes.push(0x08);
          i += 2;
        } else if (next === "f") {
          bytes.push(0x0c);
          i += 2;
        } else if (next === "n") {
          bytes.push(0x0a);
          i += 2;
        } else if (next === "r") {
          bytes.push(0x0d);
          i += 2;
        } else if (next === "t") {
          bytes.push(0x09);
          i += 2;
        } else if (next === "v") {
          bytes.push(0x0b);
          i += 2;
        } else if (next === "\\") {
          bytes.push(0x5c);
          i += 2;
        } else if (next === '"') {
          bytes.push(0x22);
          i += 2;
        } else {
          const codePoint = s.codePointAt(i + 1)!;
          const charStr = String.fromCodePoint(codePoint);
          const buf = Buffer.from(charStr, "utf8");
          for (const b of buf) bytes.push(b);
          i += 1 + charStr.length;
        }
      } else {
        const codePoint = s.codePointAt(i)!;
        const charStr = String.fromCodePoint(codePoint);
        const buf = Buffer.from(charStr, "utf8");
        for (const b of buf) bytes.push(b);
        i += charStr.length;
      }
    }
    s = Buffer.from(bytes).toString("utf8");
  }

  if (s.startsWith("b/")) return s.slice(2);
  if (s.startsWith("a/")) return s.slice(2);
  return s;
}

/**
 * Parses raw git diff text into structured files and added lines.
 * Deterministic, robust against desynchronization and minified files.
 */
export function parseDiff(rawDiff: string): ParseDiffResult {
  const files: ParsedFileDiff[] = [];
  let currentFile: ParsedFileDiff | null = null;
  let lineNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let totalAdded = 0;
  let skippedLongLines = 0;

  const diffLines = rawDiff.split("\n");
  for (const rawLine of diffLines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    // Inside hunk
    if (oldLeft > 0 || newLeft > 0) {
      const char = line[0];
      if (char === "\\") {
        continue;
      }
      if (char === "+") {
        if (newLeft <= 0) throw new GitError("Malformed diff hunk adds more lines than declared.", 2);
        if (currentFile && !currentFile.deleted && currentFile.path !== "unknown") {
          const content = line.slice(1);
          if (content.length <= MAX_LINE_LENGTH) {
            currentFile.addedLines.push({
              line: content,
              lineNumber: lineNo,
            });
            totalAdded++;
          } else {
            skippedLongLines++;
          }
        }
        lineNo++;
        newLeft--;
        continue;
      }
      if (char === "-") {
        if (oldLeft <= 0) throw new GitError("Malformed diff hunk removes more lines than declared.", 2);
        oldLeft--;
        continue;
      }
      if (char === " ") {
        if (oldLeft <= 0 || newLeft <= 0) throw new GitError("Malformed diff hunk has invalid context counts.", 2);
        oldLeft--;
        newLeft--;
        lineNo++;
        continue;
      }

      throw new GitError("Truncated or malformed diff hunk; no complete audit result was produced.", 2);
    }

    // Outside hunk
    const hunkMatch = HUNK_REGEX.exec(line);
    if (hunkMatch) {
      oldLeft = hunkMatch[1] === undefined ? 1 : parseInt(hunkMatch[1], 10);
      lineNo = parseInt(hunkMatch[2], 10);
      newLeft = hunkMatch[3] === undefined ? 1 : parseInt(hunkMatch[3], 10);
      if (![oldLeft, newLeft, lineNo].every(Number.isSafeInteger)) throw new GitError("Invalid diff hunk line counts.", 2);
      continue;
    }

    if (line.startsWith("diff --git ")) {
      const quotedMatch = line.match(/^diff --git ("(?:\\.|[^"])+") ("(?:\\.|[^"])+")$/);
      let filePath = "unknown";
      if (quotedMatch) {
        filePath = unquoteGitPath(quotedMatch[2]);
      } else {
        const plainMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (plainMatch) {
          filePath = plainMatch[2];
        }
      }
      currentFile = { path: filePath, addedLines: [] };
      files.push(currentFile);
      continue;
    }

    if (currentFile && (line.startsWith("Binary files ") || line === "GIT binary patch")) {
      currentFile.binary = true;
      continue;
    }

    if (line.startsWith("+++ /dev/null")) {
      if (currentFile) {
        currentFile.deleted = true;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const rawPath = line.trimEnd().slice(4).trim();
      const filePath = unquoteGitPath(rawPath);
      if (currentFile) {
        currentFile.path = filePath;
      } else {
        currentFile = { path: filePath, addedLines: [] };
        files.push(currentFile);
      }
      continue;
    }
  }
  if (oldLeft > 0 || newLeft > 0) throw new GitError("Truncated diff hunk; no complete audit result was produced.", 2);

  // Count skippedUnknownFiles only for files that finished parsing with unresolved "unknown" path
  let skippedUnknownFiles = 0;
  for (const file of files) {
    if (file.path === "unknown" && !file.deleted) {
      skippedUnknownFiles++;
    }
  }

  return { files, totalAdded, skippedLongLines, skippedUnknownFiles };
}

const COMMON_EXCLUDE_SPECS = [
  "--",
  ":(top,glob)**",
  ":(top,exclude,glob)**/*.lock",
  ":(top,exclude,glob)**/*-lock.json",
  ":(top,exclude,glob)**/*.lockb",
  ":(top,exclude,glob)**/dist/**",
  ":(top,exclude,glob)**/build/**",
  ":(top,exclude,glob)**/node_modules/**",
  ":(top,exclude,glob)**/*.min.js",
  ":(top,exclude,glob)**/*.map",
];

/** Older Git versions may ignore GIT_NO_LAZY_FETCH. History/diff audits must
 * refuse promisor repositories before requesting any potentially missing object. */
function requireLocalObjects(cwd: string): void {
  const result = spawnSync("git", [...HERMETIC_GIT_FLAGS, "config", "--type=bool", "--get-regexp", "^remote\\..*\\.promisor$"], {
    cwd, env: getHermeticGitEnv(), encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  if (result.error) throw new GitError(result.error.message, result.status);
  if (result.status !== 0 && result.status !== 1) throw new GitError(result.stderr, result.status);
  if (result.stdout.split("\n").some(line => /\s+(?:true|yes|on|1)\s*$/i.test(line))) {
    throw new GitError("Offline audits require a non-partial clone with local objects; promisor remotes are unsupported.", 2);
  }
}

function streamGit(cwd: string, gitArgs: string[]): Readable {
  const output = new PassThrough();
  try { requireLocalObjects(cwd); }
  catch (error) { queueMicrotask(() => output.destroy(error instanceof Error ? error : new Error(String(error)))); return output; }
  const child = spawn("git", gitArgs, {
    cwd, env: getHermeticGitEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  const timer = setTimeout(() => output.destroy(new GitError("Git audit timed out after 30 seconds; no complete result was produced.", 2)), 30_000);
  child.stderr.on("data", chunk => { if (stderr.length < 64 * 1024) stderr += chunk.toString().slice(0, 64 * 1024 - stderr.length); });
  // pipe respects backpressure; close/error also stops a child whose output the
  // parser rejected (for example an over-limit commit), avoiding a runaway scan.
  child.stdout.pipe(output, { end: false });
  output.on("close", () => { clearTimeout(timer); if (child.exitCode === null) child.kill(); });
  child.stdout.on("error", error => output.destroy(error));
  child.on("error", error => output.destroy(error));
  child.on("close", code => {
    clearTimeout(timer);
    if (output.destroyed) return;
    if (code !== 0) output.destroy(new GitError(stderr, code));
    else output.end();
  });
  return output;
}

export function streamGitLog(
  cwd: string = process.cwd(),
  since: string = "90 days ago"
): Readable {
  // Content-controlled commit messages and patches may contain the public legacy
  // delimiters. Per-process random framing prevents them from forging records.
  const nonce = randomUUID();
  const record = `\x1e__ROAST_REC_${nonce}__\x1e`;
  const field = `\x1f__ROAST_FIELD_${nonce}__\x1f`;
  const gitArgs = [
    ...HERMETIC_GIT_FLAGS,
    "log",
    "-p",
    "-U0",
    "--no-color",
    "--no-merges",
    "--no-show-signature",
    "--no-ext-diff",
    "--no-textconv",
    "--no-relative",
    "--encoding=UTF-8",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    `--since=${since}`,
    `--format=${record}%H${field}%aI${field}%an${field}%ae${field}%B${field}`,
    ...COMMON_EXCLUDE_SPECS,
  ];

  const output = streamGit(cwd, gitArgs) as FramedLog;
  output[LOG_FRAMING] = { record, field };
  return output;
}

export function streamGitDiff(
  cwd: string,
  baseSha: string,
  headSha: string,
  staged: boolean = false
): Readable {
  const gitArgs = [
    ...HERMETIC_GIT_FLAGS,
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    ...(staged ? ["--cached"] : []),
    "--end-of-options",
    ...(staged ? [] : [baseSha, headSha]),
    ...COMMON_EXCLUDE_SPECS,
  ];

  return streamGit(cwd, gitArgs);
}

/**
 * Validates and resolves a git ref to a full commit SHA safely using --end-of-options.
 * Exits with code 2 on failure.
 */
export function resolveCommitSha(cwd: string, ref: string, roleName: string = "ref"): string {
  requireLocalObjects(cwd);
  const result = spawnSync(
    "git",
    [...HERMETIC_GIT_FLAGS, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    {
      cwd,
      env: getHermeticGitEnv(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    }
  );

  if (result.error) {
    throw new GitResolutionError(`Git command execution failed: ${result.error.message}. Ensure git is installed and in your PATH.`);
  }

  if (result.status !== 0) {
    const isShallow = checkIfShallow(cwd);
    const shallowHint = isShallow
      ? "\nShallow clone detected: please configure actions/checkout with `fetch-depth: 0`."
      : "";
    throw new GitResolutionError(
      `${roleName} '${ref}' could not be resolved to a valid commit object.${shallowHint}\nGit output: ${result.stderr.trim() || result.stdout.trim()}`
    );
  }

  return result.stdout.trim();
}

/**
 * Finds the merge-base between two commit SHAs safely using --end-of-options.
 */
export function findMergeBase(cwd: string, baseSha: string, headSha: string): string {
  const result = spawnSync(
    "git",
    [...HERMETIC_GIT_FLAGS, "merge-base", "--end-of-options", baseSha, headSha],
    {
      cwd,
      env: getHermeticGitEnv(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    }
  );

  if (result.error) {
    throw new GitResolutionError(`Git command execution failed: ${result.error.message}. Ensure git is installed and in your PATH.`);
  }

  if (result.status !== 0) {
    const isShallow = checkIfShallow(cwd);
    const shallowHint = isShallow
      ? "\nShallow clone detected: repository history is truncated. Configure `fetch-depth: 0` in your workflow."
      : "";
    throw new GitResolutionError(
      `Could not find a common ancestor (merge-base) between base (${baseSha.slice(0, 7)}) and head (${headSha.slice(0, 7)}).${shallowHint}\nGit output: ${result.stderr.trim() || result.stdout.trim()}`
    );
  }

  return result.stdout.trim();
}

function checkIfShallow(cwd: string): boolean {
  try {
    const res = spawnSync("git", [...HERMETIC_GIT_FLAGS, "rev-parse", "--is-shallow-repository"], {
      cwd,
      env: getHermeticGitEnv(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    return res.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export class GitResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitResolutionError";
  }
}

