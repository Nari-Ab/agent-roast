import { spawn } from "child_process";
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
}

export interface ParsedCommit extends CommitInfo {
  files: ParsedFileDiff[];
  totalAddedCount: number;
}

export async function parseGitLogStream(
  stream: Readable,
  onCommit: (commit: ParsedCommit) => void
): Promise<void> {
  let buffer = "";

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

    const { files, totalAdded } = parseDiff(rawDiff);

    onCommit({
      hash,
      date,
      authorName,
      authorEmail,
      message,
      isAiAttributed: attribution.isAiAttributed,
      aiSignatures: attribution.signatures,
      files,
      totalAddedCount: totalAdded,
    });
  };

  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");

    stream.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
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
      resolve();
    });

    stream.on("error", reject);
  });
}

const HUNK_REGEX = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_LINE_LENGTH = 4096;

/**
 * Parses raw git diff text into structured files and added lines.
 * Deterministic, robust against desynchronization and minified files.
 */
export function parseDiff(rawDiff: string): { files: ParsedFileDiff[]; totalAdded: number } {
  const files: ParsedFileDiff[] = [];
  let currentFile: ParsedFileDiff | null = null;
  let lineNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let totalAdded = 0;

  const parsePath = (line: string): string => {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("+++ /dev/null")) return "dev/null";
    let stripped = trimmed.slice(4).trim(); // remove '+++ '
    if (stripped.startsWith('"') && stripped.endsWith('"')) {
      stripped = stripped.slice(1, -1);
    }
    return stripped.startsWith("b/") ? stripped.slice(2) : stripped;
  };

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
        if (currentFile && currentFile.path !== "dev/null") {
          const content = line.slice(1);
          if (content.length <= MAX_LINE_LENGTH) {
            currentFile.addedLines.push({
              line: content,
              lineNumber: lineNo,
            });
            totalAdded++;
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
      const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const filePath = diffMatch ? diffMatch[2] : "unknown";
      currentFile = { path: filePath, addedLines: [] };
      files.push(currentFile);
      continue;
    }

    if (line.startsWith("+++ ")) {
      const filePath = parsePath(line);
      if (currentFile) {
        currentFile.path = filePath;
      } else {
        currentFile = { path: filePath, addedLines: [] };
        files.push(currentFile);
      }
      continue;
    }
  }

  return { files, totalAdded };
}

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

  const child = spawn("git", gitArgs, {
    cwd,
    env: {
      ...process.env,
      GIT_PAGER: "cat",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stderr.on("data", (chunk) => {
    const errText = chunk.toString();
    if (errText.includes("fatal:") || errText.includes("error:")) {
      child.stdout.emit("error", new Error(errText.trim()));
    }
  });

  child.on("error", (err) => {
    child.stdout.emit("error", err);
  });

  return child.stdout;
}
