export interface CommitInfo {
  hash: string;
  date: string;
  authorName: string;
  authorEmail: string;
  message: string;
  isAiAttributed: boolean;
  aiSignatures: string[];
}

export type DetectorType =
  | "test-skip"
  | "type-escape"
  | "swallowed-error"
  | "panic-loop"
  | "trivial-assert"
  | "stub-abandonment";

export const VALID_DETECTORS: readonly DetectorType[] = [
  "test-skip",
  "type-escape",
  "swallowed-error",
  "panic-loop",
  "trivial-assert",
  "stub-abandonment",
] as const;

export interface Infraction {
  type: DetectorType;
  file?: string;
  lineNumber?: number;
  lineSnippet?: string;
  commitHash: string;
  commitDate: string;
  reason: string;
  suggestion?: string;
}

export interface MetricSummary {
  schemaVersion: string;
  totalLinesAdded: number;
  aiLinesAdded: number;
  totalCommits: number;
  aiCommits: number;
  testSkips: Infraction[];
  typeEscapes: Infraction[];
  swallowedErrors: Infraction[];
  panicLoops: Infraction[];
  trivialAsserts: Infraction[];
  stubAbandonments: Infraction[];
  rawScore: number;
  score: number | null; // 0 - 100 or null if insufficient data
  isSufficientData: boolean;
  archetype: string;
  archetypeDescription: string;
  skippedLongLines?: number;
  skippedUnknownFiles?: number;
}

export interface RoastOptions {
  cwd?: string;
  since?: string;
  all?: boolean;
  verbose?: boolean;
  json?: boolean;
  authors?: boolean;
  ignorePaths?: string[];
  scoreThreshold?: number;
  rules?: Record<string, "error" | "warn" | "off">;
  panicLoopWindowMinutes?: number;
}

export interface PrAuditOptions {
  cwd?: string;
  base?: string;
  head?: string;
  staged?: boolean;
  failOn?: string[];
  format?: "terminal" | "json" | "github" | "markdown";
  verbose?: boolean;
  authors?: boolean;
  ignorePaths?: string[];
  rules?: Record<string, "error" | "warn" | "off">;
}

export interface PrAuditResult {
  mode?: "pr" | "staged";
  schemaVersion: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  hasSupportedChanges: boolean;
  filesInspected: number;
  linesAdded: number;
  defectDensityPer100Lines: number;
  infractions: Infraction[];
  failedRules: string[];
  passed: boolean;
  skippedLongLines: number;
  skippedUnknownFiles: number;
  output: string;
  exitCode: number;
}



export interface CheckOptions {
  cwd?: string;
  failOn?: string[];
  format?: "terminal" | "json" | "github" | "markdown";
  baseline?: string;
  signal?: AbortSignal;
}

export interface CheckResult {
  schemaVersion: string;
  mode: "check";
  filesInspected: number;
  linesInspected: number;
  totalFindings: number;
  infractions: Infraction[];
  baselineCount: number;
  staleBaselineCount: number;
  skippedFiles: { file: string; reason: string }[];
  complete: boolean;
  failedRules: string[];
  passed: boolean;
  exitCode: number;
  output: string;
}
