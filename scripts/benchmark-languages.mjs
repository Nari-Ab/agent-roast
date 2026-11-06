#!/usr/bin/env node
// Replays the newest commits of public repositories in the eight languages added in 0.12.0 and tabulates what the rules
// report, so the findings can be read by hand (docs/benchmarks.md, section 5).
// Usage: node scripts/benchmark-languages.mjs <work-dir> [dist/cli.js]
// Fetches the newest 300 commits up to the revision pinned in benchmarks/language-corpus.tsv (language, repository,
// revision; an empty revision means the current default branch) into <work-dir>/repos, and writes
// <work-dir>/findings.json and <work-dir>/summary.json. An existing clone is reused, so running it twice in the same
// directory compares two builds on the same commits. Needs network access and about 1 GB of disk; takes 10 to 20
// minutes. The repositories are only read, and agent-roast never runs their code.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const work = path.resolve(process.argv[2] || "language-benchmark");
const cli = path.resolve(process.argv[3] || "dist/cli.js");
const corpus = fs.readFileSync(new URL("../benchmarks/language-corpus.tsv", import.meta.url), "utf8").trim().split("\n").map(line => line.split("\t"));
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

async function clone(lang, repo, revision) {
  const dir = path.join(work, "repos", `${lang}__${repo.replace("/", "__")}`);
  if (fs.existsSync(path.join(dir, ".git"))) return dir;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const steps = [
    ["init", "-q", dir],
    ["-C", dir, "remote", "add", "origin", `https://github.com/${repo}.git`],
    ["-C", dir, "fetch", "-q", "--depth", String(last), "--no-tags", "origin", revision || "HEAD"],
    ["-C", dir, "checkout", "-q", "FETCH_HEAD"],
  ];
  for (const args of steps) {
    if ((await run("git", args, { env })).status !== 0) { fs.rmSync(dir, { recursive: true, force: true }); return null; }
  }
  return dir;
}

async function replay(dir) {
  const result = await run(process.execPath, [cli, "replay", dir, "--last", String(last), "--json"], { cwd: work });
  try { return JSON.parse(result.stdout); } catch { return null; }
}

const findings = [];
const summary = [];
const queue = [...corpus];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const [lang, repo, revision] = queue.shift();
    const dir = await clone(lang, repo, revision);
    const result = dir && await replay(dir);
    if (!result) { summary.push({ lang, repo, error: "clone or replay failed" }); continue; }
    for (const commit of result.commits) for (const f of commit.findings) {
      findings.push({ lang, repo, sha: commit.sha.slice(0, 8), subject: commit.subject, status: commit.status, type: f.type, file: f.file, line: f.lineNumber, snippet: f.lineSnippet, reason: f.reason });
    }
    summary.push({ lang, repo, commits: result.summary.commits, blocked: result.summary.blocked, warned: result.summary.warned, failed: result.summary.failed });
  }
}));
fs.writeFileSync(path.join(work, "findings.json"), JSON.stringify(findings, null, 1));
fs.writeFileSync(path.join(work, "summary.json"), JSON.stringify(summary, null, 1));

const measured = summary.filter(row => !row.error);
console.log(`${measured.length} repositories, ${measured.reduce((n, row) => n + row.commits, 0)} commits, ${measured.reduce((n, row) => n + row.blocked, 0)} would have been blocked`);
const rules = ["test-skip", "test-focus", "trivial-assert"];
console.log(["language".padEnd(8), ...rules.map(rule => rule.padStart(15))].join(" "));
for (const lang of [...new Set(corpus.map(row => row[0]))]) {
  console.log([lang.padEnd(8), ...rules.map(rule => String(findings.filter(f => f.lang === lang && f.type === rule).length).padStart(15))].join(" "));
}
for (const row of summary.filter(row => row.error)) console.log(`not measured: ${row.repo} (${row.error})`);
