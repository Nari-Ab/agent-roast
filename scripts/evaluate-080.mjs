// Reproduce curated changes against an installed 0.7.0 CLI. No project code runs.
// Usage: node scripts/evaluate-080.mjs /absolute/path/to/0.7.0/dist/cli.js
// This regression set is maintained with the implementation, not an accuracy study.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const previous = process.argv[2];
if (!previous || !path.isAbsolute(previous) || !fs.existsSync(previous)) throw Error('Supply an installed 0.7.0 CLI path.');
const current = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const cases = [
 { name: 'recatch function is not an empty handler', file: 'auth.ts', source: 'function recatch() {}\n', expected: 0 },
 { name: 'Python import alias is not a TS cast', file: 'auth.py', source: 'import typing as any\n', expected: 0 },
 { name: 'Python pass plus real handler', file: 'auth.py', source: 'try:\n    save()\nexcept Exception: pass; report()\n', expected: 0 },
 { name: 'spaced skipped test', file: 'auth.test.ts', source: "test . skip('auth', () => {});\n", expected: 1 },
 { name: 'concurrent skipped test', file: 'auth.test.ts', source: "test.concurrent.skip('auth', () => {});\n", expected: 1 },
 { name: 'multiline skipped test', file: 'auth.test.ts', source: "test\n  .skip('auth', () => {});\n", expected: 1 },
 { name: 'method reference registers no skipped test', file: 'auth.test.ts', source: 'const method = test.skip;\n', expected: 0 },
 { name: 'Rust placeholder with diagnostic arguments', file: 'auth.rs', source: 'fn auth() { todo!("implement auth"); }\n', expected: 1 },
 { name: 'Rust raw string is documentation', file: 'auth.rs', source: 'let example = r#"\ntodo!();\n"#;\n', expected: 0 },
 { name: 'ordinary stubborn error is not a stub', file: 'auth.ts', source: 'throw new Error("stubborn failure");\n', expected: 0 },
 { name: 'multiline vacuous assertion', file: 'auth.test.ts', source: 'expect(\ntrue\n) . toBe(true);\n', expected: 1 },
 { name: 'unknown policy typo fails explicitly', file: 'auth.ts', source: 'const ok = true;\n', policy: { ignorePath: ['**/*'] }, expected: 2 },
 { name: 'coerced rule severity fails explicitly', file: 'auth.test.ts', source: "it.skip('auth');\n", policy: { rules: { 'test-skip': ['off'] } }, expected: 2 },
];
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
const results = [];
for (const sample of cases) {
 const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'roast080-evaluation-'));
 try {
  execFileSync('git', ['init', '-b', 'main'], { cwd, env, stdio: 'pipe' });
  fs.writeFileSync(path.join(cwd, sample.file), sample.source);
  if (sample.policy) fs.writeFileSync(path.join(cwd, '.agentroastrc.json'), JSON.stringify(sample.policy));
  const run = cli => spawnSync(process.execPath, [cli, 'check', cwd, '--fail-on', 'test-skip,test-focus,trivial-assert,type-escape,stub-abandonment,swallowed-error', '--json'], { env, encoding: 'utf8' }).status;
  results.push({ name: sample.name, expectedExit: sample.expected, previousExit: run(previous), currentExit: run(current) });
 } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
// Reproduce actual Git hook candidate selection with commit -a (not a mocked index).
for (const cli of [previous, current]) {
 const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'roast080-hook-evaluation-'));
 const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
 try {
  git('init', '-b', 'main'); git('config', 'user.name', 'Evaluation'); git('config', 'user.email', 'evaluation@example.invalid'); git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(cwd, 'auth.test.ts'), "test('auth', () => {});\n"); git('add', '.'); git('commit', '-m', 'baseline');
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(path.join(cwd, '.git/hooks/pre-commit'), '#!/bin/sh\n' + quote(process.execPath) + ' ' + quote(cli) + ' --staged\n', { mode: 0o755 });
  fs.writeFileSync(path.join(cwd, 'auth.test.ts'), "test.only('auth', () => {});\n");
  const status = spawnSync('git', ['commit', '-am', 'candidate'], { cwd, env, stdio: 'pipe' }).status;
  let row = results.find(row => row.name === 'real git commit -a hook checks its candidate');
  if (!row) { row = { name: 'real git commit -a hook checks its candidate', expectedExit: 1 }; results.push(row); }
  row[cli === previous ? 'previousExit' : 'currentExit'] = status;
 } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ scope: '14 curated synthetic cases; no production accuracy/adoption claim', previousVersion: '0.7.0', currentVersion: '0.8.0-unreleased',
 previousMatched: results.filter(row => row.previousExit === row.expectedExit).length, currentMatched: results.filter(row => row.currentExit === row.expectedExit).length, results }, null, 2));
if (results.some(row => row.currentExit !== row.expectedExit)) process.exitCode = 1;
