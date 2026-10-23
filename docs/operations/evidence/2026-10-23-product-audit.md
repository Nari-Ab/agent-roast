# agent-roast: practical audit improvements (2026-10-23)

Baseline: `af09960535e4d96e50e595eff04a3ed8a9dcfb32` (local main, v0.4.0).

## Product conclusion

The useful core is a small, offline guard against obvious shortcuts in the change a
developer is about to ship. A historical personality score and promotional assets
cannot substitute for accurate findings, predictable policy, and an effective hook.
This pass concentrates on the audit workflow.
No unrelated media, video scripts, or user-created assets were removed.

## Reproduced defects and changes

- The generated pre-commit hook audited committed history and missed the proposed
  commit entirely. `--staged` now inspects the index, even on an unborn branch, and
  the generated hook uses the local installation without downloading at commit time.
- `init` emitted unsupported `hallucinated-package`, `empty-catch`, and `mock-leak`
  rules and a missing schema URL. The template now uses implemented detectors.
- CLI ignored explicit config `failOn`, silently re-enabled default blockers when no
  rules were errors, and did not apply `off`. Config precedence is now explicit;
  disabled findings also stop affecting history scores and badge source data.
- Broken policy JSON silently fell back to defaults; malformed types could crash
  later during scanning. Validation now fails with an actionable config error and
  CLI status 2. This intentionally changes malformed-config behavior.
- Glob conversion rewrote stars inside its own generated regular expression,
  breaking nested ignores. Tokenized expansion preserves deep `**` semantics.
- History and PR modes contained duplicate detector implementations. One shared
  scanner now serves history, PRs, and staged checks.
- Stub examples inside strings and trailing comments produced findings. Token
  offsets distinguish actual executable keywords from quoted examples.
- Deliberately failing literal comparisons and `assert False` were mislabeled as
  fake passing tests. Only equivalent literal comparisons are flagged. Python
  `test_*.py` names are now recognized outside a tests directory.
- Division expressions could be mistaken for regular expression literals and hide
  real findings. Regex masking now requires a plausible expression prefix.
- History reports below 200 added lines hid every finding. They now omit only the
  score and retain actionable evidence.
- `panicLoopWindowMinutes` was ignored; non-target commits could connect otherwise
  non-consecutive fix chains. The configured window and intervening commits apply.
- GitHub annotations ignored advisory severity and interpolated raw filenames into
  workflow commands. Annotation level follows blocking policy; command properties
  and data are escaped, including percent, newline, comma, and colon characters.
- History `--format json` was ignored; invalid formats and NaN/out-of-range score
  thresholds silently succeeded. CLI validation now rejects these mistakes.
- Tests depended on an already-built `dist`, making a clean checkout fail or test
  stale code. `pretest` builds current sources; `typecheck` is an explicit script.
- Added a GitHub Actions Node 18/20/22 test matrix. The generated consumer workflow
  uses the isolated composite action instead of invoking npx in the PR checkout.
- The composite action installed the older 0.3 series despite this checkout being
  0.4.0. It now pins 0.4.0 and only forwards an explicit fail-on override.

## Verification

- `npm run typecheck`: passed.
- `npm test`: distribution build and all 92 tests passed (59 existing, 33 new).
- Regression cases create disposable Git repositories and invoke the compiled CLI:
  first commit, staged/unstaged divergence, untracked files, empty index, PR config,
  invalid JSON policy/types, severity overrides, explicit advisory mode, and errors.
- Original integration tests cover hostile Git configuration, path quoting,
  renames, non-repositories, bundle network checks, badge output, and CLI init.
- `git diff --check`: passed.
- Runtime during local verification: Node 23.10.0. The added CI matrix has not run
  remotely; cross-version results are not claimed.

## Remaining limits and release boundary

This remains a regex-based added-line review aid, not an AST analyzer or a proof of
AI authorship. Multi-line comments, multi-line syntax and template interpolation
are not fully parsed. Legitimate skips, abstract methods and deliberate type
suppressions need human review. The history score is heuristic and cannot certify
the present tree. Ref matching and history attribution are still heuristic.

The pre-commit generator currently targets a conventional `.git` directory; custom
`core.hooksPath` and linked-worktree hook installation remain unsupported. Existing
hooks are preserved. Users need a local dev installation for `--no-install`.

No npm release, remote push, or GitHub deployment was performed. New CLI behavior
is available from this local build; `npx agent-roast` and remote `@v1` consumers will
not gain it until a release and corresponding action update are published. The
composite action is still pinned to the already released 0.4.0 package, so its new
CLI behavior must be rolled out deliberately with the next package release.
