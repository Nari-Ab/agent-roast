import { spawn, spawnSync } from "child_process";
import { PassThrough, Readable } from "stream";
import { StringDecoder } from "string_decoder";
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

export class GitError extends Error {
  constructor(public stderr: string, public code: number | null) {
    super(`git exited with code ${code}: ${stderr.trim() || "unknown error"}`);
    this.name = "GitError";
  }
}

export const HERMETIC_GIT_FLAGS = [
  "-c", "core.quotepath=false",
  "-c", "diff.noprefix=false",
  "-c", "diff.mnemonicPrefix=false",
  "--no-pager",
] as const;

export function getHermeticGitEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extraEnv,
    GIT_PAGER: "cat",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: extraEnv?.GIT_CONFIG_GLOBAL || process.env.GIT_CONFIG_GLOBAL || "/dev/null",
  };
}

const MAX_RECORD_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB protection against OOM

export async function parseGitLogStream(
  stream: Readable,
  onCommit: (commit: ParsedCommit, stats: { skippedLongLines: number; skippedUnknownFiles: number }) => void
): Promise<{ totalSkippedLongLines: number; totalSkippedUnknownFiles: number }> {
  let buffer = "";
  let totalSkippedLongLines = 0;
  let totalSkippedUnknownFiles = 0;
  let scanFrom = 0;
  let activeRecSep: string | null = null;
  let activeFieldSep: string | null = null;

  const processBlock = (block: string) => {
    if (!block.trim()) return;

    const fieldSep = activeFieldSep || (block.includes(FIELD_SEPARATOR) ? FIELD_SEPARATOR : "\x1f");
    const parts = block.split(fieldSep);
    if (parts.length < 5) return;

    const hash = parts[0].trim();
    const date = parts[1].trim();
    const authorName = parts[2].trim();
    const authorEmail = parts[3].trim();
    const message = parts[4].trim();
    const rawDiff = parts.slice(5).join(fieldSep);

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

    const decoder = new StringDecoder("utf8");

    stream.on("data", (chunk: Buffer | string) => {
      const chunkStr = typeof chunk === "string" ? chunk : decoder.write(chunk);
      buffer += chunkStr;

      if (buffer.length > MAX_RECORD_BUFFER_SIZE) {
        const oomErr = new Error(`Git log record exceeded maximum buffer limit (${MAX_RECORD_BUFFER_SIZE} bytes).`);
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
      scanFrom = buffer.length;
    });

    stream.on("end", () => {
      buffer += decoder.end();
      if (buffer.trim()) {
        try {
          processBlock(buffer);
        } catch (err) {
          safeReject(err);
          return;
        }
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
        oldLeft--;
        continue;
      }
      if (char === " ") {
        oldLeft--;
        newLeft--;
        lineNo++;
        continue;
      }

      // Unexpected line inside hunk: desync detected, reset state
      oldLeft = 0;
      newLeft = 0;
    }

    // Outside hunk
    const hunkMatch = HUNK_REGEX.exec(line);
    if (hunkMatch) {
      oldLeft = hunkMatch[1] === undefined ? 1 : parseInt(hunkMatch[1], 10);
      lineNo = parseInt(hunkMatch[2], 10);
      newLeft = hunkMatch[3] === undefined ? 1 : parseInt(hunkMatch[3], 10);
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
  ".",
  ":(exclude,glob)**/*.lock",
  ":(exclude,glob)**/*-lock.json",
  ":(exclude,glob)**/*.lockb",
  ":(exclude,glob)**/dist/**",
  ":(exclude,glob)**/build/**",
  ":(exclude,glob)**/node_modules/**",
  ":(exclude,glob)**/*.min.js",
  ":(exclude,glob)**/*.map",
];

export function streamGitLog(
  cwd: string = process.cwd(),
  since: string = "90 days ago"
): Readable {
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
    "--encoding=UTF-8",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    `--since=${since}`,
    `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%B${FIELD_SEPARATOR}`,
    ...COMMON_EXCLUDE_SPECS,
  ];

  const output = new PassThrough();

  const child = spawn("git", gitArgs, {
    cwd,
    env: getHermeticGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => {
    output.write(chunk);
  });

  let stderrBuffer = "";
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      output.destroy(new GitError(stderrBuffer, code));
    } else {
      output.end();
    }
  });

  child.on("error", (err) => {
    output.destroy(err);
  });

  return output;
}

export function streamGitDiff(
  cwd: string,
  baseSha: string,
  headSha: string
): Readable {
  const gitArgs = [
    ...HERMETIC_GIT_FLAGS,
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--end-of-options",
    baseSha,
    headSha,
    ...COMMON_EXCLUDE_SPECS,
  ];

  const output = new PassThrough();

  const child = spawn("git", gitArgs, {
    cwd,
    env: getHermeticGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => {
    output.write(chunk);
  });

  let stderrBuffer = "";
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      output.destroy(new GitError(stderrBuffer, code));
    } else {
      output.end();
    }
  });

  child.on("error", (err) => {
    output.destroy(err);
  });

  return output;
}

/**
 * Validates and resolves a git ref to a full commit SHA safely using --end-of-options.
 * Exits with code 2 on failure.
 */
export function resolveCommitSha(cwd: string, ref: string, roleName: string = "ref"): string {
  const result = spawnSync(
    "git",
    [...HERMETIC_GIT_FLAGS, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    {
      cwd,
      env: getHermeticGitEnv(),
      encoding: "utf8",
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

