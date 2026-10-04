<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="agent-roast" width="420">
</picture>

### Audit your git history for AI coding agent infractions and panic loops

[![npm version](https://img.shields.io/npm/v/agent-roast?logo=npm&logoColor=white&color=cb3837&label=npm)](https://www.npmjs.com/package/agent-roast)
[![telemetry: zero (offline)](https://img.shields.io/badge/telemetry-zero%20(offline)-1f9d55)](#privacy)
[![speed: <200ms](https://img.shields.io/badge/speed-%3C200ms-blue)](#privacy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

`agent-roast` scans your git diffs for shortcuts taken by AI coding agents (Claude Code, Cursor, Aider, Devin). It detects disabled tests, compiler type escapes, swallowed errors, and panic revert loops, then calculates an objective **Discipline Score (0–100)** with a personality archetype. 100% offline, zero API keys, zero telemetry.

```bash
npx agent-roast            # audit AI-attributed commits (default)
npx agent-roast --all      # audit entire repository history
npx agent-roast --verbose  # show exact commit SHAs and line proofs
```

What a roast looks like on a real repository:

```text
╔══════════════════════════════════════════════════════════╗
║                 🤖 AGENT ROAST DOSSIER                    ║
╚══════════════════════════════════════════════════════════╝

  Repository:  Soup
  Commits:     304 AI-attributed / 1,153 total
  Code Added:  87,165 lines (AI) / 479,097 lines (total)

  AGENT ARCHETYPE:  The Panic Looper
  Prone to rapid-fire fix and revert thrashing cycles when wrestling bugs.

  DISCIPLINE SCORE: 55 / 100
  (100 = spotless discipline, 0 = complete shortcut addiction)

  📊 INFRACTIONS BREAKDOWN:
  ───────────────────────────────────────────────────────
  ✖  Skipped tests:       6 (it.skip, describe.skip, xit)
  ▲  Type escapes:        19 (as any, @ts-ignore, eslint-disable)
  ✖  Swallowed errors:    2 (empty catch {}, except: pass)
  ↻  Panic fix loops:     15 (quick fixes < 15m apart)
```

<img src="docs/assets/case-study.gif" alt="agent-roast animated terminal audit demo" width="100%">

---

### What it detects

Only **added lines** (`+`) are analyzed — file renames and deletions never trigger false alarms.

- **Skipped Tests (15 pts):** `it.skip`, `describe.skip`, `xit`, `pytest.skip`, `test.todo` added when tests fail.
- **Swallowed Errors (10 pts):** Empty `catch {}` or `except: pass` blocks hiding production crashes.
- **Panic Fix Loops (8 pts):** Consecutive quickfix/revert commits within 15 minutes by the same author.
- **Type Escapes (3 pts):** `as any`, `// @ts-ignore`, `// @ts-expect-error`, `# type: ignore`, `eslint-disable`.

---

### Archetypes

| Archetype | Icon | Trigger | Personality |
| :--- | :---: | :--- | :--- |
| **The Clean Coder** | 🧼 | Score $\ge 90$, 0 infractions | Spotless discipline. No skipped tests, zero panic loops. |
| **The Pragmatic Builder** | 🛠️ | Score $\ge 90$, minor shortcuts | Disciplined with rare, isolated compromises across thousands of lines. |
| **The Panic Looper** | ↻ | Dominant panic loops ($\ge 2$) | Rapid-fire fix and revert thrashing when stuck on stubborn bugs. |
| **The Silent Vandal** | ✖ | Dominant skipped tests ($\ge 3$) | Disables or skips failing test suites to force green CI. |
| **The Any Architect** | ▲ | Dominant type escapes ($\ge 5$) | Leans on `as any` and `@ts-ignore` instead of strict type modeling. |
| **The Secret Keeper** | 🤐 | Dominant empty catches ($\ge 2$) | Silences runtime errors with empty catch blocks. |
| **The Chaos Gremlin** | 🔥 | Score $< 50$, mixed shortcuts | Combines test skipping, type bypasses, and hasty patches. |

---

### Privacy

- **100% Local:** Runs streaming `git log` on your machine in <200ms.
- **Zero Telemetry:** No cloud dependencies, no LLM API calls, no network traffic.
- **Hermetic:** Source code never leaves your computer.

---

### License

[MIT](LICENSE)
