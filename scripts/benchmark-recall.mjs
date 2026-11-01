#!/usr/bin/env node
// Runs benchmarks/cases.mjs through the built CLI in throwaway Git repositories.
// Usage: npm run build && node scripts/benchmark-recall.mjs [--json]
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cases } from "../benchmarks/cases.mjs";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function git(dir, ...args) {
  const run = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}
function apply(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file);
    if (text === null) { rmSync(target, { force: true }); continue; }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

const rows = [];
for (const testCase of cases) {
  const dir = mkdtempSync(path.join(tmpdir(), "roast-bench-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "Bench"); git(dir, "config", "user.email", "bench@example.invalid"); git(dir, "config", "commit.gpgsign", "false");
    apply(dir, { "README.md": "bench\n", ...testCase.before });
    git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "before");
    const base = git(dir, "rev-parse", "HEAD");
    apply(dir, testCase.after);
    git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "after");
    const run = spawnSync(process.execPath, [cli, "review", dir, "--base", base, "--format", "json", "--fail-on", ""], { encoding: "utf8", env });
    const result = JSON.parse(run.stdout);
    const found = [...new Set(result.infractions.map((finding) => finding.type))];
    const hit = testCase.expect === "miss" ? found.length === 0
      : testCase.expect === null ? found.length === 0
      : found.includes(testCase.expect);
    const kind = testCase.expect === null ? "control" : testCase.expect === "miss" ? "gap" : "cheat";
    rows.push({ name: testCase.name, kind, expected: testCase.expect, found, ok: hit && result.complete });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const tally = (kind) => ({ total: rows.filter((r) => r.kind === kind).length, ok: rows.filter((r) => r.kind === kind && r.ok).length });
const cheat = tally("cheat"), control = tally("control"), gap = tally("gap");
if (process.argv.includes("--json")) console.log(JSON.stringify({ cheat, control, gap, rows }, null, 2));
else {
  for (const row of rows) console.log(`${row.ok ? "ok  " : "FAIL"} ${row.kind.padEnd(7)} ${row.name}${row.ok ? "" : `  (expected ${row.expected ?? "nothing"}, found ${row.found.join(",") || "nothing"})`}`);
  console.log(`\ncheats caught: ${cheat.ok}/${cheat.total} · harmless changes left alone: ${control.ok}/${control.total} · documented gaps still open: ${gap.ok}/${gap.total}`);
}
process.exit(rows.some((r) => !r.ok && r.kind !== "gap") ? 1 : 0);
