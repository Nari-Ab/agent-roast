# Changelog

## 0.5.0 — 2026-10-23

Check the code you have today, adopt the tool without blocking on existing debt, and get concrete guidance for each finding.

### New workflows

- `agent-roast check` inspects current tracked and non-ignored untracked source without requiring commits or AI attribution.
- `check --write-baseline .agentroast-baseline.json` explicitly accepts reviewed existing findings. `check --baseline ...` gates new occurrences, including additional identical shortcuts, while tolerating clean line shifts.
- `agent-roast explain <rule>` provides local explanations and remediation examples. Findings also include suggested next steps.
- `--staged` checks the Git index, including an initial commit. Generated pre-commit hooks now audit the proposed commit instead of old history.

### Accuracy and reliability

- Recognizes common multi-line empty catches and Python except/pass blocks; filters contiguous comments, docstrings and literal examples.
- Honors rule severity, disabled rules, configured fail-on lists, ignore globs and panic-loop windows consistently.
- Shows findings even when historical samples are too small to score; supports JSON history output.
- Marks unreadable, oversized, binary or symlinked source as an incomplete scan (exit 2). Incomplete checks cannot create a baseline.
- Escapes GitHub annotation properties, terminal controls and Markdown content. No new runtime dependencies or network calls were added to the CLI.
- GitHub Action now installs exactly 0.5.0. The generated workflow uses the isolated action.

### Configuration migration

Malformed configuration and unknown rule names now stop the audit with exit 2 instead of silently applying defaults. Older generated configs may contain unsupported `hallucinated-package`, `empty-catch` or `mock-leak` rules: remove them and use `swallowed-error` for empty catches. Review baseline updates as policy changes; baseline writes preserve existing files.

### Try it

```bash
npx agent-roast@0.5.0 check
npx agent-roast@0.5.0 explain swallowed-error
```

Validated with a compiled distribution build, TypeScript checks, all 143 tests, and package smoke checks. Git 2.30+ and Node.js 18+ are required. Pattern findings remain review candidates, not proof of AI authorship or a guarantee of code quality.
