# Agent Roast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and release `agent-roast` — a fast, zero-telemetry CLI that audits git diffs for AI coding agent infractions (skipped tests, type escapes, swallowed errors, panic fix loops) and generates a shareable ASCII scorecard with a 0–100 discipline rating.

**Architecture:** Streaming git log parser (`child_process.spawn`) -> commit classifier (AI attribution by trailers & authors) -> diff line scanner (regex on added `+` lines only) -> metric aggregator with 1k-LOC normalization -> archetype evaluator -> colored ASCII terminal renderer + pre-filled X (Twitter) intent link.

**Tech Stack:** Node.js (>=18), TypeScript, `picocolors` (for styling), `commander`, `tsup` (bundler), `vitest` (testing).

---

## Global Constraints
- Zero network requests and zero LLM API dependencies (runs 100% locally and offline).
- Count ONLY added lines (`+`) in diffs to eliminate false positives from file renames or refactoring.
- Small sample safeguard: if total lines added < 200 LOC, output "Insufficient data" rather than a skewed score.
- Normalize infractions per 1,000 added lines with a per-commit cap (max 20 points per commit) so vendor imports don't zero out the score.
- No copyrighted vendor logos or real company/colleague names in cards.
- Package name verified: `agent-roast` on npm.

---

## Tasks

### Task 1: Scaffolding & Git Attribution Detector
**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `src/types.ts`
- Create: `src/detector.ts`
- Test: `tests/detector.test.ts`

- [ ] **Step 1: Write failing detector tests**
Test recognizing `Co-Authored-By: Claude`, `Cursor`, `Aider`, `devin`, `Copilot`, and commit messages with AI signatures vs regular human commits.
- [ ] **Step 2: Implement `isAgentCommit(author, message, trailers): boolean` in `src/detector.ts`**
- [ ] **Step 3: Run vitest to ensure detector tests pass**
- [ ] **Step 4: Commit**

---

### Task 2: Streaming Git Log & Diff Parser
**Files:**
- Create: `src/git.ts`
- Test: `tests/git.test.ts`

- [ ] **Step 1: Write test simulating git log stream chunks**
- [ ] **Step 2: Implement streaming parser using `git log -p -U0 --no-color` with record separator (`\x1e`) and field separator (`\x1f`)**
- [ ] **Step 3: Verify parsing handles multi-commit streams, diffs, and Windows/Linux line endings**
- [ ] **Step 4: Commit**

---

### Task 3: Infraction Rules & Metrics Engine
**Files:**
- Create: `src/metrics.ts`
- Test: `tests/metrics.test.ts`

- [ ] **Step 1: Write tests for the 4 core infractions**
  1. Skipped tests: `.skip`, `xit`, `test.skip`, `describe.skip`, `@pytest.mark.skip`.
  2. Type escapes: `as any`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `eslint-disable`.
  3. Swallowed errors: empty `catch {}`, `catch (e) {}`, `except: pass`.
  4. Panic loops: consecutive commits with "fix", "quick fix", "revert" within 15 minutes.
- [ ] **Step 2: Implement `scanDiff(addedLines, commitMeta)` and metric caps**
- [ ] **Step 3: Implement normalization per 1k LOC and minimum threshold (<200 LOC = insufficient data)**
- [ ] **Step 4: Commit**

---

### Task 4: Scoring, Archetype Generator & Card Renderer
**Files:**
- Create: `src/scorer.ts`
- Create: `src/renderer.ts`
- Test: `tests/scorer.test.ts`

- [ ] **Step 1: Write tests for score calculation (0–100) and archetype assignment**
- [ ] **Step 2: Implement archetypes:**
  - `The Silent Vandal` (excessive test skips)
  - `The Any Architect` (type bypass addiction)
  - `The Panic Looper` (chain fixes and rollbacks)
  - `The Codebase Surgeon` (score >= 85, disciplined)
- [ ] **Step 3: Build terminal card renderer with `picocolors` and Twitter share intent link**
- [ ] **Step 4: Commit**

---

### Task 5: CLI Interface & Local Verification
**Files:**
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Wire commander with `--all`, `--since=90d`, `--verbose` (prints commit hashes & lines), `--json`**
- [ ] **Step 2: Build bundle using `tsup` into `dist/cli.js` with shebang `#!/usr/bin/env node`**
- [ ] **Step 3: Test CLI on current repository (`/Users/sidzuya/.gemini/antigravity-ide/scratch/semvibe`)**
- [ ] **Step 4: Commit**

---

### Task 6: GitHub Repo, README & NPM Publication
**Files:**
- Create: `README.md`
- Create: `LICENSE` (MIT)

- [ ] **Step 1: Create README with Stroq-style minimalism, sample card, and single-command install**
- [ ] **Step 2: Initialize git repo and push to GitHub**
- [ ] **Step 3: Publish `agent-roast@0.1.0` to npm**
