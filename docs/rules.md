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
`.not.toBeNull()`, `.not.toBeUndefined()`, `.not.toThrow()` and `toBeGreaterThanOrEqual(0)`; in Python a bare `assert value`,
`is not None` and `assert True`. Reformatting, renaming, moving an assertion into a helper, parametrizing a test and folding
several checks into one snapshot are not reported.
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
`setup.cfg`, `pytest.ini`, `tox.ini`, `.coveragerc`, `codecov.yml`, `.gitlab-ci.yml` and `.github/workflows/*.yml`. Covered:
a lower coverage threshold (`lines`, `branches`, `functions`, `statements`, `fail_under`, `--cov-fail-under`), a compiler
strictness switch turned off, a lint rule downgraded, a CI step allowed to fail (`continue-on-error`, `allow_failure`), a
workflow that stops running tests or stops running on pushes and pull requests, and an npm `test` script that can no longer
fail. Raising a threshold, restructuring CI and moving the test step are not reported.
**Fix:** keep the gate and fix the failure. If the change is deliberate, record why and when it comes back.

## test-skip

A test was switched off. The runner reports success without executing the behavior.

| Language | Reported |
| --- | --- |
| JavaScript/TypeScript | `it.skip`, `describe.skip`, `xit`, `xdescribe`, `test.todo`, Playwright `test.skip(true)` or with only a title |
| Python | `@pytest.mark.skip`, `@unittest.skip`, a bare `pytest.skip()` or `self.skipTest()` in a test |
| Go | `t.Skip`, `t.Skipf`, `t.SkipNow` as a statement of a test or sub-test |
| Rust | `#[ignore]`, `#[ignore = "reason"]` |
| Java, Kotlin | `@Ignore`, `@Disabled`, `@Test(enabled = false)` |
| C# | `[Ignore]` next to a test attribute (NUnit, MSTest), `[Fact(Skip = "...")]`, `[Theory(Skip = "...")]` |
| Ruby | `xit`, `xdescribe`, `skip`, `pending`, `skip: true`, `:skip => true`, `skip: "reason"` |
| PHP | `$this->markTestSkipped()`, `markTestIncomplete()` |
| Swift | `throw XCTSkip(...)`, `@Test(.disabled())`, `@Test(.disabled("reason"))` |

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
`it.only`, `describe.only`, `test.only`, `fit`, `fdescribe` (JavaScript/TypeScript); `fit`, `fdescribe`, `focus: true` (Ruby).
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

A suppression hides a type or lint problem: `as any`, `as unknown as`, `// @ts-ignore`, `// @ts-nocheck`,
`// @ts-expect-error`, `eslint-disable`, `# type: ignore`, `# noqa`. Some are justified.
**Fix:** narrow or validate the value at the boundary; keep a suppression only with a reason and the smallest scope.

## stub-abandonment

A placeholder that throws when a caller reaches it: `throw new Error("Not implemented")`, `raise NotImplementedError`, Rust
`todo!()` and `unimplemented!()`. Abstract methods may be intentional. **Fix:** implement the path or make the unsupported
state explicit.

---

## What no rule sees

These gaps are documented in [`benchmarks/cases.mjs`](../benchmarks/cases.mjs) rather than hidden:

- a module that is mocked inside its own test;
- an implementation that hardcodes the tested value;
- an assertion made vacuous with a matcher such as `expect.anything()`;
- before/after rules for languages other than JavaScript/TypeScript, Python and Go, and `assertion-weakened` for Go (skips and
  placeholder assertions are covered for ten languages, but a weakened assertion in Java or Rust is not);
- anything the agent does before it commits that the next review does not see, such as a weakened check that is fixed again.

agent-roast reads text, not program meaning. A clean report is not a certificate of quality.
