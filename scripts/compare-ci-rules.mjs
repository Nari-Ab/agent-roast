#!/usr/bin/env node
// Compares what two builds of the CI rules (src/tampering.ts: `ciTestSteps`, `resolveCiTestSteps`, `analyzeGuardFile`, and the workflows that a workflow calls) report over the newest commits of cloned
// repositories, for the commits that touch a CI file (`.github/workflows/*.yml`, `.gitlab-ci.yml`): the only commits where those rules can say anything. It reads only
// the CI files that a commit changes (one `git cat-file --batch` call per repository) and never runs project code.
//
// `resolveCiTestSteps` is run without a context (no untouched workflows, no tree): a context can only switch a finding off, so a commit that neither build reports without
// one cannot differ with one. The commits that either build reports, or whose counts of test steps or whose calls of reusable workflows differ, are the candidates; write them with --candidates and review them in full with
// both builds (`scripts/rereview-labels.mjs` reads the file as it reads a table of labels).
//
// Usage: node scripts/compare-ci-rules.mjs <old.mjs> <new.mjs> <out.json> <repos-dir>... [--last N] [--candidates candidates.tsv]
//   old.mjs, new.mjs  bundles of src/tampering.ts from the two builds:
//                     npx esbuild src/tampering.ts --bundle --platform=node --format=esm --outfile=new.mjs
//   repos-dir         a folder with one clone per repository, named `owner__name` or `group__owner__name` (the newest N first-parent commits, default 300)
// The result has the totals, the candidates with the findings of both builds, and the changed CI files whose findings of `analyzeGuardFile` differ.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const option = (name, fallback) => { const at = argv.indexOf(name); if (at < 0) return fallback; const value = argv[at + 1]; argv.splice(at, 2); return value; };
const last = Number(option("--last", "300"));
const candidatesFile = option("--candidates", null);
const [oldArg, newArg, outArg, ...roots] = argv;
if (!oldArg || !newArg || !outArg || !roots.length) { console.error("usage: compare-ci-rules.mjs <old.mjs> <new.mjs> <out.json> <repos-dir>... [--last N] [--candidates candidates.tsv]"); process.exit(2); }

const oldModule = await import(path.resolve(oldArg)), newModule = await import(path.resolve(newArg));
const CI = /(?:\.github\/workflows\/|\.gitlab-ci)[^/]*\.ya?ml$|\.gitlab-ci\.yml$/;
const describe = result => result.map(found => `${found.file}|${found.lineSnippet}`);
const guard = found => `${found.type}|${found.lineNumber}|${(found.lineSnippet ?? "").slice(0, 80)}|${found.reason}`;
const countsOf = items => JSON.stringify(items.map(item => [item.file, item.before, item.after, item.reusableAfter, item.ungatedAfter]));
const callsOf = (module, file, oldText, newText) => JSON.stringify([module.gatingCalls(file, oldText ?? ""), module.gatingCalls(file, newText ?? ""), module.lostCalls(file, oldText, newText)]);

const seen = new Set(), candidates = [], guardDiffs = [];
let commits = 0, filesSeen = 0, errors = 0;
for (const root of roots) for (const name of fs.readdirSync(root).sort()) {
  const dir = path.join(root, name);
  if (!fs.existsSync(path.join(dir, ".git"))) continue;
  const parts = name.split("__");
  const repository = parts.length === 3 ? parts.slice(1).join("/") : parts.join("/");
  if (seen.has(repository)) continue;
  seen.add(repository);
  let log;
  try { log = execFileSync("git", ["-C", dir, "log", "--first-parent", "-m", "-n", String(last), "--name-status", "-M", "--format=@@%H %P", "--", ".github/workflows", ".gitlab-ci.yml"], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { continue; }
  const byCommit = new Map();
  let sha = "", parent = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("@@")) { [sha, parent] = line.slice(2).split(" "); if (parent) byCommit.set(sha, []); continue; }
    if (!line || !parent) continue;
    const cols = line.split("\t"), code = cols[0][0];
    const oldPath = cols[1], newPath = code === "R" || code === "C" ? cols[2] : cols[1];
    if (CI.test(newPath) || CI.test(oldPath)) byCommit.get(sha)?.push({ code, oldPath, newPath, parent });
  }
  const wanted = [];
  for (const [commit, files] of byCommit) for (const file of files) { if (file.code !== "A") wanted.push(`${file.parent}:${file.oldPath}`); if (file.code !== "D") wanted.push(`${commit}:${file.newPath}`); }
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
  for (const [commit, files] of byCommit) {
    commits++;
    const before = [], after = [];
    let callsDiffer = false;
    for (const file of files) {
      const oldText = file.code === "A" ? null : blobs.get(`${file.parent}:${file.oldPath}`), newText = file.code === "D" ? null : blobs.get(`${commit}:${file.newPath}`);
      if ((file.code !== "A" && oldText == null) || (file.code !== "D" && newText == null)) continue;
      filesSeen++;
      try {
        const a = oldModule.ciTestSteps(file.newPath, oldText, newText), b = newModule.ciTestSteps(file.newPath, oldText, newText);
        if (a) before.push(a);
        if (b) after.push(b);
        if (callsOf(oldModule, file.newPath, oldText, newText) !== callsOf(newModule, file.newPath, oldText, newText)) callsDiffer = true;
        if (oldText != null && newText != null) {
          const x = oldModule.analyzeGuardFile(file.newPath, oldText, newText, commit).map(guard), y = newModule.analyzeGuardFile(file.newPath, oldText, newText, commit).map(guard);
          if (JSON.stringify(x) !== JSON.stringify(y)) guardDiffs.push({ repository, commit, file: file.newPath, old: x, new: y });
        }
      } catch { errors++; }
    }
    let oldFindings = [], newFindings = [];
    try { oldFindings = describe(oldModule.resolveCiTestSteps(before, commit)); newFindings = describe(newModule.resolveCiTestSteps(after, commit)); } catch { errors++; }
    const countsDiffer = countsOf(before) !== countsOf(after);
    if (oldFindings.length || newFindings.length || countsDiffer || callsDiffer) candidates.push({ repository, commit, oldFindings, newFindings, countsDiffer, callsDiffer });
  }
}
const totals = { repositories: seen.size, commits, changedCiFiles: filesSeen, errors, candidates: candidates.length, countsDiffer: candidates.filter(c => c.countsDiffer).length, callsDiffer: candidates.filter(c => c.callsDiffer).length,
  oldReports: candidates.filter(c => c.oldFindings.length).length, newReports: candidates.filter(c => c.newFindings.length).length, guardFindingsDiffer: guardDiffs.length };
fs.writeFileSync(outArg, JSON.stringify({ totals, candidates, guardDiffs }, null, 1));
if (candidatesFile) fs.writeFileSync(candidatesFile, `${["sample", "repository", "commit", "build", "sorted as"].join("\t")}\n${candidates.map(c => ["ci", c.repository, c.commit, "", "unlabeled"].join("\t")).join("\n")}\n`);
console.log(JSON.stringify(totals));
