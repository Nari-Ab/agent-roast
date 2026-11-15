#!/usr/bin/env node
// Compares what two builds of the before/after analysis of test files (src/tampering.ts, `analyzeTestFile`) report over the newest commits of
// cloned repositories, and lists every changed test file whose findings differ. It reads only the test files that a commit changes (one
// `git cat-file --batch` call per repository) and never runs project code, so it answers "what does this change do to the findings" for a rule
// in that file in minutes, where a replay of both builds takes hours.
//
// Usage: node scripts/compare-test-analysis.mjs <old.mjs> <new.mjs> <out.json> <repos-dir>... [--last N] [--jobs N]
//   old.mjs, new.mjs  bundles of src/tampering.ts from the two builds:
//                     npx esbuild src/tampering.ts --bundle --platform=node --format=esm --outfile=new.mjs
//   repos-dir         a folder with one clone per repository (git history of the newest N first-parent commits, default 300)
//   --jobs N          repositories compared at once (default 6)
// The result has the totals and, for each file whose findings differ, the findings of both builds (type, line and the start of the snippet).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const option = (name, fallback) => { const at = argv.indexOf(name); if (at < 0) return fallback; const value = argv[at + 1]; argv.splice(at, 2); return value; };
const last = Number(option("--last", "300"));
const jobs = Number(option("--jobs", "6"));
const one = option("--one", null);
const [oldArg, newArg, outArg, ...reposDirs] = argv;

const CANDIDATE = /\.(?:[cm]?[jt]sx?|py)$|_test\.go$/i;
const TESTISH = /(?:^|\/)(?:tests?|__tests__|specs?|e2e)\/|(?:\.|_)(?:test|spec)\.|(?:^|\/)test_[^/]*\.py$|(?:^|\/)conftest\.py$|_test\.(?:py|go)$/i;
const signature = result => JSON.stringify([
  ...result.immediate.map(f => `${f.type}|${f.lineNumber}|${(f.lineSnippet ?? "").slice(0, 200)}`),
  ...result.rewritten.map(f => `R:${f.type}|${f.lineNumber}|${(f.lineSnippet ?? "").slice(0, 200)}`),
  ...result.removedTests.map(r => `X:${r.finding.lineSnippet}`),
].sort());

async function compareRepository(dir) {
  const oldModule = await import(path.resolve(oldArg)), newModule = await import(path.resolve(newArg));
  const name = path.basename(dir);
  let log;
  try { log = execFileSync("git", ["-C", dir, "log", "--first-parent", "-m", "-n", String(last), "--name-status", "-M", "--format=@@%H %P"], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return { name, commits: 0, files: 0, analyzed: 0, diffs: [] }; }
  const entries = [];
  let sha = "", parent = "", commits = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith("@@")) { const [s, p] = line.slice(2).split(" "); sha = s; parent = p ?? ""; commits++; continue; }
    if (!line || !parent) continue;
    const parts = line.split("\t");
    const code = parts[0][0];
    const oldPath = parts[1], newPath = code === "R" || code === "C" ? parts[2] : parts[1];
    if (CANDIDATE.test(newPath) && (TESTISH.test(newPath) || TESTISH.test(oldPath))) entries.push({ sha, parent, code, oldPath, newPath });
  }
  const wanted = [];
  for (const e of entries) { if (e.code !== "A") wanted.push(`${e.parent}:${e.oldPath}`); if (e.code !== "D") wanted.push(`${e.sha}:${e.newPath}`); }
  const blobs = new Map();
  if (wanted.length) {
    const out = spawnSync("git", ["-C", dir, "cat-file", "--batch"], { input: `${wanted.join("\n")}\n`, maxBuffer: 1 << 30 }).stdout;
    let at = 0;
    for (const ref of wanted) {
      const eol = out.indexOf(10, at);
      if (eol < 0) break;
      const match = /^[0-9a-f]+ \w+ (\d+)$/.exec(out.toString("utf8", at, eol));
      at = eol + 1;
      if (!match) { blobs.set(ref, null); continue; }
      const size = Number(match[1]);
      blobs.set(ref, out.toString("utf8", at, at + size));
      at += size + 1;
    }
  }
  const diffs = [];
  let analyzed = 0;
  for (const e of entries) {
    const oldText = e.code === "A" ? null : blobs.get(`${e.parent}:${e.oldPath}`);
    const newText = e.code === "D" ? null : blobs.get(`${e.sha}:${e.newPath}`);
    if ((e.code !== "A" && oldText == null) || (e.code !== "D" && newText == null)) continue;
    if ((oldText?.length ?? 0) > 400_000 || (newText?.length ?? 0) > 400_000) continue;
    analyzed++;
    try {
      const before = signature(oldModule.analyzeTestFile(e.oldPath, e.newPath, oldText, newText, e.sha));
      const after = signature(newModule.analyzeTestFile(e.oldPath, e.newPath, oldText, newText, e.sha));
      if (before !== after) diffs.push({ repo: name, sha: e.sha.slice(0, 10), file: e.newPath, old: JSON.parse(before), new: JSON.parse(after) });
    } catch (error) { diffs.push({ repo: name, sha: e.sha.slice(0, 10), file: e.newPath, error: String(error).slice(0, 200) }); }
  }
  return { name, commits, files: entries.length, analyzed, diffs };
}

if (one) {
  process.stdout.write(JSON.stringify(await compareRepository(one)));
} else {
  if (!oldArg || !newArg || !outArg || !reposDirs.length) { console.error("usage: compare-test-analysis.mjs <old.mjs> <new.mjs> <out.json> <repos-dir>... [--last N] [--jobs N]"); process.exit(2); }
  const dirs = reposDirs.flatMap(root => fs.readdirSync(root).sort().map(name => path.join(root, name)).filter(dir => fs.existsSync(path.join(dir, ".git"))));
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < dirs.length) {
      const dir = dirs[next++];
      const stdout = await new Promise(resolve => {
        const child = spawn(process.execPath, [process.argv[1], oldArg, newArg, outArg, "--last", String(last), "--one", dir], { stdio: ["ignore", "pipe", "ignore"] });
        let text = "";
        child.stdout.on("data", chunk => text += chunk);
        child.on("close", () => resolve(text));
      });
      try { results.push(JSON.parse(stdout)); } catch { results.push({ name: path.basename(dir), commits: 0, files: 0, analyzed: 0, diffs: [], failed: true }); }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  const totals = { repositories: results.length, commits: 0, changedTestFiles: 0, analyzed: 0, differing: 0 };
  for (const r of results) { totals.commits += r.commits; totals.changedTestFiles += r.files; totals.analyzed += r.analyzed; totals.differing += r.diffs.length; }
  fs.writeFileSync(outArg, JSON.stringify({ totals, diffs: results.flatMap(r => r.diffs) }, null, 1));
  console.log(JSON.stringify(totals));
}
