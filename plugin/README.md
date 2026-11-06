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

## What the plugin runs, reads, writes and sends

- **Runs:** one `Stop` hook, `npx --yes agent-roast@<this plugin's version> hook run --agent claude`. The version is pinned.
  The first run downloads that package and its dependencies from the npm registry; nothing else is fetched.
- **Reads:** the Git repository of the current project: `HEAD` and your uncommitted changes. Your code, tests and scripts are
  never executed.
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

Set `AGENT_ROAST_HOOK=off` to switch the hook off for a session. An intended change is accepted by committing it. The same
check also runs as a command (`npx agent-roast`), a Git hook and a GitHub Action; see the
[repository](https://github.com/Nari-Ab/agent-roast) for those, for the issue tracker and for the source. MIT license.
