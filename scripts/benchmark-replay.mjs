#!/usr/bin/env node
// Replays the newest commits of each repository with `agent-roast replay --json` and summarizes what a
// first-time user would see: how many commits would have been blocked or drew a warning, and how long
// it took. Git history is only read; project code is never executed.
//
// Usage: node scripts/benchmark-replay.mjs <repo-dir>... [options]
//   --last N            newest commits per repository (default 50)
//   --concurrency N     repositories replayed in parallel (default 3)
//   --cli FILE          CLI entry to run (default dist/cli.js); point it at a frozen install so a rebuild cannot change a run
//   --out FILE          write the per-repository summaries as JSON
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value; };
const last = option("--last", "50");
const concurrency = Number(option("--concurrency", "3"));
const out = option("--out", "");
const cli = path.resolve(option("--cli", fileURLToPath(new URL("../dist/cli.js", import.meta.url))));
const repos = args;
if (!repos.length) { console.error("usage: benchmark-replay.mjs <repo-dir>... [options]"); process.exit(2); }

async function replay(dir) {
  const started = process.hrtime.bigint();
  const row = { repo: path.basename(path.resolve(dir)) };
  try {
    const { stdout } = await run(process.execPath, [cli, "replay", "--last", last, "--json"], { cwd: dir, maxBuffer: 512 * 1024 * 1024, timeout: 1_200_000 });
    const { summary, commits } = JSON.parse(stdout);
    Object.assign(row, { summary, blockedBy: commits.flatMap((commit) => commit.failedRules) });
  } catch (error) {
    row.error = String(error.stderr || error.message).trim().slice(0, 200);
  }
  row.seconds = Number(process.hrtime.bigint() - started) / 1e9;
  return row;
}

const rows = new Array(repos.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, repos.length) }, async () => {
  while (next < repos.length) { const i = next++; rows[i] = await replay(repos[i]); }
}));

const ok = rows.filter((row) => row.summary);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const quantile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0; };
const share = (count, total) => `${(100 * count / (total || 1)).toFixed(1)}%`;
const commits = ok.reduce((sum, row) => sum + row.summary.commits, 0);

console.log(`repositories: ${rows.length} (${rows.length - ok.length} failed)`);
console.log(`commits reviewed: ${commits}`);
for (const status of ["blocked", "warned", "noted", "clean", "untouched", "incomplete", "failed"]) {
  const count = ok.reduce((sum, row) => sum + row.summary[status], 0);
  console.log(`  ${status.padEnd(10)} ${String(count).padStart(6)}  ${share(count, commits)}`);
}
for (const [status, label] of [["blocked", "commits that would have been blocked"], ["warned", "commits with a warning about a weakened check"]]) {
  const values = ok.map((row) => row.summary[status]);
  const none = values.filter((value) => value === 0).length;
  console.log(`per repository, ${label}: median ${median(values)}, p90 ${quantile(values, 0.9)}, max ${Math.max(0, ...values)}, none in ${none} of ${ok.length} (${share(none, ok.length)})`);
}
const quiet = ok.filter((row) => row.summary.blocked + row.summary.warned === 0).length;
console.log(`repositories with nothing to list: ${quiet} of ${ok.length} (${share(quiet, ok.length)})`);
const seconds = rows.map((row) => row.seconds);
console.log(`seconds per repository: median ${median(seconds).toFixed(1)}, p90 ${quantile(seconds, 0.9).toFixed(1)}, max ${Math.max(0, ...seconds).toFixed(1)}`);
const blockedBy = {};
for (const row of ok) for (const rule of row.blockedBy) blockedBy[rule] = (blockedBy[rule] ?? 0) + 1;
console.log("blocking rules on blocked commits:", JSON.stringify(blockedBy));
for (const row of rows.filter((entry) => entry.error)) console.log(`failed: ${row.repo}: ${row.error}`);
if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
