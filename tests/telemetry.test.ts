import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { streamGitLog, parseGitLogStream } from "../src/git.js";

describe("Zero-Telemetry and Security Verification", () => {
  it("verifies compiled distribution bundle contains zero network modules or fetch calls", () => {
    const distDir = path.join(process.cwd(), "dist");
    expect(fs.existsSync(distDir)).toBe(true);

    const distFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".js"));
    expect(distFiles.length).toBeGreaterThan(0);

    const forbiddenTokens = [
      /import\s+.*['"](?:node:)?http['"]/,
      /require\s*\(\s*['"](?:node:)?http['"]\s*\)/,
      /import\s+.*['"](?:node:)?https['"]/,
      /require\s*\(\s*['"](?:node:)?https['"]\s*\)/,
      /import\s+.*['"](?:node:)?net['"]/,
      /require\s*\(\s*['"](?:node:)?net['"]\s*\)/,
      /import\s+.*['"](?:node:)?dns['"]/,
      /require\s*\(\s*['"](?:node:)?dns['"]\s*\)/,
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
    ];

    for (const file of distFiles) {
      const code = fs.readFileSync(path.join(distDir, file), "utf8");
      for (const token of forbiddenTokens) {
        expect(code).not.toMatch(token);
      }
    }
  });

  it("fails gracefully with descriptive error when executed outside a git repository", async () => {
    const nonGitDir = path.join(process.cwd(), ".tmp-non-git-dir");
    fs.rmSync(nonGitDir, { recursive: true, force: true });
    fs.mkdirSync(nonGitDir, { recursive: true });

    const prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = process.cwd();

    try {
      const stream = streamGitLog(nonGitDir, "1 day ago");

      await expect(
        parseGitLogStream(stream, () => {})
      ).rejects.toThrow(/not a git repository/i);
    } finally {
      if (prevCeiling !== undefined) {
        process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
      } else {
        delete process.env.GIT_CEILING_DIRECTORIES;
      }
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
