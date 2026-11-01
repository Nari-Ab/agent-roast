#!/usr/bin/env node
// Compares how often the diff-aware rules fire on commits that carry an AI-agent signature
// with commits in the same repositories that do not. Git history is only read; project code
// is never executed.
//
// Usage: node scripts/benchmark-agents.mjs <repo-dir>... [options]
//   --max-commits N     newest N non-merge commits per repository (default 3000)
//   --ai-cap N          review a seeded random sample of at most N AI-signed relevant commits per repository (default 200)
//   --human-sample N    review a seeded random sample of N other relevant commits (default 150)
//   --seed N            sampling seed (default 1)
//   --concurrency N     parallel reviews (default 4)
//   --list-only         only count commits per group, run no reviews
//   --out FILE          write per-commit results as JSON
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value; };
const maxCommits = Number(option("--max-commits", "3000"));
const aiCap = Number(option("--ai-cap", "200"));
const humanSample = Number(option("--human-sample", "150"));
const seed = Number(option("--seed", "1"));
const concurrency = Number(option("--concurrency", "4"));
const listOnly = flag("--list-only");
const out = option("--out", "");
const repos = args;
if (!repos.length) { console.error("usage: benchmark-agents.mjs <repo-dir>... [options]"); process.exit(2); }

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const BLOCKING = ["assertion-weakened", "guard-weakened"];
const RULES = [...BLOCKING, "test-removed", "expectation-rewritten", "test-skip", "test-focus", "trivial-assert"];
const RELEVANT = /(?:^|\/)(?:test_[^/]+\.py|conftest\.py|(?:tests?|__tests__|specs?)\/|[^/]*[._-](?:test|spec)\.[a-z]+|[^/]*_test\.go|package\.json|tsconfig[^/]*\.json|(?:jest|vitest|vite)\.config\.[a-z]+|\.eslintrc[^/]*|eslint\.config\.[a-z]+|pyproject\.toml|setup\.cfg|tox\.ini|pytest\.ini|\.coveragerc|codecov\.ya?ml|\.gitlab-ci\.ya?ml|\.github\/workflows\/.*)$/i;

// Signatures an agent or its harness leaves in commit metadata. Matching is on the commit
// message and author/committer identity only; it says nothing about how much of the change
// an agent wrote.
const SIGNATURES = [
  ["claude", /co-authored-by:\s*claude\b|generated with \[?claude code|noreply@anthropic\.com|^claude-session:/im],
  ["copilot", /copilot-swe-agent|\+copilot@users\.noreply\.github\.com|co-authored-by:\s*copilot\b/i],
  ["cursor", /cursoragent@cursor\.com|co-authored-by:\s*cursor\b/i],
  ["codex", /co-authored-by:\s*codex\b|codex@openai\.com|chatgpt-codex-connector/i],
  ["devin", /devin-ai-integration|co-authored-by:\s*devin\b/i],
  ["aider", /^aider:|\(aider\)/im],
  ["gemini", /co-authored-by:\s*gemini\b/i],
];
const signatureOf = (text) => SIGNATURES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(list, rand) { const copy = [...list]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n; const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; }
const pct = (x) => (100 * x).toFixed(1) + "%";

async function listCommits(dir) {
  const format = "%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%aI%x1f%B%x1f";
  const { stdout } = await run("git", ["log", "--no-merges", "-n", String(maxCommits), `--format=${format}`, "--name-only"], { cwd: dir, maxBuffer: 512 * 1024 * 1024 });
  const commits = [];
  for (const record of stdout.split("\x1e")) {
    if (!record.trim()) continue;
    const [sha, parents, an, ae, cn, ce, date, message, files] = record.split("\x1f");
    const parent = parents.trim().split(" ")[0];
    if (!parent) continue; // root commit
    const signature = signatureOf(`${an} <${ae}>\n${cn} <${ce}>\n${message}`);
    commits.push({ sha: sha.trim(), parent, date, signature, relevant: files.split("\n").some((f) => RELEVANT.test(f.trim())) });
  }
  return commits;
}

async function review(dir, commit) {
  try {
    const { stdout } = await run(process.execPath, [cli, "review", dir, "--base", commit.parent, "--head", commit.sha, "--format", "json", "--fail-on", ""], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    return JSON.parse(stdout);
  } catch (error) {
    try { return JSON.parse(error.stdout); } catch { return null; }
  }
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await worker(items[i]); }
  }));
  return results;
}

const rand = mulberry32(seed);
const records = [];
for (const repo of repos) {
  const dir = path.resolve(repo);
  const name = path.basename(dir);
  const commits = await listCommits(dir);
  const ai = commits.filter((c) => c.signature && c.relevant);
  const human = commits.filter((c) => !c.signature && c.relevant);
  const chosen = [...shuffled(ai, rand).slice(0, aiCap), ...shuffled(human, rand).slice(0, humanSample)];
  console.log(`${name}: ${commits.length} commits, ${commits.filter((c) => c.signature).length} AI-signed; relevant ${ai.length} AI / ${human.length} other; reviewing ${chosen.length}`);
  if (listOnly) { records.push({ repo: name, commits: commits.length, aiRelevant: ai.length, humanRelevant: human.length }); continue; }
  const results = await pool(chosen, (commit) => review(dir, commit));
  chosen.forEach((commit, i) => {
    const result = results[i];
    records.push({
      repo: name, sha: commit.sha, date: commit.date, group: commit.signature ? "ai" : "human", agent: commit.signature,
      reviewed: Boolean(result), complete: Boolean(result?.complete),
      findings: (result?.infractions ?? []).filter((f) => RULES.includes(f.type)).map((f) => ({ type: f.type, file: f.file, line: f.lineNumber, evidence: f.lineSnippet })),
    });
  });
}

if (!listOnly) {
  console.log("");
  for (const group of ["ai", "human"]) {
    const rows = records.filter((r) => r.group === group && r.reviewed && r.complete);
    const skipped = records.filter((r) => r.group === group).length - rows.length;
    console.log(`${group.toUpperCase()}: ${rows.length} relevant commits reviewed (${skipped} incomplete or failed), ${new Set(rows.map((r) => r.repo)).size} repositories`);
    const blocking = rows.filter((r) => r.findings.some((f) => BLOCKING.includes(f.type))).length;
    const [lo, hi] = wilson(blocking, rows.length);
    console.log(`  blocking rules: ${blocking}/${rows.length} commits = ${pct(blocking / (rows.length || 1))} (95% CI ${pct(lo)}-${pct(hi)})`);
    for (const rule of RULES) {
      const k = rows.filter((r) => r.findings.some((f) => f.type === rule)).length;
      const [l, h] = wilson(k, rows.length);
      console.log(`  ${rule.padEnd(22)} ${String(k).padStart(4)} commits  ${pct(k / (rows.length || 1)).padStart(6)}  (${pct(l)}-${pct(h)})`);
    }
  }
}
if (out) writeFileSync(out, JSON.stringify(records, null, 2));
