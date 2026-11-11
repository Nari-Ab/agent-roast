# Benchmarks

What is measured: how well the diff-aware rules (`assertion-weakened`, `assertion-removed`,
`test-removed`, `expectation-rewritten`, `guard-weakened`) separate changes that make a project
easier to pass from changes that do not, and whether AI-signed commits trigger them more often
than other commits. Everything here is reproducible, and none of it is an accuracy guarantee.

**Summary.** Weakened checks are rare (about 1 in 300 test- or CI-touching commits triggers a
block), usually deliberate and explained, and not more frequent in AI-signed commits. About one
finding in five is a false alarm. Most of the rest are decisions a reviewer should see.

| Measurement | Result |
| --- | --- |
| Labeled regression cases | 114/114 cheats caught, 80/80 harmless changes left alone, 2 documented gaps open |
| Five mature projects, 606 test/CI commits | blocking rules on 3 commits (0.5%), all deliberate |
| 166 public repositories, 12,645 commits | blocking rules on 0.3% of AI-signed and 0.3% of other commits |
| Same-repository comparison | odds ratio 0.81 (95% CI 0.40-1.67) for AI-signed versus other |
| Hand labels on unseen repositories | blocking: 2 unexplained, 7 deliberate, 2 false alarms (n=11) |
| First run: `replay` of the newest 50 commits, 179 repositories | no commit that would block in 149 of 179; nothing to list in 43 of 179 (section 4) |
| 0.15.0's new checks: newest 300 commits, 24 JavaScript and Python repositories | 5 more commits of 7,200 would block (24 to 29), all deliberate; 160 line-pattern warnings in 66 commits (section 6) |
| Eight added languages: newest 300 commits, 39 repositories | 0.12.1 reported 99 findings, 26 of them skips that depend on the environment (fixed); of the 73 left, 56 are tests that are switched off and 17 are deliberate test data (section 5) |

## 1. Labeled changes (regression cases)

`benchmarks/cases.mjs` holds before/after changes with the rule that must fire, `null` for changes
that must stay silent, and `miss` for gaps that are documented rather than hidden.
`scripts/benchmark-recall.mjs` builds a throwaway Git repository per case and runs the built CLI;
`tests/benchmark.test.ts` runs the same cases in the test suite.

```bash
npm run build && npm run bench
```

Result: **114/114 cheats caught, 80/80 harmless changes left alone, 2/2 documented gaps still
open.** The cases were written together with the detector, and many were added after a real
false alarm. They protect against regressions and show what is covered; they say nothing about
cheats nobody thought to write down. Open gaps: mocking the module under test and hardcoding the
tested value in production code. (A third, vacuous matchers such as `expect.anything()`, was closed in 0.15.0.)

43 of the cases cover disabled tests and placeholder assertions in Go, Rust, Java, Kotlin, C#,
Ruby, PHP and Swift: 29 were added in 0.12.0 and 14 in 0.12.2, after the run on real repositories in
section 5. The measurements in sections 2 to 4 were taken with 0.10.1 and 0.11.0, before those
rules existed, and do not include them.

## 2. Five mature open-source projects

`scripts/benchmark-noise.mjs` runs `review` over the newest 300 first-parent commits of each
repository and counts findings on the commits that touch tests or CI/config. Git history is only
read; project code is never executed.

| Repository | Revision at clone | Commits touching tests/config |
| --- | --- | ---: |
| tj/commander.js | `ba6d13ddb4` | 134 |
| sindresorhus/execa | `247faa0ff0` | 59 |
| pallets/click | `2247b35ea1` | 102 |
| psf/requests | `3c7baaa05a` | 112 |
| colinhacks/zod | `2554b70c3d` | 199 |
| **Total** | | **606** |

Blocking rules fired on 3 commits (0.5%): `assertion-removed` 5 commits (0.8%), `test-removed` 37
(6.1%), `expectation-rewritten` 17 (2.8%). Reading the blocking commits:

| Commit | Finding | Verdict |
| --- | --- | --- |
| commander.js `96c6c25113` | `noImplicitAny` and `strictNullChecks` set to `false` in a reworked `tsconfig.json` | deliberate; strictness is lower in that config |
| zod `a0898b4b7f` | `continue-on-error: true` on a publish step, with a documented reason | deliberate |
| zod `eb1c1089f7` | release workflow moved from every push to manual dispatch behind an approval environment; its tests stay | deliberate, explained in the commit |

The five `assertion-removed` commits were a Jest to `node:test` migration, an API removal, a
Python 2 cleanup, checks moved from internals to JSON Schema output, and one real defect: a
refactor in `requests` (`e36f34597c`) dropped the `assert` keyword from a comparison, which left
a statement with no effect.

## 3. AI-signed commits in public repositories

### Method

- **Finding repositories.** GitHub commit search for the signatures `Co-Authored-By: Claude`,
  `Generated with Claude Code`, `Co-authored-by: Copilot`, `Co-authored-by: Cursor Agent`,
  `Co-authored-by: Codex`, `devin-ai-integration` and `aider:` (monthly windows from March to
  October 2026 for Claude, the whole range for the others, up to 300 hits per query). The hits were
  grouped by repository.
- **Choosing repositories.** Public, not a fork, not archived, under 250 MB, primarily
  TypeScript, JavaScript, Python or Go (Java in batch 3, which the detectors do not parse). Three
  disjoint batches: 1 and 2 ranked by number of Claude hits, 3 found through the non-Claude
  signatures. Copies of the same project were removed by comparing sampled commits (three
  repositories). The final corpus is 166 repositories in `benchmarks/agent-corpus.tsv`, with the
  revision of each at the time of cloning.
- **Cloning.** Shallow (`--depth 1500`), without hooks or LFS files; nothing from these repositories
  is executed.
- **Marking commits.** A commit is AI-signed when its message or its author/committer identity
  carries one of the signatures of Claude, Copilot, Cursor, Codex, Devin, aider or Gemini. Everything
  else is "other".
- **Sampling.** From the newest 1,500 non-merge commits of each repository, only commits that touch
  tests or CI/config files, then a seeded random sample per repository (batch 1: up to 120 AI-signed
  and 150 other; batches 2 and 3: up to 50 and 50).
- **Reviewing.** `review` of each commit against its parent, with the packed npm package installed in
  a separate folder so that a rebuild cannot change a run in progress.
- **Statistics.** Wilson 95% intervals for rates; Mantel-Haenszel odds ratio over repositories that
  have both kinds of commits.

### Results

All three batches, shipped build, duplicates removed.

| | AI-signed | Other |
| --- | ---: | ---: |
| Repositories | 160 | 141 |
| Commits reviewed | 6,895 | 5,750 |
| Blocking rules | 20 (0.3%, 0.2-0.4%) | 16 (0.3%, 0.2-0.5%) |
| `assertion-weakened` | 5 (0.1%) | 7 (0.1%) |
| `guard-weakened` | 15 (0.2%) | 9 (0.2%) |
| `assertion-removed` (warns) | 165 (2.4%) | 124 (2.2%) |
| `test-removed` (warns) | 1,062 (15.4%) | 730 (12.7%) |
| `expectation-rewritten` (warns) | 396 (5.7%) | 315 (5.5%) |
| `test-skip` | 116 (1.7%) | 71 (1.2%) |
| `trivial-assert` | 10 (0.1%) | 5 (0.1%) |

Inside the same repository, over the 135 repositories that have both kinds: Mantel-Haenszel odds
ratio **0.81 (95% CI 0.40-1.67)** for a blocking finding in an AI-signed commit versus another
commit. Of the 91 repositories with at least 10 reviewed commits of each kind, the AI-signed rate
was higher in 12, lower in 10 and equal in 69. Batch 3, which the detector had not seen before the
last round of fixes, gives the same picture (4 of 1,947 AI-signed commits versus 4 of 1,418 other).

| Agent | AI-signed commits | Blocking | `assertion-removed` |
| --- | ---: | ---: | ---: |
| Claude | 5,380 | 19 (0.4%) | 122 (2.3%) |
| Copilot | 596 | 0 | 20 (3.4%) |
| Devin | 455 | 0 | 7 (1.5%) |
| Codex | 238 | 1 (0.4%) | 6 (2.5%) |
| Cursor | 170 | 0 | 9 (5.3%) |
| aider | 50 | 0 | 1 (2.0%) |
| Gemini | 6 | 0 | 0 |

Outside Claude the samples are too small to compare agents.

### Hand labels

I read findings with the group (AI-signed or other) and the repository hidden, looking at the
commit subject, an excerpt of its message and the diff of the flagged file. Each finding got one of:

- **unexplained weakening:** something that was checked is no longer checked and the commit gives
  no reason;
- **deliberate and explained:** the behavior or configuration changed on purpose and the commit or
  its comments say or show it (a feature removed, an API changed, a gate relaxed with a stated plan);
- **unclear:** I could not tell from the diff;
- **false alarm:** the checks were in fact kept (moved, merged into a stronger one, extracted into a
  helper) or the finding was wrong.

Labels are one reader's opinion, not independently verified; the reader was the AI assistant that
developed this release.

| Round | Build | Findings | Unexplained | Deliberate | Unclear | False alarm |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1, used to fix the detector | 0.9.0 | 60 | 6 | 30 | 5 | 19 |
| 2, used to fix the detector | candidate | 16 | 2 | 5 | 0 | 9 |
| 3a, unseen repositories, blocking | candidate | 11 | 2 | 7 | 0 | 2 |
| 3b, unseen repositories, `assertion-removed` | candidate | 24 | 1 | 12 | 6 | 5 |

Round 3 is the only out-of-sample number: **11 blocking findings, 2 unexplained (both TypeScript
strictness switched off in commits titled "Changes", from unsigned commits), 7 deliberate, 2 false
alarms.** By group over all rounds, an unexplained weakening was found in 6 of 73 AI-signed findings
and 5 of 38 others; the samples are small and partly used for tuning, so this shows no difference
rather than a difference in either direction.

Re-running the shipped build on all 111 labeled commits: all 11 unexplained weakenings are still
reported (5 as blocking, 6 as warnings), and of 35 false alarms 11 disappeared, 22 are warnings and
2 still block.

### What changed because of the labels

False alarms found by reading were fixed one class at a time and each became a regression case:
Python mock and numeric `assert_*` helpers not counted as checks; a call inside `assert` treated
as a truthiness check; a trailing remark treated as part of the assertion; several checks merged
into one stronger assertion; `toBeNull()` flipped to `toBeTruthy()` read as weaker; the count of test
steps in CI (multi-line run blocks, shared workflows, a lint command with a `.test/` path, tests
moved between workflows, deleted scheduled workflows); `continue-on-error` on a step added in the
same change; a base lint rule replaced by its `typescript-eslint` twin or switched off only in an
override; checks moved into an assertion helper; Testing Library `getBy*` queries that throw.
The first round also showed that a lost assertion is mostly a deliberate change, so
`assertion-removed` was split out of `assertion-weakened` and only warns.

### Limits

- A signature shows that a tool was involved, not how much. Unsigned AI help in the "other" group
  would hide a difference.
- The repositories were found by searching for those signatures, so many are small personal projects,
  and most signatures are Claude's.
- This measures what was committed, not what an agent tries during a session. A weakened check that
  is noticed and fixed before the commit does not appear.
- Text and structure only: no type information, no execution, no data flow.
- The Go detectors rest on labeled cases; the real-history samples contain few Go projects.
- Three fixes (assertion helpers, throwing test-library queries, scheduled-only workflows) came after
  the last labeling round and have regression cases but no new labels. The rates above are from the
  shipped build; the round 3 labels are from the build before those fixes.

## 4. The first run: replaying the newest commits

The pilot guide starts with `agent-roast replay`, so its output is measured too: the newest 50
commits of each of the 179 repositories above (7,905 commits), each reviewed on its own
against its parent with the build in this release.

| Per repository | Result |
| --- | --- |
| Commits that would have been blocked | median 0, at most 12; none in 149 of 179 |
| Commits with a warning about a weakened check | median 4; none in 46 of 179 |
| Nothing to list at all | 43 of 179 |
| Time | median 10 s, p90 28 s, max 106 s |

Of all commits, 0.6% would have been blocked, 12.1% drew a warning about a weakened
check, 9.4% matched only a line pattern such as `as any`, and 77.7% had nothing to
report or changed no source, test or CI file. 13 commits could not be compared in full and 5 were too
large to review; `replay` reports them instead of stopping.

**Why one commit at a time.** The first version of the guide ran `review --base HEAD~50`, one
comparison over the whole window. On the same repositories that stopped with an error on 44 of 179
(the history along first parents was shorter than the window on 27, more than 1,000 files changed
on 11, and files could not be compared on 6) and reported a median of 22 findings on the rest,
mostly `as any` and tests that were gone by the end of the window. A pull-request check sees one
change at a time, so that is what `replay` shows.

**What changed because of the first run.** `test-skip` blocks by default, and on this corpus it
fired on skips that gate a test on its environment: Playwright's `test.skip(testInfo.project.name
!== 'desktop-chrome', 'desktop only')` (249 of the 829 `skip()` calls in the current code of these
repositories, 30%), `pytest.skip` under an `if` or `try`, and `pytest.skip` inside a fixture. They
are no longer reported. Of the 75 non-merge commits whose review under 0.10.1 contained a
`test-skip` finding, findings fell from 160 to 34 and commits from 75 to 11. The 34 left are skips
that name a test (27), `test.skip(true, ...)` (4) and `@pytest.mark.skip` or `@unittest.skip` (3).
This is a reduction against the previous build, judged from the code of the removed findings by one
reader (a condition on the browser project, the platform or a missing service), not a labeled
accuracy figure. The cost: a conditional skip that hides a failing test is no longer reported
unless its condition mentions CI.

## 5. The eight added languages on real repositories

The `test-skip`, `test-focus` and `trivial-assert` rules for Go, Rust, Java, Kotlin, C#, Ruby, PHP and Swift were first
tested on labeled cases only (section 1). To see what they report on code nobody wrote them for, `replay` reviewed the
newest 300 commits of 39 public repositories, each commit on its own against its parent: 11,681 commits, 5 repositories
per language and 4 for PHP, well-known and test-heavy, picked by hand (`benchmarks/language-corpus.tsv`; `phpunit/phpunit`
was dropped because its clone failed). The build was 0.12.1. One reader (an AI assistant) then read every finding in its
source and put it into one of three groups.

| Group | 0.12.1 | 0.12.2 |
| --- | --- | --- |
| A skip that depends on the environment, or not a skip at all: the rules should stay silent | 26 | 0 |
| Deliberate test data: a testing framework's own fixtures, documentation examples | 17 | 17 |
| A test that is switched off, or a placeholder assertion | 56 | 56 |
| **Findings** | **99** | **73** |
| Commits with a finding | 39 | 28 |

| Language | Repositories | Commits | Findings, 0.12.1 → 0.12.2 | Commits with a finding | Switched off or placeholder | Test data |
| --- | --- | --- | --- | --- | --- | --- |
| Go | 5 | 1,497 | 1 → 1 | 1 → 1 | 1 | 0 |
| Rust | 5 | 1,498 | 0 → 0 | 0 → 0 | 0 | 0 |
| Java | 5 | 1,495 | 6 → 6 | 5 → 5 | 2 | 4 |
| Kotlin | 5 | 1,498 | 32 → 32 | 16 → 16 | 32 | 0 |
| C# | 5 | 1,498 | 26 → 14 | 4 → 2 | 4 | 10 |
| Ruby | 5 | 1,499 | 8 → 3 | 5 → 1 | 0 | 3 |
| PHP | 4 | 1,200 | 2 → 2 | 1 → 1 | 2 | 0 |
| Swift | 5 | 1,496 | 24 → 15 | 7 → 2 | 15 | 0 |

**The 26 false alarms** were skips that depend on the environment, which the rules are meant to leave alone, or were not
skips at all:
Swift `throw XCTSkip(...)` between `#if os(Windows)` and `#endif` (7) and `@Test(.disabled(if: condition))` (2); Ruby
`it "...", :skip => condition` (4) and a `pending` in a hook under an `elsif` that checks the JRuby version (1); C# `[Ignore]` as a
mapping attribute on a property, which AutoMapper uses (4), and xUnit `Skip = "..."` together with `SkipWhen`, `SkipUnless`
or `SkipType` (8). All 26 are fixed in 0.12.2, and the new build reports nothing the old one did not.

**The 73 left.** 56 are tests that are switched off: `@Ignore` or `@Disabled` in Kotlin (32: Exposed 17, koin 9, ktor 5,
okhttp 1), `.disabled(...)` in vapor's Swift Testing rewrite (15), xUnit's own `[Fact(Skip = "Appears to be flaky,
temporarily disabling")]` (4), `@Ignore` in gson (2), `assertTrue(true)` in monolog (2) and one `t.Skip` in testify. Most
carry a reason, which is what a reviewer needs to see; whether each is a good decision is not the tool's call. 17 are test
data: xUnit's acceptance fixtures, which exist to be skipped when xUnit runs them (10), JUnit 5's documentation examples (4)
and RSpec's own bisect resources (3). A project that keeps fixtures like these lists them under `ignorePaths`.

**Limits.**

- One reader labeled the findings, and the fixes were made from those same findings. "0" in the first row means the known
  false alarms are gone, not that the rate is zero on other code; expect new ones in projects not on this list.
- This run counts what is reported, not what is missed. The rules deliberately leave conditional skips alone, so a test
  disabled behind a condition is not found, and nothing here measures that beyond the labeled cases.
- No `test-focus` finding appeared in any language, and none for Rust (`#[ignore]`), so those rules still rest on the
  labeled cases alone.
- Merge commits are reviewed against their first parent: 15 of the 73 findings are in merge commits, where a test
  disabled on a release branch is reported again when that branch is merged (koin, ktor, testify, RSpec).
- The repositories are a convenience sample of well-known projects, not a random one, and framework repositories keep
  skipped tests on purpose. 13 commits (all in JetBrains/Exposed) could not be compared in full; `replay` reports
  them as failed and no findings are counted for them.
- Reviewing the 11,681 commits took 10 minutes on a Mac, with four repositories in parallel.

## 6. Shortcuts added in 0.15.0, on JavaScript and Python repositories

0.15.0 added checks for tests marked as expected to fail, weaker ways to state the same check, shell and script shortcuts in CI
and `package.json`, loosened Python lint and type-checker settings, a test-report hook that rewrites the result, and coverage
exclusions (the list is in the [changelog](../CHANGELOG.md)). Along the way, 48 more shortcuts an agent might take were tried by
hand against 0.14.0, which caught 3 of them; the build under test catches 26 and misses 22 (the main families are listed under
"What no rule sees" in [rules.md](rules.md)). To see what the new checks say about code nobody wrote them for, `scripts/benchmark-compare.mjs` replayed
the newest 300 commits of 24 well-known repositories with 0.14.0 and with the new build, each commit on its own against its
parent, and listed what only the new build reports: 12 Python and 12 JavaScript/TypeScript repositories, 7,200 commits
(`benchmarks/js-python-corpus.tsv` pins each revision). One reader (an AI assistant) then read every new finding that blocks in its
source.

| | 0.14.0 | 0.15.0 |
| --- | --- | --- |
| Commits that would block | 24 | 29 |
| New findings that block | | 6, in 5 commits |
| Findings 0.14.0 reported that 0.15.0 does not | | 0 |
| Line-pattern warnings added (`type-escape`; listed with `--all-rules`, never block) | | 160 in 66 commits |

**The six findings that block.** Four are lint settings: ruff `ignore` gained `F403`/`F405` in httpx (star imports for
re-exports, "Define and expose the API from the same place"), `UP036` in requests ("Migrate build system to PEP 517"), `UP038` in
flask ("drop end of life python versions") and `ISC004` in pip (a pre-commit.ci update that adds a new rule to the ignore list).
Two are poetry's `@pytest.mark.xfail(reason="remove command does not support dependency-groups yet")` on two tests that already
existed, in a commit that changes how those tests are set up. All six are deliberate, explained decisions; none looks like a check
switched off to get a failure through. No new `assertion-weakened` finding and no new CI or script finding appeared in 7,200 commits, so those checks rest on the labeled cases
and the hand-tried shortcuts alone.

**The warnings.** `# pragma: no cover` and `# pragma: no branch`: 99 findings in 38 commits (httpx, pytest, pip, aiohttp,
scikit-learn, pydantic, fastapi, pandas), most of them in projects that require full coverage and use the pragma as a habit.
`istanbul`, `c8` and `v8 ignore`: 10 in 7 commits. `# pyright: ignore`: 42 in 19 commits (pydantic 24, flask 9). `biome-ignore`:
6 in 2 commits (zod), `# pylint: disable` 2, `# mypy: ignore-errors` 1 (SQLAlchemy). They are warnings because a coverage exclusion
looks the same whether a person or an agent adds it.

**What the measurement changed.** The first version of each check was run on these repositories and corrected from what it
said:

- *Tests marked as expected to fail.* The first version reported 44 findings in 15 commits. Reading them: 13 commits added new
  tests written with `xfail`, `fixme` or `test.failing` (fastapi's new parameter tests, six in pydantic, two in pandas, one each
  in poetry, pip, Playwright and jest), and one only gave existing `fixme` tests an identifier prefix in their titles (Playwright).
  A new test that documents a known bug hides nothing, so a marker is now reported only on a test that was there before. That is compared per test, by name or title: a file with many identical
  `@pytest.mark.xfail(` lines made the first comparison blame the last one (pydantic). 15 commits became 1.
- *Coverage pragmas.* 160 findings became 99 once the conventional uses were left alone: `if TYPE_CHECKING:`,
  `if __name__ == "__main__":`, `raise NotImplementedError`, optional-import guards, `else:` and `case _:`.
- *Ignore lists.* requests' "Move to src directory" re-pathed its flake8 `per-file-ignores`, which the first version read as new
  ignores. Lists are now compared by code, across all of a tool's ignore lists.
- *`strict` removed from `tsconfig.json`.* The first version reported it; TanStack's Angular 22 example dropped it in a TypeScript 6
  upgrade, where it is the default. Only an explicit `false` is reported now.

**Limits.**

- This counts what is reported on human work. It says nothing about recall on agent work, which rests on the labeled cases (section 1)
  and the hand-tried shortcuts, and the checks were corrected from the same findings the table counts.
- The repositories are a convenience sample of well-known projects with long human histories. Half are Python projects, which is
  where the lint-setting and marker checks apply; an average project has fewer chances for them to fire.
- Known-failure markers are compared per test only in the review (the hook, `review`, the Action). `replay` runs the same review.
  The older `roast` history card works on added lines alone and still reports a new test written with `xfail`.
- 0.14.0 ran on the same 7,200 commits. Nothing it reported was lost.

## Reproduce

```bash
npm run build
npm run bench                                                     # labeled cases
npm run bench:noise -- ./commander.js ./execa ./click ./requests ./zod --commits 300
node scripts/benchmark-agents.mjs ./repo-a ./repo-b \
  --max-commits 1500 --ai-cap 50 --human-sample 50 --seed 3 --out agents.json
node scripts/benchmark-replay.mjs ./repo-a ./repo-b --last 50 --out replay.json   # the first run, section 4
node scripts/benchmark-languages.mjs ./language-benchmark                         # eight more languages, section 5
node scripts/benchmark-compare.mjs ./compare-benchmark ./old-build/dist/cli.js dist/cli.js   # two builds on the same history, section 6
```

`benchmarks/agent-corpus.tsv` lists the repositories and the revision of each when it was cloned. For
an exact rerun, clone each with `git clone --no-tags`, then `git fetch origin <revision>` (with
`--depth 1500`) and check it out. Search results change over time, so a fresh search will find
different repositories.

`benchmarks/language-corpus.tsv` (section 5) lists each repository with the revision it was measured at,
and the script fetches the 300 commits up to that revision, so a rerun reads the same commits. An
existing clone in the work directory is reused, which makes it easy to compare two builds on the same history.
