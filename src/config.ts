import * as fs from "fs";
import * as path from "path";

export interface AgentRoastConfig {
  /** Detector rules to fail CI on in PR mode */
  failOn?: string[];
  /** Glob patterns or prefixes to ignore from analysis */
  ignorePaths?: string[];
  /** Minimum passing score for full repository audits (0-100) */
  scoreThreshold?: number;
  /** Granular rule configuration (error | warn | off) */
  rules?: Record<string, "error" | "warn" | "off">;
  /** Maximum minutes between fix commits before flagging panic-loop */
  panicLoopWindowMinutes?: number;
}

export const DEFAULT_CONFIG: AgentRoastConfig = {
  failOn: ["test-skip", "trivial-assert"],
  ignorePaths: [
    "**/fixtures/**",
    "**/__fixtures__/**",
    "**/testdata/**",
    "**/mocks/**",
    "**/test_data/**",
    "**/__snapshots__/**",
    "**/sample/**",
    "**/samples/**",
  ],
  scoreThreshold: 70,
  rules: {
    "test-skip": "error",
    "trivial-assert": "error",
    "swallowed-error": "warn",
    "stub-abandonment": "warn",
    "type-escape": "warn",
  },
};

const CONFIG_FILENAMES = [
  ".agentroastrc.json",
  ".agentroastrc",
  "agent-roast.config.json",
];

/**
 * Discovers and parses repository configuration file.
 * Returns DEFAULT_CONFIG if no configuration file is found or if parsing fails.
 */
export function loadConfig(cwd: string = process.cwd()): AgentRoastConfig {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          return {
            ...DEFAULT_CONFIG,
            ...parsed,
            failOn: Array.isArray(parsed.failOn) ? parsed.failOn : DEFAULT_CONFIG.failOn,
            ignorePaths: Array.isArray(parsed.ignorePaths)
              ? Array.from(new Set([...(DEFAULT_CONFIG.ignorePaths || []), ...parsed.ignorePaths]))
              : DEFAULT_CONFIG.ignorePaths,
            rules: {
              ...DEFAULT_CONFIG.rules,
              ...(parsed.rules || {}),
            },
          };
        }
      } catch (err: any) {
        console.warn(`Warning: Failed to parse ${filename}: ${err.message}. Using default configuration.`);
      }
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Matches a relative or normalized file path against an array of glob ignore patterns.
 */
export function matchIgnorePath(filePath: string, ignorePatterns?: string[]): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return false;
  }

  const normalized = filePath.replace(/\\/g, "/");

  for (const pattern of ignorePatterns) {
    if (!pattern) continue;

    // Convert simple glob pattern to RegExp
    const cleanPattern = pattern.replace(/\\/g, "/");

    let regexPattern = cleanPattern
      .replace(/[.+^${}()|[\]]/g, "\\$&")
      .replace(/\*\*\//g, "(?:^|.*?/)")
      .replace(/\/\*\*/g, "(?:/.*)?")
      .replace(/\*/g, "[^/]*");

    if (!regexPattern.startsWith("^") && !regexPattern.startsWith("(?:^")) {
      regexPattern = "(?:^|/)" + regexPattern;
    }
    if (!regexPattern.endsWith("$")) {
      regexPattern = regexPattern + "(?:$|/)";
    }

    try {
      const rx = new RegExp(regexPattern, "i");
      if (rx.test(normalized)) {
        return true;
      }
    } catch {
      // Fallback substring check if regex compilation fails
      if (normalized.includes(cleanPattern.replace(/\*/g, ""))) {
        return true;
      }
    }
  }

  return false;
}
