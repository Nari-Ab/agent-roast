# Changelog

## 0.7.0 — 2026-10-28

- Upgraded CLI `--staged` and added `review --staged`: compare complete HEAD/index
  blobs and gate only introduced findings. Detect deletion-only error swallowing,
  preserve comment context and tolerate old debt, line shifts and pure renames.
- Pin cached diff object IDs without writing index/worktree. Reject unmerged entries,
  concurrent HEAD/index changes, partial clones, invalid source and incomplete scans.
  Ignore unstaged/untracked/intent-to-add content. Support initial commits and linked worktrees.
- Staged policy comes from HEAD, with built-in defaults on initial commits. Candidate
  policy edits cannot weaken the gate. Explicit `--fail-on` remains available.
- Added `test-focus` for exclusive JS/TS test APIs and common multiline modifier chains,
  including actionable guidance, severity policy, baselines, history and SARIF.
  Added `.mts` and `.cts` to supported source extensions.
- CLI staged JSON now uses `ReviewResult`, `mode: review`, `source: index`, schema
  `1.1.0`. `headSha` is an `INDEX:` digest, not a commit; `EMPTY` is the unborn base.
  The programmatic `auditPullRequest({staged:true})` API retains legacy behavior;
  use the exported `reviewStagedChanges()` API for context comparisons.
- Fixed rejected config examples and removed a nonexistent schema URL from README.
  Clarified heuristic limitations and the distinction between current source,
  context reviews, and legacy added-lines audits. No new runtime dependencies.

## 0.6.0 — 2026-10-24

- Added `review --base <trusted-ref>`: compare full source at merge-base/head and
  report introduced, existing and disappeared findings. Deletion-only regressions
  and examples inside pre-existing comments are analyzed with file context.
- Reviews use policy from the supplied base commit, report candidate policy changes,
  preserve worktree/index contents and account for Git-recognized renames/duplicates.
- Added offline SARIF 2.1.0 output to `review` and `check`, including rule guidance,
  encoded relative locations, occurrence fingerprints and incomplete-run status.
- Added explicit coverage/size limits, cancellation, bounded Git subprocess reads,
  replacement-object isolation and refusal of partial clones/ambiguous merge bases.
- Composite Action defaults to `mode: review`; `mode: audit` retains
  the legacy added-line behavior. Installation runs outside candidate npm config.
  `pull_request_target` is rejected. The Action installs exactly 0.6.0.
- Added a transparent 14-change labeled regression corpus and a pilot validation
  plan. Synthetic evaluation is not a claim about production accuracy or adoption.

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
