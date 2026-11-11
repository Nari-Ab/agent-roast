#!/usr/bin/env node
// Compares the per-commit findings of two runs of scripts/benchmark-agents.mjs (made with the same repositories and --seed, one per build,
// each with --out): which commits the second build reports something new on, split into AI-signed and other commits (docs/benchmarks.md, section 7).
// Usage: node scripts/compare-agent-runs.mjs <before.json> <after.json> <corpus-dir> [--list]   (--list names every new finding that blocks)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [beforeFile, afterFile, corpus] = process.argv.slice(2);
const list = process.argv.includes("--list");
const load = (file) => new Map(JSON.parse(fs.readFileSync(file, "utf8")).map((r) => [`${r.repo}@${r.sha}`, r]));
const before = load(beforeFile), after = load(afterFile);
const key = (f) => `${f.type}|${f.file}|${f.line}`;
const BLOCKING = ["assertion-weakened", "guard-weakened", "test-skip", "test-focus", "trivial-assert"];
const subject = (repo, sha) => { try { return execFileSync("git", ["-C", path.join(corpus, repo), "show", "-s", "--format=%s", sha], { encoding: "utf8" }).trim().slice(0, 90); } catch { return ""; } };

const summary = { ai: { reviewed: 0, newCommits: 0, newBlockingCommits: 0, lost: 0, types: {} }, human: { reviewed: 0, newCommits: 0, newBlockingCommits: 0, lost: 0, types: {} } };
const rows = [];
for (const [id, a] of after) {
  const b = before.get(id);
  if (!b || !a.reviewed || !a.complete || !b.reviewed || !b.complete) continue;
  const group = summary[a.group];
  group.reviewed++;
  const had = new Set(b.findings.map(key));
  const has = new Set(a.findings.map(key));
  const added = a.findings.filter((f) => !had.has(key(f)));
  const lost = b.findings.filter((f) => !has.has(key(f)));
  if (lost.length) group.lost += lost.length;
  if (!added.length) continue;
  group.newCommits++;
  if (added.some((f) => BLOCKING.includes(f.type))) group.newBlockingCommits++;
  for (const f of added) group.types[f.type] = (group.types[f.type] || 0) + 1;
  rows.push({ group: a.group, agent: a.agent, repo: a.repo, sha: a.sha, added });
}
console.log(`${path.basename(beforeFile)} -> ${path.basename(afterFile)}`);
for (const g of ["ai", "human"]) {
  const s = summary[g];
  console.log(`  ${g.padEnd(5)} ${s.reviewed} commits compared; ${s.newCommits} with a new finding (${s.newBlockingCommits} that would block); ${s.lost} findings lost; by type ${JSON.stringify(s.types)}`);
}
if (list) {
  for (const row of rows.filter((r) => r.added.some((f) => BLOCKING.includes(f.type)) || process.argv.includes("--all"))) {
    console.log(`\n[${row.group}${row.agent ? ":" + row.agent : ""}] ${row.repo} ${row.sha.slice(0, 10)}  ${subject(row.repo, row.sha)}`);
    for (const f of row.added) console.log(`    ${f.type.padEnd(19)} ${String(f.file).slice(-50)}:${f.line}  ${String(f.evidence || "").slice(0, 100)}`);
  }
}
