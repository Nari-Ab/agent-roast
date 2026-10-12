import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { initProject } from "../src/init.js";

describe("agent-roast init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-roast-init-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates default .agentroastrc.json in an empty directory", async () => {
    const res = await initProject({ cwd: tmpDir, yes: true });
    
    const configPath = path.join(tmpDir, ".agentroastrc.json");
    expect(fs.existsSync(configPath)).toBe(true);
    expect(res.created).toContain(".agentroastrc.json");

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(parsed.scoreThreshold).toBe(70);
    expect(parsed.rules["trivial-assert"]).toBe("warn");
    expect(parsed.rules["stub-abandonment"]).toBe("warn");
    expect(Array.isArray(parsed.ignorePaths)).toBe(true);
  });

  it("does not overwrite existing .agentroastrc.json", async () => {
    const configPath = path.join(tmpDir, ".agentroastrc.json");
    fs.writeFileSync(configPath, JSON.stringify({ scoreThreshold: 99 }), "utf-8");

    const res = await initProject({ cwd: tmpDir, yes: true });
    expect(res.skipped).toContain(".agentroastrc.json");
    
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content.scoreThreshold).toBe(99);
  });

  it("creates GitHub Actions workflow when ci is enabled", async () => {
    const res = await initProject({ cwd: tmpDir, yes: true, ci: true });
    
    const workflowPath = path.join(tmpDir, ".github", "workflows", "agent-roast.yml");
    expect(fs.existsSync(workflowPath)).toBe(true);
    expect(res.created).toContain(".github/workflows/agent-roast.yml");

    const workflowContent = fs.readFileSync(workflowPath, "utf-8");
    expect(workflowContent).toContain("agent-roast");
    expect(workflowContent).toContain("actions/checkout@v4");
  });

  it("creates .git/hooks/pre-commit when hook is enabled and .git exists", async () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));

    const res = await initProject({ cwd: tmpDir, yes: true, hook: true });
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(res.created).toContain(".git/hooks/pre-commit");

    const hookContent = fs.readFileSync(hookPath, "utf-8");
    expect(hookContent).toContain("npx agent-roast");
    
    // Verify file is executable
    const stat = fs.statSync(hookPath);
    // 0o111 checks executable bits
    expect((stat.mode & 0o111) !== 0).toBe(true);
  });

  it("skips pre-commit hook gracefully when .git does not exist", async () => {
    const res = await initProject({ cwd: tmpDir, yes: true, hook: true });
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    expect(fs.existsSync(hookPath)).toBe(false);
    expect(res.skipped).toContain(".git/hooks/pre-commit (no .git directory found)");
  });
});
