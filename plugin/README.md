# agent-roast for Claude Code

When Claude is about to finish, this plugin reviews what it changed since `HEAD`. If a test, an assertion, a coverage
threshold, a lint rule or a CI step was made weaker instead of fixing the code, Claude is sent back once with the file, the
line and the before and after. If it tries again, you get a warning instead of a second block, so the two never loop.
Anything the plugin cannot check lets Claude finish.

## What it catches

A loosened assertion (`toBe(42)` becomes `toBeDefined()`), a skipped or focused test, a placeholder assertion such as
`expect(true).toBe(true)`, a deleted test, a lowered coverage threshold, a switched-off strict mode, a CI step that is allowed
to fail. It compares the before and after of the change, so it sees what a linter cannot. The rules are in
[docs/rules.md](https://github.com/Nari-Ab/agent-roast/blob/main/docs/rules.md), and
[docs/benchmarks.md](https://github.com/Nari-Ab/agent-roast/blob/main/docs/benchmarks.md) says how often it fires and how often
it is wrong.

## Examples

1. A test is red, and Claude changes `expect(total).toBe(42)` to `expect(total).toBeDefined()`. The hook sends Claude back
   with the file, the line and the before and after, and asks it to fix the code instead.
2. Claude adds `it.skip("applies a discount", ...)` (or `@pytest.mark.skip`, `t.Skip()`, `#[ignore]` or `@Disabled`) to get a
   green run. The skip is reported as a switched-off test.
3. A coverage gate fails, and Claude lowers the threshold in `vitest.config.ts` (lines 90 to 50) or adds
   `continue-on-error: true` to the test step in `.github/workflows/ci.yml`. Both are reported as a weaker gate.

To see all of this without a Claude session, run `npx agent-roast demo`. It builds a scripted example in a temporary
repository and prints the real review; nothing of yours is read.

## What the plugin runs, reads, writes and sends

- **Runs:** one `Stop` hook, `npx --yes agent-roast@<this plugin's version> hook run --agent claude`. The version is pinned.
  The first run downloads that package and its dependencies from the npm registry; nothing else is fetched.
- **Reads:** the Git repository of the current project: `HEAD` and your uncommitted changes. From the hook's input it uses
  only the working directory, the event name and the flag that says Claude is already continuing because of a Stop hook. It
  does not read Claude's conversation, transcript, memory or uploaded files. Your code, tests and scripts are never executed.
- **Writes:** during a review, a private copy of the Git index inside the `.git` directory (`agent-roast-*.index`), deleted
  when the review ends. The real index, the working tree and `HEAD` are not touched. `agent-roast hook pause` writes a small
  marker file, `.git/agent-roast-hook-paused`, and `hook resume` removes it.
- **Sends:** nothing. agent-roast makes no network requests, calls no model and has no telemetry. A test in the repository
  checks the built files for network code.
- **Fails open:** outside a Git repository, on a timeout (60 seconds) or on any error, Claude is allowed to finish.

## Install and pause

```
/plugin install agent-roast --marketplace Nari-Ab/agent-roast
```

Set `AGENT_ROAST_HOOK=off` to switch the hook off for a session, or `AGENT_ROAST_HOOK=advisory` to get a warning without Claude
being sent back. An intended change is accepted by committing it. The same
check also runs as a command (`npx agent-roast`), a Git hook and a GitHub Action; see the
[repository](https://github.com/Nari-Ab/agent-roast) for those and for the source. Questions and bug reports go to the
[issue tracker](https://github.com/Nari-Ab/agent-roast/issues); security reports go through GitHub's private advisories, as
[SECURITY.md](https://github.com/Nari-Ab/agent-roast/blob/main/SECURITY.md) describes. MIT license.
