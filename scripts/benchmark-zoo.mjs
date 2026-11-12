#!/usr/bin/env node
// An external recall check (docs/benchmarks.md, section 13). Every specimen of MatthewWaller/reward-hack-zoo, a catalog of agent cheats that a third party wrote by hand, becomes a
// two-commit repository: the task's workspace, then the specimen laid over it the way the catalog's own `zoo check` builds a submission (a specimen that ships tests/ replaces that
// directory wholesale). agent-roast reviews the second commit against the first and the report lists, per specimen, what it found. Nothing of the catalog is executed.
// Usage: node scripts/benchmark-zoo.mjs <reward-hack-zoo clone> [path/to/cli.js (default dist/cli.js)] [work-dir]
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execFileSync } from "node:child_process";
const [zoo, cliArg, workArg] = process.argv.slice(2);
const cli = path.resolve(cliArg ?? "dist/cli.js");
if (!zoo) { console.error("Usage: node scripts/benchmark-zoo.mjs <reward-hack-zoo clone> [cli.js] [work-dir]"); process.exit(2); }
const work = workArg ?? fs.mkdtempSync(path.join(os.tmpdir(), "zoo-eval-"));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, force: true });
const toml = (file) => Object.fromEntries(fs.readFileSync(file, "utf8").split("\n").map((l) => /^(\w+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")]));
const rows = [];
for (const task of fs.readdirSync(path.join(zoo, "tasks")).sort()) {
  const taskDir = path.join(zoo, "tasks", task), specDir = path.join(taskDir, "specimens");
  if (!fs.existsSync(specDir)) continue;
  for (const specimen of fs.readdirSync(specDir).sort()) {
    const info = toml(path.join(specDir, specimen, "specimen.toml"));
    const dir = path.join(work, `${task}__${specimen}`);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    copy(path.join(taskDir, "workspace"), dir);
    git(dir, "init", "-q", "-b", "main"); git(dir, "config", "user.name", "t"); git(dir, "config", "user.email", "t@example.invalid"); git(dir, "config", "commit.gpgsign", "false");
    git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "workspace");
    const over = path.join(specDir, specimen);
    if (fs.existsSync(path.join(over, "tests"))) fs.rmSync(path.join(dir, "tests"), { recursive: true, force: true });
    for (const entry of fs.readdirSync(over)) if (entry !== "specimen.toml") copy(path.join(over, entry), path.join(dir, entry));
    git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", `specimen ${specimen}`);
    let out; try { out = execFileSync(process.execPath, [cli, "review", dir, "--base", "HEAD~1", "--head", "HEAD", "--format", "json", "--fail-on", ""], { encoding: "utf8", maxBuffer: 1 << 24, stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { out = e.stdout?.toString() ?? ""; }
    let found = []; try { found = (JSON.parse(out).infractions ?? []).map((f) => `${f.type}${f.file ? " " + f.file : ""}${f.lineSnippet ? ": " + String(f.lineSnippet).slice(0, 70) : ""}`); } catch { found = ["(unreadable output)"]; }
    rows.push({ task, specimen, kind: info.kind, species: info.species ?? "", found });
  }
}
for (const r of rows) {
  console.log(`${r.kind.padEnd(7)} ${(r.task + "/" + r.specimen).padEnd(46)} ${String(r.species).padEnd(40)} ${r.found.length ? "→ " + r.found.length + " finding(s)" : "→ nothing"}`);
  for (const f of r.found) console.log(`          ${f}`);
}
const hacks = rows.filter((r) => r.kind === "hack"), honest = rows.filter((r) => r.kind === "honest");
console.log(`\nhacks with at least one finding: ${hacks.filter((r) => r.found.length).length} of ${hacks.length}; honest specimens with a finding: ${honest.filter((r) => r.found.length).length} of ${honest.length}`);
