import * as fs from "fs";
import * as path from "path";
import { VALID_DETECTORS } from "./types.js";

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
  failOn: ["test-skip", "trivial-assert", "test-focus"],
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
    "test-focus": "error",
    "swallowed-error": "warn",
    "stub-abandonment": "warn",
    "type-escape": "warn",
  },
};

export const CONFIG_FILENAMES = [
  ".agentroastrc.json",
  ".agentroastrc",
  "agent-roast.config.json",
];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function validateConfig(value: unknown): asserts value is AgentRoastConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("Configuration must be a JSON object.");
  }
  const config = value as Record<string, unknown>;
  const knownRules = new Set<string>(VALID_DETECTORS);
  if (config.failOn !== undefined && (!Array.isArray(config.failOn) ||
      config.failOn.some(rule => typeof rule !== "string" || !knownRules.has(rule)))) {
    throw new ConfigError(`failOn must contain known rules: ${VALID_DETECTORS.join(", ")}`);
  }
  if (config.ignorePaths !== undefined && (!Array.isArray(config.ignorePaths) ||
      config.ignorePaths.some(pattern => typeof pattern !== "string"))) {
    throw new ConfigError("ignorePaths must be an array of strings.");
  }
  if (config.scoreThreshold !== undefined && (typeof config.scoreThreshold !== "number" ||
      !Number.isFinite(config.scoreThreshold) || config.scoreThreshold < 0 || config.scoreThreshold > 100)) {
    throw new ConfigError("scoreThreshold must be a number between 0 and 100.");
  }
  if (config.panicLoopWindowMinutes !== undefined && (typeof config.panicLoopWindowMinutes !== "number" ||
      !Number.isFinite(config.panicLoopWindowMinutes) || config.panicLoopWindowMinutes <= 0)) {
    throw new ConfigError("panicLoopWindowMinutes must be a positive number.");
  }
  if (config.rules !== undefined) {
    if (!config.rules || typeof config.rules !== "object" || Array.isArray(config.rules)) {
      throw new ConfigError("rules must be an object.");
    }
    for (const [rule, level] of Object.entries(config.rules)) {
      if (!knownRules.has(rule) || !["error", "warn", "off"].includes(String(level))) {
        throw new ConfigError(`Invalid rule '${rule}' or level '${level}'. Use known rules with error, warn, or off.`);
      }
    }
  }
}

/** Parse one explicit policy source; shared by worktree and trusted Git reviews. */
export function configFromText(text: string, source: string): AgentRoastConfig {
  try {
    const parsed: unknown = JSON.parse(text);
    validateConfig(parsed);
    const rules = { ...DEFAULT_CONFIG.rules, ...parsed.rules };
    const failOn = parsed.failOn ?? Object.entries(rules)
      .filter(([, level]) => level === "error").map(([rule]) => rule);
    return {
      ...DEFAULT_CONFIG, ...parsed, failOn,
      ignorePaths: [...new Set([...(DEFAULT_CONFIG.ignorePaths || []), ...(parsed.ignorePaths || [])])],
      rules,
    };
  } catch (error) {
    throw new ConfigError(`Invalid ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Invalid policy must stop the audit instead of silently changing CI behavior. */
export function loadConfig(cwd: string = process.cwd()): AgentRoastConfig {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      try { return configFromText(fs.readFileSync(filePath, "utf8"), filename); }
      catch (error) {
        if (error instanceof ConfigError) throw error;
        throw new ConfigError(`Cannot read ${filename}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return configFromText("{}", "default configuration");
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

    // Tokenize globs before expanding them: replacing '*' afterwards corrupts
    // regex fragments generated for '**/' and breaks deep directory matches.
    let regexPattern = "";
    for (let i = 0; i < cleanPattern.length; i++) {
      const char = cleanPattern[i];
      if (char === "*" && cleanPattern[i + 1] === "*") {
        i++;
        if (cleanPattern[i + 1] === "/") {
          regexPattern += "(?:.*/)?";
          i++;
        } else {
          regexPattern += ".*";
        }
      } else if (char === "*") {
        regexPattern += "[^/]*";
      } else if (char === "?") {
        regexPattern += "[^/]";
      } else {
        regexPattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }

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
