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

  it("rejects malformed JSON instead of silently weakening CI policy", () => {
    fs.writeFileSync(path.join(tmpDir, ".agentroastrc.json"), "{ invalid json", "utf8");

    expect(() => loadConfig(tmpDir)).toThrow("Invalid .agentroastrc.json");
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

describe("ignore globs remain bounded and compatible", () => {
  it("finishes a combinatorial wildcard pattern without regex backtracking", () => {
    expect(matchIgnorePath("a".repeat(1000) + ".ts", ["*a".repeat(100) + "b"])).toBe(false);
  });
  it.each([
    ["src/deep/generated/file.ts", "**/generated/**", true],
    ["generated/file.ts", "**/generated/**", true],
    ["src/file.ts", "src/*.ts", true],
    ["src/deep/file.ts", "src/*.ts", false],
    ["src/deep/file.ts", "src/**.ts", true],
    ["src/[literal]/file.ts", "[literal]", true],
    ["src/[malformed/file.ts", "[malformed", true],
    ["src/file1.ts", "file?.ts", true],
    ["src/FILE.TS", "*.ts", true],
    ["src/distinct/file.ts", "dist", false],
    ["src\\generated\\file.ts", "**\\generated\\**", true],
    ["src/xfoo.ts", "**/foo.ts", false],
  ])("matches %s against %s", (filename, pattern, expected) => {
    expect(matchIgnorePath(filename, [pattern])).toBe(expected);
  });
  it("agrees with the previous glob contract over deterministic short paths and patterns", () => {
    const legacy = (filename: string, pattern: string) => {
      let source = "";
      for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === "*" && pattern[i + 1] === "*") { i++; if (pattern[i + 1] === "/") { source += "(?:.*/)?"; i++; } else source += ".*"; }
        else if (char === "*") source += "[^/]*";
        else if (char === "?") source += "[^/]";
        else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
      return new RegExp("(?:^|/)" + source + "(?:$|/)", "i").test(filename);
    };
    let seed = 0x12345678;
    const pick = (items: string[]) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return items[seed % items.length]; };
    const fragments = ["src", "Test", "a", "foo.ts", "[x]", "sub"];
    const patterns = ["*", "**", "?", "*.ts", "**/", "src/", "[x]", "a", "foo.ts", "/"];
    for (let sample = 0; sample < 500; sample++) {
      const filename = [pick(fragments), pick(fragments), pick(fragments)].join("/");
      const pattern = pick(patterns) + pick(patterns) + pick(patterns);
      expect(matchIgnorePath(filename, [pattern]), `${filename} against ${pattern}`).toBe(legacy(filename, pattern));
    }
  });
});
