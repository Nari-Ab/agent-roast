export interface CommitInfo {
  hash: string;
  date: string;
  authorName: string;
  authorEmail: string;
  message: string;
  isAiAttributed: boolean;
  aiSignatures: string[];
}

export type DetectorType = "test-skip" | "type-escape" | "swallowed-error" | "panic-loop";

export const VALID_DETECTORS: readonly DetectorType[] = [
  "test-skip",
  "type-escape",
  "swallowed-error",
  "panic-loop",
] as const;

export interface Infraction {
  type: DetectorType;
  file?: string;
  lineNumber?: number;
  lineSnippet?: string;
  commitHash: string;
  commitDate: string;
  reason: string;
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
  rawScore: number;
  score: number; // 0 - 100
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
}

export interface PrAuditOptions {
  cwd?: string;
  base: string;
  head: string;
  failOn?: string[];
  format?: "terminal" | "json" | "github";
  verbose?: boolean;
}

export interface PrAuditResult {
  schemaVersion: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  hasSupportedChanges: boolean;
  filesInspected: number;
  linesAdded: number;
  infractions: Infraction[];
  failedRules: string[];
  passed: boolean;
  skippedLongLines: number;
  skippedUnknownFiles: number;
  output: string;
  exitCode: number;
}

