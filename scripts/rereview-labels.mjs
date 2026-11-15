#!/usr/bin/env node
// Reviews every commit of benchmarks/section9-labels.tsv again with two builds (`review --base <commit>^1 --head <commit>`) and writes, for
// each row, whether each build blocks it, with the rows whose findings differ listed in full. The commits are read from clones; a row whose
// repository has no clone is counted and left out.
//
// Usage: node scripts/rereview-labels.mjs <labels.tsv> <old-cli.js> <new-cli.js> <out.json> <repos-dir>... [--jobs N]
//   repos-dir  a folder with one clone per repository, named `owner__name` or `group__owner__name`
// The summary printed at the end counts the rows by their label and by what the two builds do with them.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const at = argv.indexOf("--jobs");
const jobs = at < 0 ? 6 : Number(argv.splice(at, 2)[1]);
const [tsvArg, oldCli, newCli, outArg, ...reposDirs] = argv;
if (!tsvArg || !oldCli || !newCli || !outArg || !reposDirs.length) { console.error("usage: rereview-labels.mjs <labels.tsv> <old-cli.js> <new-cli.js> <out.json> <repos-dir>... [--jobs N]"); process.exit(2); }

const rows = fs.readFileSync(tsvArg, "utf8").split("\n").slice(1).filter(Boolean).map(line => line.split("\t"));
const clones = new Map();
for (const root of reposDirs) {
  for (const name of fs.readdirSync(root)) {
    const parts = name.split("__");
    for (const key of [parts.join("/"), parts.slice(1).join("/")]) if (!clones.has(key)) clones.set(key, path.join(root, name));
  }
}

function review(cli, dir, sha) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.resolve(cli), "review", "--base", `${sha}^1`, "--head", sha, "--format", "json"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", chunk => out += chunk);
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try { const result = JSON.parse(out); resolve({ passed: result.passed, failed: result.failedRules, findings: result.infractions.map(f => `${f.type}|${f.file}|${f.lineNumber}|${(f.lineSnippet ?? "").slice(0, 140)}`).sort() }); }
      catch { resolve(null); }
    });
  });
}

const results = [];
let next = 0, missing = 0;
async function worker() {
  while (next < rows.length) {
    const [sample, repository, commit, , sortedAs] = rows[next++];
    const dir = clones.get(repository);
    if (!dir) { missing++; continue; }
    const [before, after] = await Promise.all([review(oldCli, dir, commit), review(newCli, dir, commit)]);
    results.push({ sample, repository, commit: commit.slice(0, 10), sortedAs, old: before, now: after });
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

const blocked = outcome => outcome !== null && outcome.passed === false;
const changed = results.filter(r => JSON.stringify(r.old) !== JSON.stringify(r.now));
const summary = {};
for (const r of results) {
  const key = `${r.sortedAs}: old ${blocked(r.old) ? "blocks" : "passes"}, new ${blocked(r.now) ? "blocks" : "passes"}`;
  summary[key] = (summary[key] ?? 0) + 1;
}
fs.writeFileSync(outArg, JSON.stringify({ rows: rows.length, reviewed: results.length, noClone: missing, summary, changed, all: results.map(r => ({ sample: r.sample, repository: r.repository, commit: r.commit, sortedAs: r.sortedAs, oldBlocks: blocked(r.old), newBlocks: blocked(r.now) })) }, null, 1));
console.log(`rows ${rows.length}, reviewed ${results.length}, no clone ${missing}, findings differ in ${changed.length}`);
for (const [key, count] of Object.entries(summary).sort()) console.log(`${String(count).padStart(5)}  ${key}`);
