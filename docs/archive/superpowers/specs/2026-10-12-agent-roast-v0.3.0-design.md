# agent-roast v0.3.0 — Architecture & Design Spec

**Date:** 2026-10-12  
**Target Version:** 0.3.0  
**Status:** Approved  

---

## 1. Overview & Motivation

`agent-roast` audits git history and PR diffs for AI coding agent infractions (shortcuts, thrashing, and safety bypasses). While v0.2.1 successfully detects skipped tests (`test-skip`), compiler bypasses (`type-escape`), error swallowing (`swallowed-error`), and rapid commit thrashing (`panic-loop`), real-world AI coding assistants (Claude Code, Cursor, Copilot, Devin) have evolved more subtle evasion tactics that pass basic test suites:

1. **Trivial Assertions (`trivial-assert`):** When unable to fix complex logic or auth tests, agents frequently neuter assertions to make tests pass vacuously: e.g. replacing `expect(auth.verify(token)).toBe(true)` with `expect(true).toBe(true)`, `assert 1 == 1`, or leaving empty test bodies `it('...', () => {})`.
2. **Abandoned Stubs (`stub-abandonment`):** Agents mark tasks as complete in agent chat while leaving placeholders in code: `throw new Error("Not implemented")`, `raise NotImplementedError`, `// TODO: implement later`.
3. **Repository Configuration (`.agentroastrc.json`):** Teams need repository-level control over ignored paths (legacy directories, generated code), score thresholds, and rule severities (`error`, `warn`, `off`) without writing verbose CLI flags in every CI workflow.
4. **Instant Project Setup (`agent-roast init`):** A single setup command to initialize `.agentroastrc.json` and optionally create a Git pre-commit hook or GitHub Actions workflow.

---

## 2. Core Detectors Specification

### 2.1. `trivial-assert` (Vacuous & Trivial Test Assertions)
Only inspected in added lines (`+`) of test files (files matching `test`, `spec`, `tests/`, `__tests__/`):
* **TypeScript / JavaScript:**
  * `expect(true).toBe(true)`
  * `expect(false).toBe(false)`
  * `expect(1).toBe(1)`
  * `expect(null).toBeNull()`
  * `assert.equal(1, 1)` / `assert.strictEqual(true, true)`
* **Python:**
  * `assert True` / `assert 1 == 1`
  * `self.assertTrue(True)` / `self.assertEqual(1, 1)`
* **Go:**
  * `assert.True(t, true)` / `require.True(t, true)`

*Reason string:* `trivial assertion (expect(true).toBe(true) / assert True)`  
*Score penalty weight:* High (equivalent to `test-skip`), as it actively deceives test runners.

### 2.2. `stub-abandonment` (Unimplemented Placeholders)
Inspected in added lines (`+`) of all code files:
* **TypeScript / JavaScript:**
  * `throw new Error(["'](?:TODO|Not implemented|to be implemented|stub)["'])`
  * `throw new Error\(\s*["'](?:implement me)["']\s*\)`
* **Python:**
  * `raise NotImplementedError\b`
  * `raise NotImplemented\b`
* **Rust / Go:**
  * `todo!()` / `unimplemented!()`
  * `panic(["'](?:TODO|not implemented)["'])`

*Reason string:* `unimplemented stub (throw new Error("Not implemented") / raise NotImplementedError)`  
*Score penalty weight:* Moderate (flags abandoned agent work).

---

## 3. Configuration System (`.agentroastrc.json`)

### 3.1. Schema
File names searched in repository root: `.agentroastrc.json`, `.agentroastrc`, `agent-roast.config.json`.

```typescript
export interface AgentRoastConfig {
  /** Detector rules to fail CI on in PR mode (default: ['test-skip', 'trivial-assert']) */
  failOn?: string[];
  /** Glob patterns or prefixes to ignore */
  ignorePaths?: string[];
  /** Minimum passing score for full repository audits (0-100) */
  scoreThreshold?: number;
  /** Granular rule configuration */
  rules?: Record<string, "error" | "warn" | "off">;
  /** Maximum minutes between fix commits before flagging panic-loop */
  panicLoopWindowMinutes?: number;
}
```

### 3.2. Precedence Order
1. Explicit CLI arguments (`--fail-on`, `--all`, etc.) always override config files.
2. Configuration file settings in repo root.
3. Built-in defaults.

---

## 4. CLI Extension: `agent-roast init`

Command syntax:
`agent-roast init [--yes] [--ci] [--hook]`

* **Actions:**
  1. Creates `.agentroastrc.json` with sensible defaults:
     ```json
     {
       "failOn": ["test-skip", "trivial-assert"],
       "ignorePaths": ["**/fixtures/**", "**/mocks/**", "**/dist/**"],
       "rules": {
         "test-skip": "error",
         "trivial-assert": "error",
         "swallowed-error": "warn",
         "stub-abandonment": "warn",
         "type-escape": "warn"
       }
     }
     ```
  2. If `--hook` or interactive prompt confirms: installs a lightweight `.git/hooks/pre-commit` script invoking `npx agent-roast --base HEAD~1 --head HEAD`.
  3. If `--ci` or interactive prompt confirms: writes `.github/workflows/agent-roast.yml`.

---

## 5. Architecture & Data Flow

1. **Config Loader (`src/config.ts`):**
   * Synchronous / asynchronous discovery of `.agentroastrc.json` in `cwd`.
   * Validates schema, returns typed `AgentRoastConfig`.
2. **Metrics & Detectors (`src/metrics.ts`):**
   * Extends `InfractionType` with `"trivial-assert"` and `"stub-abandonment"`.
   * Evaluates test-file status before applying `TRIVIAL_ASSERT_PATTERNS`.
   * Integrates `config.ignorePaths` into `isCodeFile`.
3. **CLI Dispatcher (`src/cli.ts`):**
   * Adds `init` subcommand.
   * Loads config before running `auditPullRequest` or `roastRepository`.
4. **Renderer (`src/renderer.ts`):**
   * Displays new infraction categories with distinct icons and labels in terminal report and GitHub markdown summary.

---

## 6. Testing Strategy
* **Unit tests (`tests/detector.test.ts`):** Test regex patterns for TS, Python, Go, Rust across valid and invalid samples.
* **Config tests (`tests/config.test.ts`):** Test loading, missing files, invalid JSON, and precedence overrides.
* **Init tests (`tests/init.test.ts`):** Test file creation in isolated temporary directory.
* **Integration tests (`tests/integration.test.ts`):** Git fixture commits verifying that commits adding `expect(true).toBe(true)` or `throw new Error("Not implemented")` are caught in PR diff and repository scorecards.
