import path from "path";
import { streamGitLog, parseGitLogStream } from "./git.js";
import { MetricsCollector } from "./metrics.js";
import { formatTerminalCard } from "./renderer.js";
import { MetricSummary, RoastOptions } from "./types.js";

export * from "./types.js";
export * from "./detector.js";
export * from "./git.js";
export * from "./metrics.js";
export * from "./renderer.js";

export async function roastRepository(
  options: RoastOptions = {}
): Promise<{ summary: MetricSummary; output: string }> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const since = options.since || "90 days ago";
  const repoName = path.basename(cwd);

  const collector = new MetricsCollector({ all: options.all });
  const gitStream = streamGitLog(cwd, since);

  await parseGitLogStream(gitStream, (commit) => {
    collector.processCommit(commit);
  });

  const summary = collector.getSummary();
  const output = formatTerminalCard(summary, {
    repoName,
    verbose: options.verbose,
  });

  return { summary, output };
}
