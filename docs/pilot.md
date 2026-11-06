# Try agent-roast on your repository

agent-roast compares the before and after of a change and reports when the checks got weaker
instead of the code getting fixed: an assertion loosened, a test removed, a coverage threshold
lowered, `strict` turned off, a CI step allowed to fail. It runs offline, reads Git objects only
and never executes your code.

The numbers in [benchmarks.md](benchmarks.md) come from public history. What they cannot show is
how the findings look to the people who own the repository. This page is a short way to find
out. You can stop after any step.

## What to expect

Blocking findings are rare, warnings are not. Replaying the newest 50 commits of 179 public
repositories that use AI coding agents, 149 of 179 had no commit that would have been blocked, and
43 of 179 had nothing at all to list. Across 7,905 commits, 0.6% would have been blocked and
12.1% drew a warning, mostly a test that was removed or whose expected value changed, which is
usually deliberate. About one blocking finding in five is a false alarm. For most repositories a
quiet trial is a normal result, and "nothing it said was worth my time" is as useful an answer as
"it caught something".

## Where it works

| Language | What is checked |
| --- | --- |
| TypeScript, JavaScript | all rules |
| Python | all rules |
| Go | disabled tests (`t.Skip`) and placeholder assertions, plus the before/after rules `assertion-removed`, `test-removed` and `expectation-rewritten` on `_test.go` files; tested less than the two above |
| Rust, Java, Kotlin, C#, Ruby, PHP, Swift | disabled tests (`#[ignore]`, `@Disabled`, `[Ignore]`, `xit`, `markTestSkipped`, `XCTSkip`) and placeholder assertions (new in 0.12.0; labeled cases, and the newest commits of 39 public repositories read by hand, `docs/benchmarks.md` section 5), plus a few line rules such as an empty `catch` or Rust `todo!()`; their tests are not read by the before/after rules |
| C/C++ | a few line rules only |

Config and CI checks read `package.json`, `tsconfig*.json`, ESLint, Jest and Vitest config,
`pyproject.toml`, `setup.cfg`, `pytest.ini`, `tox.ini`, `.coveragerc`, `codecov.yml`, GitHub
workflows and `.gitlab-ci.yml`. Build files such as `Cargo.toml`, `pom.xml` and `build.gradle`
are not read.

## Step 1: replay your last commits (two minutes)

On a clean checkout, a bare `npx agent-roast` runs the same replay. `npx agent-roast demo` first shows a
scripted example in a temporary repository, if you would like to see the output before you point it at your code.

You need Node.js 18+ and Git 2.30+, in a clone with full history (`git fetch --unshallow` if the
clone is shallow).

```bash
npx agent-roast@latest replay
```

It reviews each of the last 50 commits on its own against its parent, the way a pull-request
check would have seen it, and prints how many commits would have been blocked and which ones drew
a warning, with the evidence. It never fails because of a finding. A typical repository takes
about 10 seconds; the slowest of the 179 took 106 seconds (measured with three repositories
replayed at once on a busy laptop). A repository with fewer than 50 commits is replayed as far
back as it goes.

Use `--last 200` for more history, `--all-rules` to list line patterns such as `as any`, and
`--json` for every finding. The findings that matter most come first: checks that got weaker
(`assertion-weakened`, `guard-weakened`), skipped, focused and trivial tests, then removed or
rewritten tests. For each one, decide whether it was a real problem, a deliberate change, or a
false alarm. `npx agent-roast@latest explain <rule>` says what a rule means and what to do about
it.

## Step 2: watch real pull requests (optional, about two weeks)

Add this workflow as `.github/workflows/agent-roast.yml`:

```yaml
name: agent-roast (advisory)
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
          fetch-depth: 0
      - uses: Nari-Ab/agent-roast@v1
        with:
          advisory: "true"
```

In advisory mode findings never fail a pull request; they appear as annotations and in the job
summary. A broken setup or an incomplete scan still fails the job. The tool makes no network
requests; the Action only downloads its pinned package from npm. The same check runs locally
with `npx agent-roast@latest review --base origin/main --advisory`.

## Step 3: say what happened

Open a [pilot feedback issue](https://github.com/Nari-Ab/agent-roast/issues/new?template=pilot-feedback.yml).
Counts are enough: you do not need to name the repository or paste code. Paste the summary line of
the replay (it holds counts only), and for each finding give the rule name and your verdict (real
problem, deliberate change, false alarm). Say whether you would keep the tool running.

If you agree in the form, the counts go into [the scorecard](product/pilot-scorecard.csv): no
names, no code and no private repository content. The CLI has no telemetry, so nothing is
collected unless you write it down.

## Limits

It reads text, not program semantics: it cannot tell who wrote a change, and a green result is
not a quality certificate. Known gaps are listed in [benchmarks.md](benchmarks.md) and in the
README under "Scope and limitations".
