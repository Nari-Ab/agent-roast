# Benchmarks

Two measurements back the claims about the diff-aware rules (`assertion-weakened`,
`test-removed`, `expectation-rewritten`, `guard-weakened`). Neither is an accuracy
guarantee; both are reproducible.

## 1. Labeled changes (recall and controls)

`benchmarks/cases.mjs` holds before/after changes with the rule that must fire, `null` for
changes that must stay silent, and `miss` for gaps that are documented rather than hidden.
`scripts/benchmark-recall.mjs` builds a throwaway Git repository per case and runs the built CLI.
`tests/benchmark.test.ts` runs the same cases in the test suite.

```bash
npm run build && npm run bench
```

Result at 0.9.0: **32/32 cheats caught, 15/15 harmless changes left alone, 3/3 documented gaps
still open.** The cases were written together with the detector. They protect against regressions
and show what is covered; they say nothing about cheats nobody thought to write down.

Open gaps: mocking the module under test, hardcoding the tested value in production code, and
vacuous matchers such as `expect.anything()`.

## 2. Noise on real human history

`scripts/benchmark-noise.mjs` runs `review` over the last N first-parent commits of each repository
(only commits that touch tests or CI/config are reviewed) and counts findings. Git history is only
read; project code is never executed.

```bash
git clone --depth 600 https://github.com/<owner>/<repo>.git
npm run build && npm run bench:noise -- ./repo --commits 300
```

Corpus (shallow clones taken 2026-11-01), last 300 commits each:

| Repository | HEAD | Relevant commits | Commits with a blocking finding |
| --- | --- | ---: | ---: |
| tj/commander.js | `ba6d13ddb4` | 134 | 2 |
| sindresorhus/execa | `247faa0ff0` | 59 | 0 |
| pallets/click | `2247b35ea1` | 102 | 1 |
| psf/requests | `3c7baaa05a` | 112 | 2 |
| colinhacks/zod | `2554b70c3d` | 199 | 2 |
| **Total** | | **606** | **7 (1.2%)** |

Non-blocking rules on the same 606 commits: `test-removed` 37 commits (6.1%),
`expectation-rewritten` 17 commits (2.8%).

### The seven blocking commits, read by hand

| Commit | Finding | Verdict |
| --- | --- | --- |
| commander.js `3dd608610b` | fewer assertions after moving tests from Jest to `node:test` (`expect.assertions(n)` guards dropped) | deliberate migration |
| commander.js `96c6c25113` | `noImplicitAny` and `strictNullChecks` set to `false` in a reworked `tsconfig.json` | deliberate, but strictness is lower in that config |
| click `0e0c00324a` | `test_stderr` 10 → 6 assertions after the `mix_stderr` option was removed | deliberate rewrite |
| requests `8bce583b95` | duplicate `u('...')` check removed when Python 2 support ended | deliberate cleanup |
| requests `e36f34597c` | `test_header_validation` lost its `assert`; the comparison no longer does anything | **real defect** |
| zod `6f0483671e` | assertions moved from internal `bag` values to `toJSONSchema()` output | deliberate refactor |
| zod `a0898b4b7f` | `continue-on-error: true` on a publish step, with a documented reason | deliberate |

So one of seven was a mistake and six were decisions a reviewer is right to look at. That is the
intended behavior of a review aid, and it is also why exceptions need a reason and an expiry date.

### What went wrong on the first runs

The first run produced 39 blocking findings on 12 commits; the numbers above are 11 findings on
7 commits. Causes that were fixed and are now covered by cases: `expect.assertions(n)` counted as an assertion; `black`/`prettier` rewrapping
read as removed assertions; multi-line Python signatures cutting a test short; parametrized tests
read as fewer assertions; CI steps split or moved to another package manager read as a removed
test step; several assertions on one line counted once; a very long `@parametrize` decorator.

## Limits

- Human history, five projects, JS/TS and Python mostly. No real AI-agent pull requests yet.
- Text and structure only: no type information, no execution, no dataflow.
- No Go project is in the real-history sample; Go support rests on labeled cases only.
