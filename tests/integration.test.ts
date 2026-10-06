import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { streamGitLog, parseGitLogStream } from "../src/git.js";
import { MetricsCollector } from "../src/metrics.js";
import {
  auditPullRequest,
  GitResolutionError,
  InvalidDetectorError,
} from "../src/index.js";

describe("Real Git Integration with Hostile Environment", () => {
  const tempDir = path.join(process.cwd(), ".tmp-test-repo");
  const hostileConfigPath = path.join(process.cwd(), ".tmp-hostile.gitconfig");

  beforeAll(() => {
    // Create hostile gitconfig
    const hostileConfigContent = `
[diff]
    noprefix = true
    mnemonicPrefix = true
[log]
    showSignature = false
[core]
    quotepath = true
`;
    fs.writeFileSync(hostileConfigPath, hostileConfigContent.trim());
  });

  afterAll(() => {
    fs.rmSync(hostileConfigPath, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles hostile git environment with Cyrillic quotes, no-newline, renames, and PR audit", async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: hostileConfigPath,
    };

    try {
      execSync("git init -b main", { cwd: tempDir, env, stdio: "ignore" });
      execSync('git config user.name "Test Dev"', { cwd: tempDir, env, stdio: "ignore" });
      execSync('git config user.email "dev@test.local"', { cwd: tempDir, env, stdio: "ignore" });
      
      // Also write directly to local repo config to guarantee hostility even if global is bypassed
      execSync("git config diff.noprefix true", { cwd: tempDir, env, stdio: "ignore" });
      execSync("git config diff.mnemonicPrefix true", { cwd: tempDir, env, stdio: "ignore" });
      execSync("git config core.quotepath true", { cwd: tempDir, env, stdio: "ignore" });

      // Commit 1: Initial commit with base files
      fs.writeFileSync(path.join(tempDir, "base.ts"), 'export const initial = "hello";\n');
      execSync("git add base.ts && git commit -m 'feat: initial base'", { cwd: tempDir, env, stdio: "ignore" });

      // Commit 2: File with Cyrillic and quote in filename, plus code type bypass
      const cyrillicQuotedFile = 'тест "кавычка".ts';
      fs.writeFileSync(
        path.join(tempDir, cyrillicQuotedFile),
        'export const val = 123 as any;\n'
      );
      execSync(`git add . && git commit -m 'feat: add cyrillic file'`, { cwd: tempDir, env, stdio: "ignore" });

      // Commit 3: File without trailing newline + skipped test
      fs.writeFileSync(
        path.join(tempDir, "no-newline.test.ts"),
        'it.skip("failing test", () => {})' // NO trailing \n
      );
      execSync("git add no-newline.test.ts && git commit -m 'fix: test with no newline'", {
        cwd: tempDir,
        env,
        stdio: "ignore",
      });

      // Commit 4: Renamed file with modification
      execSync("git mv base.ts renamed-base.ts", { cwd: tempDir, env, stdio: "ignore" });
      fs.appendFileSync(path.join(tempDir, "renamed-base.ts"), 'export const extra = true;\n');
      execSync("git add . && git commit -m 'refactor: rename base and add extra'", { cwd: tempDir, env, stdio: "ignore" });

      // 1. Verify Full History Audit
      const stream = streamGitLog(tempDir, "1 day ago");
      const collector = new MetricsCollector({ all: true });

      const stats = await parseGitLogStream(stream, (commit, s) => {
        collector.processCommit(commit);
        collector.recordSkipped(s);
      });

      const summary = collector.getSummary();

      expect(summary.totalCommits).toBeGreaterThanOrEqual(4);
      expect(summary.testSkips.length).toBe(1);
      expect(summary.typeEscapes.length).toBe(1);
      expect(summary.testSkips[0].reason).toContain("it.skip");
      expect(summary.testSkips[0].file).toContain("no-newline.test.ts");
      expect(summary.typeEscapes[0].reason).toContain("as any");
      expect(summary.typeEscapes[0].file).toBe(cyrillicQuotedFile);

      // 2. PR Mode on feature branch
      execSync("git checkout -b feature/agent-diff", { cwd: tempDir, env, stdio: "ignore" });

      // Add a commit on feature branch with swallowed error
      fs.writeFileSync(
        path.join(tempDir, "service.ts"),
        'try { doSomething(); } catch {} // swallowed!\n'
      );
      execSync("git add service.ts && git commit -m 'feat: add service with catch block'", {
        cwd: tempDir,
        env,
        stdio: "ignore",
      });

      // Audit PR: base = main, head = feature/agent-diff
      const prResult = await auditPullRequest({
        cwd: tempDir,
        base: "main",
        head: "feature/agent-diff",
        failOn: ["swallowed-error"],
      });

      expect(prResult.hasSupportedChanges).toBe(true);
      expect(prResult.filesInspected).toBe(1);
      expect(prResult.infractions.length).toBe(1);
      expect(prResult.infractions[0].type).toBe("swallowed-error");
      expect(prResult.failedRules).toEqual(["swallowed-error"]);
      expect(prResult.passed).toBe(false);
      expect(prResult.exitCode).toBe(1);

      // Audit PR with non-blocking fail-on:
      const prResultNonBlocking = await auditPullRequest({
        cwd: tempDir,
        base: "main",
        head: "feature/agent-diff",
        failOn: ["test-skip"], // only test-skip blocks, swallowed-error is ignored
      });
      expect(prResultNonBlocking.passed).toBe(true);
      expect(prResultNonBlocking.exitCode).toBe(0);

      // Audit PR with non-code changes:
      execSync("git checkout -b chore/docs-only", { cwd: tempDir, env, stdio: "ignore" });
      fs.writeFileSync(path.join(tempDir, "DOCUMENTATION.md"), "# Just Docs\n");
      execSync("git add DOCUMENTATION.md && git commit -m 'docs: update markdown'", { cwd: tempDir, env, stdio: "ignore" });

      const prResultDocs = await auditPullRequest({
        cwd: tempDir,
        base: "feature/agent-diff",
        head: "chore/docs-only",
      });
      expect(prResultDocs.hasSupportedChanges).toBe(false);
      expect(prResultDocs.passed).toBe(true);
      expect(prResultDocs.exitCode).toBe(0);

      // 3. Error Handling in PR Mode
      // Unknown detector in failOn throws InvalidDetectorError
      await expect(
        auditPullRequest({
          cwd: tempDir,
          base: "main",
          head: "feature/agent-diff",
          failOn: [("unknown-detector" as unknown) as import("../src/types.js").DetectorType],
        })
      ).rejects.toThrow(InvalidDetectorError);

      // Non-existent ref throws GitResolutionError
      await expect(
        auditPullRequest({
          cwd: tempDir,
          base: "non-existent-branch-xyz",
          head: "feature/agent-diff",
        })
      ).rejects.toThrow(GitResolutionError);

    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("terminates with exit code 2 promptly when git exits with code 128", () => {
    const emptyDir = path.join(process.cwd(), ".tmp-integration-empty");
    fs.rmSync(emptyDir, { recursive: true, force: true });
    fs.mkdirSync(emptyDir, { recursive: true });

    try {
      const start = Date.now();
      let exitCode = 0;
      let output = "";
      try {
        output = execSync(`node ./dist/cli.js "${emptyDir}"`, {
          cwd: process.cwd(),
          env: {
            ...process.env,
            GIT_CEILING_DIRECTORIES: process.cwd(),
          },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5000,
        });
      } catch (err: any) {
        exitCode = err.status;
        output = (err.stderr || "") + (err.stdout || "");
      }

      const elapsed = Date.now() - start;
      expect(exitCode).toBe(2);
      expect(elapsed).toBeLessThan(4000);
      expect(output).toMatch(/git exited with code 128/i);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

