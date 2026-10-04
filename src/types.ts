export interface CommitInfo {
  hash: string;
  date: string;
  authorName: string;
  authorEmail: string;
  message: string;
  isAiAttributed: boolean;
  aiSignatures: string[];
}

export interface Infraction {
  type: "test-skip" | "type-escape" | "swallowed-error" | "panic-loop";
  file?: string;
  lineSnippet?: string;
  commitHash: string;
  commitDate: string;
  reason: string;
}

export interface MetricSummary {
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
}

export interface RoastOptions {
  cwd?: string;
  since?: string;
  all?: boolean;
  verbose?: boolean;
  json?: boolean;
}
