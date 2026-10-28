import * as fs from "fs";
import * as path from "path";
import { VALID_DETECTORS } from "./types.js";
import { readRegularFile } from "./file-read.js";
import { validateExceptions } from "./exceptions.js";
import type { FindingException } from "./exceptions.js";

export const MAX_CONFIG_BYTES = 64 * 1024;

export interface AgentRoastConfig {
  /** Reviewed, occurrence-limited allowances that expire on a calendar date. */
  exceptions?: FindingException[];
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
  const supported = new Set(["$schema", "failOn", "ignorePaths", "scoreThreshold", "rules", "panicLoopWindowMinutes", "exceptions"]);
  for (const key of Object.keys(config)) if (!supported.has(key)) throw new ConfigError(`Unknown configuration setting '${key}'.`);
  if (config.$schema !== undefined && typeof config.$schema !== "string") throw new ConfigError("$schema must be a string.");
  validateExceptions(config.exceptions);
  const knownRules = new Set<string>(VALID_DETECTORS);
  if (config.failOn !== undefined && (!Array.isArray(config.failOn) ||
      config.failOn.some(rule => typeof rule !== "string" || !knownRules.has(rule)))) {
    throw new ConfigError(`failOn must contain known rules: ${VALID_DETECTORS.join(", ")}`);
  }
  if (config.ignorePaths !== undefined && (!Array.isArray(config.ignorePaths) || config.ignorePaths.length > 1000 ||
      config.ignorePaths.some(pattern => typeof pattern !== "string" || pattern.length > 1024))) {
    throw new ConfigError("ignorePaths must contain at most 1000 strings, each no longer than 1024 characters.");
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
      if (!knownRules.has(rule) || typeof level !== "string" || !["error", "warn", "off"].includes(level)) {
        throw new ConfigError(`Invalid rule '${rule}' or level '${level}'. Use known rules with error, warn, or off.`);
      }
    }
  }
}

/** Parse one explicit policy source; shared by worktree and trusted Git reviews. */
export function configFromText(text: string, source: string): AgentRoastConfig {
  try {
    if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) throw new ConfigError("Configuration exceeds the 64 KiB limit.");
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
    try { fs.lstatSync(filePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new ConfigError(`Cannot inspect ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
    {
      try { return configFromText(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(filePath, MAX_CONFIG_BYTES)), filename); }
      catch (error) {
        if (error instanceof ConfigError) throw error;
        throw new ConfigError(`Cannot read ${filename}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return configFromText("{}", "default configuration");
}

type GlobToken = { kind: "literal"; value: string } | { kind: "star" | "globstar" | "directoryStart" | "directoryBody" | "question" };

/** A small wildcard NFA. Unlike expanding globs into backtracking regexes, work
 * is bounded by filename length times pattern length, even for adversarial input.
 * Matching remains case-insensitive and may begin/end at directory boundaries. */
function matchesGlob(filename: string, pattern: string): boolean {
  const tokens: GlobToken[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") { tokens.push({ kind: "directoryStart" }, { kind: "directoryBody" }); i++; }
      else tokens.push({ kind: "globstar" });
    } else if (pattern[i] === "*") tokens.push({ kind: "star" });
    else if (pattern[i] === "?") tokens.push({ kind: "question" });
    else tokens.push({ kind: "literal", value: pattern[i].toLowerCase() });
  }
  const closure = (states: Set<number>) => {
    const queue = [...states];
    for (let i = 0; i < queue.length; i++) {
      const state = queue[i];
      const kind = tokens[state]?.kind;
      const add = (next: number) => { if (!states.has(next)) { states.add(next); queue.push(next); } };
      if (kind === "star" || kind === "globstar") add(state + 1);
      else if (kind === "directoryStart") { add(state + 1); add(state + 2); }
    }
    return states;
  };
  let states = new Set<number>();
  for (let offset = 0; offset <= filename.length; offset++) {
    if (!offset || filename[offset - 1] === "/") states.add(0);
    closure(states);
    if (states.has(tokens.length) && (offset === filename.length || filename[offset] === "/")) return true;
    if (offset === filename.length) break;
    const char = filename[offset];
    const next = new Set<number>();
    for (const state of states) {
      const token = tokens[state];
      if (!token) continue;
      if (token.kind === "literal") { if (token.value === char.toLowerCase()) next.add(state + 1); }
      else if (token.kind === "question") { if (char !== "/") next.add(state + 1); }
      else if (token.kind === "star") { if (char !== "/") next.add(state); }
      else if (token.kind === "globstar") next.add(state);
      else if (token.kind === "directoryBody") { next.add(state); if (char === "/") next.add(state + 1); }
    }
    states = next;
  }
  return false;
}

export function matchIgnorePath(filePath: string, ignorePatterns?: string[]): boolean {
  if (!ignorePatterns?.length) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return ignorePatterns.some(pattern => Boolean(pattern) && matchesGlob(normalized, pattern.replace(/\\/g, "/")));
}
