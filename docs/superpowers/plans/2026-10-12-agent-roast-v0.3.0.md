# agent-roast v0.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement agent-roast v0.3.0 with two new detection rules (`trivial-assert`, `stub-abandonment`), a configuration file system (`.agentroastrc.json`), and an interactive setup command (`agent-roast init`).

**Architecture:** Pure TypeScript modular architecture. Add `src/config.ts` for zero-dependency config discovery and validation; expand `src/metrics.ts` and `src/types.ts` with new AST-free streaming regex patterns for test assertions and stub abandonments; update `src/cli.ts` with config precedence and the `init` subcommand.

**Tech Stack:** TypeScript, Node.js (>=18), Commander, Picocolors, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-12-agent-roast-v0.3.0-design.md](file:///Users/sidzuya/.gemini/antigravity-ide/scratch/agent-roast/docs/superpowers/specs/2026-10-12-agent-roast-v0.3.0-design.md)

## Global Constraints

- 100% offline, zero-telemetry, zero LLM dependencies, no external network calls.
- Strict backward compatibility: running `npx agent-roast` without arguments must work as before.
- Hermetic git argument safety (`--end-of-options` argument isolation).
- No AST bloat: keep runtime dependency-free (only `commander` and `picocolors`).

## Review Focus

- Test file detection heuristics: ensure `trivial-assert` is only checked in test files, never triggering false positives on production helper functions or boolean operations.
- Comment stripping: ensure comments like `// expect(true).toBe(true)` or docstrings do not trigger `trivial-assert`.
- Config precedence: ensure CLI flags (`--fail-on`) take precedence over `.agentroastrc.json`.
- Malformed config handling: invalid JSON in `.agentroastrc.json` must warn gracefully or fail with a clear diagnostic, not unhandled crash.
- Cross-platform paths: Windows vs POSIX path separators in `ignorePaths` globbing.

---

### Task 1: New Infraction Types and Detectors (`trivial-assert`, `stub-abandonment`)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/metrics.ts`
- Modify: `src/renderer.ts`
- Test: `tests/detector.test.ts`
- Test: `tests/metrics.test.ts`

**Interfaces:**
- Consumes: `Infraction`, `InfractionType`, `ParsedFileDiff` from `src/types.ts` and `src/git.ts`.
- Produces: Updated `InfractionType = "test-skip" | "type-escape" | "swallowed-error" | "panic-loop" | "trivial-assert" | "stub-abandonment"`.

- [ ] **Step 1: Write failing detector unit tests for `trivial-assert` and `stub-abandonment`**

Add tests to `tests/detector.test.ts`:
```typescript
it("detects trivial assertions (expect(true).toBe(true), assert True)", () => { ... });
it("detects stub abandonment (throw new Error('Not implemented'), raise NotImplementedError)", () => { ... });
it("ignores comments and strings containing these patterns", () => { ... });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL due to missing detector patterns / infraction types.

- [ ] **Step 3: Update `src/types.ts`, `src/metrics.ts`, and `src/renderer.ts`**

1. Add `"trivial-assert" | "stub-abandonment"` to `InfractionType`.
2. Implement `TRIVIAL_ASSERT_PATTERNS` and `STUB_ABANDONMENT_PATTERNS` in `src/metrics.ts`.
3. Add helper `isTestFile(filePath: string): boolean`.
4. Update `auditFileDiffs` and `MetricTracker.processCommit` to scan and record these infractions.
5. Update `src/renderer.ts` to output formatted labels for `trivial-assert` and `stub-abandonment`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS all existing and new tests.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/metrics.ts src/renderer.ts tests/detector.test.ts tests/metrics.test.ts
git commit -m "feat(detectors): add trivial-assert and stub-abandonment rules"
```

---

### Task 2: Configuration Loader (`.agentroastrc.json`)

**Files:**
- Create: `src/config.ts`
- Modify: `src/metrics.ts`
- Modify: `src/index.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: Node `fs`, `path`.
- Produces: `export interface AgentRoastConfig { ... }`, `export function loadConfig(cwd: string): AgentRoastConfig`, `export function matchIgnorePath(filePath: string, ignorePatterns?: string[]): boolean`.

- [ ] **Step 1: Write failing config loader unit tests**

Create `tests/config.test.ts` testing:
- Default config when no file exists.
- Loading `.agentroastrc.json` with custom `failOn`, `ignorePaths`, and `rules`.
- Handling malformed JSON gracefully.
- Matching path ignores against globs/subdirectories.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (module `src/config.ts` does not exist).

- [ ] **Step 3: Implement `src/config.ts` and integrate with `src/metrics.ts`**

1. Create `src/config.ts` with `DEFAULT_CONFIG`, `loadConfig(cwd: string)`, and path matching.
2. Update `isCodeFile` and `auditFileDiffs` in `src/metrics.ts` to accept optional `ignorePaths`.
3. Export config types and utilities from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/metrics.ts src/index.ts tests/config.test.ts
git commit -m "feat(config): add .agentroastrc.json discovery and path ignore system"
```

---

### Task 3: CLI Integration and `agent-roast init` Subcommand

**Files:**
- Create: `src/init.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`
- Test: `tests/init.test.ts`

**Interfaces:**
- Consumes: `loadConfig` from `src/config.ts`.
- Produces: `export function initProject(options: { cwd: string; yes?: boolean; ci?: boolean; hook?: boolean }): Promise<{ configCreated: boolean; workflowCreated: boolean; hookCreated: boolean }>`.
- Produces: CLI subcommand `agent-roast init` and CLI integration with `.agentroastrc.json`.

- [ ] **Step 1: Write failing tests for `initProject`**

Create `tests/init.test.ts` testing:
- Generation of `.agentroastrc.json`.
- Optional generation of `.github/workflows/agent-roast.yml`.
- Optional generation of `.git/hooks/pre-commit`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/init.test.ts`
Expected: FAIL (module `src/init.ts` does not exist).

- [ ] **Step 3: Implement `src/init.ts` and update `src/cli.ts`**

1. Implement `src/init.ts` with template generators.
2. Wire up `init` command in `src/cli.ts`.
3. In `src/cli.ts`, load config file before running repository or PR audits, applying CLI overrides on top.
4. Update `package.json` version to `0.3.0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/init.ts src/cli.ts package.json tests/init.test.ts
git commit -m "feat(cli): add agent-roast init command and config integration"
```

---

### Task 4: Real Git Integration Tests & Documentation

**Files:**
- Modify: `tests/integration.test.ts`
- Modify: `README.md`
- Modify: `action.yml`

**Interfaces:**
- Consumes: Complete `agent-roast` v0.3.0 CLI and public API.
- Produces: Verified end-to-end integration tests and updated documentation.

- [ ] **Step 1: Write integration tests with real Git commits**

Add test cases in `tests/integration.test.ts`:
- Commit containing `expect(true).toBe(true)` in test file is caught as `trivial-assert`.
- Commit containing `throw new Error("Not implemented")` in source file is caught as `stub-abandonment`.
- PR mode with `.agentroastrc.json` configured fails when `trivial-assert` is present.

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Update `README.md` and `action.yml`**

Document:
- v0.3.0 release highlights.
- New rules: `trivial-assert` and `stub-abandonment`.
- Configuration via `.agentroastrc.json`.
- Quickstart with `npx agent-roast init`.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run build`
Expected: PASS with 0 lint/type errors and 100% test pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration.test.ts README.md action.yml
git commit -m "docs: document agent-roast v0.3.0 features and add integration tests"
```
