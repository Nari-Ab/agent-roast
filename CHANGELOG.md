# Changelog

## 0.17.0 — 2026-11-11

**An exact check that became a bound, and `toEqual` that became `toMatchObject`.**

- **A check loosened on the same expression is reported** (`assertion-weakened`, blocks). When what an assertion looks at stays the same
  and only the matcher gets looser, three forms are read: a number or count turned into a bound (`expect(cost.do).toBe(2)` to
  `toBeLessThanOrEqual(2)`, `toHaveLength(3)` to `toBeGreaterThan(1)`, `assert len(added) == 2` to `>= 2`, `assert status == 500` to
  `status >= 400`, Node's `assert.equal(x.length, 3)` to `assert.ok(x.length > 0)`, `assertEqual` to `assertGreaterEqual`), a set or value
  equality turned into a subset or a range (`assert set(a) == set(b)` to `<=`), and `toEqual(X)` or `toStrictEqual(X)` turned into
  `toMatchObject(X)` with the very same argument, which lets extra properties through. Left alone: a check that expected nothing (zero,
  empty, `None`), which was flipped and not loosened; a negated check; another expression; a `toMatchObject` given more fields than the
  `toEqual` it replaces; an exact check that took the old one's place on the same expression with another value (`assert.equal(calls, 3)`
  became `assert.equal(calls, after)`, next to a new `assert.ok(calls > before)`); a check that is still somewhere in the file (it moved);
  and a test whose title was changed in the same commit, which is a new scenario.
- **The loosened check is found when the test gained or lost other assertions too.** Assertions used to be compared one to one, and only
  when a test kept the same number of them; they are now also paired by the expression they check, where the old assertion stood.
- **A flipped expectation is no longer read as a loosened one when the old value ended the line with a bracket or a quote.**
  `assert tags == {}` turned into `assert len(tags) > 0` expects the opposite, not less. 0.15.0 and 0.16.0 reported it, because a word boundary
  cannot match after `}`, `]` or a quote. `== []`, `== ''`, `== set()`, `== ()` and `== 0.0` count as expecting nothing now too.
- **Measured on the commits of the last release** (the 9,761 reviewed commits of 164 repositories, `docs/benchmarks.md` section 8). Of 29
  commits that turned an exact check into a bound, or `toEqual(X)` into `toMatchObject`, on the same expression, 0.16.0 reported 1 and this
  version reports 13; in 12 of the other 16 the test was renamed in the same commit, which is not compared. Of the 2,177 sampled commits
  that add a line the rule can fire on, 14 gave a finding that 0.16.0 did not (18 findings, 10 of them in 6 AI-signed commits) and
  none were lost. Reading them showed two false alarms, both fixed here, and the rest loosened checks that a reviewer should see:
  a count that became "at least", a `toEqual` that became `toMatchObject`, a timing check relaxed to a bound with the reason in the commit.
  On the 7,200 commits of 24 repositories of section 6: 1 new finding.
- `scripts/scan-edited-assertions.mjs` finds the assertions that were edited in place in a benchmark run, and
  `scripts/compare-builds-on-diffs.mjs` reviews only the commits that can differ with two builds and lists what changed, to measure a new rule in
  minutes instead of hours.
- Labeled cases: 126 cheats caught, 90 look-alikes left alone, 1 gap open (it was 119, 84 and 1).

## 0.16.0 — 2026-11-11

**A test that checks its own mock, and a first look at what the rules say about AI-signed commits.**

- **A test that replaces the function it checks with a mock** (`trivial-assert`, blocks) is reported: `jest.mock("./price", () =>
  ({ price: () => 42 }))` followed by `expect(price(cart)).toBe(42)`, or `monkeypatch.setattr(cart, "total", lambda: 42)` followed by
  `assert cart.total() == 42`. The assertion cannot fail whatever the real code does. It is read in one test file, in
  JavaScript/TypeScript (top-level `jest.mock` and `vi.mock`, also through `const total = price(cart); expect(total)`) and in Python
  (`patch`, `patch.object`, `mocker.patch`, `monkeypatch.setattr` against the `assert`s of the same test or `with` block), and only when
  the change introduces it. A mocked dependency, a mock that keeps the real module (`requireActual`, `wraps=`, `{ spy: true }`), an
  automock without a return value, `doMock`, an assertion about how a mock was called, and the tests of the mocking tools themselves are
  left alone. On 21,686 test files of 24 public repositories the only matches were jest's, vitest's and pytest's own tests of mocking,
  plus one sanity check. This closes the second of the three documented gaps.
- **Six kinds of false alarm that 0.15.0 had, found by replaying it on AI-signed commits, are fixed.** The same 9,732 commits (5,454
  AI-signed, 4,278 others, 164 public repositories) were reviewed with 0.14.0 and 0.15.0: 30 findings were new, in 27 commits, and
  reading them showed 7 false alarms. An assertion removed from the front of a test shifted the pairing of the others, so a check that
  stayed was compared with one that replaced it (assertions are now paired by content, and `isinstance` replaced by `len(x) > 0` is no
  longer read as an exact check turned into a bound); `.not.toHaveBeenCalled()` was read as looser than `toHaveBeenCalledWith(...)` (twice);
  a dropped `match=` was reported although the exception was kept (`as info`) to be checked on the next line; a ruff rule enabled in the
  same change with its existing violations listed per file, and a flake8 code outside the tool's default set, were reported as ignored;
  and `|| true` that replaced a `continue-on-error: true` was reported although the tolerance was the same. The other 23 findings are
  real loosening: a test marked `xfail` in a commit titled to turn CI green, `--passWithNoTests` added "to prevent CI failure",
  `toHaveBeenCalledWith(...)` relaxed to `toHaveBeenCalled()`, `== pytest.approx(x)` relaxed to `>= 1`, `raises(RuntimeError, match=...)`
  relaxed to `raises(Exception, ...)`, a CI job switched off, and ruff, mypy and tsconfig settings loosened. Section 7 of
  `docs/benchmarks.md` has the numbers, the limits, and `scripts/compare-agent-runs.mjs` to repeat it.
- Labeled cases: 119 cheats caught, 84 look-alikes left alone, 1 gap open (it was 114, 80 and 2).

## 0.15.0 — 2026-11-11

**More of the shortcuts an agent takes to turn a red test green.** 48 shortcuts were tried by hand against 0.14.0; it caught 3.
The checks below were added for the rest that leave a trace in a diff, then run on the newest 300 commits of 24 public JavaScript
and Python repositories and corrected from what they said (`docs/benchmarks.md`, section 6).

- **Tests that are expected to fail count like skips.** `@pytest.mark.xfail`, `pytest.xfail()`, `@unittest.expectedFailure`,
  `pytestmark = pytest.mark.skip` for a whole module, `marks=pytest.mark.xfail` on one parametrized case, `it.fails` (Vitest),
  `test.failing` (Jest, AVA) and Playwright's `test.fixme` and `test.fail`: a failure that is expected cannot fail the run. A
  condition that depends on the environment (`xfail(sys.platform == "win32", ...)`, `test.fixme(browserName === "webkit", ...)`)
  is left alone, like a conditional skip. A marker only counts on a test that **was already there**, compared per test: a new test
  written with `xfail` to document a known bug hides nothing, and public history is full of them (15 commits in the 24
  repositories were reported without this condition, 1 with it). `xfail_strict` switched off is reported as `guard-weakened`.
- **Weaker ways to say the same thing** (`assertion-weakened`). `toThrow("message")` to `toThrow()` or `toThrow(Error)`,
  `pytest.raises(ValueError)` to `Exception`, a dropped `match=`, `assertRaisesRegex` to `assertRaises`,
  `toHaveBeenCalledWith(...)` to `toHaveBeenCalled()`, an exact count to `toBeGreaterThan(0)`, `assert len(x) == 3` to
  `assert len(x) > 0`, and `toEqual(expect.anything())`, which closes one of the three documented gaps. A check that expected
  nothing (`toHaveLength(0)` to `toBeGreaterThan(0)`) is a flipped expectation and is left alone.
- **CI and scripts** (`guard-weakened`). `npm test || true`, `pytest; exit 0` and a step or job switched off with `if: false`;
  the `lint`, `typecheck`, `check`, `ci`, `verify` and `validate` scripts in `package.json`, not only `test`, turned into `echo`,
  `true` or `... || true`.
- **Python lint and type-checker settings** (`guard-weakened`), the twin of the tsconfig and ESLint checks: codes added to a ruff,
  flake8 or pylint ignore list (or mypy's `disable_error_code`), codes dropped from `select`, a mypy strictness switch turned off,
  `ignore_errors = true` for a module, a pylint `fail-under` lowered. A tool being configured for the first time is not reported.
  In `tsconfig.json`, a single check such as `noImplicitAny` switched off under `strict`.
- **A test harness that rewrites the result** (`guard-weakened`). In `conftest.py`, `sitecustomize.py` and test files:
  `report.outcome = "passed"`, `call.excinfo = None`, `session.exitstatus = 0`.
- **Coverage exclusions and more suppressions** (`type-escape`, a warning that never blocks): `# pragma: no cover` and
  `# pragma: no branch`, `istanbul ignore`, `c8 ignore`, `v8 ignore`, `# pylint: disable`, `# pyright: ignore`,
  `# mypy: ignore-errors`, `# flake8: noqa`, `# ruff: noqa`, `biome-ignore`. The conventional uses of a pragma (`if TYPE_CHECKING:`,
  `if __name__ == "__main__":`, `raise NotImplementedError`, optional-import guards) are not reported.

On the 7,200 commits, 5 more would block than with 0.14.0 (24 to 29): four ruff `ignore` changes and one commit that marked two
existing tests `xfail`, all deliberate and explained; 160 warnings appeared in 66 commits; nothing 0.14.0 reported was lost.
The labeled set is now 114 cheats caught, 80 look-alikes left alone and 2 gaps open (it was 71, 51 and 3). Still missed, and now
listed in `docs/rules.md`: tests excluded by a runner option (`--ignore`, `testPathIgnorePatterns`, a longer `omit`), assertions made
unreachable, and suppressions in Go, Rust and Java. `scripts/benchmark-compare.mjs` replays two builds on the same history so the
next release can be measured the same way.

## 0.14.0 — 2026-11-11

**Try the hook without risk.** `agent-roast hook install --advisory` adds the hook in a mode where the agent is never sent
back: when it finishes with a weakened check, you get the one-line warning and the agent carries on. Run it for a week to see
what the hook would have said, then install it again without `--advisory` to start sending agents back. `hook status` shows
which mode each hook is in. For a hook you cannot edit, such as the Claude Code plugin's, set `AGENT_ROAST_HOOK=advisory` in
the environment; `hook run --advisory` does the same for a command you write by hand. Cursor has no channel for a message to the
person, so there the warning goes to the hook's log.

Fixed on the way: Commander gives `--advisory` to the root command wherever it appears, so the hook commands now read it from
there as well (a test through the real command line caught it).

## 0.13.0 — 2026-11-11

**An MCP server.** `agent-roast mcp` runs a small MCP server over stdio, so any agent that speaks MCP (Claude Code, Codex,
Cursor and others) can ask whether its changes weaken a check before it says it is done. It is read-only and offline like the
rest of agent-roast, and it has no dependency, so the built files still contain no network code.

- Three tools: `review_worktree` (everything uncommitted against `HEAD`, the same review the hook runs), `review_changes`
  (two committed revisions; the rules come from the base) and `stop_hook` (the Stop hook's answer, for plugin hooks of type
  `mcp_tool`). All carry read-only annotations, and what a tool finds reaches the agent in the words the hook uses.
- It answers both protocol eras: the `initialize` handshake of 2025-11-25 and earlier, and the per-request metadata of
  2026-07-28 (`server/discover`, `resultType`, `UnsupportedProtocolVersionError`). Claude Code's connection check accepts it.
- The tools read only the project the server was started in (and other worktrees of the same repository). A path outside it,
  through `..` or a symlink, is refused; `--root <directory>` names more places, and a server started from the filesystem root
  has no project until it is given one. A check is stopped after 25 seconds and a client can cancel it.
- `server.json` and `mcpName` in `package.json` make it ready for the official MCP registry; `docs/maintainers.md` has the steps.

Setup for Claude Code, Codex, Cursor and others is in `docs/integrations.md#mcp-server`. A tool only helps when the agent calls
it, so the hook stays the way to guarantee a review.

## 0.12.2 — 2026-11-06

The skip, focus and placeholder-assertion rules added in 0.12.0 for Go, Rust, Java, Kotlin, C#, Ruby, PHP and
Swift had only been tested on labeled cases. They were run on the newest 300 commits of 39 public repositories
and every finding was read in its source (`docs/benchmarks.md`, section 5). 26 of the 99 findings were skips that
depend on the environment, which the rules are meant to leave alone. Those are fixed, and nothing new is reported:

- **Swift.** `throw XCTSkip(...)` between `#if os(Windows)` and `#endif`, and `@Test(.disabled(if: condition))`,
  are no longer reported. A test file wrapped in `#if canImport(XCTest)` still reports its skips. Functions
  declared `public`, `open`, `final` or `override` are recognized as helpers and tests.
- **Ruby.** `it "...", :skip => condition` and `skip: condition` are no longer reported; a bare flag, `true`
  and a reason still are. A `skip` or `pending` in a hook under `if` / `elsif` counts as guarded.
- **C#.** `[Ignore]` is reported only next to a test attribute (`[Test]`, `[TestMethod]`, `[Fact]`, ...), so
  AutoMapper's `[Ignore]` mapping attribute is no longer a skip. `Skip = "..."` together with `SkipUnless`,
  `SkipWhen` or `SkipType` depends on the environment and is not reported.

14 labeled cases were added: 71 of 71 cheats caught and 51 of 51 look-alikes silent. `scripts/benchmark-languages.mjs`
repeats the run on real repositories (`benchmarks/language-corpus.tsv` lists them). Known limit: the
labels come from one reader, and they were made on the same repositories the fixes were made on.

## 0.12.1 — 2026-11-04

The GitHub Action is renamed **"Agent Roast: weakened-test guard"** so that it can be listed on GitHub
Marketplace: the plain name `agent-roast` belongs to a GitHub organization, and Marketplace rejects a
name that matches a user or an organization. `uses: Nari-Ab/agent-roast@v1` is unchanged. The CLI is
the same as in 0.12.0.

## 0.12.0 — 2026-11-04

Until now agent-roast looked at a change after it was committed. This release looks at it while it
is still being made, where an agent can still fix it, and makes the first run show something useful.

**Guard a coding agent.**

- New `agent-roast hook install` adds a Stop hook to Claude Code, Codex and Cursor. When the agent
  is about to finish, everything it changed since `HEAD` is reviewed, and if a check got weaker the
  agent is sent back once with the file, the line and the before and after. A second attempt is not
  blocked again; the person gets a warning instead, so the two never loop. Anything that cannot be
  checked lets the agent finish. `hook status`, `hook uninstall`, `hook pause` and `hook resume`
  manage it, and the hook pins the version that installed it. `--instructions` also writes a short
  paragraph into `AGENTS.md` and `CLAUDE.md`.
- New Claude Code plugin and marketplace entry: `/plugin install agent-roast --marketplace Nari-Ab/agent-roast`.
- New `review --worktree` compares `HEAD` with everything not committed yet (staged, unstaged and
  untracked files). Git compares against a private copy of the index, so the repository is never
  touched; the policy still comes from `HEAD`. Context reviews report `schemaVersion` `1.2.0` and
  `source: "worktree"`.

**A first run that says something.**

- `agent-roast` without arguments now reviews what you have not committed yet, and on a clean tree
  replays your recent commits. It used to print the history score, which moved to `agent-roast audit`
  (`--all`, `--since`, `--base` and the other old options still work as before). `--json`,
  `--format`, `--fail-on` and `--advisory` apply to the new default.
- New `agent-roast demo` shows a scripted example in a temporary repository, with the real review.
- The terminal review colors `FAIL` and `WARN` findings and the verdict.

**More languages.** `test-skip`, `test-focus` and `trivial-assert` now cover Go, Rust, Java, Kotlin,
C#, Ruby, PHP and Swift, with skips that depend on the environment left alone (`testing.Short()`,
`@DisabledOnOs`, `skip ... unless`, `XCTSkipUnless`, `#[cfg_attr(..., ignore)]`). 29 labeled cases
were added: 64 of 64 cheats caught and 44 of 44 look-alikes silent.

**Pipelines and project.**

- The Action takes `comment: true` to keep one pull request comment up to date, and stays quiet
  on a clean pull request.
- CI runs the full suite on macOS and a first-run smoke test on Linux, macOS and Windows. A release
  workflow can publish with npm provenance once it is enabled (`docs/maintainers.md`).
- README rewritten as a landing page; the long reference moved to `docs/` (rules, integrations,
  reference, comparison). Added CONTRIBUTING, SECURITY, a code of conduct, pull request and issue
  templates for false positives and missed shortcuts, and dependabot. Internal plans and evidence
  moved to `docs/archive`.

Known limits: the agent hooks follow each agent's documented protocol and are tested with simulated
hook input, not yet in long live sessions. `assertion-weakened` is still JavaScript, TypeScript and
Python only.

## 0.11.0 — 2026-11-02

Found by running the first command of the pilot guide on the 179 repositories of the benchmark
corpus: `review --base HEAD~50` stopped with an error on 44 of them and reported a median of 22
findings on the rest, mostly `as any` and removed tests.

- New `agent-roast replay`: reviews each of the newest commits (50 by default, `--last N`) on its
  own against its parent, the way a pull-request check would have seen it, and lists the commits
  that would have been blocked or drew a warning about a weakened check. It follows the first-parent
  history, never fails because of a finding, and reports a commit that is too large to read instead
  of stopping. Line patterns such as `as any` are counted and listed with `--all-rules`; `--json`
  returns every finding.
- New `--advisory` option for `review`, `check` and `--staged`: report without failing, the same as
  an empty `--fail-on`. cmd.exe and Windows PowerShell 5.1 do not pass the empty argument, so the
  documented advisory command failed there.
- Fewer false alarms in `test-skip`, which blocks by default. A skip that depends on the
  environment is no longer reported: Playwright's `test.skip(condition, 'reason')`, a `pytest.skip`
  or `self.skipTest` under `if`/`try`, and a `pytest.skip` inside a fixture or helper. Skips that
  name a test, stand alone in a test body, are `skip(true)` or depend on `CI` are still reported. On
  the 75 commits of the corpus that carried a `test-skip` finding, findings fell from 160 to 34.
- A review ref that does not resolve now says why: a shallow clone (run `git fetch --unshallow`) or
  a history shorter than the requested `HEAD~N` (with the number that works).
- Six more labeled cases (three cheats, three harmless): 43 cheats, 36 harmless changes, 3
  documented gaps.
- The Action description no longer presents the tool as an audit of AI shortcuts and panic loops.

## 0.10.1 — 2026-11-01

- Fix: a blocking finding could be hidden. The terminal report shows at most 20 findings, in file
  order, so a change with 20 or more warnings in files that sort earlier (typically `as any` in a
  large pull request) left a finding such as `assertion-weakened` behind "N more new findings",
  with only the `BLOCKED` line naming the rule. Advisory runs (`--fail-on ''`) had the same
  problem. Findings are now ordered by importance: rules that block, then the before/after rules
  and the default blocking shortcuts, then the noisier line patterns. The markdown and GitHub
  summary tables use the same order. JSON and SARIF output are unchanged.
- Docs: [docs/pilot.md](docs/pilot.md) describes how to try the tool on your own repository, and
  there is a feedback form for it.

## 0.10.0 — 2026-11-01

Measured on 12,645 commits from 166 public repositories, then fixed. The finding: weakened
checks are rare (about 1 in 300 test-touching commits triggers a block), usually deliberate, and
not more frequent in AI-signed commits. This release makes the rules quieter and more accurate.

- **Behavior change:** `assertion-weakened` now means an exact check replaced by a weaker one and
  still blocks. A test that only lost assertions is the new `assertion-removed` rule, which warns:
  most such cases were deliberate or false alarms. A policy that set `"assertion-weakened": "off"`
  to silence lost assertions should set `"assertion-removed": "off"` instead.
- `guard-weakened` now reports a workflow that keeps its tests but stops running on pushes and pull
  requests, and a deleted workflow that gated changes. It no longer reports: tolerated failure on a
  step or job added in the same change; a lint rule enforced by a namespaced twin or switched off
  only in an override; CI restructuring that keeps test steps (multi-line run blocks, shared
  workflows, tests moved to another workflow); or scheduled-only workflows.
- Fewer false alarms in the assertion rules: formatter rewraps and trailing remarks are ignored;
  Python `assert_*` helpers (mocks, numeric comparisons) count as checks; checks moved into an
  assertion helper introduced by the same change, checks whose literals are still asserted in the
  test, Testing Library `getBy*` presence checks, and not-null checks flipped to presence checks are
  not reported.
- Add `scripts/benchmark-agents.mjs` (AI-signed versus other commits, Wilson intervals,
  per-repository comparison), a `--cli` option for benchmarking a frozen install,
  `benchmarks/agent-corpus.tsv` (the 166 repositories and their revisions), and 76 labeled cases
  (40 cheats, 33 harmless changes, 3 documented gaps). Method and results: `docs/benchmarks.md`.
- The README no longer presents the tool as an AI-cheating detector: the measurements show these moves are not specific to AI.
- The SARIF rule list and `schema.json` include `assertion-removed`.


## 0.9.0 — 2026-11-01

- New diff-aware rules for `review` and `--staged` that catch changes which make a project
  easier to pass without making it more correct:
  - `assertion-weakened`: a test loses assertions, or an exact check becomes a weaker one.
  - `test-removed`: a test, or a whole test file, disappears (renames and moves are not reported).
  - `expectation-rewritten`: an expected value changes while the inputs stay the same and
    production code changed in the same review.
  - `guard-weakened`: lower coverage thresholds, compiler strictness switched off, lint rules
    downgraded, CI steps allowed to fail or no longer running tests, test scripts that cannot fail.
- **Behavior change:** `assertion-weakened` and `guard-weakened` block by default, like
  `test-skip`. To relax, set `"rules": { "assertion-weakened": "warn" }` (or `"off"`) in the
  trusted policy. `test-removed` and `expectation-rewritten` report without blocking.
- Comparison is statement-based and formatter-safe: quote style, wrapping and trailing commas are
  ignored; moved, renamed, parametrized and snapshot-folded tests are not reported. Parsing is
  bounded by the next test's start, so work stays linear on very large or malformed test files.
- Add `benchmarks/cases.mjs` (32 cheats, 15 controls, 3 documented gaps),
  `scripts/benchmark-recall.mjs` and `scripts/benchmark-noise.mjs`, and document the method and
  results in `docs/benchmarks.md`. On 606 test/config commits of five open-source projects the
  blocking rules fired on 7 (1.2%); each was read by hand.
- The SARIF rule list and `schema.json` include the new rules.
- Remove unreferenced launch assets (audio/video, GIF render scripts, Product Hunt kit, the old
  site video page) and the `gifenc` and `@napi-rs/canvas` dev dependencies.
- Update the composite Action to install exactly 0.9.0, and the site and README to match.

## 0.8.1 — 2026-10-29

- Fix `init` from repository subdirectories: create effective root policy and CI
  workflow, preserve existing root files, report the actual destination, and refuse
  bare repositories before writing ineffective settings.
- Avoid focused/skipped-test false alarms from JS regexp literals after arrow,
  throw and control headers; preserve context across contiguous source lines.
- Detect multiline empty catches, TypeScript bypass casts and placeholder errors,
  including deletion-only catch regressions. Do not join absent diff hunks. Bound
  scanning of unfinished catch headers and reduce ordinary TODO-message noise.
- Add 39 regression tests and 22 disposable-repository CLI workflows. The complete
  suite contains 486 tests; Node 18/20/22 remain supported. No new dependencies.
- Document remaining Node test option-object and template-interpolation gaps;
  hand-selected QA results are not a production accuracy measurement.
- Update the composite Action to install exactly 0.8.1 and the site/install examples.

## 0.8.0 — 2026-10-28

- Reviewed, expiring exceptions for exact finding fingerprints and total occurrence
  counts. Mandatory reasons, visible accepted records, `--ignore-exceptions`, and
  SARIF suppressions let teams handle intentional cases without disabling rules.
  Baseline/exception budgets cannot stack to hide duplicates; trusted base/HEAD policy
  remains authoritative for context reviews. Packaged an offline configuration schema.
- Fixed real pre-commit candidate selection for `git commit -a` and `--only` temporary
  indexes. Refuse outside index redirects. Isolated all explicit-repository Git reads,
  bounded policy/source/subprocess reads, prevented symlink/special-file configuration
  reads and no-overwrite initialization writes, and supported linked-worktree hooks.
- Replaced backtracking ignore-glob expansion with a bounded wildcard matcher;
  reject unknown policy fields and non-string severities. Legacy/history CLI audits
  now fail incomplete scans with exit 2 instead of reporting a clean result.
- Improved language-aware skip/focus/assertion/error/stub patterns and literal masking;
  avoid `recatch`, Python imports/real handlers, ordinary variable references and
  human author names becoming false findings/AI attribution.
- Escape untrusted evidence in legacy terminal/Markdown reports and XML badge labels.
  Preserve accepted-finding identities through exception toggles and baseline filters.
- Added explicit Action advisory input for pilots (incomplete scans still fail).
  Updated site/workflow/article examples and removed unsupported speed, zero-dependency,
  no-false-positive and AI-intent claims. Historical demos are labeled illustrations.
  No new runtime dependencies. Updated development-only Vitest/Vite/esbuild to patched
  versions; development requires Node 20.19+ while the CLI retains Node 18+ support.
  CI uses a Node22 test runner with explicit CLI runtimes18/20/22. The composite
  Action installs exactly 0.8.0.

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
