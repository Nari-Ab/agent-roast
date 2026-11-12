# What a block looks like

agent-roast blocks rarely, and every block is a question, not a verdict. This page shows real ones from public repositories: what the tool
printed, what the change was, and how it was sorted. Each was read in its source by an AI assistant, which is the method and the limit of
[the measurements](benchmarks.md#9-repositories-nobody-had-tuned-on). None of it says anything about a project: most of these changes are
deliberate and say why in the commit.

## What the tool prints

This is `npx agent-roast replay` (0.20.0) on the newest 50 commits of [getkimchi/kimchi](https://github.com/getkimchi/kimchi), shortened:

```text
agent-roast — replay of the last 50 commits (up to 3332170)
  47 commits changed source, tests or CI config · 3 did not
  Would have blocked: 1 commit · warnings on 16 · line patterns only on 9 · nothing to report on 21

  BLOCK fd7fcd7 2026-11-09 perf(pr-cost): make the idle reporting pass cheap (#1672)
    FAIL [assertion-weakened] src/extensions/pr-cost-reporting/worker.test.ts:595
      recovers a durable frozen ACK when legacy file cleanup fails without resending: expect(await read… → expect(Object.values((await readReportingState(directory)).entries)[0].pendingId
```

A block names the file, the line, the test and the before and after. In this one an exact comparison of a file's bytes was replaced by a check of one
property of the state, so a reviewer should look at whether the old check lives on somewhere else. Warnings (a test that disappeared, an expected value
that was edited) are listed after the blocks and never stop anything.

## Ten changes that a reviewer should see

Real blocks, each of them a check that got weaker, a gate that was relaxed or a test that was switched off. Most say why.

| Commit | What changed | What the commit says |
| --- | --- | --- |
| [kimchi 21981da](https://github.com/getkimchi/kimchi/commit/21981dae8bdcec5c13576c1296970311794d2a4e) | `expect(errorSpy).toHaveBeenCalledTimes(1)` became `expect(resnapshotFailures.length).toBeGreaterThanOrEqual(1)` | "test: deflake mcp deferred-resnapshot assertions" |
| [tus-node-server e126301](https://github.com/tus/tus-node-server/commit/e1263016d91a790471f6d146dd27368d229ac366) | `assert.equal(received, 4)` became `assert.ok(received >= 4, 'should have received 4 or more events')` | "make test less flaky" |
| [auto-round 33ec4c7](https://github.com/intel/auto-round/commit/33ec4c75b8a8bbc6ddfb582d1a8a3b7e6a25f6c3) | an existing test got `@pytest.mark.xfail(reason="<link to an upstream issue>")` and `# TODO: remove xfail once the issue is resolved` | "Temporarily skip the issue in the CT" |
| [swamp a5d688a](https://github.com/swamp-club/swamp/commit/a5d688ab9e492b56ef780873c08c059d9afdcae4) | the Windows test workflow's `push` trigger became a `schedule` | "run the Windows Compatibility workflow every 4 hours instead of on every merge" (a run takes 40 to 50 minutes) |
| [better-harness e084d2c](https://github.com/QoderAI/better-harness/commit/e084d2c3e3984c7df7ec1fd08f88f05f18270193) | `expect(pages).toHaveLength(1)` became `expect(pages.length).toBeLessThanOrEqual(3)` | "repair the last browser failures with two layout regressions" |
| [open-science a00a55d](https://github.com/aipoch/open-science/commit/a00a55d0a669d88ece3b707950b2b079c99b2cb8) | `rejects.toThrow('200 Connection Established')` became `rejects.toThrow()`, in two tests | "unify Notebook HTTPS policy and unsafe network approvals" |
| [AgileRL 0f19061](https://github.com/AgileRL/AgileRL/commit/0f19061489667d0fb446bfdf8917dfd74e67b3da) | `assert individual.mut == sampled_mutation or "None"` became `assert True` | a merge of a branch; the old assertion could not fail either, because `or "None"` is always true |
| [djangogirls c3126a1](https://github.com/DjangoGirls/djangogirls/commit/c3126a1affa35ebc31a46e37efc706d5ffead7b4) | a new test with its request and its assertions commented out under a `TODO`, ending in `assert True` | a merge of a pull request |
| [dbcli d176d2d](https://github.com/CarlLee1983/dbcli/commit/d176d2d8b52efb8f399075f26415566525aec8ad) | `expect(r.code).toBe(2)` became `expect(r.code).not.toBe(0)`, in nine tests (read since 0.20.0) | "fix Windows CI failures ... and flaky tests" |
| [docx-editor ba742d7](https://github.com/eigenpal/docx-editor/commit/ba742d7d1f25c050dedb65d39d386df03dcc8e24) | `expect(record.resource.kind).toBe('unrenderable')` became `expect(record.resource.kind).not.toBe('ready')` (read since 0.20.0) | "address release readiness gaps" |

## Some false alarms

A block where no check got weaker. Four were found by reading these samples and are fixed (in 0.19.0 and 0.20.0); two are still blocked today, and listed with the others in
[the benchmarks](benchmarks.md#11-a-seventh-sample-and-two-things-that-were-missing).

| Commit | What the tool saw | What it was |
| --- | --- | --- |
| [tortoise-orm](https://github.com/tortoise/tortoise-orm) (51 commits, "Release 0.25.0", "docs: update documentation url", ...) | `mypy check_untyped_defs: true → false` in `pyproject.toml` | `[[tool.mypy.overrides]]` relaxes the check for `tests.*` and keeps it for another module; the rules read those tables as one. Fixed in 0.19.0 |
| [Tavotto 2e278ae](https://github.com/Tavotto/Tavotto/commit/2e278aeee5bf68394a589714af2d9f1e4b69589c) | `continue-on-error: true` on a CI step | the step uploads an artifact, and the commit says an upload that times out must not turn the job red. A step that only uploads or publishes is not a check since 0.19.0 |
| [AgileRL a8d504a](https://github.com/AgileRL/AgileRL/commit/a8d504a26f5837cfa87702eb3e46c3791205cf78) | `assert sharded.n_bytes * 8 == full.n_bytes` became `... > ...` | an exact check on a computed value took its place, next to the old relation as an inequality. Still blocked |
| [any-llm 9b3448f](https://github.com/mozilla-ai/any-llm/commit/9b3448ff8ef7953877758f6b618720cee59a74e8) | `assert iteration <= max_iterations` became `assert answered` | the old bound could not fail after `while iteration < max_iterations`; the new check asks whether the agent answered. Still blocked |
| [disnake 6c482d1](https://github.com/DisnakeDev/disnake/commit/6c482d1eb791819d1ae3005d54cd5f624bd6b45f) (and five more commits of it) | `ruff ignore: +UP007, +UP035, +UP045` in `pyproject.toml` | the commit drops Python 3.9 and raises `requires-python`; the rules that the bump brings are ignored, so the checks in force are the same. A ruff ignore added together with a bump of the Python version or of ruff is not reported since 0.20.0 |
| [docx-editor 89b1ef0](https://github.com/eigenpal/docx-editor/commit/89b1ef0ba5be4d831787e707030e8406821c7991) | `[test-focus]` on `fit(` in a test file | a layout function that is called `fit`, read as Jasmine's focused test. `fit` and `fdescribe` need a title written as a string since 0.20.0 |
| [pi-web 753b78e](https://github.com/jmfederico/pi-web/commit/753b78e647493debdd67b8ccfae40eccdebfaf63) | `expect(editor.hasAttribute("completion-menu-open")).toBe(true)` became `expect(menu?.shadowRoot?.querySelector("[popover]")).not.toBeNull()` | a refactor moved the fact that the menu is open from an attribute to an element; the check is of the same kind. Still blocked |

## What a first run shows

The first thing `npx agent-roast replay` shows on a repository is the newest 50 commits. On the 278 public JavaScript, TypeScript and Python repositories of the seven samples of [the benchmarks](benchmarks.md) (79,843 commits replayed):

- **Blocks:** 26 repositories (9%) list at least one, 32 in all. A reviewer should see 23 of the 32; 9 are false alarms (28%), in 8 repositories (3%), and in 6 of those
  (2%) every block is a false alarm. In the newest 300 commits it is 101 repositories (36%), 195 blocks, 33 false alarms (17%). These figures are for 0.20.0, which was fixed from
  those samples, so they flatter it. Out of sample is the seventh alone with the published 0.19.0, which had not seen it: 4 of 40 repositories (10%) show a block in the newest 50 commits, 4 blocks, 1 false alarm.
- **Warnings** (a test that disappeared, an expected value that was edited, a line pattern): a median of 3 commits of the 50 per repository, none in 29% of the repositories, 10% of the commits on average. They never stop anything.
- One reader sorted every block, and the share of false alarms moved between a quarter and two thirds from one sample to the next
  ([section 11](benchmarks.md#11-a-seventh-sample-and-two-things-that-were-missing)), so treat these as a first estimate for a repository like those, not as a promise.

## What to do with a block

- **A real weakening:** fix the code instead. That is what the agent hook says to the agent, with the file, the line and the before and after.
- **A deliberate change:** commit it. The hook reviews uncommitted work, so a committed change is accepted; for a pull request, add an expiring exception
  instead of turning the rule off ([reference](reference.md#configuration)).
- **A false alarm:** please [open an issue](https://github.com/Nari-Ab/agent-roast/issues/new/choose) with the commit; that is how the ones above were found.
- **Not sure yet:** `npx agent-roast hook install --advisory` only warns and never sends the agent back.
