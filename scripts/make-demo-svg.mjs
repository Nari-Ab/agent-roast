#!/usr/bin/env node
// Renders the real output of `agent-roast demo` as an animated terminal image (docs/assets/demo-terminal.svg).
// The lines are shortened (the "Next:" hints and the header are dropped) but never edited, so the picture shows what the
// command prints. Usage: node scripts/make-demo-svg.mjs [dist/cli.js] [docs/assets/demo-terminal.svg]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = path.resolve(process.argv[2] || "dist/cli.js");
const out = path.resolve(process.argv[3] || "docs/assets/demo-terminal.svg");
const run = spawnSync(process.execPath, [cli, "demo"], { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: undefined } });
if (run.status !== 0) throw new Error(`demo failed: ${run.stderr}`);

// Parse the SGR colors picocolors writes into styled segments.
const CLASS_OF = { 1: "b", 2: "d", 31: "r", 32: "g", 33: "y", 36: "c" };
function segments(line) {
  const parts = [];
  const active = new Set();
  let last = 0;
  for (const match of line.matchAll(/\u001b\[(\d+)m/g)) {
    if (match.index > last) parts.push({ text: line.slice(last, match.index), classes: [...active] });
    const code = Number(match[1]);
    if (code === 0 || code === 39 || code === 22) { for (const c of code === 22 ? ["b", "d"] : code === 39 ? ["r", "g", "y", "c"] : [...active]) active.delete(c); }
    else if (CLASS_OF[code]) active.add(CLASS_OF[code]);
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), classes: [...active] });
  return parts;
}
const plain = line => line.replace(/\u001b\[\d+m/g, "");

const raw = run.stdout.split("\n");
const keep = [];
for (const line of raw) {
  const text = plain(line);
  if (/^agent-roast demo —/.test(text) || /^What agent-roast reports/.test(text) || /^Use it on your own work/.test(text)) {
    if (/^Use it/.test(text)) break;
    continue;
  }
  if (/^\s+Next:/.test(text) || /^\s+[0-9a-f]{7} → WORKTREE:/.test(text) || /changed files compared/.test(text)) continue;
  if (!text.trim() && (!keep.length || !plain(keep.at(-1)).trim())) continue;
  keep.push(line);
}
while (keep.length && !plain(keep.at(-1)).trim()) keep.pop();
// Findings are separated by blank lines in the terminal; the picture is tighter without them.
for (let i = keep.length - 2; i >= 0; i--) if (!plain(keep[i]).trim() && /^\s+(?:FAIL|WARN) \[/.test(plain(keep[i + 1]))) keep.splice(i, 1);

const LINE = 21, TOP = 52, LEFT = 24, WIDTH = 900, CYCLE = 26;
const lines = [`\u001b[2m$\u001b[22m \u001b[36mnpx agent-roast demo\u001b[39m`, "", ...keep];
const height = TOP + lines.length * LINE + 28;
const escape = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const step = 0.55; // seconds between lines
const css = [], rows = [];
lines.forEach((line, i) => {
  const start = ((0.6 + i * step) / CYCLE * 100).toFixed(2);
  css.push(`@keyframes k${i}{0%,${start}%{opacity:0}${(Number(start) + 0.4).toFixed(2)}%,94%{opacity:1}100%{opacity:0}}.l${i}{animation:k${i} ${CYCLE}s linear infinite}`);
  const spans = segments(line).map(part => `<tspan${part.classes.length ? ` class="${part.classes.join(" ")}"` : ""}>${escape(part.text)}</tspan>`).join("");
  rows.push(`<text class="l${i}" x="${LEFT}" y="${TOP + i * LINE}" xml:space="preserve">${spans}</text>`);
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="agent-roast demo: a scripted fix that weakens an assertion, skips a test, lowers coverage thresholds and lets a CI step fail, and the review that blocks it">
<title>agent-roast demo (real output of &#96;npx agent-roast demo&#96;, shortened)</title>
<style>
text{font:13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono",monospace;fill:#e6edf3;white-space:pre}
.b{font-weight:700}.d{fill:#8b949e}.r{fill:#ff7b72}.g{fill:#3fb950}.y{fill:#e3b341}.c{fill:#79c0ff}
${css.join("\n")}
@media (prefers-reduced-motion:reduce){text{animation:none!important;opacity:1!important}}
</style>
<rect width="${WIDTH}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${WIDTH}" height="34" rx="10" fill="#161b22"/><rect y="24" width="${WIDTH}" height="10" fill="#161b22"/>
<circle cx="22" cy="17" r="6" fill="#ff5f56"/><circle cx="42" cy="17" r="6" fill="#ffbd2e"/><circle cx="62" cy="17" r="6" fill="#27c93f"/>
${rows.join("\n")}
</svg>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(process.cwd(), out)} (${lines.length} lines, ${(svg.length / 1024).toFixed(1)} KiB)`);
