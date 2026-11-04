# How agent-roast compares

Checked on 4 November 2026 from each project's public README. These tools change quickly, so treat the rows as a starting point
and read their pages. Several of them solve a neighboring problem and work well **together** with agent-roast.

## The short version

agent-roast does one thing: it notices when a change makes the **checks** easier to pass (a weaker assertion, a skipped or
deleted test, a lowered coverage threshold, a CI step allowed to fail) instead of making the code correct. It compares the
full before and after of every changed file, takes its policy from the trusted side, and acts at three points: when an agent
is about to finish, when you commit, and on the pull request. It is deterministic and offline: no model, no tokens, no network.

## Tools in the same neighborhood

| Tool | What it is | Overlap | Difference |
| --- | --- | --- | --- |
| [TDD Guard](https://github.com/nizos/tdd-guard) / [Probity](https://github.com/nizos/probity) | Hooks for coding agents that enforce test-driven development and other rules, using deterministic checks or a model | Both put a guard inside the agent's loop (Claude Code, and for Probity Codex and Copilot CLI) | They enforce a **process** (tests first, minimal code). agent-roast checks the **integrity of the checks that exist**. Use both. |
| [aislop](https://github.com/scanaislop/aislop) | A scanner for the "slop" agents leave behind (narrative comments, dead code, `as any`, duplication, 50+ rules over 11 languages), with a score and auto-fix | Agent hooks, CI, SARIF; a few overlapping patterns (`as any`, swallowed errors, stubs) | Broad code hygiene versus a narrow integrity question. aislop does not compare a test with its previous version. |
| [hallucinot](https://github.com/jayj221/hallucinot), [fakegreen](https://github.com/fitzyracing1/fakegreen-action), [SlopGate](https://github.com/Shinraya-Tech-Labs/slopgate), GreenLie and others | Diff or AST checks for disabled tests, deleted assertions and neutered CI | The same problem | Differences are in depth and evidence: agent-roast reads whole files before and after, takes policy from the base, covers an agent hook, a pre-commit hook and a PR comment, and publishes how it was measured and where it is wrong. |
| `eslint-plugin-jest` (`no-disabled-tests`, `no-focused-tests`), `eslint-plugin-no-only-tests`, Ruff, Playwright `forbidOnly` | Linters and runner options | Catch a skip or `.only` in the current code | They see the current file, not that an assertion got weaker or a test vanished. Keep them; agent-roast covers the rest. |
| Coverage gates, [Stryker](https://stryker-mutator.io/), [mutmut](https://github.com/boxed/mutmut) | Measure whether tests catch defects | A lowered threshold defeats a coverage gate | They measure the tests; agent-roast guards the **gate itself** and the tests against being edited down. Complementary. |
| AI review bots (CodeRabbit, Copilot code review, ...) | A model reads the pull request | May notice a weakened test | Non-deterministic, cost tokens, and send code to a service. agent-roast is a cheap tripwire that can run before them. |
| Semgrep, gitleaks, reviewdog | General static analysis and secret scanning | Design ideas for baselines, suppressions and annotations | Different job. See [the design notes](archive/product/related-tools-0.8.md). |

## What it is good at

- **Seeing removal.** A deleted test or a lowered threshold leaves no suspicious line behind. Comparing full files finds it.
- **Not being talked out of its rules.** A pull request, or an agent, cannot edit the config to silence the check, because
  policy is read from `HEAD` or the base branch.
- **Saying how often it is right.** On 12,645 commits in 166 public repositories it found weakened checks in about 1 of 300
  commits that touch tests or CI, and roughly one finding in five was a false alarm. Method, caveats and the gaps that remain are
  in [benchmarks.md](benchmarks.md).

## What it is not

- Not proof of who wrote a change. It cannot tell an agent from a person, and the measurements show these moves are **not
  specific to AI**.
- Not a quality certificate. It reads text, not program meaning; a clean report means no known shortcut was found.
- Not a replacement for a compiler, a linter, a test runner or review. It is a tripwire for one failure mode.
