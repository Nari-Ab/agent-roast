# Product improvement: current-code checks and gradual adoption

Date: 2026-10-23. Builds on the first local bug-fix pass in
`codex/agent-roast-practical-audits`; no public release was made.

## Decision and acceptance criteria

The initial tool is strongest as a focused, offline reviewer for obvious coding
shortcuts. The main adoption barriers were functional: history and AI attribution
were prerequisites for many useful results, reports did not explain remediation,
and users lacked a way to accept existing debt while rejecting new occurrences.
This pass implements that workflow rather than adding more cosmetic scoring.

Accepted behavior:

1. Inspect the current tree, including tracked modifications and non-ignored untracked
   files, without commit history, AI attribution, executing project code, or networking.
2. Show actionable rule-specific guidance and retain machine-readable output.
3. Explicitly accept existing findings through a baseline while catching additional
   occurrences, even duplicates, after clean line shifts.
4. Never label an incomplete scan a passing audit or save it as a baseline.
5. Preserve existing baseline files under repeated and concurrent writes.
6. Recognize common multi-line empty handlers without flagging comments/docstrings.

## Delivered behavior

- `agent-roast check [path]`: scans supported current source in the containing Git
  repository, applies root config, and respects Git ignores for untracked files.
  Unlike history audits, it requires neither existing commits nor an attribution
  tag and reports findings without a personality or a numerical quality claim.
- `agent-roast explain <rule>`: local rule descriptions, limitations, remediation
  suggestions and examples. Structured findings also include suggestions; diff
  terminal reports display them.
- `check --write-baseline <new-file>`: explicitly accepts current findings. Files
  contain hashes and counts, not source snippets or absolute project paths. An
  atomic no-replace publication prevents partial baselines and lost concurrent writes.
- `check --baseline <file>`: reports new findings and separately accounts for accepted
  debt. Fingerprints exclude line numbers, include file/rule/snippet, and track counts
  so a duplicate new shortcut cannot inherit unlimited suppression. Findings that
  disappear (or become disabled/ignored) are counted as stale baseline debt.
- Whole-tree output supports terminal, JSON, Markdown and GitHub annotations. Terminal
  reports cap displayed findings at 20 and direct users to JSON for all results.
- Added bounded, source-aware lexical masking for contiguous JS block comments,
  Python docstrings, Ruby comments, Go raw strings, strings and common JS regexes.
  Common multi-line empty catches and Python except/pass are detected, without
  joining separate added diff hunks into fabricated empty handlers.
- Source and baseline reads reject symlinks, bound memory use and detect file changes
  during reads. An unreadable/binary/oversized supported file results in an explicit
  incomplete result and exit 2. Source scan cancellation rejects the operation.
- Git fsmonitor hooks are disabled during Git reads. Current-tree scanning never
  runs package scripts, builds, tests, hooks or analyzed source.
- Terminal controls and Markdown image/link syntax are escaped in the new reports;
  GitHub annotation escaping from the previous pass is retained.
- README now leads with practical checks and adoption instructions. Removed static
  "audit verified" and hardcoded "CI passing" badges; test status uses the real
  workflow badge. Package description reflects current-code checks, and lockfile
  root version was aligned with the existing package version (0.4.0).

## Behavioral demonstration

See `2026-10-23-adoption-demo.json`, generated from a disposable Git repository with
real files, through the exported API and compiled distribution.

| Stage | New findings | Accepted findings | Stale baseline | Exit |
| --- | ---: | ---: | ---: | ---: |
| First review: skipped test, trivial assert, multi-line empty catch | 3 | 0 | 0 | 1 |
| Baseline explicitly accepted | 0 | 3 | 0 | 0 |
| Another identical skipped test added after a clean line shift | 1 | 3 | 0 | 1 |
| All problematic code fixed | 0 | 0 | 3 | 0 |

This is a behavioral control, not a user study or a measured adoption claim.

## Verification

- `npm run typecheck`: passed.
- `npm test`: build plus all 143 tests passed (13 files). The previous pass had 92;
  this pass adds 51 cases across current-tree checks, lexer behavior and baselines.
- Concurrent baseline control uses four independent Node processes: exactly one
  publishes the destination and all other writers preserve it.
- Controls include empty/unborn repos; unstaged vs indexed content; ignored,
  deleted and unusually named files; malformed/missing baselines; multiplicity;
  source symlinks; binary/oversized source; cancellation; conflicting CLI options;
  fixture masking; non-empty error handlers; and arbitrary project scripts/hooks.
- Existing hostile-Git, PR/staged, badge, and static zero-network bundle tests pass.
- `npm pack --dry-run --json`: valid package manifest with the compiled CLI, API,
  declarations, README and license; no new runtime dependencies or test assets.
- `git diff --check`: clean.
- A read-only run against the local agent-roast checkout inspected 30 supported
  files / 7,009 lines and reported a complete scan. This is a smoke check only;
  zero reported patterns does not imply a bug-free project.
- Local runtime: Node 23.10.0. The pre-existing added Node 18/20/22 workflow matrix
  has not run remotely, so cross-version CI success is not claimed.

## Boundaries

A baseline is reviewed policy, not a security boundary against someone who can edit
that policy. Snippet or file changes require fresh review. Identical occurrences
are distinguished by count, not full semantic identity. An accepted baseline cannot
prove an issue was fixed: a stale count also includes policy/ignore changes.

The lexer is deliberately limited and has no AST or type information. Template
interpolation, complex/raw language literals, inherited contexts outside an added
hunk, and all possible handler syntaxes are not fully parsed. Findings remain review
candidates, including legitimate abstract stubs or deliberate test skips. No risky
code auto-fixes were added.

`check` requires a Git repository (`git init` is sufficient) and scans its containing
root, not an arbitrary non-Git directory. It does not recurse through submodules.
Defaults exclude generated output and dependencies. Limits: 2 MiB per file and 50
MiB total; supported files that hit limits are reported incomplete, never clean.
Intentional exclusions belong in `ignorePaths`. Baseline refresh writes a new file
for review; there is no automatic silent baseline rewrite.

Existing history, PR, staged and badge commands remain available. New features are
local until a package release. The composite action still references released 0.4.0
and must be deliberately updated with the next release; publishing, remote pushes,
deployment, and changing release tags were not performed.

External integration was considered but deferred: GitHub can ingest third-party
SARIF results ([official documentation](https://docs.github.com/en/code-security/concepts/code-scanning/sarif-files)).
Reliable findings and adoption behavior were prioritized before another export format.
