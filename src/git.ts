import { spawn } from "child_process";
import { Readable } from "stream";
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

    const files: ParsedFileDiff[] = [];
    let currentFile: ParsedFileDiff | null = null;
    let currentLineNum = 0;
    let totalAdded = 0;

    const diffLines = rawDiff.split("\n");
    for (const dLine of diffLines) {
      if (dLine.startsWith("diff --git")) {
        // e.g. diff --git a/src/index.ts b/src/index.ts
        const match = dLine.match(/b\/(.+)$/);
        const filePath = match ? match[1] : "unknown";
        currentFile = { path: filePath, addedLines: [] };
        files.push(currentFile);
      } else if (dLine.startsWith("@@")) {
        // e.g. @@ -10,0 +15,2 @@ or @@ -1 +1 @@
        const match = dLine.match(/\+(\d+)/);
        if (match) {
          currentLineNum = parseInt(match[1], 10);
        }
      } else if (dLine.startsWith("+") && !dLine.startsWith("+++")) {
        if (currentFile) {
          currentFile.addedLines.push({
            line: dLine.slice(1),
            lineNumber: currentLineNum,
          });
          totalAdded++;
        }
        currentLineNum++;
      } else if (!dLine.startsWith("-")) {
        currentLineNum++;
      }
    }

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
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
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
      if (buffer.trim()) {
        processBlock(buffer);
      }
      resolve();
    });

    stream.on("error", reject);
  });
}

export function streamGitLog(
  cwd: string = process.cwd(),
  since: string = "90 days ago"
): Readable {
  // Format: \x1e %H \x1f %aI \x1f %an \x1f %ae \x1f %B \x1f
  const gitArgs = [
    "--no-pager",
    "log",
    "-p",
    "-U0",
    "--no-color",
    `--since=${since}`,
    "--format=%x1e%H%x1f%aI%x1f%an%x1f%ae%x1f%B%x1f",
    "--",
    ".",
    ":(exclude)*.lock",
    ":(exclude)*-lock.json",
    ":(exclude)*.lockb",
    ":(exclude)dist",
    ":(exclude)node_modules",
    ":(exclude).drift_venv",
  ];

  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const child = spawn("git", gitArgs, {
    cwd,
    env: {
      ...process.env,
      GIT_PAGER: "cat",
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || nullDevice,
      GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM || nullDevice,
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
