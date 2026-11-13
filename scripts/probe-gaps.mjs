#!/usr/bin/env node
// A search of real commits for the shapes of the gaps that docs/rules.md lists under "What no rule sees" (docs/benchmarks.md, section 13): how often does each shape appear in the ADDED
// lines of the newest N first-parent commits of every repository in the given directories, per kind of file (test, configuration, source)? `git log -p -U0` is streamed, nothing is executed.
// Every hit is kept in <out.json> so that it can be read: a shape is worth a rule only when it is rare in ordinary code and, when it shows, mostly a check that got weaker.
// Usage: node scripts/probe-gaps.mjs <out.json> <N> <dir>...      (each dir holds repositories as subdirectories)
import fs from "node:fs"; import path from "node:path"; import { spawn } from "node:child_process";
const [outFile, nArg, ...dirs] = process.argv.slice(2); const N = +nArg;
if (!outFile || !N || !dirs.length) { console.error("Usage: node scripts/probe-gaps.mjs <out.json> <N> <dir>..."); process.exit(2); }
const TEST = /(?:^|\/)(?:tests?|__tests__|specs?|e2e|integration)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$|(?:^|\/)conftest\.py$/i;
const CONFIG = /(?:^|\/)(?:package\.json|jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|vitest\.workspace\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|\.mocharc[^/]*|karma\.conf\.[cm]?[jt]s|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|noxfile\.py|Makefile|justfile|\.gitlab-ci\.ya?ml|[^/]+\.ya?ml|[^/]+\.sh|\.pre-commit-config\.ya?ml)$/;
const SKIP_PATH = /(?:^|\/)(?:node_modules|vendor|dist|build)\/|(?:package-lock|pnpm-lock|yarn\.lock|poetry\.lock|uv\.lock|Cargo\.lock)|\.snap$/i;
const probes = [
  { id: "py-or-true", kinds: ["test"], re: /^\s*assert\b.*\bor\s+True\b|^\s*self\.assert(?:True|Equal)\(.*\bor\s+True\b/, desc: "assert x or True" },
  { id: "py-assert-true", kinds: ["test"], re: /^\s*assert\s+(?:True|1)\s*(?:#.*)?$|^\s*self\.assertTrue\(\s*(?:True|1)\s*\)/, desc: "assert True / assertTrue(True)" },
  { id: "js-unawaited-resolves", kinds: ["test"], re: /^\s*expect\(.*\)\s*\.\s*(?:resolves|rejects)\b(?!.*(?:await|return))/, desc: "expect(...).resolves/rejects on a line without await/return" },
  { id: "js-custom-matcher-pass-true", kinds: ["test", "config"], re: /pass\s*:\s*true\s*[,}]/, desc: "a custom matcher with pass: true" },
  { id: "runner-exclude-config", kinds: ["config", "test"], re: /\b(?:testPathIgnorePatterns|modulePathIgnorePatterns|testIgnore|grepInvert|norecursedirs|collect_ignore(?:_glob)?)\b/, desc: "a runner option that excludes tests" },
  { id: "runner-exclude-cli", kinds: ["config"], re: /(?:--ignore(?:=|\s)\S*test|--deselect\b|-k\s+["']?not\b|--exclude(?:=|\s)\S*test|--testPathIgnorePatterns|--skip\s+\S*test|-m\s+["']not\s)/i, desc: "a command line that leaves tests out" },
  { id: "retries", kinds: ["config", "test"], re: /\b(?:retries\s*:\s*[1-9]|retryTimes\(|--reruns?\b|--retries\b|@(?:pytest\.mark\.)?flaky\b|pytest\.mark\.flaky|flaky\()/, desc: "a retry count / flaky marker" },
  { id: "timeout-raised", kinds: ["config", "test"], re: /\b(?:jest\.setTimeout\(\s*\d{5,}|testTimeout\s*:\s*\d{5,}|timeout\s*:\s*\d{6,}|@pytest\.mark\.timeout\(\s*\d{3,}|--timeout[= ]\d{3,})/, desc: "a timeout of a minute or more" },
  { id: "snapshot-update", kinds: ["config"], re: /(?:\s-u\b|--update-snapshots?\b|--updateSnapshot\b|UPDATE_SNAPSHOTS?=|--snapshot-update\b|-- -u\b)/, desc: "a snapshot update flag in a command" },
  { id: "or-true", kinds: ["config"], re: /\|\|\s*true\b|;\s*true\s*$|\bexit\s+0\b|\bset\s+\+e\b/, desc: "|| true / exit 0 / set +e" },
  { id: "no-verify", kinds: ["config"], re: /--no-verify\b|SKIP=\S+|HUSKY=0|--no-gpg-sign/, desc: "--no-verify and friends" },
  { id: "exit-zero-in-test", kinds: ["test"], re: /^\s*(?:sys\.exit\(\s*0\s*\)|os\._exit\(\s*0\s*\)|process\.exit\(\s*0\s*\)|exit\(\s*0\s*\))/, desc: "exit(0) in a test file" },
  { id: "always-equal", kinds: ["test", "source"], re: /def\s+__eq__\(self,\s*\w+\)\s*:\s*return\s+True|class\s+Always(?:Equal|True)|__ne__.*return\s+False/, desc: "an object that equals everything" },
  { id: "skipif-true", kinds: ["test"], re: /skip[Ii]f\(\s*(?:True|true|1)\s*[,)]|pytest\.mark\.skipif\(\s*(?:True|1)\s*[,)]/, desc: "skipif(True)" },
  { id: "if-false", kinds: ["test"], re: /^\s*(?:if\s*\(\s*false\s*\)|if\s+False\s*:|if\s+0\s*:|if\s*\(\s*0\s*\))/, desc: "if (false) around code in a test" },
  { id: "todo-test", kinds: ["test"], re: /\b(?:it|test|describe)\.todo\(/, desc: "it.todo / test.todo" },
  { id: "py-except-return-default", kinds: ["source"], re: /^\s*except(?:\s+(?:Exception|BaseException))?(?:\s+as\s+\w+)?\s*:\s*(?:return\s+(?:\[\]|\{\}|None|0|""|''|False|True)\s*)?$/, desc: "a broad except (the line before a default return)", pair: /^\s*return\s+(?:\[\]|\{\}|None|0|""|''|False|True|\(\))\s*(?:#.*)?$/ },
  { id: "special-case-if-return", kinds: ["source"], re: /^\s*(?:if|elif)\s+[\w.\[\]"']+\s*==\s*(?:"[^"]{3,}"|'[^']{3,}'|\d{2,})\s*:\s*$/, desc: "if x == <literal>: (the next line returns a literal)", pair: /^\s*return\s+(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|\[[^\]]*\]|\{[^}]*\})\s*(?:#.*)?$/ },
];
const kindOf = (file) => (TEST.test(file) ? "test" : CONFIG.test(file) ? "config" : /\.(?:py|[cm]?[jt]sx?|go|rs|java|kt|rb|php|cs|swift)$/.test(file) ? "source" : "other");
const hits = Object.fromEntries(probes.map((p) => [p.id, []])); let commits = 0, repos = 0;
import readline from "node:readline";
const stream = (dir) => {
  const p = spawn("git", ["-C", dir, "log", "--first-parent", `-${N}`, "-p", "-U0", "--no-color", "--no-ext-diff", "--diff-filter=AMR", "--format=@@@%H"], { stdio: ["ignore", "pipe", "ignore"] });
  p.on("error", () => {});
  return readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
};
for (const dir of dirs) for (const name of fs.readdirSync(dir).sort()) {
  const full = path.join(dir, name); if (!fs.existsSync(path.join(full, ".git"))) continue;
  repos++;
  let sha = "", file = "", kind = "", prev = null;
  for await (const line of stream(full)) {
    if (line.startsWith("@@@")) { sha = line.slice(3); commits++; file = ""; continue; }
    if (line.startsWith("+++ ")) { file = line.startsWith("+++ b/") ? line.slice(6) : ""; kind = file && !SKIP_PATH.test(file) ? kindOf(file) : ""; prev = null; continue; }
    if (!kind || !line.startsWith("+") || line.startsWith("+++")) { if (!line.startsWith("+")) prev = prev && line.startsWith("@@") ? null : prev; continue; }
    const added = line.slice(1);
    if (added.length > 400) { prev = null; continue; }
    for (const p of probes) {
      if (!p.kinds.includes(kind)) continue;
      if (p.pair) { if (prev && prev.id === p.id && p.pair.test(added)) hits[p.id].push({ repo: name, sha, file, line: `${prev.line.trim()}  ⏎  ${added.trim()}`.slice(0, 200) }); continue; }
      if (p.re.test(added)) hits[p.id].push({ repo: name, sha, file, line: added.trim().slice(0, 200) });
    }
    prev = null;
    for (const p of probes) if (p.pair && p.kinds.includes(kind) && p.re.test(added)) { prev = { id: p.id, line: added }; break; }
  }
}
fs.writeFileSync(outFile, JSON.stringify(hits, null, 1));
console.log(`${repos} repositories, ${commits} commits`);
for (const p of probes) { const h = hits[p.id]; console.log(`${p.id.padEnd(28)} hits ${String(h.length).padStart(6)}  commits ${String(new Set(h.map((x) => x.repo + x.sha)).size).padStart(5)}  repos ${String(new Set(h.map((x) => x.repo)).size).padStart(4)}  ${p.desc}`); }
