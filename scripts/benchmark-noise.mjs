#!/usr/bin/env node
// Measures how often the diff-aware rules fire on ordinary human history.
// Usage: node scripts/benchmark-noise.mjs <repo-dir>... [--commits N] [--out report.json]
// Reads Git history only; project code is never executed.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value; };
const limit = Number(option("--commits", "300"));
const out = option("--out", "");
const repos = args;
if (!repos.length) { console.error("usage: benchmark-noise.mjs <repo-dir>... [--commits N] [--out file]"); process.exit(2); }

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const RULES = ["assertion-weakened", "assertion-removed", "test-removed", "expectation-rewritten", "guard-weakened"];
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const RELEVANT = /(?:^|\/)(?:test_[^/]+\.py|(?:tests?|__tests__|specs?)\/|[^/]*[._-](?:test|spec)\.[a-z]+|package\.json|tsconfig[^/]*\.json|(?:jest|vitest)\.config\.[a-z]+|\.eslintrc[^/]*|eslint\.config\.[a-z]+|pyproject\.toml|setup\.cfg|tox\.ini|\.github\/workflows\/.*)$/i;

const report = [];
for (const repo of repos) {
  const dir = path.resolve(repo);
  const commits = git(dir, "rev-list", "--first-parent", "--no-merges", "-n", String(limit), "HEAD").stdout.split("\n").filter(Boolean);
  const stats = { repo: path.basename(dir), commitsScanned: 0, reviewed: 0, incomplete: 0, findings: Object.fromEntries(RULES.map(r => [r, 0])), commitsFlagged: 0, samples: [] };
  for (const sha of commits) {
    const parent = git(dir, "rev-parse", "--verify", "--quiet", `${sha}^`);
    if (parent.status !== 0) continue;
    stats.commitsScanned++;
    const files = git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", `${sha}^`, sha).stdout.split("\n").filter(Boolean);
    if (!files.some(f => RELEVANT.test(f))) continue;
    const run = spawnSync(process.execPath, [cli, "review", dir, "--base", `${sha}^`, "--head", sha, "--format", "json", "--fail-on", ""], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let result;
    try { result = JSON.parse(run.stdout); } catch { stats.incomplete++; continue; }
    stats.reviewed++;
    if (!result.complete) stats.incomplete++;
    const hits = result.infractions.filter(f => RULES.includes(f.type));
    if (hits.length) stats.commitsFlagged++;
    for (const hit of hits) {
      stats.findings[hit.type]++;
      stats.samples.push({ sha: sha.slice(0, 10), type: hit.type, file: hit.file, line: hit.lineNumber, evidence: hit.lineSnippet });
    }
  }
  report.push(stats);
  const total = Object.values(stats.findings).reduce((a, b) => a + b, 0);
  console.log(`${stats.repo}: ${stats.reviewed} relevant commits reviewed of ${stats.commitsScanned}; ${stats.commitsFlagged} flagged, ${total} findings ${JSON.stringify(stats.findings)}${stats.incomplete ? `, ${stats.incomplete} incomplete` : ""}`);
}
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
