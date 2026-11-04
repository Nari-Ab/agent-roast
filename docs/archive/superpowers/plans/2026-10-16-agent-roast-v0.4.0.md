# agent-roast v0.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview
Implement v0.4.0 with viral badges (`agent-roast badge`), Markdown PR commenting, and distribution assets (Dev.to / Habr article).

---

### Task 1: Badge Generator Engine (`src/badge.ts` & `tests/badge.test.ts`)
- [ ] Write unit tests in `tests/badge.test.ts`:
  - `getScoreColor(score)` returning correct colors (brightgreen, green, yellowgreen, yellow, red, lightgrey).
  - `generateSvgBadge(score, label)` producing valid XML/SVG with label and score message.
  - `generateShieldsMarkdown(score, label)` producing correct Markdown snippet.
  - `generateShieldsJson(score, label)` producing Shields.io endpoint schema.
- [ ] Implement `src/badge.ts`:
  - Zero-dependency SVG string builder with accurate text width metrics and GitHub-style flat-square styling.
  - Helpers for Shields.io Markdown link and JSON endpoint.
- [ ] Export `src/badge.ts` from `src/index.ts`.
- [ ] Run `vitest run tests/badge.test.ts` and verify all tests pass.

### Task 2: Enhanced PR Markdown Formatter (`formatPrMarkdownComment`)
- [ ] Write unit tests in `tests/renderer.test.ts` for `formatPrMarkdownComment`:
  - Format output contains summary table with status, defect density, lines added, files inspected.
  - Collapsible `<details>` section when infractions exist.
  - Clean pass state message when infractions are empty.
- [ ] Implement `formatPrMarkdownComment` in `src/renderer.ts`.
- [ ] Update `src/cli.ts` to accept `--format markdown` for PR mode audits and output `formatPrMarkdownComment`.
- [ ] Run `vitest run tests/renderer.test.ts` and verify.

### Task 3: CLI Integration for `agent-roast badge` & Version Bump
- [ ] Update `src/cli.ts`:
  - Register `program.command("badge [path]")`:
    - Options: `--out <file>`, `--json`, `--all`, `--since <time>`.
    - Computes repository score and generates SVG file, Shields JSON, or Markdown snippet.
- [ ] Update `package.json` version to `0.4.0`.
- [ ] Add integration test in `tests/integration.test.ts` testing `agent-roast badge --json` and `agent-roast badge --out ./test-badge.svg`.
- [ ] Run `npm run build && npm test`.

### Task 4: Documentation & Dev.to / Blog Article
- [ ] Update `README.md` with:
  - Badge section showing how to add the AI Discipline badge to repos.
  - PR comment markdown explanation.
- [ ] Create `docs/articles/how-ai-agents-cheat-tests.md`:
  - Full, polished technical article ready to post to Dev.to, Habr, Medium, or LinkedIn Articles.
- [ ] Final verification and commit.
