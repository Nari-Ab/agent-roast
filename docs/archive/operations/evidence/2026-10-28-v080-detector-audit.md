# Detector and source-lexer audit for 0.8.0

Baseline examined: 0.7.0 / 179e980042346a0352cf7bb469fd67046b527182.
Modules examined in full: source.ts, metrics.ts, detector.ts, rules.ts and their
source/metrics/focus/detector regression tests. Changes are project-authored;
no third-party implementation was copied.

## Reproduced weaknesses and corrections

| 0.7.0 reproduction | Before | Correction |
| --- | --- | --- |
| `function recatch() {}` in TypeScript | False swallowed-error finding | Catch keyword boundaries and supported-language gate |
| `import typing as any` in Python | False TS type-escape finding | TS assertions scoped to TS-family sources |
| `myexcept: pass` in Python | False swallowed-error finding | Anchored Python exception header |
| `except Exception: pass; report(error)` | Real handling called an empty handler | Only pass-only suites qualify |
| `test . skip(...)` / `test.concurrent.skip(...)` / multiline chain | Missed skipped registration | Shared source-context test API matcher |
| `const skipped = test.skip;` / `const focused = test.only.each;` | Mere references could block | A supported call/tagged-table shape is required |
| `@unittest.skip(...)` / `self.skipTest(...)` | Missed Python skipped test | Explicit unittest APIs recognized |
| `todo!("implement auth")` in Rust | Missed placeholder with diagnostic arguments | Both zero-argument and formatted placeholder macros recognized |
| JS string with an escaped newline containing `it.skip` | Example on following line treated as executable code | Preserve explicit string continuation state |
| Rust raw strings / Java and Kotlin text blocks / C# verbatim strings / C++ raw strings | Multiline examples could be interpreted as code | Recognize literal delimiters, Rust lifetimes and nested comments |
| Stub example in a literal before real stub on same line | First raw match hid the actual code occurrence | Skip masked matches and find the first executable match |
| `throw new Error("stubborn failure")` | `stub` prefix falsely classified as unfinished code | Placeholder word boundaries |
| `expect(\ntrue\n) . toBe(true)` in a test | Missed formatted trivial assertion | Contiguous source-context assertion matching |
| `Devin Smith <devin@example.com>` / `Claude Dubois` | Human name classified as AI | Anchored agent labels and specific known addresses |
| Dependabot or github-actions identity | Arbitrary automation classified as AI | Generic bots no longer count as AI signals |
| Co-author example in message body | Example could classify commit as AI | Only final Git trailer block and explicit attribution lines |
| Long arithmetic line with repeated division | Quadratic regexp-context rescans | Bounded token suffix, whitespace normalization |

The old lexer took approximately 4.8/11/39.6ms for synthetic 10k/20k/40k
arithmetic lines in one local run. These measurements diagnosed growth only;
they are not production performance claims. The new regression test processes a
roughly 1MiB line with a generous 5-second ceiling and preserves every code offset.

## Verification

- Targeted source/metrics/focus/detector suites: 120 tests pass in four files.
- Source length, line numbers, literal/comment separation and hunk gaps have explicit
  controls. A Python floor-division suspicion was investigated and disproved; a
  regression control confirms it stays executable code.
- Existing metric fixture put Python `except: pass` in an api.ts file. It was moved
  to api.py; all three intended swallowed-error controls remain tested.
- Return shape for SourceMasker retains code/comments and adds two token-position
  arrays (real template and block-comment openers). Tagged `.each` calls and actual
  block eslint directives are distinguishable from examples in comments/literals.

## Remaining limitations

- This is a lexer and focused heuristics, not a language parser, compiler or import
  resolver. Custom aliases and computed members such as test['only'] remain outside
  detection. Same-named custom APIs may need explicit justified exceptions.
- Template interpolation expressions are deliberately not parsed. Arbitrary nested
  templates, JSX/HTML-language regions, and all language-specific literal forms are
  not guaranteed. Added-line legacy mode cannot infer context before a hunk.
- Conditional skip/skipIf/skipUnless/skipif expressions are not evaluated. The
  unconditional APIs are review signals, not proof a deliberate skip is wrong.
- Complex multiline Python exception headers and general tautologies are not fully
  parsed. Trivial assertions recognize a documented narrow constant set.
- AI attribution remains a fallible, user-controlled metadata signal. It does not
  establish authorship, wrongdoing, authorization or identity. Known explicit agent
  labels may themselves be reused by people. Current-code/context checks do not
  depend on AI attribution.
- Legacy history scoring caps retained findings per detector/commit and uses
  heuristic sample normalization; it is not a measure of current code safety.

## Primary API references checked

- https://jestjs.io/docs/api — skipped/focused modifier chains, aliases and tagged tables.
- https://docs.python.org/3/library/unittest.html#skipping-tests-and-expected-failures
  — unconditional skip decorator and TestCase.skipTest.
- https://main.vitest.dev/api/test — skip/only/todo/concurrent test options and aliases.
