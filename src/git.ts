import { spawn, spawnSync } from "child_process";
import { Readable } from "stream";
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

const MAX_RECORD_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB protection against OOM

export async function parseGitLogStream(
  stream: Readable,
  onCommit: (commit: ParsedCommit, stats: { skippedLongLines: number; skippedUnknownFiles: number }) => void
): Promise<{ totalSkippedLongLines: number; totalSkippedUnknownFiles: number }> {
  let buffer = "";
  let totalSkippedLongLines = 0;
  let totalSkippedUnknownFiles = 0;

  const processBlock = (block: string) => {
    if (!block.trim()) return;

    // Field separator \x1f separates hash, date, author, email, message, diff
    const parts = block.split("\x1f");
    if (parts.length < 5) return;

    const hash = parts[0].trim();
    const date = parts[1].trim();
    const authorName = parts[2].trim();
    const authorEmail = parts[3].trim();
    const message = parts[4].trim();
    const rawDiff = parts.slice(5).join("\x1f");

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
    const decoder = new StringDecoder("utf8");

    stream.on("data", (chunk: Buffer | string) => {
      const chunkStr = typeof chunk === "string" ? chunk : decoder.write(chunk);
      buffer += chunkStr;

      if (buffer.length > MAX_RECORD_BUFFER_SIZE) {
        stream.destroy();
        reject(new Error(`Git log record exceeded maximum buffer limit (${MAX_RECORD_BUFFER_SIZE} bytes).`));
        return;
      }

      const records = buffer.split("\x1e");
      // All items except the last one are complete commits
      while (records.length > 1) {
        const completeBlock = records.shift();
        if (completeBlock !== undefined) {
          processBlock(completeBlock);
        }
      }
      buffer = records[0] || "";
    });

    stream.on("end", () => {
      buffer += decoder.end();
      if (buffer.trim()) {
        processBlock(buffer);
      }
      resolve({ totalSkippedLongLines, totalSkippedUnknownFiles });
    });

    stream.on("error", reject);
  });
}

const HUNK_REGEX = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_LINE_LENGTH = 4096;

/**
 * Unquotes git C-style escaped path (e.g. "b/foo\"bar.ts" or "b/\321\202\320\265\321\201\321\202.ts")
 * decoding octal escape sequences into UTF-8.
 */
export function unquoteGitPath(pathStr: string): string {
  let s = pathStr.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
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
          i = j - 1;
        } else if (next === "n") {
          bytes.push(0x0a);
          i++;
        } else if (next === "t") {
          bytes.push(0x09);
          i++;
        } else if (next === "r") {
          bytes.push(0x0d);
          i++;
        } else if (next === "\\") {
          bytes.push(0x5c);
          i++;
        } else if (next === '"') {
          bytes.push(0x22);
          i++;
        } else {
          bytes.push(s.charCodeAt(i + 1));
          i++;
        }
      } else {
        const code = s.charCodeAt(i);
        if (code < 128) {
          bytes.push(code);
        } else {
          const buf = Buffer.from(s[i], "utf8");
          for (const b of buf) bytes.push(b);
        }
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
  let skippedUnknownFiles = 0;

  const diffLines = rawDiff.split("\n");
  for (const rawLine of diffLines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    // When inside a hunk
    if (oldLeft > 0 || newLeft > 0) {
      const char = line[0];
      if (char === "\\") {
        // "\ No newline at end of file" — ignore completely
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

      // Unexpected line inside hunk: desync detected, reset state to avoid cascaded corruption
      oldLeft = 0;
      newLeft = 0;
    }

    // Outside hunk: check for new hunk or file header
    const hunkMatch = HUNK_REGEX.exec(line);
    if (hunkMatch) {
      oldLeft = hunkMatch[1] === undefined ? 1 : parseInt(hunkMatch[1], 10);
      lineNo = parseInt(hunkMatch[2], 10);
      newLeft = hunkMatch[3] === undefined ? 1 : parseInt(hunkMatch[3], 10);
      continue;
    }

    if (line.startsWith("diff --git ")) {
      // Check for quoted format: diff --git "a/..." "b/..."
      const quotedMatch = line.match(/^diff --git ("(?:\\.|[^"])+") ("(?:\\.|[^"])+")$/);
      let filePath = "unknown";
      if (quotedMatch) {
        filePath = unquoteGitPath(quotedMatch[2]);
      } else {
        const plainMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (plainMatch) {
          filePath = plainMatch[2];
        } else {
          skippedUnknownFiles++;
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
  // Format: \x1e %H \x1f %aI \x1f %an \x1f %ae \x1f %B \x1f
  const gitArgs = [
    "-c", "core.quotepath=false",
    "--no-pager",
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
    "--format=%x1e%H%x1f%aI%x1f%an%x1f%ae%x1f%B%x1f",
    ...COMMON_EXCLUDE_SPECS,
  ];

  const child = spawn("git", gitArgs, {
    cwd,
    env: {
      ...process.env,
      GIT_PAGER: "cat",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuffer = "";
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      child.stdout.emit(
        "error",
        new Error(`git log exited with code ${code}: ${stderrBuffer.trim() || "unknown error"}`)
      );
    }
  });

  child.on("error", (err) => {
    child.stdout.emit("error", err);
  });

  return child.stdout;
}

export function streamGitDiff(
  cwd: string,
  baseSha: string,
  headSha: string
): Readable {
  const gitArgs = [
    "-c", "core.quotepath=false",
    "--no-pager",
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

  const child = spawn("git", gitArgs, {
    cwd,
    env: {
      ...process.env,
      GIT_PAGER: "cat",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuffer = "";
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      child.stdout.emit(
        "error",
        new Error(`git diff exited with code ${code}: ${stderrBuffer.trim() || "unknown error"}`)
      );
    }
  });

  child.on("error", (err) => {
    child.stdout.emit("error", err);
  });

  return child.stdout;
}

/**
 * Validates and resolves a git ref to a full commit SHA safely using --end-of-options.
 * Exits with code 2 on failure.
 */
export function resolveCommitSha(cwd: string, ref: string, roleName: string = "ref"): string {
  const result = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

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
  const result = spawnSync("git", ["merge-base", "--end-of-options", baseSha, headSha], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

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
    const res = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd,
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

