// Reproduce a small, curated comparison against an installed 0.6.0 CLI.
// Usage: node scripts/evaluate-staged.mjs /absolute/path/to/0.6.0/dist/cli.js
// Synthetic regression examples, not production precision/recall or user research.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const previous = process.argv[2];
if (!previous || !path.isAbsolute(previous) || !fs.existsSync(previous)) throw new Error('Pass the absolute path to an installed 0.6.0 CLI.');
const current = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const cases = [
  { name: 'deletion-only empty handler', file: 'save.ts', before: 'try { save(); } catch (error) {\n  report(error);\n}\n', after: 'try { save(); } catch (error) {\n}\n', failOn: ['--fail-on', 'swallowed-error'], expected: 1 },
  { name: 'new exclusive test', file: 'auth.test.ts', before: "test('auth', () => {});\n", after: "test.only('auth', () => {});\n", expected: 1 },
  { name: 'focused test alias', file: 'auth.test.ts', before: "it('auth', () => {});\n", after: "fit('auth', () => {});\n", expected: 1 },
  { name: 'example in pre-existing block comment', file: 'auth.ts', before: '/*\nDocumentation\n*/\n', after: "/*\nDocumentation\nit.skip('example');\n*/\n", expected: 0 },
  { name: 'example in pre-existing docstring', file: 'auth.py', before: '"""\nDocumentation\n"""\n', after: '"""\nDocumentation\npytest.skip("example")\n"""\n', expected: 0 },
  { name: 'old debt plus a clean line', file: 'auth.test.ts', before: "it.skip('old');\n", after: "// harmless shift\nit.skip('old');\n", expected: 0 },
  { name: 'partial staging cannot use an unstaged repair', file: 'auth.test.ts', before: "it('auth', () => {});\n", after: "it.skip('auth', () => {});\n", worktree: "it('auth', () => {});\n", expected: 1 },
  { name: 'additional identical shortcut', file: 'auth.test.ts', before: "it.skip('old');\n", after: "it.skip('old');\nit.skip('old');\n", expected: 1 },
  { name: 'ordinary behavior assertion', file: 'auth.test.ts', before: '', after: 'expect(canSignIn(user)).toBe(true);\n', expected: 0 },
];
const results = [];
for (const sample of cases) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'roast-staged-evaluation-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Evaluation'); git('config', 'user.email', 'evaluation@example.invalid'); git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(cwd, sample.file), sample.before); git('add', '.'); git('commit', '-m', 'base');
    fs.writeFileSync(path.join(cwd, sample.file), sample.after); git('add', '.');
    if (sample.worktree) fs.writeFileSync(path.join(cwd, sample.file), sample.worktree);
    const run = cli => spawnSync(process.execPath, [cli, cwd, '--staged', '--json', ...(sample.failOn ?? [])], { cwd, env, encoding: 'utf8' }).status;
    results.push({ name: sample.name, expectedExit: sample.expected, previousExit: run(previous), currentExit: run(current) });
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ scope: '9 curated synthetic staged changes; not independent accuracy evaluation or user adoption', previousVersion: '0.6.0', currentVersion: '0.7.0-unreleased',
  previousMatched: results.filter(row => row.previousExit === row.expectedExit).length,
  currentMatched: results.filter(row => row.currentExit === row.expectedExit).length, results }, null, 2));
if (results.some(row => row.currentExit !== row.expectedExit)) process.exitCode = 1;
