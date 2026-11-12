# Rules

Every rule answers one question: **did this change make the checks easier to pass, instead of making the code correct?**
Run `npx agent-roast explain <rule>` for the same text in the terminal.

Rules come in two groups. The **before/after rules** compare the full text of a changed file with its previous version, so
they see what a linter cannot: an assertion that got weaker, a test that vanished, a gate that was lowered. The **line
patterns** look at a single file and are compared with the previous version too, so old debt never blocks a new change.

| Rule | Group | Blocks by default | Languages |
| --- | --- | :-: | --- |
| [`assertion-weakened`](#assertion-weakened) | before/after | yes | JavaScript/TypeScript, Python |
| [`guard-weakened`](#guard-weakened) | before/after | yes | config and CI files |
| [`test-skip`](#test-skip) | line pattern | yes | JS/TS, Python, Go, Rust, Java, Kotlin, C#, Ruby, PHP, Swift |
| [`test-focus`](#test-focus) | line pattern | yes | JS/TS, Ruby |
| [`trivial-assert`](#trivial-assert) | line pattern | yes | JS/TS, Python, Go, Rust, Java, Kotlin, C#, Ruby, PHP, Swift |
| [`assertion-removed`](#assertion-removed) | before/after | warns | JavaScript/TypeScript, Python, Go |
| [`test-removed`](#test-removed) | before/after | warns | JavaScript/TypeScript, Python, Go |
| [`expectation-rewritten`](#expectation-rewritten) | before/after | warns | JavaScript/TypeScript, Python, Go |
| [`swallowed-error`](#swallowed-error) | line pattern | warns | JS/TS, Java, Kotlin, C#, PHP, C/C++ (`catch {}`), Python (`except: pass`) |
| [`type-escape`](#type-escape) | line pattern | warns | TypeScript, Python, ESLint directives |
| [`stub-abandonment`](#stub-abandonment) | line pattern | warns | JS/TS, Python, Rust |

"Blocks" means the check exits with status 1. Change that with `failOn` in `.agentroastrc.json`, `--fail-on <rules>`, or
`--advisory` (report everything, fail on nothing). A rule can also be set to `warn` or `off` under `rules`. See the
[reference](reference.md#configuration).

---

## assertion-weakened

An exact check was replaced by a weaker one. The test stays green and verifies far less.

```ts
- expect(total).toBe(42);
+ expect(total).toBeDefined();
```
```python
- assert response.status_code == 200
+ assert response
```

Recognized weaker forms: in JavaScript/TypeScript `toBeDefined`, `toBeTruthy`, `toBeFalsy`, `toBeUndefined`,
`.not.toBeNull()`, `.not.toBeUndefined()`, `.not.toThrow()`, `toBeGreaterThanOrEqual(0)`, `toBeGreaterThan(0)` and
`toBeGreaterThanOrEqual(1)` where an exact value or count stood, `toHaveBeenCalled()` where `toHaveBeenCalledWith(...)` or
`toHaveBeenCalledTimes(n)` stood, `toEqual(expect.anything())` or `expect.any(Type)` where a value stood, and a
`toThrow("message")` or `toThrow(SomeError)` that lost its argument (or became `toThrow(Error)`); in Python a bare
`assert value`, `is not None`, `assert True`, `assert len(x) > 0` where `== 3` stood, `pytest.raises(ValueError)` broadened to
`Exception`, a `match=` dropped from `pytest.raises`, and `assertRaisesRegex` relaxed to `assertRaises`. An exact check turned
into a bound is not reported when the old check expected nothing (`toHaveLength(0)` to `toBeGreaterThan(0)` is a flipped
expectation, not a looser one). Reformatting, renaming, moving an assertion into a helper, parametrizing a test and folding
several checks into one snapshot are not reported.

**An exact check relaxed on the same expression.** When the checked expression stays the same and only the matcher changes, three more
forms are reported: a number or count turned into a bound (`toBe(2)` to `toBeGreaterThanOrEqual(2)`, `toHaveLength(3)` to
`toBeGreaterThan(1)`, `assert len(x) == 3` to `assert len(x) >= 3`, `assert handler.level == WARNING` to `> CRITICAL`, Node's
`assert.equal(x.length, 3)` to `assert.ok(x.length > 0)`); a set or value equality turned into a subset or range
(`assert set(a) == set(b)` to `assert set(a) <= set(b)`); and `toEqual(X)` or `toStrictEqual(X)` turned into `toMatchObject(X)` with the
very same argument, which lets extra properties through. "The same expression" is what makes these safe to report: `expect(items)` and
`expect(items.length)` count as one, another expression is another check, and a `toMatchObject` that was given more fields than the
`toEqual` it replaces is not the same argument. A check that expected nothing (zero, empty, `None`) was flipped, not relaxed. Left alone as other checks, not looser ones: a negated check with an argument (`rejects.toThrow(/a/)` turned into `rejects.not.toThrow(/b/)` says
the error must not match), a limit that moves against another expression (`toBeGreaterThan(before.height)` turned into `toBeGreaterThan(0)` after the
subtraction moved, or an `in` test turned into `> 0`: only a numeric limit that was lowered counts), a compound Python assertion (`a == x and b <= c`
holds more than one check), and brackets around a whole Python assertion (formatters add and drop them). A multi-index subscript such as
`matrix[0, 1] == 3.0` is an exact check, not a bare name followed by a message. The pair is
found even when other assertions were added to or removed from the same test, by the expression it checks and only where the old
assertion stood. Nothing is reported when the exact assertion is still somewhere in the file (it moved), or when the assertion that took its
place still checks the same expression exactly with another value (`assert.equal(calls, 3)` became `assert.equal(calls, after)`, next to a
new `assert.ok(calls > before)`: a changed expectation, not a looser check). A test whose title was changed in the same commit is a new
scenario and is not compared.
**Fix:** restore the exact check, or assert the specific value the code should produce.

## guard-weakened

A gate that decides whether bad code can pass was made easier to pass.

```diff
- coverage: { thresholds: { lines: 90 } }
+ coverage: { thresholds: { lines: 50 } }
```
```diff
-   "strict": true
+   "strict": false
```
```diff
    - name: Run tests
+     continue-on-error: true
      run: npm test
```

Watched files: `package.json`, `tsconfig*.json`, `jest`/`vitest`/`vite` config, ESLint config, `pyproject.toml`,
`setup.cfg`, `pytest.ini`, `tox.ini`, `ruff.toml`, `.flake8`, `mypy.ini`, `.pylintrc`, `.coveragerc`, `codecov.yml`,
`.gitlab-ci.yml` and `.github/workflows/*.yml`. Covered:
a lower coverage threshold (`lines`, `branches`, `functions`, `statements`, `fail_under`, `--cov-fail-under`), a compiler
strictness switch turned off, a lint rule downgraded, a CI step allowed to fail (`continue-on-error`, `allow_failure`), a
workflow that stops running tests or stops running on pushes and pull requests, an npm `test` script that can no longer
fail, and pytest's `xfail_strict` switched from true to false (tests marked xfail then pass whether or not they fail).
Raising a threshold, restructuring CI and moving the test step are not reported. A test step is a known runner (`pytest`, `vitest`, `jest`,
`npm test`, `go test`, `cargo test`, `make test`, ...) or a monorepo runner (`nx affected --target=test`, `turbo run test`, `lerna run test`,
`bazel test`).

More shortcuts of the same kind:

- **A test command that cannot fail in CI.** `npm test || true`, `pytest; exit 0` and `pytest || echo "tests failed"` end the
  step with success whatever the tests did, which is `continue-on-error` written in shell. A step or job switched off with
  `if: false` (or `if: ${{ false }}`) is reported when it existed before. Only a runner line counts: `npm cache clean || true`
  is fine, and so is a step that was already written that way.
- **An npm script that always says yes.** The `test`, `lint`, `typecheck`, `check`, `ci`, `verify` and `validate` scripts (and
  their `test:unit`-style and `pre`/`post` variants) turned into `echo ...`, `true`, `exit 0`, `:` or `... || true`.
  `--passWithNoTests` added to a test script counts too. A `build` script is not a gate and is not read.
- **One compiler check switched off under `strict`.** `"noImplicitAny": false` (or another switch) added to a `tsconfig.json` that
  has `"strict": true`. A `strict` that is simply deleted is not reported: TypeScript 6 turns it on by default.
- **Lint and type-checker settings** (the Python twin of the tsconfig and ESLint checks). ruff, flake8, pylint and mypy are
  compared between the two versions of their config (`pyproject.toml`, `ruff.toml`, `setup.cfg`, `tox.ini`, `.flake8`,
  `mypy.ini`, `.pylintrc`): codes added to `ignore`, `extend-ignore`, `per-file-ignores` (ruff and flake8), `disable` (pylint) or
  `disable_error_code` (mypy); codes dropped from `select` unless a shorter prefix still covers them; a mypy strictness switch
  (`strict`, `disallow_untyped_defs`, `check_untyped_defs`, `warn_return_any`, ...) turned from true to false;
  `ignore_errors = true` added for a module; a pylint `fail-under` lowered. A tool that was not configured before is being
  adopted, and its first ignore list is not reported; a stricter setting, a code removed from an ignore list and a reordered
  list are not reported either. `ignore_missing_imports` and numeric limits such as `max-line-length` are not read.

The same rule covers a test harness that rewrites what the runner reports. In `conftest.py`, `sitecustomize.py` and test files,
`report.outcome = "passed"` (any object, outcome set to the string `passed`), `call.excinfo = None` and `session.exitstatus = 0`
(or `pytest.ExitCode.OK`) are reported: nothing else in a test run has a reason to say a failure passed. A pytest plugin outside
those files is not read, and `report.outcome = "rerun"` or a comparison such as `report.outcome == "passed"` is fine.
**Fix:** keep the gate and fix the failure. If the change is deliberate, record why and when it comes back.

## test-skip

A test was switched off. The runner reports success without executing the behavior.

| Language | Reported |
| --- | --- |
| JavaScript/TypeScript | `it.skip`, `describe.skip`, `xit`, `xdescribe`, `test.todo`, Playwright `test.skip(true)` or with only a title; tests expected to fail: `it.fails` (Vitest), `test.failing` (Jest, AVA), Playwright `test.fixme` and `test.fail` |
| Python | `@pytest.mark.skip`, `@unittest.skip`, a bare `pytest.skip()` or `self.skipTest()` in a test; tests expected to fail: `@pytest.mark.xfail`, `pytest.xfail()`, `@unittest.expectedFailure`; `pytestmark = pytest.mark.skip` for a whole module and `marks=pytest.mark.xfail` on one parametrized case |
| Go | `t.Skip`, `t.Skipf`, `t.SkipNow` as a statement of a test or sub-test |
| Rust | `#[ignore]`, `#[ignore = "reason"]` |
| Java, Kotlin | `@Ignore`, `@Disabled`, `@Test(enabled = false)` |
| C# | `[Ignore]` next to a test attribute (NUnit, MSTest), `[Fact(Skip = "...")]`, `[Theory(Skip = "...")]` |
| Ruby | `xit`, `xdescribe`, `skip`, `pending`, `skip: true`, `:skip => true`, `skip: "reason"` |
| PHP | `$this->markTestSkipped()`, `markTestIncomplete()` |
| Swift | `throw XCTSkip(...)`, `@Test(.disabled())`, `@Test(.disabled("reason"))` |

A test expected to fail is reported because a failure that is expected cannot fail the run: an agent that cannot fix a test marks it
`xfail` and the suite is green. The conditional forms are exempt exactly like conditional skips:
`@pytest.mark.xfail(sys.platform == "win32", reason="paths")` (also with the condition on its own line or as `condition=`) and
`test.fixme(browserName === "webkit", "...")` expect the failure only where the condition holds. A bare marker, `reason=`,
`strict=` or `raises=` alone, a literal `True` and a condition that mentions CI are reported. A marker that is only built
(`skip_slow = pytest.mark.skip(...)`, the pytest documentation's `--runslow` pattern) or attached through `add_marker` is not.
In the review (the hook, `review`, the Action) a skip, an ignore or an expected-failure marker only counts on a test that **was already
there**. A test the same change adds is not a check that got weaker: it documents a bug its author knows about (in 24 repositories, 15
commits wrote a new test with `xfail`), it needs a server, a device or a database and is run on purpose (Rust's
`#[ignore = "requires KVM"]`, `@pytest.mark.skip(reason="needs a model on localhost")`), or it is a case deferred to a later change.
Of the 74 commits that 0.17.0 blocked in 40 repositories that nobody had tuned on, 32 were such a skip on a test the commit adds
([benchmarks, section 9](benchmarks.md#9-repositories-nobody-had-tuned-on)). The test behind a marker is found by its name or title
(Python, JavaScript and TypeScript), by the `fn` below the attribute (Rust) and by the `func Test...` around `t.Skip()` (Go); a file that is
new has only new tests. In the other languages a marker counts when the file has more of them than before. The comparison is per test, so a
file with many identical `@pytest.mark.xfail(` lines is read correctly. The price: an agent that writes a new test and skips it because it
cannot make it pass is not stopped by this rule, while the same marker on a test that was running is. Two gaps are known: a
`test.skip(true, "needs admin")` inside an `if` that checks the environment is reported, because the literal hides the condition, and a
`test.fixme(` whose title is on the next line is compared by count, which can blame a marker that was already there.
A skip that depends on the environment is **not** reported, because those are overwhelmingly platform or service gates:
`if testing.Short() { t.Skip() }`, `if not has_gpu(): pytest.skip(...)`, `test.skip(browserName === "webkit", ...)`,
`@DisabledOnOs`, `skip "no redis" unless redis_available?`, a skip inside a fixture or helper. The same goes for Swift
`#if os(Windows)` around a `throw XCTSkip(...)` and `@Test(.disabled(if: condition))`, a Ruby `it "...", :skip => !feature?`, and
xUnit `Skip = "..."` together with `SkipUnless`, `SkipWhen` or `SkipType`. A C# `[Ignore]` that is not next to a test attribute
(AutoMapper and Json.NET use it on properties) is not a skip. A skip whose condition mentions
`CI`, or one that names a test or stands alone in a test body, is reported. The price of that trade-off: a conditional skip
that hides a real failure is missed unless its condition mentions `CI`.
**Fix:** re-enable the test and fix its failure. If the skip is intentional, say why and when it ends.

## test-focus

An exclusive test or suite narrows the run, so the rest of the suite is never executed while the focused tests pass.
`it.only`, `describe.only`, `test.only`, `fit`, `fdescribe` (JavaScript/TypeScript); `fit`, `fdescribe`, `focus: true` (Ruby). A method that happens
to be called `fit()` or `xit()`, with nothing between the brackets (a terminal addon's `fit` in a test double), is not a registration.
**Fix:** remove the focus and run the whole suite. Turn on your runner's forbid-only option in CI as well
([Playwright](https://playwright.dev/docs/api/class-testconfig#test-config-forbid-only), Jest, Vitest).

## trivial-assert

An assertion that compares a constant with itself cannot fail, so it adds the look of a check without checking anything.

```ts
expect(true).toBe(true);
```
```go
assert.True(t, true)
```

Reported in JavaScript/TypeScript, Python, Go, Rust (`assert!(true)`), Java and Kotlin (`assertTrue(true)`,
`assertEquals(1, 1)`), C#, Ruby, PHP and Swift. **Fix:** call the real behavior and assert its output or side effect.

**A test that checks its own mock.** The same rule reports a test that replaces the function it checks with a mock and then
asserts on what the mock returns. That cannot fail whatever the real code does:

```ts
jest.mock("./price", () => ({ price: () => 42 }));   // the module under test, replaced
it("totals", () => { expect(price(cart)).toBe(42); }); // checks the mock
```
```python
def test_total(monkeypatch):
    monkeypatch.setattr(pricing, "price", lambda cart: 42)
    assert pricing.price(CART) == 42
```

Read in one test file, in JavaScript/TypeScript (`jest.mock` and `vi.mock` at the top level of the file, against the file's imports
and `expect(...)`, also through `const total = price(cart); expect(total)`) and in Python (`patch`, `patch.object`,
`mocker.patch` and `monkeypatch.setattr`, against the `assert`s of the same test or `with` block). It is reported only when the
change introduces it. Left alone: mocking a *dependency* of the code under test and asserting the code under test, a mock that
keeps the real module (`requireActual`, `importActual`, `wraps=`, or a factory that is handed the real module's loader and calls it,
under whatever name: `vi.mock("./client", async (original) => ({ ...(await original()), send: vi.fn() }))`), an automock nobody gave a return value (a manual mock decides),
`doMock` and mocks made inside a hook or a `describe` (they come after the import was loaded), an assertion about how a mock was
called, a bare imported name in Python (a patch of the module attribute does not change it), and test files whose path mentions
`mock` or `monkeypatch` (the tests of the mocking tools themselves). On 21,686 test files of 24 public repositories the only
matches were the tests of jest, vitest and pytest's `monkeypatch`, plus one sanity precondition in scikit-learn.

## assertion-removed

A test keeps its name but loses assertions. Often the behavior changed on purpose; sometimes a check was dropped to get the
suite green. **Fix:** confirm the removed checks no longer apply, or restore them, and say so in the pull request.

## test-removed

A test (or a whole test file) disappeared and no identical body appears elsewhere in the same change, so it is not a rename or
a move. Removal is right when the feature itself is gone. **Fix:** confirm that, or restore the test and fix the code.

## expectation-rewritten

An expected value changed while the test inputs stayed the same, and production code changed in the same review. That is the
shape of "adjust the test to the new output" instead of correcting the output. **Fix:** check the new expectation against the
requirement, not against what the program prints now.

## swallowed-error

An empty handler (`catch {}`, `except: pass`) makes a failed operation look successful and hides diagnostics.
**Fix:** handle the expected error, return an observable failure, or rethrow. Document a deliberate best-effort operation.

## type-escape

A suppression hides a type, lint or coverage problem: `as any`, `as unknown as`, `// @ts-ignore`, `// @ts-nocheck`,
`// @ts-expect-error`, `eslint-disable`, `biome-ignore`, `# type: ignore`, `# noqa`, `# pylint: disable`, `# pyright: ignore`,
`# mypy: ignore-errors`, `# flake8: noqa` and `# ruff: noqa`. Coverage exclusions count too: `# pragma: no cover` and
`# pragma: no branch` in Python, `istanbul ignore`, `c8 ignore`, `v8 ignore` and `node:coverage ignore` in JavaScript and
TypeScript, as line or block comments. A line a coverage threshold never sees is a way to pass the threshold without testing the
code; the closing `c8 ignore stop` of a region is not counted again. Some are justified (a defensive branch, generated code),
which is why the rule only warns by default.
**Fix:** narrow or validate the value at the boundary; test the excluded code; keep a suppression only with a reason and the
smallest scope.

## stub-abandonment

A placeholder that throws when a caller reaches it: `throw new Error("Not implemented")`, `raise NotImplementedError`, Rust
`todo!()` and `unimplemented!()`. Abstract methods may be intentional. **Fix:** implement the path or make the unsupported
state explicit.

---

## What no rule sees

These gaps are documented in [`benchmarks/cases.mjs`](../benchmarks/cases.mjs) rather than hidden:

- a module under test mocked in a way the file alone does not show (a helper that sets the mock up, `doMock` with a dynamic import,
  a patch of the name in the test's own namespace);
- a pytest hook in `conftest.py` that deselects or skips tests wholesale (`pytest_collection_modifyitems`): the pytest
  documentation's own `--runslow` example is the same code, so only the hooks that rewrite a result are reported;
- `pytestmark = [pytest.mark.slow, pytest.mark.skip]`, where the skip is not the first marker of the list;
- an implementation that hardcodes the tested value;
- an assertion made vacuous by a custom matcher that always passes (`expect.extend({ toBeValid: () => ({ pass: true }) })`);
- tests that stop running because a runner option excludes them (`testPathIgnorePatterns`, vitest `exclude`, pytest `--ignore`
  or `-k "not ..."` in `addopts` or in a CI command, a longer coverage `omit` list): the CI check sees a removed test step, but
  not a narrowed one;
- a failing assertion that is moved after an early `return`, wrapped in `if (false)`, or left without `await`, and
  `assert x or True`;
- a check relaxed to a range when the test was also renamed or the expected value changed in the same commit (`toBe(200)` to
  `toBeLessThan(500)` on the same expression is reported; a renamed test is read as a new scenario and not compared), and a range
  that is wider than the exact value but written in a form this rule does not read (`expect(res.status >= 400).toBe(true)`);
- a lint rule switched off in an ESLint config that never mentioned it (it may come from a preset), a longer `omit` list, a test
  script whose runner was swapped for another command, a raised timeout or a retry count, an updated snapshot;
- suppressions in the languages without a comment directive table: Go `//nolint`, Rust `#![allow(warnings)]`, Java
  `@SuppressWarnings("all")`;
- before/after rules for languages other than JavaScript/TypeScript, Python and Go, and `assertion-weakened` for Go (skips and
  placeholder assertions are covered for ten languages, but a weakened assertion in Java or Rust is not);
- anything the agent does before it commits that the next review does not see, such as a weakened check that is fixed again.

agent-roast reads text, not program meaning. A clean report is not a certificate of quality.
