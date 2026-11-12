# Benchmarks

What is measured: how well the diff-aware rules (`assertion-weakened`, `assertion-removed`,
`test-removed`, `expectation-rewritten`, `guard-weakened`) separate changes that make a project
easier to pass from changes that do not, and whether AI-signed commits trigger them more often
than other commits. Everything here is reproducible, and none of it is an accuracy guarantee.

**Summary.** Weakened checks are rare (about 1 in 300 test- or CI-touching commits triggers a
block), usually deliberate and explained, and not more frequent in AI-signed commits. On repositories that the rules
were not written from, between a quarter and two thirds of the blocked commits were false alarms, depending on the sample (sections 9 and 10: 69%
for 0.17.0 on two samples, 51% and 27% for 0.18.0 on two samples nobody had read, 66% for this version as it was frozen on a sixth, where 52 of the
100 blocks were one repository and 51 of them one defect, which is fixed; 48% for the published 0.19.0 on a seventh, section 11); the rest are decisions a reviewer should see.

| Measurement | Result |
| --- | --- |
| Labeled regression cases | 152/152 cheats caught, 136/136 harmless changes left alone, 1 documented gap open |
| Five mature projects, 606 test/CI commits | blocking rules on 3 commits (0.5%), all deliberate |
| 166 public repositories, 12,645 commits | blocking rules on 0.3% of AI-signed and 0.3% of other commits |
| Same-repository comparison | odds ratio 0.81 (95% CI 0.40-1.67) for AI-signed versus other |
| Hand labels on unseen repositories | blocking: 2 unexplained, 7 deliberate, 2 false alarms (n=11) |
| First run: `replay` of the newest 50 commits, 179 repositories | no commit that would block in 149 of 179; nothing to list in 43 of 179 (section 4) |
| 0.15.0's new checks: newest 300 commits, 24 JavaScript and Python repositories | 5 more commits of 7,200 would block (24 to 29), all deliberate; 160 line-pattern warnings in 66 commits (section 6) |
| 0.15.0 on AI-signed commits: 9,732 sampled commits, 164 repositories | AI-signed commits that would block 0.3% to 0.6% (17 to 30 of 5,454), others 0.3% to 0.4% (13 to 19 of 4,278); of the 30 new findings 7 were false alarms (fixed in 0.16.0), 23 real loosening (section 7) |
| 0.17.0's rule for an exact check turned into a bound: the same 9,761 commits, the 2,177 that can differ | 18 new findings in 14 commits (10 in 6 AI-signed), none lost; two false alarms found by reading them and fixed; 13 of the 29 commits that a scan found reported, up from 1; on the 7,200 commits of section 6, 1 new finding (section 8) |
| What the rules block on repositories nobody had tuned on: four samples, 158 repositories, 44,878 commits | 0.17.0 blocked 74 of 11,604 commits on sample 1 and 65 of 10,726 on sample 4, 69% of both false alarms; this version, frozen before sample 4 was drawn, blocked 41 of 10,726: 20 for a reviewer and 21 false alarms (51%), 9 of them in one repository (section 9) |
| Two more samples nobody had read (section 10): 80 repositories, 22,965 commits | 0.18.0 blocked 33 of 11,630 commits on sample 5: 24 for a reviewer and 9 false alarms (27%); this version, frozen before sample 6 was drawn, blocked 100 of 11,335: 34 and 66 (52 of the 100 in one repository, 51 of them one defect since 0.15.0, fixed afterwards: the released build blocks 44, 34 and 10) |
| A seventh sample nobody had read (section 11): 40 repositories, 12,000 commits | the published 0.19.0 blocked 31: 16 for a reviewer and 15 false alarms (48%; 39% without one repository); 0.18.0 blocked 32; the build frozen before the sample was read blocked 32, one more and a real one; the shipped build, after the fixes from reading it, blocks 22 of those commits (17 and 5) |
| Eight added languages: newest 300 commits, 39 repositories | 0.12.1 reported 99 findings, 26 of them skips that depend on the environment (fixed); of the 73 left, 56 are tests that are switched off and 17 are deliberate test data (section 5) |

## 1. Labeled changes (regression cases)

`benchmarks/cases.mjs` holds before/after changes with the rule that must fire, `null` for changes
that must stay silent, and `miss` for gaps that are documented rather than hidden.
`scripts/benchmark-recall.mjs` builds a throwaway Git repository per case and runs the built CLI;
`tests/benchmark.test.ts` runs the same cases in the test suite.

```bash
npm run build && npm run bench
```

Result: **152/152 cheats caught, 136/136 harmless changes left alone, 1/1 documented gap still
open.** The cases were written together with the detector, and many were added after a real
false alarm. They protect against regressions and show what is covered; they say nothing about
cheats nobody thought to write down. The open gap: hardcoding the tested value in production code.
(Vacuous matchers such as `expect.anything()` were closed in 0.15.0, and a module mocked in its own test in 0.16.0.)

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

## 7. AI-signed commits, and a test that checks its own mock

Sections 3 and 6 measure human history. Section 3 compares AI-signed commits with others, but only for the rules of 0.10.1 and 0.11.0.
To see what the rules of 0.15.0 say about AI-signed commits, `scripts/benchmark-agents.mjs` was run once per build on the same sampled
commits, and `scripts/compare-agent-runs.mjs` listed what the newer build reports and the older one does not. The corpus is the 166
public repositories of `benchmarks/agent-corpus.tsv` (164 cloned again at their pinned revisions; two could not be fetched), each
with at most its newest 1,500 commits. For each repository a seeded sample (seed 3) of at most 50 AI-signed and 50 other commits that
touch tests or configuration was reviewed, each commit on its own against its parent: 5,454 AI-signed commits in 158 repositories
and 4,278 others in 139. "AI-signed" means that the commit message or the author or committer identity carries the signature of Claude,
Copilot, Cursor, Codex, Devin, aider or Gemini; it says nothing about how much of the change an agent wrote.

| Commits that would block | 0.14.0 | 0.15.0 |
| --- | --- | --- |
| AI-signed, of 5,454 | 17 (0.3%) | 30 (0.6%, 95% CI 0.4 to 0.8%) |
| Others, of 4,278 | 13 (0.3%) | 19 (0.4%, 95% CI 0.3 to 0.7%) |

**The 30 new findings** (20 in AI-signed commits, 10 in others; 27 commits) were read in their source by one reader (an AI assistant).
7 were false alarms of six kinds, which 0.15.0 shipped with and 0.16.0 fixes:

| False alarm | Findings |
| --- | --- |
| An assertion removed from the front of a test shifted the position-by-position pairing: an `isinstance` check that stayed was compared with the `len(x) > 0` that replaced `is not None`, and read as an exact check turned into a bound | 1 |
| `toHaveBeenCalledWith(...)` or `toHaveBeenCalledTimes(2)` replaced by `.not.toHaveBeenCalled()`, the opposite expectation, read as a looser one | 2 |
| A `match=` dropped from `pytest.raises(...)` although the exception was kept (`as info`) and checked on the next line | 1 |
| A ruff rule enabled in the same change with its existing violations listed per file | 1 |
| A flake8 code ignored that the tool does not check by default | 1 |
| `\|\| true` added in the same change that removed a `continue-on-error: true` from the step: the same tolerance | 1 |

The other **23 findings (20 commits; 15 findings in 13 AI-signed commits)** are loosening that a reviewer should see: 10 lint or type
settings (ruff, flake8 and mypy ignore lists and a tsconfig check switched off), 9 weaker assertions (`toHaveBeenCalledWith(...)`
relaxed to `toHaveBeenCalled()` in two tests, `== pytest.approx(x, abs=1.0)` relaxed to `>= 1` in two, `call_count == 5` relaxed to
`>= 1`, an exact list relaxed to `length > 0`, `raises(RuntimeError, match=...)` relaxed to `raises(Exception, ...)`, and two tests that
expected `TypeError` with a message and now expect `ValueError` without one), two `--passWithNoTests` added to a test script (one in a
commit titled to prevent a CI failure), one CI job switched off with `if: false` (with a comment saying why) and one test marked `xfail`
in a commit titled to turn CI green on `main`. Most carry an explanation in the commit; whether each is a good decision is not the
tool's call. Counting only these 23, 13 of the 5,454 AI-signed commits (0.2%) and 7 of the 4,278 others (0.2%) would block that 0.14.0
did not report. The two rates overlap and the sample is small, so this is no evidence that agents do these things more often than
people, which is what section 3 found too.

**Findings that disappeared.** Two findings that 0.14.0 reported are gone in 0.15.0: an assertion that was already a bound
(`len(x) > 0`, `toBeGreaterThan(0)`) is no longer compared as if it were an exact check.

**The mock detector on the same commits.** The build with the mock detector (0.16.0 before the six fixes) was run on the same
9,732 commits and reported nothing new: in this sample no commit has a test that checks its own mock, so the detector's recall on
real agent work is untested and rests on the labeled cases. On the human side, all 21,686 test files of the 24 repositories of
section 6 were read with it: 15 matches, every one a test of jest's, vitest's or pytest's mocking itself (14) or a sanity check that a
patch is in force (scikit-learn, 1). Test files whose path mentions `mock` or `monkeypatch` are now skipped; in a real review the
`fixtures` folders that hold most of the jest and vitest ones are already left out.

**Limits.**

- One reader labeled the findings, and the six fixes were made from the same findings; expect other false alarms elsewhere.
- Repositories that use coding agents are a convenience sample, a repository with many AI-signed commits is capped at 50 of them, and a
  commit with no signature may still be agent-written.
- Reviewing each commit against its parent counts a revert or a merge-train commit separately; 27 AI-signed and 16 other commits
  could not be compared in full and are left out.

## 8. An exact check turned into a bound

Section 7 read what 0.15.0 added on AI-signed commits. The assertions that those commits edited in place showed one more shortcut that no
rule read: an exact count or value turned into a bound (`expect(cost.do).toBe(2)` to `toBeLessThanOrEqual(2)`, `assert len(added) == 2`
to `>= 2`), or `toEqual(X)` turned into `toMatchObject(X)`, which lets extra properties through. The test stays green, and the code may now
do more than the test allowed.

**How it was found.** The 9,761 reviewed commits of section 7 (9,732 of them compared in full) were scanned for assertions edited in place,
a removed assertion line next to an added one in the same hunk of a test file (`scripts/scan-edited-assertions.mjs`), and each pair was
sorted by the kind of matcher before and after. 29 commits turned an exact check into a bound, or `toEqual(X)` into
`toMatchObject(...)`, on the same expression. 0.16.0 reported 1 of them (`== pytest.approx(x, abs=1.0)` relaxed to `>= 1`); this version
reports 13. The rule was written from these commits, so they show what it was built on, not how well it works. The other 16 are left alone
on purpose or are not loosening: in 12 the test was renamed or removed in the same commit (the new title says what the new scenario is,
so the old test and the new one are not compared), in 3 the expected value or object changed as well (`toEqual({ status: 'ok' })` to
`toMatchObject({ status: 'amount_mismatch' })` is another expectation, not a looser one), and 1 is a check of another kind.

**What else the new rule says.** The two builds are the same code except for this rule, which can fire only on a commit that adds a bound
matcher, a `toMatchObject`, `assert.ok` or a Python comparison to a test file, so `scripts/compare-builds-on-diffs.mjs` reviewed only the
2,177 sampled commits that do, with 0.16.0 and with this version. The new build reported **18 findings that 0.16.0 did not, in 14 commits**
(10 findings in 6 AI-signed commits, 8 in 8 others), and none that 0.16.0 reported disappeared. One reader (an AI assistant) read each
one in its commit. These are the numbers of the fourth build of the rule on these commits, the one in this version; the earlier builds listed
the two false alarms below (the second pass had 19 findings in 15 commits), and the third silenced a real finding on the human history:

| Finding | Count |
| --- | --- |
| An exact count or value turned into a bound: `toBe(2)` to `toBeGreaterThanOrEqual(2)`, `len(added) == 2` to `>= 2`, a schema version `== 3` to `>= 3`, a pinned provider count (`21`) to "at least 21", `max(observed) == capacity` to `<= capacity`, pinned numbers to bounds between two fields | 10 findings in 10 commits |
| `toEqual(X)` turned into `toMatchObject(X)`: four commits, one of which did it in five tests; in two the result had gained fields that added lines assert | 8 findings in 4 commits |

Whether each is a good decision is not the tool's call. Several say why in the test or the commit: a count that only grows, a
schema that moved to a new version, a field added to the result, a timing check that failed under load. One drops the checks on
what was stored and keeps `len(comments) >= 2`. On the human side, the same 24 repositories and 7,200 commits as section 6 gave 1 new
finding (aiohttp's `assert len(result) == len(sc_cookies)` replaced by `assert len(result) <= 1`, in a commit that adds limits to cookie handling), and nothing disappeared.

**Two false alarms were found by reading them, and are fixed in this version.**

- `assert tags == {}` turned into `assert len(tags) > 0` expects the opposite, not less, and was reported as a loosened check. The test
  for an expected-empty value ended in a word boundary, which cannot match after `}`, `]` or a quote at the end of the line, so `== {}`,
  `== []` and `== ''` were not recognized. 0.15.0 and 0.16.0 report it too; none of the sampled commits contained one (nothing
  disappeared), but it turned up in the first findings of this run. `== set()`, `== ()` and `== 0.0` count as expecting nothing now as well.
- `assert.equal(calls, 3)` replaced by `assert.equal(calls, afterLookup)` and a new `assert.ok(calls > beforeLookup)` was read as an exact
  check turned into a bound, although an exact check on the same expression took the old one's place with another value. That is a changed
  expectation, which `expectation-rewritten` is for, so the rule is quiet when the assertion that took the old one's place is an exact
  check on the same expression. (A first version of this guard looked at the whole test and silenced a real relaxation, aiohttp's `len(result) ==
  len(sc_cookies)` to `len(result) <= 1`, because an unrelated exact check on `result` was added further down; it now looks only at where the
  old assertion stood.)

**Limits.**

- One reader labeled the findings and the two fixes were made from the same findings; expect other false alarms elsewhere.
- The 29 commits are the ones the rule was written from. They are 29 of 9,761 commits, and the same scan found many more edits of another
  kind: an exact check flipped to `toBeNull()` or `toBeUndefined()` (expecting the opposite, which is not looser), or changed to another value.
- A check loosened in a commit that also renames its test is not compared: that is 12 of the 29.
- JavaScript, TypeScript and Python only, and the bounds are read where the checked expression is spelled the same before and after.
- The comparison covers commits that add one of the lines above; a bound written in a form the filter does not match is not in it.

## 9. Repositories nobody had tuned on

Sections 6 to 8 replay history that was read while the rules were being written. A user asks something else: what does the tool block in a
repository it has never seen, and how often is it wrong? This section replays the rules on repositories that no earlier corpus contained,
reads every blocked commit in its source, and fixes what was wrong. It was done four times, each time on new repositories.

**Method.** The four samples hold 40, 39, 39 and 40 public repositories (24, 24, 23 and 24 JavaScript or TypeScript, 16, 15, 16 and 16
Python). Each came from the same GitHub search: `language:` TypeScript, JavaScript or Python, 400 to 6,000 stars, pushed after 2026-10-25,
5 to 200 MB, not archived, not a fork. Of the 300 most recently updated per language, lists, tutorials and templates were dropped by name,
the rest was shuffled with a seeded generator, and a repository that an earlier corpus used was skipped. `benchmarks/unseen-corpus.tsv`,
`heldout-corpus.tsv`, `third-corpus.tsv` and `fourth-corpus.tsv` list them with the revision measured. `agent-roast replay` reviewed the
newest 300 commits of each one's first-parent history (a merged pull request is one commit; 44,878 commits in 158 repositories), each against its parent; 257 could not be compared in full and 38 failed
to review, and are in no count below. A **blocked** commit has a finding of a blocking rule. One reader (an AI assistant) opened every
blocked commit in its repository and sorted it; `benchmarks/section9-labels.tsv` has one row per blocked commit (repository, commit, how it was
sorted, the cause). A **false alarm** is a block where no check got weaker and no gate was relaxed: a new test
that is skipped, a method that happens to be called `fit`, a refactor that checks the same thing in another form. **A reviewer should see
it** is every other block: an assertion that got weaker, a gate that was relaxed, a test that was switched off or focused, whether the
commit says why or not.

Every sample was replayed with the build that existed when it was drawn, read, and its false alarms fixed before the next one: sample 1
with the released 0.17.0, sample 2 with the build after the fixes from sample 1, sample 3 with the build after the fixes from samples 1 and
2, and sample 4 with this version, which was frozen before the sample was drawn and not changed after it was read. So the first row of each
sample is an out-of-sample figure for the build that produced it, and the "0.18.0, fitted" rows are not: this version was fixed on those
commits.

| Sample | Repositories, commits | Build | Blocked commits (repositories) | False alarms | A reviewer should see |
| --- | --- | --- | --- | --- | --- |
| 1 | 40, 11,604 | 0.17.0 | 74 (23) | 51 | 23 |
| | | 0.18.0, fitted | 27 (17) | 4 | 23 |
| 2 | 39, 11,222 | after the fixes from sample 1 | 38 (18) | 22 | 16 |
| | | 0.18.0, fitted | 19 (14) | 4 | 15 |
| 3 | 39, 11,326 | after the fixes from samples 1 and 2 | 49 (19) | 13 | 36 |
| | | 0.18.0, fitted | 42 (15) | 6 | 36 |
| 4 | 40, 10,726 | 0.17.0 | 65 (21) | 45 | 20 |
| | | **0.18.0, not fitted** | **41 (18)** | **21** | **20** |

(One of the 16 in sample 2 is a `toBe(2)` turned into `toBeGreaterThanOrEqual(3)`, which this version reads as another expectation and no
longer blocks; the 15 are the rest.) The share of false alarms among the blocks of a build that had not seen the sample was 69% for 0.17.0
on sample 1, 58% and 27% for the builds in between on samples 2 and 3, and 69% again for 0.17.0 on sample 4; for this version on sample 4
it was 51%. On sample 4 every one of the 20 blocks for a reviewer is still there, and 24 false alarms are gone: 45 become 21, which is 4.2
and 2.0 false blocks per 1,000 commits. About half is still not good enough, and that figure moves with the repositories: nine of the 21
false alarms are in one repository, and five of the 40 repositories had only false alarms. The blocks themselves are rare, 0.4% of the
commits on sample 4; the other half are the kind of change the tool exists for.

**Sample 1: what 0.17.0 blocked.**

| What was blocked | Commits | 0.18.0 |
| --- | --- | --- |
| A skip, ignore or expected-failure marker on a test the same commit adds: 28 `#[ignore = "requires /dev/kvm"]`-style markers on new integration tests in one Rust repository, tests that need a login or a database, a case deferred to a later change | 32 | silent |
| A method called `fit()` read as a focused test | 4 | silent |
| An exact check turned into `toBeUndefined()`: a property that was removed, the opposite expectation and not a looser one | 4 | silent |
| An assertion read wrongly: brackets around a whole Python assertion, a compound `a == x and b <= c`, a limit that moved from a variable to `0`, `rejects.not.toThrow(/b/)` | 4 | silent |
| A mock factory that keeps the real module (`vi.mock("./client", async (original) => ({ ...(await original()), ... }))`) | 2 | silent |
| Tests that moved to a monorepo runner (`nx`, `turbo`) | 1 | silent |
| A lint, coverage or CI gate changed | 11 | blocked |
| An assertion that got weaker | 9 | blocked |
| A test that was running was switched off | 3 | blocked |
| An equivalent refactor read as a weaker check (a different expression that checks the same thing) | 4 | blocked, a false alarm |

**Samples 2 and 3: the same question for a build that had not seen them.** After the fixes from sample 1, 18 of the 38 blocked commits of
sample 2 were false alarms, of three kinds: 13 exact checks turned into `toBeUndefined()` (a flipped or equivalent expectation; sample 1 had
shown four), 3 Python patches that were not in force or that the code under test rewires, and 2 helpers called `fit(...)`; 4 equivalent
refactors were left, and 16 blocks were for a reviewer (6 gates, 2 tests switched off, 8 weaker assertions). After those fixes, sample 3 had 49 blocked commits and 13 false alarms: 7 of four kinds (a `test.fail(true, "reason")` inside a
test that the commit adds, 3; an equality turned into a strict inequality against the same value, which rejects what the old check
accepted, 2; the brackets around the message of a Python assertion, 1; a method of the patched object that runs after the patch, 1) and 6
that this version still blocks (3 equivalent refactors and 3 test data that look like trivial assertions); 36 were for a reviewer (15
gates, 14 tests switched off, 7 weaker assertions).

**Sample 4: this version, measured as it is.** It blocked 41 of the 10,726 commits, in 18 of 40 repositories. 0.17.0 blocks 65, in 21
repositories: the 41, and 24 more that are all false alarms: 17 skips on tests that pull requests add (all in one repository), a helper
called `fit`, three exact checks turned into `toBeUndefined()` (a property that was removed), an equality turned into a strict inequality, an
environment-dependent skip, and a commit that re-enabled skipped tests and was blamed for the ones left.

| What was blocked by 0.18.0 | Commits |
| --- | --- |
| A check that got weaker: `toBe('RS485FullDuplex')` to `toBeDefined()`, `toHaveBeenCalledWith(true)` to `toHaveBeenCalled()`, `toBe(27)` to `toBeGreaterThanOrEqual(27)` in three tests, `toEqual` to `toMatchObject` in two commits, `assert data is not None and not data.refresh_pending` cut to `assert data is not None`, `assert orphan_before == 8` to `len(...) > 0`, an exact message to `toBeDefined()` | 10 |
| A gate that changed: CI jobs commented out in a tooling migration, `mypy` `ignore_errors`, a workflow that no longer runs on push or pull request, a canary job allowed to fail, a test step moved from every push to releases only | 5 |
| A test that was running is switched off or focused: `it.only` left in two commits titled "simplify tests", `describe.skip` in a commit titled "test: debug", four test classes skipped because a service is offline, an `expectedFailure` | 5 |
| **False alarm:** a skip written inside a test with a run-time condition around it (`if (!isAdmin) { test.skip(true, "Requires admin access") }`): the literal `true` hides the condition that the rule would have left alone | 5 |
| **False alarm:** `test.fixme(` with the title on the next line, so the test it belongs to is not found and markers are compared by count: it blamed a marker that was already there (two commits) and a test that the commit adds (two) | 4 |
| **False alarm:** a step that is not a check, switched off or allowed to fail (a job that posts a comment, an artifact download) | 3 |
| **False alarm:** an equivalent refactor or a rewritten test: `assert not any(...)` turned into `assert helper(...) is not None` when the behavior flipped, `assertTrue(x is not None)` to `assert x is not None`, a font-icon helper replaced by a selector, a test rewritten with a twin check, a validation call that now throws, a boolean check that follows its inputs | 7 |
| **False alarm:** a manual legacy workflow deleted while the tests still run in the others | 1 |
| **False alarm:** `monkeypatch.setattr(module, "fn", original)` followed by `install()`, which wraps `module.fn` again | 1 |

Nothing in the last five rows was changed after reading it: they are the false alarms that this version still has, and the first two are
the largest. Whether each of the 20 blocks for a reviewer is a good decision is not the tool's call; several say why in the commit
(a service that is offline, a gate moved in a migration), and two `.only` were left in a test file.

**The 24 repositories of section 6 and the 9,761 commits of section 7.** Both were measured again with this version and 0.17.0. On the 7,200
commits of the 24 repositories, 25 commits block where 0.17.0 blocked 30; 40 findings are gone, 27 of them in one commit that rewrote
`toStrictEqual(undefined)` into `toBeUndefined()` across a monorepo, 11 are skips or `todo`s on tests that a commit adds (one is a merge
of an old tag), two are refactors, and none of them was a weaker check; one warning is new (an expected message edited next to a
production change, found because brackets around a whole assertion no longer hide the pair). On the 9,761 commits of section 7, 3,963 can
differ and were reviewed again: 0.17.0 blocks 107 (70 AI-signed), this version 86 (54). Of the 86 findings that disappeared, 80 were skips
on tests in new files and the others a Rust `#[ignore]` on a new test, three skip markers that moved to the line of their own test, a
refactor (`assert len(opened) == 1` replaced by a check of a writer's state), and one count that was changed and loosened at the same time
(`assert len(PluginType) == 13` to `>= 14`), which a reader would have kept. Three findings are new: two are those skip markers and one is a
warning for an edited expected count.

**What this version still gets wrong, as found on sample 4** (listed so that they can be fixed, not as a promise):

- A skip with a literal `true` inside an `if`, and a `test.fixme(` whose title is on the next line (9 commits, one repository). A
  prettier-formatted registration puts a long title there, so the test behind the marker is not found.
- A step that posts a comment, downloads an artifact or publishes, which the CI rules cannot tell from a check.
- A refactor that checks the same thing with other words, which no pairing by expression can see.
- A patch whose target is rewired by a call that is not handed the patched object.

**Limits.**

- One reader sorted every block, and the fixes were made from the same sorting. The rows marked fitted say nothing about other
  repositories; only the first row of each sample and the last row of sample 4 do, and four samples are four samples: a repository with one
  habit moves a count (32 of the 74 blocks of sample 1 are in one repository, 9 of the 21 false alarms of sample 4 in another).
- The search sorts by the last update, so the repositories are active, and several are developed with an AI coding assistant; a quiet
  repository blocks less.
- The count is of blocked commits among the newest 300 of a repository, not of agent sessions. A merged pull request is reviewed against its
  first parent as one change, as the Action reviews a pull request; a Stop hook reviews uncommitted work, which is smaller.
- "A reviewer should see it" does not mean the change was wrong: it means a check got weaker or a gate was relaxed. Recall is not measured
  here; section 1 and the labeled cases are what says which cheats are caught.
- The new rule for skips has a price: a new test that is written already skipped is not reported. So has the rule for bounds: an exact count
  that is changed and turned into a minimum in the same commit is not.

## 10. Two more samples, and what the fixes from sample 4 did

Section 9 ended with a list of what 0.18.0 still got wrong on sample 4. This section fixes those, and measures twice more on repositories that
nobody had read: a fifth sample, replayed with 0.18.0 and with the build that had the fixes from sample 4, and a sixth, replayed with this version as it
was after the fifth had been read and its false alarms fixed, frozen before the sixth was drawn. The search, the replay, the reader and the
definitions of "false alarm" and "a reviewer should see it" are those of section 9. One case is added: a new test that asserts nothing (`assert True`,
`expect(true).toBe(true)`, a probe) changes no check that existed, so by the definition it is a false alarm; it is counted here as "a reviewer should see
it", because a test that passes while checking nothing is what the tool is for, and the figures that count them as false alarms are given next to them.

**Method.** Samples 5 and 6 hold 40 repositories each (24 JavaScript or TypeScript, 16 Python), `benchmarks/fifth-corpus.tsv` and `sixth-corpus.tsv`
with the revision measured, none in an earlier corpus; 11,630 and 11,335 of the newest commits of their first-parent histories were reviewed against their
parents (165 and 218 could not be compared in full and 6 and 11 failed to review, and are in no count). `benchmarks/section9-labels.tsv` has a row for every
blocked commit of all six samples, now with a column for the build that ships.

| Sample | Commits | Build | Blocked commits (repositories) | False alarms | A reviewer should see |
| --- | --- | --- | --- | --- | --- |
| 5 | 11,630 | **0.18.0, not fitted** | **33 (18)** | **9** | **24** |
| | | with the fixes from sample 4 | 33 (18) | 9 | 24 |
| | | this version, fitted | 25 (15) | 1 | 24 |
| 6 | 11,335 | 0.18.0 | 102 (20) | 68 | 34 |
| | | **this version as it was frozen** | **100 (19)** | **66** | **34** |
| | | this version, after the fixes from reading the sample (fitted) | 44 (17) | 10 | 34 |

The share of false alarms among the blocks of a build that had not seen the sample was 27% for 0.18.0 on sample 5 (51% on sample 4) and 66% for the
frozen build on sample 6. The second figure is one repository: 52 of its 100 blocks are in `tortoise-orm`, and 51 of those are one defect that has been in the rules since 0.15.0 (below). Without that
repository the frozen build blocked 48 commits, 14 of them false alarms (29%). Counting the commits that add a test which asserts nothing as false alarms, the
figures are 13 of 33 on sample 5 for 0.18.0 (39%) and 72 of 100 on sample 6 for the frozen build (20 of 48 without the repository).

**Sample 5: the fixes from sample 4 changed nothing, and 0.18.0 was right about the rest.** Nine kinds of false alarm had been found on sample 4
and fixed (a skip under a run-time `if`, a wrapped `test.fixme(` title, a step that is not a check in a workflow that gates nothing, a patch that
the code under test wraps again, `assertTrue(x is not None)` turned into `assert x is not None`, a mock that another test configures, and
three smaller ones), which took sample 4 from 41 blocks to 25. Then sample 5 was drawn and replayed with 0.18.0, which had been frozen
before it existed, and with the build that had those fixes: **both blocked the same 33 commits** of 11,630, in 18 of 40 repositories. Each of the nine
fixes had come from one or two repositories, and none of the 33 blocks was of those kinds. So the figure for 0.18.0 on sample 5 is a second
out-of-sample one, and it is better than the first: 9 false alarms of 33 (27%), against 21 of 41 (51%) on sample 4.

| What was blocked on sample 5 | Commits |
| --- | --- |
| A test that was running is switched off: `it.skip`, `describe.skip` or `xfail` on existing tests, in seven commits, most of them with a comment that says why (a network test that is flaky on CI, an upstream bug, a feature that was reverted) | 7 |
| A check that got weaker: `toEqual` turned into `toMatchObject` after a field was added (two commits), `toThrow(/.../)` turned into `.not.toThrow()` when the code was made tolerant, `toThrow("load failed")` into `toThrow()`, `assert.equal(received, 4)` into `assert.ok(received >= 4)` "to make the test less flaky", `equal(renames, 3)` into `>= 3` after a retry was added, a TLS options object into `dispatcher` being truthy after a runtime migration | 7 |
| A gate that changed: a ruff or flake8 ignore (three commits), `--passWithNoTests` added to three packages that have tests, a workflow moved from every merge to a schedule, a pull-request job moved to a nightly workflow | 6 |
| A new test that asserts nothing: `assert True` with the real checks commented out under a TODO (two commits, a merge and the revert of its revert), `expect(true).toBe(true)` in a ported library, a probe test left in the tree. No check that existed got weaker, so by the definition above these four are false alarms; they are counted as "a reviewer should see it" because a test that passes without checking anything is what the tool is for. Counted as false alarms the figure for 0.18.0 is 13 of 33 (39%) | 4 |
| **False alarm:** a step or job that is not a check, allowed to fail: an artifact upload, a cloud login for signing, a release attachment, an emulated `ppc64le` image build in a workflow that runs when a version is tagged | 4 |
| **False alarm:** a check rewritten: an element's existence as `exists()).toBe(true)` turned into `querySelector(...)).not.toBeNull()`; a `toBe(false)` on a button that a redesign turned into a disabled attribute | 2 |
| **False alarm:** a mocked helper next to the real assertion: `expect(python).not.toContain(...)` on the mock's own output in a test that also checks the code under test | 1 |
| **False alarm:** `npm test` replaced by `python -m unittest` in a workflow, which the CI rules did not know as a test command | 1 |
| **False alarm:** `it.todo(` with its title on the next line, on a test that the commit adds | 1 |

**Sample 6: what the frozen build blocked.** Nothing was changed after the build was frozen and before the sample was read.

| What was blocked on sample 6 | Commits |
| --- | --- |
| **False alarm:** the elements of `[[tool.mypy.overrides]]` read as one table: `check_untyped_defs = false` for `tests.*` next to `true` for `examples.fastapi.*` is read as a switch that was turned off, on every commit that touches `pyproject.toml` ("Release 0.25.0", "docs: update documentation url"). One repository; a defect since 0.15.0 | 51 |
| A check that got weaker: `toEqual` turned into `toMatchObject` (seven commits, most after a field was added), an exact count into a bound (`toBe(1)` into `toBeGreaterThan(0)`, `toHaveBeenCalledTimes(1)` into `>= 1` "to deflake", `toHaveLength(1)` into `<= 3`, `== 1` into `>= 1`), `toThrow("message")` into `toThrow()`, `toHaveBeenCalledWith(...)` into `toHaveBeenCalled()` (twice), `toHaveBeenCalledOnce()` into `toHaveBeenCalled()`, a count of zero into `!expect(...).toHaveBeenCalled()`, a membership test into a presence test, an exact message into "not empty", an exact file into a property of a state | 20 |
| A gate that changed: a ruff per-file ignore added (four commits), a workflow deleted that ran the Rust tests on three systems, `noImplicitReturns` switched off in a rewritten `tsconfig.json` | 6 |
| A test that was running is switched off: `@pytest.mark.skip` on two tests, `@Ignore("Manual only")` on two test suites | 2 |
| A new test that asserts nothing, or an assertion replaced by `assert True`: smoke tests that end in `assert True` (three), `expect(true).toBe(true)` in a `catch`, one that says "simple assertion to pass the test", and an assertion that was already always true (`... or "None"`) replaced by `assert True`. Counted as for a reviewer | 6 |
| **False alarm:** a check rewritten in an equivalent or stronger form: a mode string replaced by a layout flag, a bit compared with 1 and now read as a boolean, a bound that could not fail (`assert iteration <= max_iterations` after a `while iteration < max_iterations` loop) replaced by a flag and a content check, an exact check on a computed value next to the old relation as an inequality, a shape check kept with its new shape | 5 |
| **False alarm:** ruff ignores added for the rules that an upgrade brought (`CPY`, `PLR0917`, `CPY001`), and an ignore list rewritten from rule codes to rule names with `preview = true` | 3 |
| **False alarm:** two deleted security-scan workflows read as "tests removed", because of the word "test" in the comment at the end of a line (`run: exit 0 # Skip unnecessary test runs for dependabot`) | 2 |
| **False alarm:** a duplicate test workflow removed while the same tests still run in another (two workflows merged into one) | 2 |
| **False alarm:** `@test.expectedFailure` of a test framework rewritten as pytest's `xfail` | 1 |
| **False alarm:** `yarn test` replaced by `yarn coverage`, which runs the tests | 1 |
| **False alarm:** `vi.mock("../group-client", async original => ({ ...await original(), ... }))`, a factory that keeps the real module, written without brackets around its parameter | 1 |

0.18.0 blocks two commits more, both false alarms: a publish step and an auto-merge step allowed to fail, in workflows that gate nothing.

**What reading sample 6 showed to be defects, and what was fixed afterwards.** Five things were plainly wrong, and are fixed in this version, after the
sample was read: the elements of `[[tool.mypy.overrides]]` are tables of their own, named by their `module` (they all had the section name `tool.mypy.overrides`, so the
last one that sets a switch to `true` made every other that sets it to `false` look like a switch turned off); a comment at the end of a CI line is not part of
the command; `yarn coverage` and `npm run coverage` run the tests; `@test.expectedFailure` is the same marker as `@unittest.expectedFailure`, and a mock factory
whose parameter has no brackets keeps the real module like one that has. On the 100 blocked commits the fixed build, compared with the frozen one, reports 165
findings fewer and none new; 56 commits are no longer blocked, and every one of the 56 was a false alarm. The last row of the table is therefore fitted:
the fixes were made from those commits. The kinds that are not defects were left alone, as in section 9.

**The regressions of this version, against 0.18.0.**

- **The recorded blocks of samples 1 to 5** (162 commits that 0.18.0 had flagged), reviewed again with both builds: 55 findings are gone and none is new; 29
  commits are no longer blocked. 24 of the 29 are false alarms of the kinds that this version fixes (a skip under an `if`, a wrapped title, a step that is not a check, a mock that
  another test configures, `assertTrue(x is not None)` turned into `assert x is not None`, a deleted manual workflow, a todo on a new test, `python -m unittest`...), and five were sorted
  "for a reviewer" when they were read: four are steps in workflows that gate nothing (a schema workflow, two generated lock workflows, a deps canary) and one
  is the "finish" step of Coveralls allowed to fail. Those five are the price of reading a workflow that gates nothing, and of reading a step that
  only uploads, signs in or publishes as not being a check.
- **The 24 repositories of section 6** (7,200 commits): 21 commits would block where 0.18.0 blocked 25, and none is new. The four findings that are gone are a bot step that
  posts a lint comment, an upload of release assets, an upload with attestations and an npm publish, each with `continue-on-error: true`.
- **The 9,761 commits of section 7**, both builds on the commits that can differ. The CI rules: of the 1,363 commits that touch a workflow, three differ. Three findings are gone, in two commits:
  a publish workflow whose trigger moved from a tag push to a published release, and two workflows of a package that was deleted; all three are release
  workflows that run when a version is tagged, which this version does not read as gating (a test step removed from one is not reported). One finding is new: a bot's tree-replacement commit
  deleted a workflow that runs `python -m unittest`, which was not known as a test command. The test rules: of the 2,949 commits that add a line the new rules could change, none has a new finding and eight findings are gone, in four commits: five skips under a run-time `if` in a
  Playwright suite (two commits, one of them AI-signed), an assertion on a mock's output next to an assertion on the code under test, and two on a mock factory that keeps the real module and is
  written without brackets around its parameter (a commit of a repository that is not one of the 40: the same defect as on sample 6, found on another corpus). Each was read, and each was a false alarm.
- **The labeled cases:** 145 of 145 cheats are caught and 127 of 127 harmless changes are left alone (14 and 17 more than for 0.18.0, for the kinds of samples 4
  and 5), and one gap is still open. The five defects of sample 6 have tests (`tests/sixth-sample.test.ts`) and no labeled cases of their own.

**What this version still gets wrong, as found on samples 5 and 6** (listed so that they can be fixed, not as a promise):

- A test workflow removed while the same tests run in another (two workflows merged into one, or a duplicate dropped): the review counts test lines, not
  distinct commands. Two commits on sample 6, and the case in sample 4 where it was a deleted manual workflow.
- A ruff ignore list that was rewritten from rule codes to rule names, and ignores that a ruff upgrade made necessary for rules it brought: three commits on sample 6.
- A check that was rewritten in an equivalent or stronger form, which no pairing by expression can see: five commits on sample 6 and one on sample 5 (a UI test rewritten
  after a redesign; an element's existence written as a boolean and then as a query is read since this version). It is the largest kind that is left: 6 of the 11 false alarms of the fixed build on the two samples.
- A test that is written to pass without asserting anything is blocked, and a smoke test that ends in `assert True` is one: ten commits on the two samples, which are counted for a
  reviewer here and which most projects would call fine.
- A runner the rules do not know. `python -m unittest` and `yarn coverage` were found on these samples and are known now; the next is not.

Section 11 fixes the first of these (a workflow dropped while another runs the same command), part of the second (ignores that ride along with a version bump) and adds the runners that the seventh sample showed.

**Limits.**

- One reader sorted every block, an AI assistant, and the fixes were made from the same sorting. The rows marked fitted say nothing about other
  repositories. Out of sample are the first row of every sample, 0.18.0 on samples 4 and 5, and the frozen build on sample 6.
- A repository with one habit moves a count, and so does one defect. On sample 6, 52 of the 100 blocks of the frozen build are one repository. The share of
  false alarms by sample is 69%, 58%, 27%, 69% and 51% (section 9), then 27% and 66%: it moves by a factor of two or three from one sample to the next, so the figure for a
  new repository is a range, not a number.
- The build that ships is not the build that was measured on sample 6: it has five fixes that reading the sample showed to be defects. They are covered by tests and by the
  reviews above, not by a new sample.
- The same price as in section 9 holds, and three more: a skip with a literal `true` under an `if` of the agent's own is not reported; a step that only uploads, signs in or
  publishes is not a check, so letting it fail is not reported (an action that is not on the short list of `NON_CHECK_ACTION`, and every `run:` step, still is); a test step removed from a
  workflow that runs only when a version is tagged is not reported.
- Everything in section 9 about the search, the age of the repositories, and "a reviewer should see it" does not mean the change was wrong.

## 11. A seventh sample, and two things that were missing

Section 10 ended with a list of what 0.19.0 still got wrong. This section measures the published 0.19.0 once more on repositories that nobody had read, and
adds two things that were missing, found on corpora that had already been read, before any block of this sample was read: a check turned into "not another value" (`toBe(2)` into `not.toBe(0)`), which no rule read, and a workflow
dropped while another one runs the same tests, which was reported as lost tests. The search, the replay, the reader and the definitions of "false alarm" and "a reviewer
should see it" are those of sections 9 and 10, including the way a new test that asserts nothing is counted.

**Method.** Sample 7 holds 40 repositories (24 JavaScript or TypeScript, 16 Python), `benchmarks/seventh-corpus.tsv` with the revision measured, none in an earlier corpus; 12,000 of the
newest commits of their first-parent histories were reviewed against their parents (13 could not be compared in full and 2 failed to review, and are in no count). Three builds were
replayed on it, and none of them was changed after the first block was read: 0.18.0, **0.19.0 as it was published**, and a build with the two additions of this version, frozen before any block of the sample was read.
`benchmarks/section9-labels.tsv` has a row for every blocked commit of all seven samples, now with a column for this version.

| Build | Blocked commits (repositories) | False alarms | A reviewer should see |
| --- | --- | --- | --- |
| 0.18.0 | 32 (14) | 16 | 16 |
| **0.19.0, as published** | **31 (13)** | **15** | **16** |
| **the build frozen before the sample was read** (0.19.0 and the two additions) | **32 (13)** | **15** | **17** |
| this version, after the fixes from reading the sample (fitted) | 22 (12) | 5 | 17 |

The share of false alarms among the blocks of a build that had not seen the sample is **48% for the published 0.19.0** (15 of 31; 39% without one repository, `disnake`, where 6 of its 8 blocks
are false alarms in one file, `pyproject.toml`) and 50% for 0.18.0. By sample it is now 69%, 58%, 27%, 69%, 51%, 27% and 66% (sections 9 and 10), then 48%: the published 0.19.0 is inside the same range, a factor of two or three from one sample to the next.

**The two additions, on this sample.** The check turned into "not another value" added one block that the published build does not have, and it is a real one: a test that pinned the kind of a record,
`expect(record.resource.kind).toBe('unrenderable')`, now says `not.toBe('ready')`. The dropped duplicate changed nothing on this sample; it removes the two false alarms of sample 6 that section 10 listed and two older blocks, below.

| What was blocked on sample 7 (0.19.0 as published) | Commits |
| --- | --- |
| A check that got weaker: an exact value turned into "something is there" (`assert cursor.summary[0]["read_rows"] == '2'` into `assert cursor.summary`; the pixels of a drawn image into `toBeDefined()` on the image), an exact count into a bound (`len(w) == 1` into `>= 1`, `== existing_runners - 1` into `<=`, `toHaveLength(20)` into `toBeGreaterThan(1)`, `assert.equal(matched, 2)` into `assert.ok(matched >= 2)`, a lower bound of four into one brought in by a merge), `toEqual` into `toMatchObject` (two commits, three tests) | 9 |
| A gate that changed: ruff's flake8-type-checking rules ignored again; the XML-parsing rules and `ISC001` ignored in a commit that enables more docstring rules; the whole `TC` family and `T20` ignored for some files in a rewrite of a configuration to opt-out | 3 |
| A test that was running is switched off: `@unittest.skipIf(<backend is off>)` turned into an unconditional `@unittest.skip` "until a pull request is merged" (two tests), `test.skip(true, ...)` on three tests that cover a retired mode, `xfail` on a test that the message calls flaky, `test.skip` on a test with a `@TODO` | 4 |
| **False alarm:** ruff ignores added together with a bump of the Python version or of ruff (`requires-python = ">=3.9"` and `UP006`, `UP035`; `ruff==0.8.0` and `RUF022`): the bump brings the rules, the ignores keep what was in force. One repository | 4 |
| **False alarm:** a ruff or mypy configuration that got stricter overall (rules enabled, `strict = true`), with an exemption for the examples or for one module | 3 |
| **False alarm:** an existence check rewritten as another existence check after the thing it looked at changed: a file that moved into a database, an attribute into an element, a label into a lookup by that label | 3 |
| **False alarm:** a CI test command rewritten as a wrapper script or a task alias that the CI rules did not know as a runner (`python scripts/run_tests.py`, `deno task test`) | 2 |
| **False alarm:** a test workflow dropped while its tests moved with the code into a package that another workflow tests | 1 |
| **False alarm:** `fit(line, width, ...)`, a function that a test calls, read as Jasmine's focused test | 1 |
| **False alarm:** a report job that was allowed to fail merged into another job, where the same step is allowed to fail: the tolerance moved | 1 |

0.18.0 blocks one more commit, a false alarm that 0.19.0 fixed: a step allowed to fail in a scheduled workflow that updates a spec.

**What reading it showed to be defects, and what was fixed afterwards.** Ten of the fifteen false alarms are fixed in this version, after the sample was read: two defects and three kinds that a rule can tell apart:

- Quoted words in the comments of a TOML list were read as rule codes: `"EM",  # allow Exception("text")` listed `text` as an ignored code, and `# "ANN", # flake8-annotations`, a selector that is commented out, was read as selected, so
  enabling a rule family with an exemption for the examples looked like a rule switched off. Comments are dropped before the list is read. Two of the fifteen false alarms.
- A ruff ignore added in the same change that raises `requires-python`, `target-version` or the pinned `ruff` version is not reported: the upgrade is what brings those rules. The setting has to be in both versions of the file and higher in the new one,
  so a version that goes down, or a `requires-python` that is only written for the first time, does not hide an ignore. Four of the fifteen. The price: an ignore that rides along
  with an upgrade is not reported, and a pin kept in another file (a pre-commit `rev`) is not read.
- `deno task test`, `just test`, `rake test`, `composer test`, `mix test`, `sbt test`, `./gradlew test`, `node --test`, and a project's own test script run through an interpreter or by path (`python scripts/run_tests.py`,
  `./scripts/test.sh`, `python tests/test_cli.py`) are test steps. Two of the fifteen. A command that only mentions such a script (`chmod +x scripts/test.sh`, `cat tests.py`) is not one.
- `fit(` and `fdescribe(` are Jasmine's focused tests only with a title written as a string first (`fit("keeps the band", ...)`); a call such as `fit(line, width)` is a helper. One of the fifteen.
- A tolerance that moved is not a new one: a step is not reported as made easier to pass when the same commands were already inside a job or step allowed to fail, and the places allowed to fail did not grow. One of the fifteen.

On the 32 blocked commits of the frozen build, the shipped build blocks 22: all 17 that a reviewer should see, and 5 false alarms, with no finding that is new. The last row of the table is therefore fitted:
the fixes were made from those commits. The five that are left were not fixed: an existence check that was rewritten after a refactor (three), tests that moved with the code into a package another workflow tests (one),
and a configuration that is stricter overall but exempts one module from two error codes (one).

**How the two additions were found.** A recall probe on the 9,761 commits of section 7: 1,248 of them say in their own message that they skip, disable, loosen, relax or de-flake a test, and touch a test or a CI file. The published build blocks 30 of them, warns on 280 and says nothing on 938.
All 84 silent commits whose subject has one of the stronger words and a test file were read: one clear miss (an exit-code test, `expect(r.code).toBe(2)` into `expect(r.code).not.toBe(0)` in nine tests), and two by design (a failing precondition turned into `pytest.skip`, skips that depend on the environment); a random 30 of the rest had none.
A second look at where an assertion was edited in place: of 121 pairs where the same expression was checked less exactly afterwards, the build reports 23. Of the 98 it does not, 44 are tests that were renamed or removed (the pairing
needs the same title), 41 are tests whose number of assertions did not change and whose pair is a changed value, a flipped expectation or an equivalent record (`toBe('x')` into `toBeNull()`, `.length).toBe(0)` into `toHaveLength(0)`), 8 are tests that gained or lost an assertion, of which one is a loosening
(`toEqual(['x'])` into `toContain('x')`), and 5 are not in a test. The negated check is the one form that was missing; `toEqual` of one element into `toContain` is a narrow one, and is not read. Scanning the corpora of the six samples and the agent corpus (about 97,000 commits) for an exact check edited into a negated one found
45 commits, almost all of them a flipped expectation (the same value, negated), which is not reported; the new rule adds one block there (`toBe("first revert")` into `not.toBe("")`).

**The regressions of this version, against the published 0.19.0.**

- **The commits that touch a CI file or a Python lint or type configuration** (the newest 300 of every repository: 11,684 commits in 418 repositories, the seven samples, the agent corpus and the 24 repositories of section 6),
  the analysis of the published 0.19.0 and of this version on every changed file, and a full review with both builds on the 639 commits where it differs (8 of them could not be reviewed). Sixteen commits lose findings and two gain one; in two more the same finding reads differently (the words of a comment are no longer in its snippet).
  Gone: four workflows dropped or moved while the same tests run elsewhere (two false alarms of sample 6, and two older blocks that were sorted "for a reviewer": a schema workflow that stopped running on pushes while `pnpm test` still runs on every push, and a publish workflow whose
  `npm test` still runs on every pull request); six ruff ignores that come with a higher Python or ruff version (the four of `disnake`, and two commits of other corpora: `requires-python` from 3.8 to 3.11, and from 3.9 to 3.10); two commits where words of a comment were read as codes (`disnake`);
  three test commands replaced by a wrapper that is known now (two of sample 7 and `uv run pytest` replaced by `bash scripts/run-tests.sh` in a commit of sample 6, which stays blocked for another reason); and the tolerance that moved. New: a workflow deleted that ran `tests/pytorch/test_sanity_import.py` in three jobs ("Remove failing GitHub Build workflow",
  `NVIDIA/TransformerEngine`; a reviewer should see it, and it is a gain of the longer runner list), and a loop over test files replaced by `bash packages/ag2-sparrow/tools/publish_gate.sh` (`sonichi/sutando`; a false alarm, a script whose name does not say that it runs tests).
  A run on the commits that touch a workflow, with both builds and the rule for duplicates only, had found the first four and nothing new.
- **The blocked commits of all seven samples** (394 rows of `benchmarks/section9-labels.tsv`), reviewed again with the shipped build: 195 are blocked, 162 that a reviewer should see and 33 false alarms. Of the 208 rows that the published 0.19.0 blocks, 14 are not blocked any more:
  12 false alarms (ten of sample 7, the two of sample 6 about duplicate workflows) and the two older blocks sorted "for a reviewer" that are named above (a schema workflow and a publish workflow whose tests run elsewhere). One row is blocked now and was not: `docx-editor`, `toBe('unrenderable')` into `not.toBe('ready')`.
  The column "blocked by 0.20.0" of the table has the answer for every row.
- **The labeled cases:** 152 of 152 cheats are caught and 136 of 136 harmless changes are left alone (seven and nine more than for 0.19.0), and one gap is still open. The defects of this sample and of the two additions have tests (`tests/negated-exact.test.ts`, `tests/duplicate-workflow.test.ts`, `tests/seventh-sample.test.ts`).

**What this version still gets wrong, as found on sample 7** (listed so that they can be fixed, not as a promise):

- An existence check that was rewritten after a refactor (a file that moved into a database, an attribute into an element, a label into a lookup): the check is the same kind and no pairing by expression sees it. Three commits on sample 7.
  It is the largest kind that is left, with the other equivalent rewrites of section 10.
- Tests that moved with the code into a package that another workflow runs: the removed workflow's command was `cd kernels-data/bindings/python && uv run pytest tests`, the other's is `uv run pytest tests` with another working directory. The review compares commands, not where the tests went.
- A configuration that is stricter overall and exempts a module from an error code.
- An ignore list rewritten from rule codes to rule names (section 10) is still reported.
- A runner the rules do not know. The ones found on sample 7 are known now; the next is not.

**Limits.**

- One reader sorted every block, an AI assistant, and the fixes were made from the same sorting. The last row of the table says nothing about other repositories. Out of sample are the published 0.19.0, 0.18.0 and the build frozen before the sample was read.
- One repository with one habit moves a count. `disnake` has 8 of the 31 blocks, 6 of them false alarms; without it the share is 39%. The range is the finding, not the 48%.
- The build that ships is not the build that was measured: it has five fixes from reading the sample, covered by tests and by the reviews above, not by a new sample.
- The same price as in sections 9 and 10 holds, and two more: a ruff ignore added together with a version bump is not reported, and a test step is not reported as removed while another workflow runs the same command in the same directory.
- Everything in section 9 about the search, the age of the repositories, and "a reviewer should see it" does not mean the change was wrong.


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
node scripts/benchmark-agents.mjs ./clones/* --max-commits 1500 --ai-cap 50 --human-sample 50 --seed 3 --cli ./old-build/dist/cli.js --out old.json   # section 7,
node scripts/benchmark-agents.mjs ./clones/* --max-commits 1500 --ai-cap 50 --human-sample 50 --seed 3 --cli dist/cli.js --out new.json         # once per build
node scripts/compare-agent-runs.mjs old.json new.json ./clones --list
node scripts/scan-edited-assertions.mjs agents.json ./clones --list           # section 8: the 29 commits where an exact check became a bound
node scripts/compare-builds-on-diffs.mjs agents.json ./clones --base ./old/dist/cli.js --cand dist/cli.js \
  --out diff.json --added '<the regular expression in the header of the script>'   # section 8: both builds on the commits that can differ
node scripts/benchmark-compare.mjs ./work-unseen ./v0.17.0/dist/cli.js dist/cli.js benchmarks/unseen-corpus.tsv   # sections 9 and 10, once per corpus:
#   unseen-corpus.tsv, heldout-corpus.tsv, third-corpus.tsv, fourth-corpus.tsv, fifth-corpus.tsv, sixth-corpus.tsv, seventh-corpus.tsv; summary.json has the blocked commits per repository for both
#   builds and dropped.json the findings that disappeared (`npm install agent-roast@0.17.0` gives the old build)
```

`benchmarks/agent-corpus.tsv` lists the repositories and the revision of each when it was cloned. For
an exact rerun, clone each with `git clone --no-tags`, then `git fetch origin <revision>` (with
`--depth 1500`) and check it out. Search results change over time, so a fresh search will find
different repositories.

`benchmarks/language-corpus.tsv` (section 5) lists each repository with the revision it was measured at,
and the script fetches the 300 commits up to that revision, so a rerun reads the same commits. An
existing clone in the work directory is reused, which makes it easy to compare two builds on the same history.
