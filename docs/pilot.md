# Try agent-roast on your repository

agent-roast compares the before and after of a change and reports when the checks got weaker
instead of the code getting fixed: an assertion loosened, a test removed, a coverage threshold
lowered, `strict` turned off, a CI step allowed to fail. It runs offline, reads Git objects only
and never executes your code.

The numbers in [benchmarks.md](benchmarks.md) come from public history. What they cannot show is
how the findings look to the people who own the repository. This page is a short way to find
out. You can stop after any step.

## What to expect

Findings are rare. Across 12,645 commits that touch tests or CI/config, the blocking rules fired
on 0.3%, and about one finding in five was a false alarm. For most repositories a quiet trial is
a normal result, and "nothing it said was worth my time" is as useful an answer as "it caught
something".

## Where it works

| Language | What is checked |
| --- | --- |
| TypeScript, JavaScript | all rules |
| Python | all rules |
| Go | the before/after rules on `_test.go` files; tested less than the two above |
| Java, Kotlin, Rust, C#, PHP, Ruby, C/C++ | a few line rules only (for example an empty `catch`, Rust `todo!()`); their tests are not read by the before/after rules |

Config and CI checks read `package.json`, `tsconfig*.json`, ESLint, Jest and Vitest config,
`pyproject.toml`, `setup.cfg`, `pytest.ini`, `tox.ini`, `.coveragerc`, `codecov.yml`, GitHub
workflows and `.gitlab-ci.yml`. Build files such as `Cargo.toml`, `pom.xml` and `build.gradle`
are not read.

## Step 1: look back (five minutes)

You need Node.js 18+ and Git 2.30+, in a clone with full history (`git fetch --unshallow` if the
clone is shallow).

```bash
# The last 50 commits, compared as one before/after change. Reports; never fails.
npx agent-roast@latest review --base HEAD~50 --fail-on ''
```

Use a smaller number if the repository has fewer commits, or if the output says `INCOMPLETE`
(the change was too large to read in full).

The findings that matter most are listed first: checks that got weaker (`assertion-weakened`,
`guard-weakened`), skipped, focused and trivial tests, then removed or rewritten tests, then the
noisier line patterns such as `as any`. For each finding, decide whether it was a real problem,
a deliberate change, or a false alarm. `npx agent-roast@latest explain <rule>` says what a rule
means and what to do about it.

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
with `npx agent-roast@latest review --base origin/main --fail-on ''`.

## Step 3: say what happened

Open a [pilot feedback issue](https://github.com/Nari-Ab/agent-roast/issues/new?template=pilot-feedback.yml).
Counts are enough: you do not need to name the repository or paste code. For each finding, give
the rule name and your verdict (real problem, deliberate change, false alarm), and say whether
you would keep the tool running.

If you agree in the form, the counts go into [the scorecard](product/pilot-scorecard.csv): no
names, no code and no private repository content. The CLI has no telemetry, so nothing is
collected unless you write it down.

## Limits

It reads text, not program semantics: it cannot tell who wrote a change, and a green result is
not a quality certificate. Known gaps are listed in [benchmarks.md](benchmarks.md) and in the
README under "Scope and limitations".
