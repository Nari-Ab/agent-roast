# Changelog

## 0.24.0 — 2026-11-13

**A gap closed: the only caller of a reusable test workflow, and two ideas from earlier sections tried again by a different method.**

Section 16 (0.23.0) left a documented gap: deleting, or editing, the workflow that calls a reusable workflow which holds the tests stopped those tests from running, unseen, because the review judges only the changed files and the caller itself has no test step of its own. This version closes it, and tries two open questions again with a second method each; neither earns its keep. `docs/benchmarks.md` section 17 has the numbers and the limits.

- **A reusable workflow (`workflow_call`) that a diff stops calling is read from the tree it still sits in**, and reported only when it does not gate on a trigger of its own (`push`, `pull_request`, `pull_request_target`, `merge_group`) and nothing else, in the diff or not in it, still calls it. A workflow that already gates on its own trigger, or keeps another caller, loses nothing when one caller goes.
- **Measured on real history.** 11,106 commits of 516 repositories touch a CI file; 33 commits, across 26 repositories, stop calling a workflow they called before (`scripts/scan-reusable-callers.mjs`). This version reports one: `python-poetry/poetry`'s own pre-commit automation rewrote `uses: ./.github/workflows/.tests-matrix.yaml` into `uses: $/.github/workflows/.tests-matrix.yaml` in a dependency-bump commit, a path GitHub Actions cannot resolve, so that workflow's test matrix stopped running on every pull request, unnoticed in this clone's history. One more, `TheRealSavi/iOpenPod`'s, was already reported by the rule of section 16 (the called workflow dropped its own triggers in the same diff); this version does not report it twice. The rest keep another caller or gate on a trigger of their own regardless of callers.
- **Two ideas tried again, and still refused.** Demoting an `assertion-weakened` finding whose subject changed (section 16) was tried a second way: splitting the 34 commits where every finding does this by whether the new subject is a drill-down of the old one (`result` narrowed into `result.error`) or a wholly different expression (`card.className` replaced by a query). Almost none of the 34 are a drill-down by that measure (2 of 34, one false alarm and one real), so it sorts almost nothing.
  "A test that runs through a command that does not say so" (sections 13 and 16: `nx run-many`, `moon ci`) was searched for directly: of 93 lines across the corpora that call a bare monorepo task runner with no word "test" on the line, 77 do not run tests at all (mostly `turbo run build`, `nx run <project>:build`); reading any of them as a test step unconditionally would trade one recall gain for many false alarms.
- Labeled cases: 165 of 165 cheats caught, 154 of 154 look-alikes left alone, 1 gap open (one more of each than before this version, for a deleted caller and one deleted together with the workflow it called); 52 files, 1,555 tests. The 299 recorded blocks of the label table, reviewed again, are unchanged.

## 0.23.0 — 2026-11-13

**Three false alarms of a tenth sample fixed, tests that run through a task-runner target read as tests, and a guard that was measured and not built.**

A tenth sample (`docs/benchmarks.md` section 15) of 40 repositories that no earlier measurement used blocked 40 commits with 0.21.0 as shipped, 27 for a reviewer and 13 false alarms (33%), the same 39 and one more than the published 0.20.0. Reading the 13 showed three that a rule can fix, and the regression of the fixes found two more real findings.
Section 16 has the tables; the figures about the sample are fitted to it, the regressions are not.

- **A target of a task runner that has the word test among its words is a test run.** `make unit-test`, `make acceptance-test`, `just test-asyncio py314 1`, `pnpm run docs:test` count; a target that sets up, installs, builds or type-checks (`make setup-tests`, `pnpm run typecheck:tests`, `pnpm run build:native:test`) does not, and `npm run cover` is read like `npm run coverage`.
  The tests of TransformerLens that moved from `poetry run pytest` into `make unit-test` are no removal any more (one false alarm). The first version of the rule reported `npm run unit-tests` turned into `npm run cover` in `apache/cordova-ios`; the regression found it and the `cover` script fixed it.
- **A workflow that another workflow calls runs on every change that its caller runs on.** A workflow that lost its own `push` and `pull_request` triggers by becoming reusable (`workflow_call`) is not "no longer running on pull requests" while a workflow that gates calls it (`uses: ./.github/workflows/sdk.yml`), in the change or not in it (one false alarm, `bunqueue`).
- **A skip marker only counts in a file that holds tests.** The word test, tests, testing, spec or conftest has to stand as a word of the path: `@pytest.mark.skip` on a library function that is called `test_prompt` was reported, and it was the only Python skip finding of the label table outside such a path (one false alarm).
- **Measured (fitted to the sample).** On the 300 blocks of the shipped build in the label table: 297 still blocked, 3 not, the three false alarms above, and none of the 238 that a reviewer should see lost. 15,295 commits in 527 repositories touch a CI file or a Python lint or type configuration: the analyses of both sources differ on 320 and the full review of both builds on 3 (1 not reviewable): one finding gone, two new and real
  (`open-telemetry/opentelemetry-js` took `npm run docs:test` out of the job that runs on pull requests and runs it weekly; `extension-js/extension.js` allowed the test step of its dependency canary to fail, a commit that sample 4 had sorted for a reviewer). The label table has 515 rows and a column for this version: 299 blocks, 240 for a reviewer and 59 false alarms.
  Labeled cases: 164 of 164 cheats caught, 153 of 153 look-alikes left alone, 1 gap open; 51 files, 1,542 tests. The price: a command that is learned makes a step that moves to a command that is not known a removal, as `npm run cover` showed; tests that run behind a command that names no test (`nx run-many`, `moon ci`, `python eval/run_evals.py`) are still reported when they move.
- **A guard that was measured and not built.** "The subject of the assertion changed" (the old and the new assertion share no identifier) would have unblocked 22 false alarms and 12 blocks for a reviewer of the 300: about two false alarms for one weakened check that goes unreported (samples 1 to 9: 18 against 10; sample 10: 4 against 2), and the 12 look like the 22 line by line. Checks rewritten in an equivalent form are 43 of the 62 false alarms of the table and stay.

## 0.22.0 — 2026-11-13

**Three more agents can be sent back to fix the code: Gemini CLI, GitHub Copilot and Factory Droid.**

`agent-roast hook install gemini`, `copilot` and `droid` guard three more agents. Each one runs a hook when its agent has finished a turn, and each documents that the hook may answer with a decision and a reason that goes back to the model: what the Stop hooks of Claude Code, Codex and Cursor do.
The hook is the same review of everything that is not committed yet, and the same rule about sending an agent back **once**: the next input of the same agent says that it is already continuing because of a hook (`stop_hook_active`), and then the hook only warns the person.

- **Gemini CLI** (`hook install gemini`, `.gemini/settings.json`, or `~/.gemini/settings.json` with `--global`). Gemini CLI's `AfterAgent` hook runs once per turn, after the model's final response, and `{"decision": "deny", "reason": "..."}` rejects the response and retries the turn with the reason as the new prompt.
  The entry is `{"matcher": "*", "hooks": [{"name": "agent-roast", "type": "command", "command": "...", "timeout": 60000}]}` under `hooks.AfterAgent` (Gemini CLI counts the timeout in milliseconds). Intact checks answer `{}`, the warning is a `systemMessage`, other events are ignored. Gemini CLI warns the first time it sees a project hook.
- **GitHub Copilot** (`hook install copilot`, `.github/hooks/agent-roast.json`, or `~/.copilot/hooks/agent-roast.json`). Copilot loads the hook files of `.github/hooks` in the Copilot CLI, in VS Code's agent mode and, from the default branch, in the cloud agent. The hook is registered under `Stop`, the alias of `agentStop` that writes the VS Code-compatible input,
  and `{"decision": "block", "reason": "..."}` forces another turn (Copilot ends the turn after eight blocks in a row; this hook sends one). Copilot documents no field for a message to the person, so the warning is its display-only progress line. The file is `{"version": 1, "hooks": {"Stop": [{"type": "command", "command": "...", "timeoutSec": 60}]}}`.
- **Factory Droid** (`hook install droid`, `.factory/hooks.json`, or `~/.factory/hooks.json`). Droid's `Stop` hook takes Claude Code's input and its `{"decision": "block", "reason": "..."}` answer, and its hooks.json is keyed by event name at the top of the file.
- `hook uninstall` and `hook status` know the three agents, installing again refreshes the pinned version, other settings and other hooks are kept, a settings file with comments (Gemini CLI's may have them) is left alone with a message as an unreadable one is for the other agents, and `hook install` with no names also picks a repository that has a `.gemini`, `.github/hooks` or `.factory` folder.
- **What is not covered.** Like the other three integrations these follow the documented protocol and are tested with simulated hook input; there was no live session of any of the three. Whether the hook fires in a non-interactive run (`gemini -p`, `copilot -p`, `droid exec`) is not documented. Google's Antigravity CLI, which the Gemini CLI documentation says replaced it for unpaid-tier
  users on 18 June 2026, has hooks of its own that are not covered, and neither is Copilot's cloud agent, whose sandbox has a restricted network that `npx` may not get through. `docs/integrations.md` has a section for each.
- **A tenth sample measures the build that ships (documentation only).** 40 public repositories that no earlier measurement used (`benchmarks/tenth-corpus.tsv`, 11,191 commits): the published 0.20.0 blocked 39, 26 for a reviewer and 13 false alarms (33%);
  0.21.0 as it ships, with the fixes of samples 8 and 9 and the three of reading the code once more, blocked the same 39 and one more, a real one (`assert ... or True` in a new test): 27 and 13. None of the ten false alarms that 0.21.0 fixed showed here,
  and the 13 that did are other kinds: checks rewritten in an equivalent form (7), tests that run through `make unit-test` or through another workflow after a migration (2), workflows that are no gate (2), a library function called `test_prompt` that is marked skip (1),
  a new test paired with an old one in a merge (1). They are listed in `docs/benchmarks.md` section 15 and are not fixed in this version. The label table has 514 rows (ten samples), 300 blocks of the shipped build: 238 for a reviewer and 62 false alarms.

## 0.21.0 — 2026-11-13

**Ten false alarms fixed that an eighth and a ninth sample showed, two shapes that a search of 126,486 commits found, and a catalog of cheats that someone else wrote.**

0.20.0 as it was frozen was tried on an eighth sample that nobody had read: 39 public JavaScript, TypeScript and Python repositories, 11,081 commits (`benchmarks/eighth-corpus.tsv`). It blocked 26 commits, 16 for a reviewer and 10 false alarms (38%),
against 29 and 13 (45%) for the published 0.19.0. Reading the blocks showed what is fixed here. A search of the added lines of 126,486 commits in 505 repositories for the gaps that `docs/rules.md` lists found two shapes worth a rule, and the specimens of a third party's
catalog of agent cheats were reviewed as an outside check. 0.21.0 as it was frozen then blocked 46 of the 11,286 commits of a ninth sample that it had not seen, the same 46 as the published 0.20.0: 28 for a reviewer and 18 false alarms (39%), and reading them showed five more false alarms, fixed here.
`docs/benchmarks.md` sections 12 to 14 have the tables, what is still wrong and the limits.

- **A mock that is configured on one member of a namespace import is a mock of that member only.** `vi.mocked(filesystem.open).mockImplementation(...)` made `await filesystem.stat(...)` look like the output of a mock, because the module was spied on and one member was configured (one false alarm).
- **A Python expectation of nothing turned into its opposite is a flipped expectation, not a weaker one.** `assert memory.created_at.tzinfo is None` into `is not None`, and `assert not (cap > 0 and used >= cap)` into `assert admitted.unlimited` (two false alarms).
  A check that is compound outside its brackets is not an expectation of nothing: `assert data is not None and not data.refresh_pending` turned into `assert data is not None` dropped a clause and is still reported.
- **A ruff `target-version` that is dropped hands the choice to `requires-python`.** The effective target is the one that is written, or else the one the project requires, so ignores for the rules that a higher target brings are not reported (one false alarm).
- **A test command inside a block of commands is a test step.** The lines of a folded block (`run: >-`) are one command and an item of a GitLab `script:` list is one (one that only prints is not); in a literal block (`run: |`) a runner known by name, or a tool with `test` as its first argument
  (`hvigorw test`, `terraform test`), counts, so a step is the same test step in either kind of block. The shell builtin `test "$x" = y` is not a test run (one false alarm).
- **`assert check or True` cannot fail, and `skipif(True)` is a skip.** The first is a `trivial-assert` (Python tests; only an `or` outside every bracket, so a callback that ends in `or True` is left alone) and the second a `test-skip` on a test that was already there (`@pytest.mark.skipif(True, ...)`, `@unittest.skipIf(True, ...)`).
  They are the two shapes of the documented gaps that the search found to be rare in ordinary code and, when they show, a check that cannot fail or a test that is switched off. Of the 24 commits where the search found either, seven differ between 0.20.0 and this version, with nine new findings, all read as real:
  seven neutered assertions ("TDD placeholder", "message content not asserted verbatim") and two skips with a FIXME. Sixteen other shapes were read and not built: retries, timeouts, runner exclusions, `if False:` and the rest are the ordinary content of test files and configuration (`scripts/probe-gaps.mjs`).
- **An outside check.** The 15 specimens of [reward-hack-zoo](https://github.com/MatthewWaller/reward-hack-zoo) (nine hacks and six honest solutions, written by hand by the catalog's author) were reviewed with `scripts/benchmark-zoo.mjs`: four hacks are reported (a skip, a patched target, a `conftest.py` that rewrites reports,
  an edited expected value as a warning) and none of the honest solutions. The five that are not (special-casing, swallowed errors, overfitting) live in the code and look like ordinary code line by line; the search found their shapes 950 and 1,180 times.
- **Fixed after reading sample 9 (so not part of its measurement).** A command that installs dependencies names a group, an extra or a package that is called `test` (`uv sync --group test`, `pip install .[test]`) and runs no tests, and `tox -e lint` or `nox -s docs` runs a tool that is not the tests, and the name of a step or of an artifact (`- name: Test with tox`) is not a command:
  only the command itself is left out, so `pip install -e .[test] && pytest` and `tox -e lint,py312` are still test steps (two false alarms). A test step that was already allowed to fail (`continue-on-error`, `allow_failure`) or switched off (`if: false`) checked nothing and is no check that is lost when it goes (one).
  A registration with a table, `it.skip.each([`, is judged by its first lines: `it.each([` that became `it.skip.each([` is still reported, a table that was not in the old file (a reproduction written as `it.fails.each`, single skipped tests regrouped into one) is not (two).
  The price: a test step that was allowed to fail is not reported when it is removed, and a table that is new and is skipped in the same change is not reported either.
- **Found by reading the code of these fixes once more (not by a sample).** `uv tool install ... tox` and the installers `uv add`, `poetry add`, `pdm add`, `npm add`, `pnpm add` and `bun add` run no tests (the first stood on 19 lines of one repository of the corpora, each read as a `tox` run).
  A test step that may fail is left out by the line it stands on, not by its text: the same command in a job that gates is still counted when both go, and a workflow that is deleted while the same command runs only in a job that may fail is reported, because that job checks nothing.
  The gap before the `tox -e` environment is bounded: a line of 200,000 characters made of `tox ` took 4.9 s to read.
- **Measured.** On sample 8 the shipped build blocks 21 of the 26 commits that 0.20.0 blocked (the 16 that a reviewer should see and 5 false alarms) and on sample 9 41 of the 46 (28 and 13), with no finding that is new (the last rows of the two tables are fitted). 14,176 commits of the nine samples, the agent corpus and the 24 repositories of section 6 touch a CI file or a Python lint or type configuration: the analyses of both sources differ on 1,589, and the full review with both builds of those differs on 5 (the 5 findings that are gone are five of the ten false alarms fixed in this release, the ones in CI and lint configuration, and none is new).
  The 474 recorded blocks of the nine samples, reviewed again with this version: 260 are blocked (211 for a reviewer, 49 false alarms); on samples 1 to 8, 24 of the 237 that 0.19.0 blocks are not (22 false alarms and 2 older blocks whose tests run in another workflow), and 6 are blocked that 0.19.0 does not block, all for a reviewer (one from the rule of 0.20.0 for an exact value turned into "not another value", 5 from the two rules of section 13).
  Labeled cases: 162 of 162 cheats caught, 150 of 150 look-alikes left alone, 1 gap open; 50 files, 1,517 tests. The regressions found five defects of the fixes themselves, fixed before the numbers were taken (`docs/benchmarks.md`, section 14). The price: a test script of another shape inside a literal block is not seen,
  an `or True` inside a call (`assert any(x or True for ...)`) is not reported, a `skipif(True)` on a test that the same change adds is not reported (as for every skip), and special-casing, swallowed errors and overfitting are not reported at all.

## 0.20.0 — 2026-11-12

**A check turned into "not another value", a duplicate workflow dropped, and fewer false alarms on a seventh sample.**

Two things were missing, found on corpora that had already been read, before any block of a seventh sample was read, and reading that sample showed what else was wrong. The published 0.19.0 blocked 31 of its 12,000 commits (40 public
JavaScript, TypeScript and Python repositories that no earlier measurement had used, `benchmarks/seventh-corpus.tsv`): 16 for a reviewer and 15 false alarms (48%; 6 of them in one repository's
`pyproject.toml`). 0.18.0 blocked 32, 16 of them false alarms. The build of this version that was frozen before the sample was read blocked 32 and added one block that is real. The fixes that reading the sample
showed are in this version; on the 32 commits it blocks 22, the 17 that a reviewer should see and 5 false alarms. `docs/benchmarks.md` section 11 has the tables, what is still wrong and the limits.

- **An exact value turned into "not another value" is a weaker check.** `expect(x).toBe(2)` edited into `expect(x).not.toBe(0)` (also `toEqual`, `toStrictEqual` and `toHaveLength`), `assert x == 2` into `assert x != 0`,
  and `self.assertEqual(x, 2)` into `self.assertNotEqual(x, 0)`: the test pinned one value and now only rules another out, so nearly anything passes. Found by a recall probe on the 1,248 agent commits whose messages say they skip, disable or loosen
  tests (an exit-code test, `toBe(2)` into `not.toBe(0)` in nine tests of one commit). Not reported: ruling out the very value the old check expected (a flipped expectation), an old check that expected nothing or a boolean, a name as the
  new value (`not.toBe(previousId)` asks whether something changed), a compound Python assertion. In about 97,000 commits there are 45 where an exact check was edited into a negated one; the rule adds one block there, a real one, and the rest are flipped expectations.
- **A workflow dropped while another one runs the same tests is not "tests removed".** A workflow that stops running its test commands is reported only when one of them no longer runs in a workflow that gates changes, whether
  the same change touches that workflow or not (the unchanged workflows of the head tree are read only then). The same command in another `working-directory`, another runner, or a workflow that runs only on a schedule does not count. It
  removes the two false alarms of sample 6 that 0.19.0 listed as still wrong, and two older blocks that were sorted "for a reviewer" (a schema workflow that stopped running on pushes while `pnpm test` still runs on every push, and a publish workflow whose `npm test` still runs on every pull request).
- **Fixed after reading sample 7 (so not part of its measurement).** Quoted words in the comments of a TOML list were read as rule codes: `"EM",  # allow Exception("text")` listed `text` as ignored, and a commented-out `# "ANN"` was read as selected (two false alarms).
  A ruff ignore added in the same change that raises `requires-python`, `target-version` or the pinned ruff version (it has to be in both versions of the file, and higher in the new one) is not reported, because the bump brings those rules (four). `deno task test`, `just test`, `rake test`, `composer test`, `mix test`, `sbt test`,
  `./gradlew test`, `node --test` and a project's own test script run through an interpreter or by path (`python scripts/run_tests.py`, `./scripts/test.sh`) are test steps (two). `fit(` and `fdescribe(` are focused tests only with a title written as a string,
  not a call such as `fit(line, width)` (one). A tolerance that moved is not a new one: a step is not reported as made easier to pass when the same commands were already inside a job or step allowed to fail and the places allowed to fail did not grow (one).
  The price: a ruff ignore that rides along with an upgrade is not reported, and neither is a test step removed while another workflow runs the same command in the same directory.
- **Measured.** A seventh sample (40 repositories, 12,000 commits) was replayed with the published 0.19.0, 0.18.0 and the build frozen before any block was read; the recorded blocks of all seven samples (394 commits) were reviewed again with this version: 195 are blocked, 162 for a reviewer and 33 false alarms; 14 that 0.19.0 blocks are not (12 false alarms, and two older blocks sorted "for a reviewer" whose tests run in another workflow), and one is new (a real one).
  The 11,684 commits of the samples, the agent corpus and the 24 repositories of section 6 that touch a CI file or a Python lint or type configuration, reviewed with both builds where the analyses differ: 16 commits lose findings (the kinds above and two older blocks), 2 gain one (a deleted workflow that ran sanity tests, a real one; a loop over test files replaced by a script whose name does not say that it runs tests, a false alarm).
  Labeled cases: 152 of 152 cheats caught, 136 of 136 look-alikes left alone, 1 gap open; 1,444 tests. The price: a ruff ignore that comes with a version bump is not reported, a test step is not reported as removed while another workflow runs the same command in the same directory, and five false alarms of sample 7 are not fixed
  (an existence check rewritten after a refactor, three; tests that moved with the code into a package another workflow tests; a configuration that is stricter overall).

## 0.19.0 — 2026-11-12

**Fewer false alarms, and a defect that blocked every commit of a repository.**

The false alarms that 0.18.0 still had on sample 4 are fixed, and two more samples of 40 public JavaScript, TypeScript and Python repositories
that no earlier measurement had used were replayed (`benchmarks/fifth-corpus.tsv`, `sixth-corpus.tsv`). 0.18.0 blocked 33 of the 11,630
commits of the fifth, 9 of them false alarms (27%), and 24 a change that a reviewer should see. The build of this version that was frozen before the
sixth sample was drawn blocked 100 of its 11,335 commits, in 19 of 40 repositories: 34 for a reviewer and 66 false alarms, 52 of them in one
repository, where one defect (since 0.15.0: the elements of `[[tool.mypy.overrides]]` read as one table) blocked 51 commits that had nothing to do with
mypy. That defect and four smaller ones that reading the sample showed are fixed in this version; on the 100 blocked commits the released build blocks 44,
the 34 and 10 false alarms. On the same sample 0.18.0 blocks 102 commits, 34 for a reviewer and 68 false alarms. `docs/benchmarks.md` section 10 has the tables, what is still wrong and the limits.

- **A `test.skip(true, ...)` that an `if` decides at run time is a conditional skip.** `if (!isAdmin) { test.skip(true, "needs an admin") }` asks
  the environment before it skips, which is what `test.skip(isAdmin, ...)` does in one call, and the literal `true` hid that. The same goes
  for `fixme` and `fail`, and for a guard that is an `else`, a `case`, a `catch` or a `cond &&` in front of the call. A condition that mentions
  CI, or is plainly true (`if (true)`), still hides the test and is reported, and so is a skip written straight into a test, a hook or a
  `describe`. The price: an agent that wraps a skip in an `if` it controls is not stopped by this rule.
- **A registration that a formatter wrapped after its opening bracket still has a title.** `test.fixme(` with `"title",` on the next line, and
  `it.todo(` with a title and nothing else, are read like their one-line forms, so the test behind a marker is found and a marker that was
  already there is not blamed on a new one. A `todo` that carries the title of a test the change adds is a new placeholder, not a test switched off.
- **A workflow's triggers are read from its `on:` section,** where a Docker step's `push: true` used to count as a push trigger and made a deleted
  manual workflow look like lost tests; and a `push:` that lists only `tags:` is a release pipeline that runs when a version is tagged, so it
  gates nothing. In a workflow that runs only on a schedule, a release, a tag, a manual dispatch or after another workflow, a step or job that
  is switched off or allowed to fail is reported only when it runs tests. The price: a gate-like job there that does not run tests is not
  reported any more (five commits that were sorted "for a reviewer" in the earlier samples: four in workflows that gate nothing, and a Coveralls
  "finish" step).
- **A step that only uploads, signs in, publishes or comments is not a check in any workflow.** `continue-on-error: true` or `if: false` on a
  single step that uses `actions/upload-artifact`, `download-artifact`, `cache`, `docker/login-action`, `docker/build-push-action`, `azure/login`,
  `aws-actions/configure-aws-credentials`, `softprops/action-gh-release`, `codecov/codecov-action`, `coverallsapp/github-action`, `peter-evans/*`
  or another action on a short list (`NON_CHECK_ACTION`) and runs nothing is not reported. An action that is not on the list, and every `run:`
  step, still is, because it may be the check.
- **More test runners are known to CI,** `python -m unittest`, `python -m pytest`, `nosetests`, `playwright test`, `cypress run`,
  `karma start`, `hatch test` and `swift test`, so `npm test` replaced by `python3 -m unittest` is not "the test step was removed"; and the
  shell builtin `test -f summary.md`, which has the word on the line, is not a test run (`test -f out.md && cat out.md >> "$GITHUB_STEP_SUMMARY" || true`
  was read as a test command that can no longer fail).
- **Mocks, read more narrowly.** A function that a call in the test wraps again (`install()`, `wrap_model()`, `instrument()`) is not what the
  assertion reads back; a mock that another test, or a hook of another `describe`, configures does not fake what this test calls; and an
  assertion on a mock's output in a test that also asserts on something else is a redundant check, not a test that cannot fail.
- **Assertions, read more carefully.** `self.assertTrue(x is not None)` written as `assert x is not None` is the same check in another style,
  and `expect(wrapper.find(".menu").exists()).toBe(true)` written as `expect(document.querySelector(".menu")).not.toBeNull()` (or
  `toBeTruthy()` or `toBeInTheDocument()`) still says the element is there.

- **Fixed, found by reading sample 6 (so not part of its measurement):** the elements of `[[tool.mypy.overrides]]` are tables of their own, named
  by their `module`: `check_untyped_defs = false` for `tests.*` next to `true` for another module was read as one switch turned off, on every commit that
  touched `pyproject.toml` (51 of the 52 blocked commits of one repository); a comment at the end of a CI line is not part of the command (`run: exit 0 # Skip
  unnecessary test runs for bots` was a test step, and two deleted security-scan workflows were "tests removed"); `yarn coverage` and `npm run coverage`
  are test steps; `@test.expectedFailure` is the marker that `@unittest.expectedFailure` is, under another module's name, so a test rewritten from one
  to pytest's `xfail` is not a new marker; and a mock factory whose parameter has no brackets, `async original => ({ ...await original(), ... })`, keeps
  the real module like the one with brackets.
- **Measured.** Sample 5 was replayed with 0.18.0 and with the build that had the fixes from sample 4: the same 33 commits, so those nine fixes changed
  nothing on a sample they were not made from. The recorded blocks of the first five samples (162 commits that 0.18.0 flagged) were reviewed again with
  the released build: 55 findings are gone and none is new, and 29 commits are no longer blocked: 24 false alarms and five that were sorted "for a reviewer" when they were read. On the 24 repositories of section 6 (7,200 commits), 21 commits block where 0.18.0 blocked 25, and the four findings that are gone are
  steps that post a lint comment, upload release assets, attest and publish a package. On the 9,761 commits of section 7, the CI rules differ on three
  commits (three findings gone, in release workflows whose trigger was a tag push or that belonged to a deleted package, and one new: a deleted workflow
  that ran `python -m unittest`, a runner that is known now) and the test rules on four commits that lose eight findings and gain none (five skips under a run-time `if`, a mock next to a real assertion, a mock factory without brackets). The price: five commits that were sorted "for a reviewer" in
  the earlier samples are silent now (four are steps in workflows that gate nothing, one is a Coveralls "finish" step), a test step removed from a
  workflow that runs only when a version is tagged is not reported, and a `test.skip(true, ...)` that an `if` of the agent's own decides is not.

## 0.18.0 — 2026-11-12

**Fewer false alarms: what 0.17.0 blocked on repositories that no earlier measurement had used.**

0.17.0 was replayed on the newest 300 commits of 40 public JavaScript, TypeScript and Python repositories that none of the earlier corpora
contained (`benchmarks/unseen-corpus.tsv`). It blocked 74 of the 11,604 commits, in 23 of the 40 repositories, and a single Rust repository
had 32 of them. Each was read in its source: 51 were not a weaker check, and what could be fixed is fixed here, so the same replay blocks 27
commits in 17 repositories. Two more samples were replayed with the builds in between, and a fourth was drawn after this version was frozen:
it blocked 41 of 10,726 commits in 18 of 40 repositories, where 0.17.0 blocks 65 (45 of them false alarms). Of the 41, 20 are a check that got weaker, a gate that was
relaxed or a test that was switched off, and 21 are false alarms (nine of them in one repository, six kinds in all, none of them fixed here).
`docs/benchmarks.md` section 9 has the tables, the false alarms that are left and the limits.

- **Changed: a skip, ignore or expected-failure marker counts only on a test that was already there.** `test-skip` reported any skipped
  test that a change introduced; a test the same change adds, already skipped, is no longer reported, and a new file is all new tests.
  Most of those were not a check that got weaker: 28 of the 32 blocked commits of the Rust repository added an integration test marked
  `#[ignore = "requires /dev/kvm"]` or another VM or root requirement; of the 42 commits that a skip blocked among the 9,761 commits of the
  last measurement, 20 are not blocked any more, because the skipped tests are new (a Playwright test that needs `TEST_USERNAME`, an
  integration test that needs a database, a parity case deferred to a later spec). A skip on a test that was running is reported as before.
  The test behind a marker is found in Python, JavaScript and TypeScript, Rust (the `fn` below the attribute) and Go (the `func Test...`
  around `t.Skip()`); the other languages keep comparing counts. A `test.skip(true, "reason")` or `test.fail(true, "reason")` inside a test
  body belongs to the test around it, when that test's title is on the line that registers it. The price: an agent that writes a new test
  and skips it because it cannot make it pass is not stopped by this rule.
- **Assertions are read more carefully.** The brackets around a whole Python assertion or around its message are a formatter's choice, and
  `assert m[0, 1] == 3.0` is an exact check rather than a bare name followed by a message (which also made an exact check on such a table,
  turned into a bare subscript, invisible). A quote or a bracket inside a regular expression literal no longer swallows the lines after a
  multi-line assertion, which used to compare them with whatever stood there before. `rejects.toThrow(/a/)` turned into
  `rejects.not.toThrow(/b/)` says the error must not match, and is not the weak form of a throw. A threshold counts only against a number:
  `toBeGreaterThan(before.height)` to `toBeGreaterThan(0)` after the subtraction moved, and an `in` test turned into `> 0`, are other checks.
  A compound Python assertion (`a == x and b <= c`) is not read as one comparison. `toBeUndefined()` is no longer a weaker form of an exact
  check: `toEqual(x)` turned into it says the property is gone, which is the opposite expectation, not a looser one (`.not.toBeUndefined()`
  still is). A bound that rejects the value the old check pinned (`toBe(2)` to `toBeGreaterThan(2)` or `toBeGreaterThanOrEqual(3)`,
  `assert n == 16` to `assert n > 16`) is another expectation, not a looser one. The price: an exact count that was changed and turned into
  a minimum at the same time (`== 13` to `>= 14`) is no longer reported.
- **A method called `fit()` or `xit()` is not a test.** With nothing between the brackets it is a method of a test double, such as a terminal
  addon's `fit`; `expect(fit({ x: 1 }))`, `await fit("okapi")` and `const v = fit(a)` call a helper that has that name.
- **Fewer false `trivial-assert` reports on mocks.** A mock factory that is handed the real module's loader keeps the real module, whatever
  the parameter is called: `vi.mock("./client", async (original) => ({ ...(await original()), send: vi.fn() }))`. A Python patch counts
  only while it is in force (a fixture, a decorator, a `with` header on one or several lines, `.start()`, `enter_context`), not a patcher that
  is only assigned; and not when the code under test may rewire the patched object afterwards (it is handed to another call, or another
  method of it runs after the patch).
- **`nx`, `turbo`, `lerna`, `rush` and `bazel test` count as test steps,** so tests that moved to a monorepo runner in another workflow are not
  reported as removed.
- **Measured** on four samples of 39 to 40 repositories (158 repositories, 44,878 commits; `benchmarks/unseen-corpus.tsv`,
  `heldout-corpus.tsv`, `third-corpus.tsv`, `fourth-corpus.tsv` with the revisions measured). Each sample was read blocked commit by blocked
  commit, which is where every fix above comes from, so the figures of the first three samples after the fixes are fitted; only the first
  figure of each sample, and the fourth sample, are out of sample. On the 24 repositories of section 6, 25 commits block where 0.17.0 blocked
  30, with no weaker check lost. On the 9,761 commits of section 7, the new build blocks 86 commits where 0.17.0 blocked 107, 20 of them
  skips on tests that the commit adds; one finding that a reader would keep is gone (`== 13` to `>= 14`).
- Labeled cases: 131 cheats caught, 110 look-alikes left alone, 1 gap open (it was 126, 90 and 1); 20 of the 25 new cases fail on 0.17.0.

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
