#!/usr/bin/env node
// Finds the assertions that were edited in place in the sampled commits of a benchmark-agents run (a removed assertion line next to an
// added one in the same hunk of a test file), sorts each pair by the kind of matcher before and after, and counts the commits where an
// exact check became a bound, or `toEqual(X)` became `toMatchObject(...)`, on the same expression (section 8 of docs/benchmarks.md).
//
// Usage: node scripts/scan-edited-assertions.mjs <run.json> <clones-dir> [--out pairs.json] [--list]
//   run.json     the --out file of scripts/benchmark-agents.mjs; its reviewed commits are scanned
//   clones-dir   the directory that holds the clones, one folder per repository name in run.json
//   --out        write every edited pair as JSON
//   --list       print each commit of the same-expression relaxations with the line before and after
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const run = promisify(execFile);
const args = process.argv.slice(2);
const positional = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--out");
const [runFile, corpus] = positional;
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
if (!runFile || !corpus) { console.error("usage: scan-edited-assertions.mjs <run.json> <clones-dir> [--out pairs.json] [--list]"); process.exit(2); }
const records = JSON.parse(fs.readFileSync(runFile, "utf8")).filter((r) => r.reviewed);

const TEST = /(?:^|\/)(?:tests?|__tests__|specs?|e2e)\/|[._-](?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$/i;
const JS_ASSERT = /(?<![\w$.])expect\s*\(|(?<![\w$.])assert\s*\./;
const PY_ASSERT = /^\s*assert\b|\bself\s*\.\s*assert\w*\s*\(|\bpytest\.raises\b|\bassertRaises/;

// Matcher classes, from the most specific to the least.
const CLASSES = [
  ["exact", /\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*(?!expect\.|undefined|null|true|false)|\bassert\s*\.\s*(?:strictEqual|deepStrictEqual|equal|deepEqual)\b|\bself\.assert(?:Equal|DictEqual|ListEqual|Is)\b|==\s*(?!None|True|False)/],
  ["count", /\.toHaveLength\s*\(\s*\d|\.toHaveBeenCalledTimes\s*\(|len\([^)]*\)\s*==\s*\d|\.call_count\s*==|\.length\)?\.(?:toBe|toEqual)\(\s*\d/],
  ["structure", /\.(?:toMatchObject|toHaveProperty|toContainEqual|toMatch|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\bobjectContaining|\bin\s+\w|\bissubset\b|assertIn|assertDictContainsSubset|assertRegex|\.startswith\(|\.endswith\(|isinstance\s*\(/],
  ["contains", /\.toContain\s*\(|\.toHaveBeenCalledWith\s*\(|\.toHaveBeenLastCalledWith|\.toHaveBeenNthCalledWith|assert_called_with|assert_called_once_with|assert_any_call/],
  ["bound", /\.toBeGreaterThan(?:OrEqual)?\s*\(|\.toBeLessThan(?:OrEqual)?\s*\(|\.toBeCloseTo|[<>]=?\s*[\w.(]|\bapprox\b/],
  ["existence", /\.(?:toBeDefined|toBeTruthy|toBeFalsy|toBeUndefined|toBeNull|toBeInstanceOf)\s*\(|\.toHaveBeenCalled\s*\(\s*\)|\.called\b|assert_called\(\)|is not None|\bassert\s+[\w.\[\]()]+\s*$|assertTrue|assertIsNotNone|\.toThrow\s*\(\s*\)|\bexists\b/],
];
const classOf = (text) => CLASSES.find(([, re]) => re.test(text))?.[0] ?? "other";
const ORDER = ["exact", "count", "structure", "contains", "bound", "existence", "other"];

/** What the assertion looks at: the argument of `expect(...)`, the left side of `assert x == 1`, the first argument of `assert.equal(...)`. */
function subject(text, file) {
  const squash = (value) => value.replace(/\s+/g, "").replace(/^len\((.*)\)$/, "$1").replace(/\.length$/, "");
  if (/\.py$/.test(file)) {
    const operand = /^\s*assert\s+(?:not\s+)?(.+?)\s*(?:==|!=|<=|>=|<|>|\bin\b|\bis\b)/.exec(text)?.[1] ?? /\bself\s*\.\s*assert\w*\s*\(\s*([^,]+?)\s*,/.exec(text)?.[1];
    return operand ? squash(operand) : null;
  }
  const start = text.indexOf("expect(");
  if (start < 0) { const node = /assert\s*\.\s*\w+\s*\(\s*([^,)]+?)\s*(?:,|\)|>=|<=|>|<)/.exec(text)?.[1]; return node ? squash(node) : null; }
  let depth = 0;
  for (let i = start + 6; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return squash(text.slice(start + 7, i));
  }
  return null;
}

async function diffOf(repo, sha) {
  try { return (await run("git", ["-C", path.join(corpus, repo), "show", "--format=", "-U0", "--no-color", "-M", sha], { maxBuffer: 64 * 1024 * 1024 })).stdout; } catch { return null; }
}

const pairs = [];
let next = 0, done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < records.length) {
    const r = records[next++];
    const diff = await diffOf(r.repo, r.sha);
    if (diff === null || diff.length > 30_000_000) continue;
    let file = "", removed = [], added = [];
    const flush = () => {
      if (removed.length && added.length && TEST.test(file)) {
        const assert = /\.py$/.test(file) ? PY_ASSERT : JS_ASSERT;
        for (let i = 0; i < Math.min(removed.length, added.length); i++) {
          if (assert.test(removed[i]) && assert.test(added[i]) && removed[i].trim() !== added[i].trim()) {
            pairs.push({ group: r.group, agent: r.agent, repo: r.repo, sha: r.sha.slice(0, 10), full: r.sha, file, before: removed[i].trim().slice(0, 200), after: added[i].trim().slice(0, 200) });
          }
        }
      }
      removed = []; added = [];
    };
    for (const line of diff.split("\n")) {
      if (line.startsWith("@@") || line.startsWith("diff --git")) { flush(); continue; }
      if (line.startsWith("+++ ")) { file = line.slice(4).replace(/^b\//, ""); continue; }
      if (line.startsWith("--- ")) continue;
      if (line.startsWith("-")) { if (added.length) flush(); removed.push(line.slice(1)); }
      else if (line.startsWith("+")) added.push(line.slice(1));
    }
    flush();
    if (++done % 2000 === 0) console.error(`${done} of ${records.length}`);
  }
}));

const transitions = new Map();
for (const p of pairs) {
  p.from = classOf(p.before); p.to = classOf(p.after);
  p.weaker = ORDER.indexOf(p.to) > ORDER.indexOf(p.from) && p.from !== "other" && p.to !== "other";
  const entry = transitions.get(`${p.from} -> ${p.to}`) ?? { ai: 0, human: 0 };
  entry[p.group === "ai" ? "ai" : "human"]++;
  transitions.set(`${p.from} -> ${p.to}`, entry);
}
console.log(`${pairs.length} edited assertion pairs in ${new Set(pairs.map((p) => p.repo + p.full)).size} commits of ${records.length}`);
const looser = [...transitions].filter(([key]) => { const [a, b] = key.split(" -> "); return ORDER.indexOf(b) > ORDER.indexOf(a) && a !== "other" && b !== "other"; });
for (const [key, e] of looser.sort((a, b) => (b[1].ai + b[1].human) - (a[1].ai + a[1].human))) console.log(`${key.padEnd(24)} AI-signed ${String(e.ai).padStart(4)}  other ${String(e.human).padStart(4)}`);

const same = pairs.filter((p) => p.weaker && subject(p.before, p.file) && subject(p.before, p.file) === subject(p.after, p.file)
  && ((p.from === "exact" && p.to === "bound") || (p.from === "exact" && p.to === "structure" && /toEqual|toStrictEqual/.test(p.before) && /toMatchObject/.test(p.after))));
const commits = new Map();
for (const p of same) commits.set(p.repo + p.full, p);
console.log(`\nexact check turned into a bound, or toEqual into toMatchObject, on the same expression: ${same.length} pairs in ${commits.size} commits`);
if (args.includes("--list")) for (const p of same) console.log(`[${p.group}] ${p.repo.slice(0, 36)} ${p.sha} ${p.file}\n    - ${p.before.slice(0, 110)}\n    + ${p.after.slice(0, 110)}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(pairs, null, 1));
