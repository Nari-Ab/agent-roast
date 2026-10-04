# agent-roast 🤖🔥

> **Zero-telemetry CLI scorecard auditing your git history for AI coding agent infractions, shortcuts, and panic loops.**

[![npm version](https://img.shields.io/npm/v/agent-roast?color=cb3837&label=npm)](https://www.npmjs.com/package/agent-roast)
[![telemetry: zero](https://img.shields.io/badge/telemetry-zero%20(offline)-1f9d55)](#privacy--security)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Did your AI coding agent (Cursor, Claude Code, Aider) write clean software, or did it silently delete tests and slap `as any` everywhere to pretend everything compiles?

Run in any git repository (100% local, zero tokens, zero telemetry):

```bash
npx agent-roast
```

---

### What it looks like:

```text
╔══════════════════════════════════════════════════════════╗
║                 🤖 AGENT ROAST DOSSIER                    ║
╚══════════════════════════════════════════════════════════╝

  Repository:  my-app
  Commits:     18 AI-attributed / 42 total
  Code Added:  4,210 lines (AI) / 12,480 lines (total)

  AGENT ARCHETYPE:  The Any Architect
  Leans on compiler bypasses (`as any`, `@ts-ignore`) rather than strict type modeling.

  DISCIPLINE SCORE: 68 / 100
  (100 = spotless discipline, 0 = complete shortcut addiction)

  📊 INFRACTIONS BREAKDOWN:
  ───────────────────────────────────────────────────────
  ✖  Skipped tests:       4 (it.skip, describe.skip, xit)
  ▲  Type escapes:        16 (as any, @ts-ignore, eslint-disable)
  ✖  Swallowed errors:    3 (empty catch {}, except: pass)
  ↻  Panic fix loops:     2 (quick fixes < 15m apart)

  ───────────────────────────────────────────────────────
  📢 Share your score on X: https://twitter.com/intent/tweet?text=...
  Tip: Run with --verbose to see exact commit SHAs and lines
```

---

### What it detects (only added lines, zero false alarms from file renames):

1. **Skipped Tests:** `it.skip`, `describe.skip`, `xit`, `test.todo` added when tests fail.
2. **Type Escapes:** `as any`, `// @ts-ignore`, `// @ts-expect-error`, `# type: ignore`, `eslint-disable`.
3. **Swallowed Errors:** Empty `catch {}` or `except: pass` blocks hiding production bugs.
4. **Panic Loops:** Consecutive quickfix/revert commits within 15 minutes by the agent.

---

### Options

```bash
npx agent-roast            # Audit AI-attributed commits (Co-Authored-By: Claude, Cursor, Aider, etc.)
npx agent-roast --all      # Audit ALL commits across the repository
npx agent-roast --verbose  # Print exact commit SHAs and code lines as proof
npx agent-roast --since 30d # Audit last 30 days of git history
npx agent-roast --json     # Output raw JSON metrics for CI pipelines
```

---

### Privacy & Security

`agent-roast` is strictly **local and deterministic**:
- Runs streaming `git log` on your machine in milliseconds.
- **Zero network calls**, zero LLM APIs, zero tracking or analytics.
- Your source code never leaves your terminal.

---

### License

[MIT](LICENSE)
