#!/usr/bin/env node
// Replays the newest commits of public repositories with two builds of agent-roast and lists what the NEW build reports that
// the OLD one did not, so every added finding can be read in its source (docs/benchmarks.md, section 6).
// Usage: node scripts/benchmark-compare.mjs <work-dir> <old-cli.js> <new-cli.js> [corpus.tsv]
// The corpus (default benchmarks/js-python-corpus.tsv) has one repository per line: group, owner/name, revision. The newest 300
// commits up to the revision are fetched into <work-dir>/repos (an existing clone is reused), both builds replay them, and
// <work-dir>/added.json, dropped.json and summary.json are written. Needs network access and about 3 GB of disk; takes 10 to 30
// minutes. The repositories are only read, and agent-roast never runs their code.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [workArg, oldArg, newArg, corpusArg] = process.argv.slice(2);
if (!workArg || !oldArg || !newArg) { console.error("usage: benchmark-compare.mjs <work-dir> <old-cli.js> <new-cli.js> [corpus.tsv]"); process.exit(2); }
const work = path.resolve(workArg);
const oldCli = path.resolve(oldArg);
const newCli = path.resolve(newArg);
const corpus = fs.readFileSync(corpusArg ? path.resolve(corpusArg) : new URL("../benchmarks/js-python-corpus.tsv", import.meta.url), "utf8")
  .trim().split("\n").map(line => line.split("\t"));
const last = 300;
fs.mkdirSync(path.join(work, "repos"), { recursive: true });

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.resume();
    child.on("error", () => resolve({ status: 1, stdout }));
    child.on("close", status => resolve({ status, stdout }));
  });
}

async function clone(group, repo, revision) {
  const dir = path.join(work, "repos", `${group}__${repo.replace("/", "__")}`);
  if (fs.existsSync(path.join(dir, ".git"))) return dir;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const steps = [
    ["init", "-q", dir],
    ["-C", dir, "remote", "add", "origin", `https://github.com/${repo}.git`],
    ["-C", dir, "fetch", "-q", "--depth", String(last + 1), "--no-tags", "origin", revision || "HEAD"],
    ["-C", dir, "checkout", "-q", "FETCH_HEAD"],
  ];
  for (const args of steps) {
    if ((await run("git", args, { env })).status !== 0) { fs.rmSync(dir, { recursive: true, force: true }); return null; }
  }
  return dir;
}

async function replay(cli, dir) {
  const result = await run(process.execPath, [cli, "replay", dir, "--last", String(last), "--json"], { cwd: work });
  try { return JSON.parse(result.stdout); } catch { return null; }
}

const key = (sha, finding) => [sha, finding.type, finding.file, finding.lineNumber, finding.reason].join("|");
const row = (group, repo, commit, finding) => ({ group, repo, sha: commit.sha.slice(0, 10), subject: commit.subject, status: commit.status, type: finding.type, file: finding.file, line: finding.lineNumber, snippet: finding.lineSnippet, reason: finding.reason });
const added = [];
const dropped = [];
const summary = [];
const queue = [...corpus];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const [group, repo, revision] = queue.shift();
    const dir = await clone(group, repo, revision);
    if (!dir) { summary.push({ group, repo, error: "clone failed" }); continue; }
    const [before, after] = await Promise.all([replay(oldCli, dir), replay(newCli, dir)]);
    if (!before || !after) { summary.push({ group, repo, error: "replay failed" }); continue; }
    const had = new Map(before.commits.flatMap(commit => commit.findings.map(finding => [key(commit.sha, finding), { commit, finding }])));
    const has = new Map(after.commits.flatMap(commit => commit.findings.map(finding => [key(commit.sha, finding), { commit, finding }])));
    for (const [k, { commit, finding }] of has) if (!had.has(k)) added.push(row(group, repo, commit, finding));
    for (const [k, { commit, finding }] of had) if (!has.has(k)) dropped.push(row(group, repo, commit, finding));
    summary.push({ group, repo, commits: after.summary.commits, blockedBefore: before.summary.blocked, blockedAfter: after.summary.blocked, warnedBefore: before.summary.warned, warnedAfter: after.summary.warned });
  }
}));
fs.writeFileSync(path.join(work, "added.json"), JSON.stringify(added, null, 1));
fs.writeFileSync(path.join(work, "dropped.json"), JSON.stringify(dropped, null, 1));
fs.writeFileSync(path.join(work, "summary.json"), JSON.stringify(summary, null, 1));

const measured = summary.filter(item => !item.error);
const total = field => measured.reduce((sum, item) => sum + item[field], 0);
console.log(`${measured.length} repositories, ${total("commits")} commits`);
console.log(`commits that would block: ${total("blockedBefore")} before, ${total("blockedAfter")} after; commits with a warning only: ${total("warnedBefore")} before, ${total("warnedAfter")} after`);
const groups = new Map();
for (const item of added) {
  const name = `${item.type}: ${item.reason.replace(/\s*\(.*$/, "")}`;
  const entry = groups.get(name) ?? { findings: 0, commits: new Set() };
  entry.findings++;
  entry.commits.add(`${item.repo}@${item.sha}`);
  groups.set(name, entry);
}
console.log("new findings, by rule and reason:");
for (const [name, entry] of [...groups].sort((a, b) => b[1].findings - a[1].findings)) console.log(`  ${String(entry.findings).padStart(4)} findings in ${String(entry.commits.size).padStart(3)} commits  ${name}`);
console.log(`findings the old build reported and the new one does not: ${dropped.length}`);
for (const item of summary.filter(entry => entry.error)) console.log(`not measured: ${item.repo} (${item.error})`);
