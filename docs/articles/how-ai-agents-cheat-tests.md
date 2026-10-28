# Review coding shortcuts before a green build hides them

*By Nariman Abdukarimov ([@Nari-Ab](https://github.com/Nari-Ab))*

A passing test run tells you that the tests which executed passed. It does not tell
you whether a change disabled a relevant test, narrowed the run, or removed error
handling. These patterns can occur in code written by people or AI. A finding does
not establish authorship, intent, or whether an exception is justified.

The examples below are illustrative, not measured customer incidents or a ranking
of the most common problems.

## Disabled or focused tests

```typescript
it.skip("rejects an expired session", async () => { /* ... */ });
test.only("sign in", async () => { /* ... */ });
```

The first test does not execute; the second can limit which tests execute.
`agent-roast` reports common skip syntax and, since 0.7.0, focused JS/TS test APIs.
Custom aliases and computed properties are outside the current heuristic's scope.
Use the runner's own protections too, for example
[Playwright's forbidOnly setting](https://playwright.dev/docs/api/class-testconfig#test-config-forbid-only).
Intentional conditional skips should have a specific reason and a review plan.

## Assertions which do not test behavior

```typescript
expect(true).toBe(true);
```

Comparing a constant to itself cannot detect a behavioral regression. Prefer an
assertion about the actual result, such as `expect(canSignIn(user)).toBe(true)`.
This is one narrow pattern; the tool cannot prove that an arbitrary test is useful
or that its assertions cover the requirement.

## Compiler and linter suppressions

```typescript
const user = response.data as any;
// @ts-ignore
useUser(user);
```

Suppressions can be legitimate, especially at compatibility boundaries. Review
whether the value can be narrowed or validated and whether the suppression is as
small as possible. `type-escape` is advisory by default; a warning is not proof of
an unsafe value and removing every suppression automatically would be harmful.

## Empty error handlers and unfinished paths

```typescript
try { save(); } catch (error) {
  // The only report(error) call was deleted.
}
```

A scan of added diff lines can miss this change. Context review compares the full
versions of changed source files and can detect a newly empty handler even when
only a line was deleted. An intentional best-effort operation may still be a valid
exception; review the expected behavior. Obvious `Not implemented` stubs are also
reported, but abstract contracts can be intentional.

## Use the right source for the question

```bash
# Current tracked and non-ignored untracked source, without AI attribution/history
npx agent-roast check

# Full changed-source comparison against a trusted base commit
npx agent-roast review --base origin/main

# Exactly the next commit: HEAD versus index, excluding unstaged repairs
npx agent-roast --staged
```

A Git repository is required; `git init` is enough for `check`. Context review keeps
existing findings separate, and only new configured blockers fail. Policy comes
from the trusted base; staged review uses HEAD policy or built-in defaults for an
initial commit. A reviewed baseline can help adopt `check` without blocking on
all historical debt. A baseline accepts debt; it does not fix it.

```bash
npx agent-roast init --ci --hook
```

This generates config, a read-only pull-request workflow and a local pre-commit
hook without overwriting existing files. Install the package as a dev dependency
for the hook's local `--no-install` invocation. Defaults block skipped tests,
focused tests and trivial assertions; type escapes and obvious stubs are advisory.

## Privacy and limits

The installed analyzer makes no source uploads or LLM calls, executes no project
code, and needs no API key. npm/npx installation can access the registry. JSON and
Markdown reports can contain source snippets; share them according to your source
policy. SARIF omits snippets; uploading it is a separate optional action.

These are heuristic checks with false positives and missed findings. They do not
replace compilers, language-aware linters, tests or human review. Complex syntax,
imports, custom aliases and template interpolation are not fully parsed. Scan limits
and incomplete results are explicit; an incomplete context scan exits 2. Runtime
depends on repository size and environment; there is no universal latency promise.

Historical audit and static badge generation remain available, but the history
score does not certify current code quality or developer performance. No usage,
retention or production accuracy measurements are claimed here.

- [Source and current documentation](https://github.com/Nari-Ab/agent-roast)
- [npm package](https://www.npmjs.com/package/agent-roast)
