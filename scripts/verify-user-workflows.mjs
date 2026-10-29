#!/usr/bin/env node
// End-to-end CLI checks in disposable repositories. Never run target project code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve(process.argv[2] || 'dist/cli.js');
const output = process.argv[3] && path.resolve(process.argv[3]);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-roast-workflows-'));
const home = path.join(workspace, 'home'); fs.mkdirSync(home);
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1', npm_config_offline: 'true' };
for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(key)) delete env[key];
const results = [];
const run = (cwd, command, args) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
};
const git = (cwd, ...args) => {
  const result = run(cwd, 'git', args);
  assert.equal(result.status, 0, `git ${args[0]}: ${result.stderr}`);
  return result.stdout.trim();
};
const write = (cwd, file, text) => { const dest = path.join(cwd, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const repo = () => {
  const cwd = fs.mkdtempSync(path.join(workspace, 'repo-'));
  git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.name', 'QA'); git(cwd, 'config', 'user.email', 'qa@example.invalid'); git(cwd, 'config', 'commit.gpgsign', 'false');
  return cwd;
};
const commit = cwd => { git(cwd, 'add', '.'); git(cwd, 'commit', '--allow-empty', '-m', 'fixture'); return git(cwd, 'rev-parse', 'HEAD'); };
const invoke = (cwd, ...args) => run(cwd, process.execPath, [cli, ...args]);
const json = (cwd, ...args) => { const result = invoke(cwd, ...args, '--format', 'json'); return { status: result.status, report: JSON.parse(result.stdout) }; };
const check = cwd => json(cwd, 'check');
const test = (name, fn) => {
  const start = performance.now();
  try { fn(); results.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }); }
  catch (error) { results.push({ name, passed: false, error: error.message, durationMs: Math.round(performance.now() - start) }); }
};

try {
  test('CLI version is available without a project', () => { assert.equal(invoke(workspace, '--version').status, 0); });
  test('check explains missing Git repository', () => { const r = invoke(workspace, 'check'); assert.equal(r.status, 2); assert.ok(r.stderr); });
  test('new project: clean source passes without history', () => {
    const cwd = repo(); write(cwd, 'src/auth.ts', 'export const authorize = (role: string) => role === "admin";\n');
    const r = check(cwd); assert.equal(r.status, 0); assert.equal(r.report.complete, true); assert.equal(r.report.filesInspected, 1);
  });
  test('untracked skipped test blocks before first commit', () => {
    const cwd = repo(); write(cwd, 'auth.test.ts', "test.skip('auth', () => {});\n"); const r = check(cwd); assert.equal(r.status, 1); assert.equal(r.report.infractions[0].type, 'test-skip');
  });
  test('Git-ignored and generated sources do not become project debt', () => {
    const cwd = repo(); write(cwd, '.gitignore', 'private/\n'); write(cwd, 'private/auth.test.ts', "test.only('private');\n"); write(cwd, 'dist/auth.test.ts', "test.only('generated');\n"); write(cwd, 'node_modules/fake/auth.test.ts', "test.only('dependency');\n"); write(cwd, 'auth.ts', 'export const ready = true;\n');
    const r = check(cwd); assert.equal(r.status, 0); assert.equal(r.report.filesInspected, 1);
  });
  test('init from a package creates effective root config and CI', () => {
    const cwd = repo(); fs.mkdirSync(path.join(cwd, 'packages/app'), { recursive: true }); assert.equal(invoke(path.join(cwd, 'packages/app'), 'init', '--ci').status, 0);
    assert.ok(fs.existsSync(path.join(cwd, '.agentroastrc.json'))); assert.ok(fs.existsSync(path.join(cwd, '.github/workflows/agent-roast.yml'))); assert.ok(!fs.existsSync(path.join(cwd, 'packages/app/.agentroastrc.json')));
  });
  test('init retry preserves operator policy bytes', () => {
    const cwd = repo(); write(cwd, '.agentroastrc.json', '{"failOn":[]}\n'); const before = fs.readFileSync(path.join(cwd, '.agentroastrc.json')); assert.equal(invoke(cwd, 'init').status, 0); assert.deepEqual(fs.readFileSync(path.join(cwd, '.agentroastrc.json')), before);
  });
  test('baseline adoption accepts old debt but blocks an identical new occurrence', () => {
    const cwd = repo(); const source = "test.skip('auth', () => {});\n"; write(cwd, 'auth.test.ts', source);
    assert.equal(invoke(cwd, 'check', '--write-baseline', 'baseline.json').status, 0); assert.equal(invoke(cwd, 'check', '--baseline', 'baseline.json').status, 0);
    const before = fs.readFileSync(path.join(cwd, 'baseline.json')); assert.equal(invoke(cwd, 'check', '--write-baseline', 'baseline.json').status, 2); assert.deepEqual(fs.readFileSync(path.join(cwd, 'baseline.json')), before);
    write(cwd, 'auth.test.ts', source.repeat(2)); assert.equal(invoke(cwd, 'check', '--baseline', 'baseline.json').status, 1);
  });
  test('one reviewed exception accepts one occurrence, exposes it in SARIF, and expires', () => {
    const cwd = repo(); const source = "test.skip('auth', () => {});\n"; write(cwd, 'auth.test.ts', source); const finding = check(cwd).report.infractions[0];
    const exception = { fingerprint: finding.fingerprint, count: 1, reason: 'Restore integration sandbox under QA-42', expires: '9999-12-31' };
    write(cwd, '.agentroastrc.json', JSON.stringify({ exceptions: [exception] })); assert.equal(check(cwd).status, 0);
    const sarif = JSON.parse(invoke(cwd, 'check', '--format', 'sarif').stdout); assert.equal(sarif.runs[0].results[0].suppressions[0].status, 'accepted'); assert.equal(invoke(cwd, 'check', '--ignore-exceptions').status, 1);
    write(cwd, 'auth.test.ts', source.repeat(2)); assert.equal(check(cwd).status, 1);
    write(cwd, 'auth.test.ts', source); exception.expires = '2000-01-01'; write(cwd, '.agentroastrc.json', JSON.stringify({ exceptions: [exception] })); assert.equal(check(cwd).status, 1);
  });
  test('review allows line shifts of old debt and does not change HEAD or index', () => {
    const cwd = repo(); write(cwd, 'auth.test.ts', "test.skip('old');\n"); const base = commit(cwd); write(cwd, 'auth.test.ts', "// harmless edit\ntest.skip('old');\n"); const head = commit(cwd); const index = fs.readFileSync(path.join(cwd, '.git/index'));
    const r = json(cwd, 'review', '--base', base); assert.equal(r.status, 0); assert.equal(r.report.unchangedCount, 1); assert.equal(git(cwd, 'rev-parse', 'HEAD'), head); assert.deepEqual(fs.readFileSync(path.join(cwd, '.git/index')), index);
  });
  test('review blocks deletion-only handling regression with formatted catch', () => {
    const cwd = repo(); write(cwd, '.agentroastrc.json', '{"rules":{"swallowed-error":"error"}}'); write(cwd, 'save.ts', 'try { save(); } catch\n (error)\n {\n report(error);\n }\n'); const base = commit(cwd);
    write(cwd, 'save.ts', 'try { save(); } catch\n (error)\n {\n }\n'); commit(cwd); const r = json(cwd, 'review', '--base', base); assert.equal(r.status, 1); assert.equal(r.report.infractions[0].type, 'swallowed-error');
  });
  test('candidate policy cannot disable trusted PR gate', () => {
    const cwd = repo(); const base = commit(cwd); write(cwd, '.agentroastrc.json', '{"failOn":[],"rules":{"test-focus":"off"}}'); write(cwd, 'auth.test.ts', "test.only('auth');\n"); commit(cwd);
    const r = json(cwd, 'review', '--base', base); assert.equal(r.status, 1); assert.ok(r.report.policyChanges.includes('.agentroastrc.json'));
  });
  test('pure rename preserves old-debt identity', () => {
    const cwd = repo(); write(cwd, 'old.test.ts', "test.skip('old');\n"); const base = commit(cwd); git(cwd, 'mv', 'old.test.ts', 'new.test.ts'); commit(cwd); const r = json(cwd, 'review', '--base', base); assert.equal(r.status, 0); assert.equal(r.report.renamedFiles, 1); assert.equal(r.report.unchangedCount, 1);
  });
  test('staged gate reads staged content despite a repaired worktree', () => {
    const cwd = repo(); write(cwd, 'auth.test.ts', "test('auth');\n"); commit(cwd); write(cwd, 'auth.test.ts', "test.only('auth');\n"); git(cwd, 'add', '.'); write(cwd, 'auth.test.ts', "test('auth');\n"); const before = fs.readFileSync(path.join(cwd, '.git/index'));
    assert.equal(json(cwd, '--staged').status, 1); assert.equal(check(cwd).status, 0); assert.deepEqual(fs.readFileSync(path.join(cwd, '.git/index')), before);
  });
  test('first commit cannot approve itself with candidate policy', () => {
    const cwd = repo(); write(cwd, '.agentroastrc.json', '{"failOn":[]}'); write(cwd, 'auth.test.ts', "test.only('auth');\n"); git(cwd, 'add', '.'); assert.equal(json(cwd, '--staged').status, 1);
  });
  test('generated hook blocks commit -a and permits a clean retry', () => {
    const cwd = repo(); write(cwd, 'auth.test.ts', "test('auth');\n"); write(cwd, 'package.json', '{"name":"qa-fixture","version":"1.0.0","private":true}'); commit(cwd);
    const bin = path.join(cwd, 'node_modules/.bin'); fs.mkdirSync(bin, { recursive: true }); fs.symlinkSync(cli, path.join(bin, 'agent-roast')); assert.equal(invoke(cwd, 'init', '--hook').status, 0);
    const before = git(cwd, 'rev-parse', 'HEAD'); write(cwd, 'auth.test.ts', "test.only('auth');\n"); const bad = run(cwd, 'git', ['commit', '-am', 'should be blocked']); assert.equal(bad.status, 1, bad.stderr); assert.equal(git(cwd, 'rev-parse', 'HEAD'), before); assert.ok(fs.readFileSync(path.join(cwd, 'auth.test.ts'), 'utf8').includes('test.only'));
    write(cwd, 'auth.test.ts', "test('auth, repaired');\n"); assert.equal(run(cwd, 'git', ['commit', '-am', 'clean retry']).status, 0);
  });
  test('invalid policy, symlink, binary and oversized source never produce a clean pass', () => {
    for (const kind of ['policy', 'symlink', 'binary', 'oversized']) {
      const cwd = repo();
      if (kind === 'policy') write(cwd, '.agentroastrc.json', '{"rules":{"typo":"off"}}');
      if (kind === 'symlink') fs.symlinkSync('missing', path.join(cwd, 'auth.ts'));
      if (kind === 'binary') write(cwd, 'auth.ts', Buffer.from([0, 1]));
      if (kind === 'oversized') write(cwd, 'auth.ts', 'x'.repeat(2 * 1024 * 1024 + 1));
      assert.equal(invoke(cwd, 'check', '--format', 'json').status, 2, kind);
    }
  });
  test('regular-expression examples do not block a clean project', () => {
    const cwd = repo(); write(cwd, 'auth.test.ts', "const matcher = () => /test.only('example')/;\nif (ready) /test.skip('example')/.test(value);\n"); assert.equal(check(cwd).status, 0);
  });
  test('formatted type assertion remains visible', () => {
    const cwd = repo(); write(cwd, '.agentroastrc.json', '{"rules":{"type-escape":"error"}}'); write(cwd, 'auth.ts', 'const payload = response as\n any;\n'); assert.equal(check(cwd).status, 1);
  });
  test('formatted unfinished implementation remains visible', () => {
    const cwd = repo(); write(cwd, '.agentroastrc.json', '{"rules":{"stub-abandonment":"error"}}'); write(cwd, 'auth.ts', "throw new Error(\n 'Not implemented'\n);\n"); assert.equal(check(cwd).status, 1);
  });
  test('JSON, Markdown, GitHub and SARIF retain the same blocking decision', () => {
    const cwd = repo(); write(cwd, 'auth.test.ts', "test.only('auth');\n");
    for (const format of ['json', 'markdown', 'github', 'sarif']) { const r = invoke(cwd, 'check', '--format', format); assert.equal(r.status, 1, format); assert.ok(r.stdout.includes(format === 'github' ? '::error file=auth.test.ts' : 'test-focus'), format); }
  });
  test('no-source repository reports its lack of source coverage', () => {
    const cwd = repo(); const r = check(cwd); assert.equal(r.report.filesInspected, 0); assert.ok(invoke(cwd, 'check').stdout.includes('No supported source files inspected'));
  });
} finally {
  const report = { generatedAt: new Date().toISOString(), cliVersion: invoke(workspace, '--version').stdout.trim(), runtime: process.version, total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  fs.rmSync(workspace, { recursive: true, force: true });
}
process.exitCode = results.some(result => !result.passed) ? 1 : 0;
