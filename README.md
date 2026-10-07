<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="agent-roast" width="380">
</picture>

<h2>Audit your git history for AI coding agent infractions and panic loops</h2>

<p>
  <a href="https://github.com/Nari-Ab/agent-roast/actions"><img src="https://img.shields.io/badge/CI-passing-2ea44f?logo=github&logoColor=white" alt="CI"></a>
  <a href="https://github.com/Nari-Ab/agent-roast"><img src="https://img.shields.io/badge/roast%20audit-verified-2ea44f" alt="Roast Audit"></a>
  <a href="https://www.npmjs.com/package/agent-roast"><img src="https://img.shields.io/npm/v/agent-roast?color=cb3837&logo=npm&logoColor=white" alt="npm"></a>
  <a href="https://www.npmjs.com/package/agent-roast"><img src="https://img.shields.io/npm/dt/agent-roast?label=downloads&color=0969da" alt="downloads"></a>
  <a href="https://nari-ab.github.io/agent-roast/"><img src="https://img.shields.io/badge/site-live-1f9d55" alt="site"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0969da" alt="license"></a>
</p>

</div>

`agent-roast` scans recorded git diffs for shortcuts taken by AI coding assistants (Claude Code, Cursor, Codex, Antigravity, Aider). It checks for skipped tests, compiler type escapes (`as any`), swallowed errors, and panic revert loops, then outputs a discipline score and line proofs. 100% offline, zero API keys, zero telemetry.

```bash
# Audit repository history
npx agent-roast            # scan AI-attributed commits (last 90 days)
npx agent-roast --all      # scan entire repository history
npx agent-roast --verbose  # show commit SHAs and line proofs

# Audit pull request diffs (CI gate)
npx agent-roast --base origin/main --head HEAD
npx agent-roast --base origin/main --head HEAD --fail-on test-skip,swallowed-error --format github
```

What a report looks like (a real repository audit, trimmed):

```text
agent-roast — git discipline audit (304 AI commits in Soup)

SCORE: 55 / 100 · The Panic Looper
  Prone to rapid-fire fix and revert thrashing cycles when wrestling stubborn bugs.

INFRACTIONS DETECTED (42)

  ● panic-loop (15) — consecutive quick fixes < 15m apart
      latest: 3df29a1 -> a910f21 (3m apart)

  ● type-escape (19) — compiler type bypasses in added lines
      e.g. src/client.ts:42 — response.body as any

  ● test-skip (6) — disabled or skipped test suites
      e.g. tests/test_outbound.py:18 — pytest.skip(...)

  ● swallowed-error (2) — empty catch blocks or except: pass
```

<img src="docs/assets/case-study.gif" alt="Case study: an AI agent disables failing auth tests with it.skip, slaps as any, and agent-roast catches the shortcuts" width="820">

<img src="docs/assets/demo.gif" alt="agent-roast running in terminal: streaming git diff, calculating discipline score and line proofs" width="820">

---

### GitHub Actions Integration

Add `agent-roast` as a gate in your pull request workflow (`.github/workflows/audit.yml`):

```yaml
name: Agent Audit
on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Required for complete merge-base history

      - name: Run agent-roast audit
        uses: Nari-Ab/agent-roast@v1
        with:
          fail-on: test-skip
          format: github
```

> **Security Note:** `agent-roast` runs in an isolated runner directory (`$RUNNER_TEMP`) with `--ignore-scripts` to neutralize malicious `.npmrc` files in untrusted pull requests. `pull_request_target` is not supported.

---

### What it checks

Only **added lines** (`+`) in source code files are scanned — deleted lines, file moves, and comments never trigger false alarms.

- **Skipped tests (`test-skip`):** `it.skip`, `describe.skip`, `xit`, `pytest.skip`, `test.todo` added to silence failing tests. (Default blocking gate).
- **Type escapes (`type-escape`):** `as any`, `as unknown as`, `as never`, `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error`, `# type: ignore`, `# noqa`, `eslint-disable`.
- **Swallowed errors (`swallowed-error`):** Empty `catch {}` or `except: pass` blocks hiding runtime failures.
- **Panic fix loops (`panic-loop`):** Heuristic chain analysis of rapid-fire fix/revert commits by the same author within 15 minutes touching overlapping files. *(Observational metric for repository audits; not a PR blocker)*.

---

### Scoring Methodology

- **Repository Audit Score:** Uses size-invariant defect density:
  $$\text{Score} = 100 \cdot \exp\left(-\left(\frac{\text{codeDensity}}{R_0} + \frac{\text{panicDensity}}{R_1}\right)\right)$$
  where defect points are normalized by effective sample volume ($k\text{Loc} + 0.5$). Repositories with fewer than 200 lines added return `null` (insufficient data) rather than an arbitrary 100.
- **Pull Request Mode:** Avoids unstable micro-sample scores. Reports verified infractions, pass/fail status, and reference defect density per 100 LOC. Author identities are hidden by default to prevent team blame games.

---

### Requirements & Privacy

- **Requirements:** Git 2.30+ (for `--end-of-options` argument isolation), Node.js 18+.
- **100% Local:** Instant streaming parser runs directly on your machine.
- **Zero Telemetry:** No cloud dependencies, no LLM API calls, no network traffic. Verified by static bundle inspection.
- **Hermetic:** Enforces `-c core.quotepath=false -c diff.noprefix=false` to guarantee identical behavior across all environments.

---

### Author & Support

Created by Nariman Abdukarimov ([abdukarimov.nariman07@gmail.com](mailto:abdukarimov.nariman07@gmail.com)).

### License

[MIT](LICENSE)

