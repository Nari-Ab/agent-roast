#!/usr/bin/env node
// Reviews, with two builds, only the commits of a benchmark-agents run whose diff adds a line that a new rule could fire on, and lists what
// each build reports differently. It gives the answer of a full run of both builds (scripts/benchmark-agents.mjs) in a fraction of the
// time, as long as the rule can only fire on a commit that adds such a line: the two builds are the same code otherwise.
//
// Usage: node scripts/compare-builds-on-diffs.mjs <run.json> <clones-dir> --base <old/dist/cli.js> --cand <new/dist/cli.js> --added <regex> [options]
//   run.json         the --out file of scripts/benchmark-agents.mjs; its reviewed commits are the sample
//   clones-dir       the directory that holds the clones, one folder per repository name in run.json
//   --added <regex>  a commit is kept when a line it adds to a test file matches (JavaScript regex, no flags)
//   --out <file>     write the new and the vanished findings as JSON; the list of kept commits is cached next to it (<file>.kept.json)
//   --concurrency N  commits reviewed at once (default 6)
//
// Example, the rule of 0.17.0 (an exact check turned into a bound on the same expression):
//   node scripts/compare-builds-on-diffs.mjs agents.json ./clones --base ./old/dist/cli.js --cand dist/cli.js --out diff.json \
//     --added '\.(?:toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual|toMatchObject)\s*\(|\bassert\s*\.\s*ok\s*\(|\bassert\b[^#\n]*(?:>=|<=|(?<![-=])>(?!=)|<)|assertGreater|assertLess'
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const positional = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [runFile, corpus] = positional;
const base = option("--base"), cand = option("--cand"), added = option("--added"), outFile = option("--out");
const concurrency = Number(option("--concurrency", "6"));
if (!runFile || !corpus || !base || !cand || !added) {
  console.error("usage: compare-builds-on-diffs.mjs <run.json> <clones-dir> --base <cli.js> --cand <cli.js> --added <regex> [--out file] [--concurrency N]");
  process.exit(2);
}
const pattern = new RegExp(added);
const records = JSON.parse(fs.readFileSync(runFile, "utf8")).filter((r) => r.reviewed);
const TEST = /(?:^|\/)(?:tests?|__tests__|specs?|e2e)\/|[._-](?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$/i;

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

async function keptCommits() {
  const cache = outFile && `${outFile}.kept.json`;
  if (cache && fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  let done = 0;
  const flags = await pool(records, concurrency, async (r) => {
    let diff;
    try { diff = (await run("git", ["-C", path.join(corpus, r.repo), "show", "--format=", "-U0", "--no-color", "-M", r.sha], { maxBuffer: 64 * 1024 * 1024 })).stdout; } catch { return false; }
    if (diff.length > 30_000_000) return false;
    let file = "", hit = false;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++ ")) { file = line.slice(4).replace(/^b\//, ""); continue; }
      if (line.startsWith("+") && TEST.test(file) && pattern.test(line.slice(1))) { hit = true; break; }
    }
    if (++done % 2000 === 0) console.error(`scanned ${done} of ${records.length}`);
    return hit;
  });
  const kept = records.filter((_, i) => flags[i]);
  if (cache) fs.writeFileSync(cache, JSON.stringify(kept));
  return kept;
}

async function review(cli, r) {
  try {
    const { stdout } = await run(process.execPath, [cli, "review", path.join(corpus, r.repo), "--base", `${r.sha}^`, "--head", r.sha, "--format", "json", "--fail-on", ""], { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    return JSON.parse(stdout).infractions ?? [];
  } catch (error) {
    try { return JSON.parse(error.stdout).infractions ?? []; } catch { return null; }
  }
}

const key = (f) => `${f.type}|${f.file}|${(f.lineSnippet ?? "").slice(0, 120)}`;
const kept = await keptCommits();
console.log(`${records.length} reviewed commits in the run; ${kept.length} add a line that matches`);
let finished = 0, failed = 0;
const fresh = [], gone = [];
const commits = (rows) => new Set(rows.map((f) => f.repo + f.sha)).size;
await pool(kept, concurrency, async (r) => {
  const [a, b] = await Promise.all([review(base, r), review(cand, r)]);
  if (!a || !b) failed++;
  else {
    const before = new Set(a.map(key)), after = new Set(b.map(key));
    const row = (f) => ({ group: r.group, agent: r.agent, repo: r.repo, sha: r.sha.slice(0, 10), full: r.sha, type: f.type, file: f.file, snippet: f.lineSnippet });
    // Printed as they are found, so a long run can be read while it goes on.
    for (const f of b) if (!before.has(key(f))) { fresh.push(row(f)); console.log(`NEW  [${r.group}] ${r.repo.slice(0, 40)} ${r.sha.slice(0, 10)} ${f.type} ${f.file}\n       ${(f.lineSnippet ?? "").slice(0, 190)}`); }
    for (const f of a) if (!after.has(key(f))) { gone.push(row(f)); console.log(`GONE [${r.group}] ${r.repo.slice(0, 40)} ${r.sha.slice(0, 10)} ${f.type} ${f.file}\n       ${(f.lineSnippet ?? "").slice(0, 190)}`); }
  }
  if (++finished % 100 === 0) console.error(`reviewed ${finished} of ${kept.length}`);
});
console.log(`reviewed with both builds: ${kept.length - failed}; failed or timed out: ${failed}`);
console.log(`new findings: ${fresh.length} in ${commits(fresh)} commits (AI-signed ${fresh.filter((f) => f.group === "ai").length}, other ${fresh.filter((f) => f.group !== "ai").length})`);
console.log(`findings that disappeared: ${gone.length} in ${commits(gone)} commits`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ kept: kept.length, failed, fresh, gone }, null, 1));
