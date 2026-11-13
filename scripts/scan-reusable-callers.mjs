#!/usr/bin/env node
// Finds, in the newest 300 first-parent commits of each cloned repository, every commit where a changed CI file stops calling a local reusable
// workflow (`uses: ./.github/workflows/sdk.yml`) that it called before, whether by being deleted or by being edited to call something else: the
// gap this measures, and the fix it validates, are in docs/benchmarks.md section 17.
//
// Usage: node scripts/scan-reusable-callers.mjs <clones-dir>...
//   clones-dir   a directory whose immediate subdirectories are cloned repositories; pass one per corpus
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

// A plain restatement of what tampering.ts's `gatingCalls` extracts, for a standalone scan: the local reusable workflows a file calls, read
// without judging whether the caller itself gates (a diagnostic scan may over-collect; what matters for this one is whether a call disappears).
const calls = (text) => [...text.matchAll(/^\s*-?\s*uses:\s*["']?\.\/(\.github\/workflows\/[^\s"'#@]+\.ya?ml)/gm)].map((match) => match[1]);
const lostCalls = (oldText, newText) => { const before = calls(oldText ?? ""), after = new Set(calls(newText ?? "")); return before.filter((workflow) => !after.has(workflow)); };

const roots = process.argv.slice(2);
if (!roots.length) { console.error("usage: node scripts/scan-reusable-callers.mjs <clones-dir>..."); process.exit(1); }

// One `git cat-file --batch` process per repository, so that every blob of its history is read without spawning a process per blob.
class Blobs {
  constructor(dir) {
    this.process = spawn("git", ["-C", dir, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "ignore"] });
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.process.stdout.on("data", (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.drain(); });
  }
  drain() {
    while (this.queue.length) {
      const newline = this.buffer.indexOf(10);
      if (newline < 0) return;
      const header = this.buffer.slice(0, newline).toString();
      if (/ missing$/.test(header)) { this.buffer = this.buffer.slice(newline + 1); this.queue.shift()(null); continue; }
      const match = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
      if (!match) { this.buffer = this.buffer.slice(newline + 1); this.queue.shift()(null); continue; }
      const size = Number(match[2]);
      if (this.buffer.length < newline + 1 + size + 1) return;
      const body = this.buffer.slice(newline + 1, newline + 1 + size).toString("utf8");
      this.buffer = this.buffer.slice(newline + 1 + size + 1);
      this.queue.shift()(body);
    }
  }
  get(spec) { return new Promise((resolve) => { this.queue.push(resolve); this.process.stdin.write(spec + "\n"); }); }
  close() { this.process.stdin.end(); }
}

const WORKFLOW_FILE = /(?:\.github\/workflows\/[^/]+\.ya?ml)$/i;
const git = (dir, args) => {
  try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
  catch { return []; }
};

let repos = 0, commits = 0, changedFiles = 0;
const hits = [];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const repo of fs.readdirSync(root).sort()) {
    const dir = path.join(root, repo);
    if (!fs.existsSync(path.join(dir, ".git"))) continue;
    const window = new Set(git(dir, ["log", "--first-parent", "-300", "--format=%H"]));
    const shas = git(dir, ["log", "--first-parent", "--format=%H", "--", ".github/workflows"]).filter((sha) => window.has(sha));
    if (!shas.length) continue;
    repos++;
    const blobs = new Blobs(dir);
    for (const sha of shas) {
      commits++;
      const changed = git(dir, ["diff-tree", "-r", "--no-renames", "--name-only", "--no-commit-id", `${sha}^1`, sha, "--", ".github/workflows"]).filter((file) => WORKFLOW_FILE.test(file));
      for (const file of changed) {
        changedFiles++;
        const [oldText, newText] = [await blobs.get(`${sha}^1:${file}`), await blobs.get(`${sha}:${file}`)];
        const lost = lostCalls(oldText, newText);
        if (lost.length) hits.push({ repo, dir: root, sha, file, lost });
      }
    }
    blobs.close();
  }
}

console.log(`${repos} repositories, ${commits} commits touching CI files, ${changedFiles} changed CI files;`
  + ` ${new Set(hits.map((hit) => `${hit.repo}:${hit.sha}`)).size} commits (in ${new Set(hits.map((hit) => hit.repo)).size} repositories) where a changed file stops calling a reusable workflow it called before:`);
for (const hit of hits) console.log(`  ${hit.repo} ${hit.sha.slice(0, 9)} ${hit.file} -> ${hit.lost.join(", ")}`);
