import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig, matchIgnorePath, DEFAULT_CONFIG } from "../src/config.js";

describe("Configuration Loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-roast-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns DEFAULT_CONFIG when no config file exists", () => {
    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.failOn).toContain("test-skip");
    expect(config.failOn).toContain("trivial-assert");
  });

  it("loads and parses .agentroastrc.json", () => {
    const customConfig = {
      failOn: ["test-skip", "swallowed-error"],
      ignorePaths: ["**/legacy/**", "autogen/**"],
      scoreThreshold: 75,
      rules: {
        "test-skip": "error",
        "trivial-assert": "warn",
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".agentroastrc.json"),
      JSON.stringify(customConfig, null, 2),
      "utf8"
    );

    const config = loadConfig(tmpDir);
    expect(config.failOn).toEqual(["test-skip", "swallowed-error"]);
    expect(config.ignorePaths).toContain("**/legacy/**");
    expect(config.scoreThreshold).toBe(75);
    expect(config.rules?.["trivial-assert"]).toBe("warn");
  });

  it("loads agent-roast.config.json fallback", () => {
    fs.writeFileSync(
      path.join(tmpDir, "agent-roast.config.json"),
      JSON.stringify({ scoreThreshold: 80 }, null, 2),
      "utf8"
    );

    const config = loadConfig(tmpDir);
    expect(config.scoreThreshold).toBe(80);
    expect(config.failOn).toEqual(DEFAULT_CONFIG.failOn);
  });

  it("handles malformed JSON gracefully by returning defaults", () => {
    fs.writeFileSync(path.join(tmpDir, ".agentroastrc.json"), "{ invalid json", "utf8");

    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("matches ignore paths correctly using glob wildcards and prefixes", () => {
    const ignores = ["**/legacy/**", "autogen/**", "*.pb.go", "dist/*"];

    expect(matchIgnorePath("src/legacy/old_service.ts", ignores)).toBe(true);
    expect(matchIgnorePath("legacy/root.ts", ignores)).toBe(true);
    expect(matchIgnorePath("autogen/api_client.ts", ignores)).toBe(true);
    expect(matchIgnorePath("proto/service.pb.go", ignores)).toBe(true);
    expect(matchIgnorePath("dist/bundle.js", ignores)).toBe(true);

    expect(matchIgnorePath("src/features/new_service.ts", ignores)).toBe(false);
    expect(matchIgnorePath("src/api/auth.ts", ignores)).toBe(false);
  });
});
