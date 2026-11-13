# Integrations

agent-roast can stop a weakened check at five points. Use as many as you like; they share one set of rules and one policy file.

| Where | What happens | Command |
| --- | --- | --- |
| **The agent is about to finish** | The agent is sent back once to fix the code | `agent-roast hook install` |
| **The agent asks first** | Any MCP-capable agent can call a read-only tool before it says it is done | `agent-roast mcp`, see [MCP server](#mcp-server) |
| **You are about to commit** | The commit is refused | `agent-roast init --hook`, or [pre-commit](#the-pre-commit-framework) |
| **A pull request is opened** | The check fails, annotates and comments | [GitHub Action](#github-actions) |
| **Any time** | You look | `npx agent-roast`, `npx agent-roast replay` |

- [Claude Code](#claude-code) · [Codex](#codex) · [Cursor](#cursor) · [Gemini CLI](#gemini-cli) · [GitHub Copilot](#github-copilot) · [Factory Droid](#factory-droid) · [AGENTS.md and CLAUDE.md](#agentsmd-and-claudemd) · [MCP server](#mcp-server)
- [Git hook and pre-commit](#git-hooks) · [GitHub Actions](#github-actions) · [other CI](#other-ci) · [the API](#programmatic-use)

---

## The agent hook

```bash
npx agent-roast hook install            # the agents that already have a folder in this repository
npx agent-roast hook install claude     # or name them: claude, codex, cursor, gemini, copilot, droid
```

`hook install` adds a **Stop hook** (for Gemini CLI an `AfterAgent` hook, for GitHub Copilot a hook file of its own) to the agent's own settings. It keeps everything else in the file, can be run again to
refresh the pinned version, and refuses to touch a file it cannot parse. Add `--global` for every repository of your user,
`--local` for Claude Code's untracked `.claude/settings.local.json`, `--dry-run` to preview, `--advisory` to
[only warn](#try-it-without-blocking-anything), and `--instructions` to also write a short "keep the checks honest" paragraph
into `AGENTS.md` / `CLAUDE.md`.

The hook runs `npx --yes agent-roast@<version> hook run --agent <name>`. The version is **pinned** to the one that installed it,
so an agent never runs newer code than you reviewed. Re-run `hook install` after upgrading. If agent-roast is installed
globally, `--command agent-roast` skips `npx`.

### What happens when the agent tries to finish

1. The agent reports it is done. The hook reviews **everything not committed yet** against `HEAD`, with the policy committed at
   `HEAD` (the agent cannot switch the rules off by editing the config). It is the same review as `agent-roast review --worktree`.
2. If a rule that blocks by default fired ([`assertion-weakened`, `guard-weakened`, `test-skip`, `test-focus`,
   `trivial-assert`](rules.md)), the agent is sent back **once** with the file, line, before and after of each change and the
   instruction to fix the code instead. Warnings only (`test-removed`, `assertion-removed`, ...) never block.
3. If the agent finishes again with the same problem, it is **not** blocked a second time. You get a one-line warning instead, so
   you decide and the two never loop.
4. Anything the tool cannot check (not a Git repository, a timeout after 25 seconds, a symlinked source file, input that is not
   JSON) lets the agent finish. The hook never breaks a session.

An intended change is simple to accept: **commit it**. A committed change becomes the baseline, so the next review does not see
it as new. To let an agent finish without the check for a while, `agent-roast hook pause --for 2h` (and `hook resume`), or set
`AGENT_ROAST_HOOK=off` in the environment. Manage the installation with `hook status` and `hook uninstall`.

### Try it without blocking anything

```bash
npx agent-roast hook install --advisory
```

In advisory mode the hook runs the same review, but the agent is **never sent back**: when it finishes with a weakened check you
get the one-line warning from step 3 above and the agent carries on. Use it for a week to see what the hook would have said, then
run `npx agent-roast hook install` again, without `--advisory`, to start sending agents back. `hook status` shows which mode each
hook is in. For a hook you cannot edit, such as the Claude Code plugin's, set `AGENT_ROAST_HOOK=advisory` in the environment
instead. Cursor has no channel for a message to the person, so there the warning goes to the hook's log.

### What it does not do

- It is a guardrail against the shortcut an agent reaches for, not a sandbox against an adversary. An agent that is allowed to
  edit `.claude/settings.json` can remove the hook. Protect that file with the agent's own permission rules or managed settings
  if that matters, and keep the pull request check as the enforcement point.
- It sees uncommitted changes. If an agent commits before it stops, the hook has nothing to review; the pull request check does.
- It reviews the files that changed since `HEAD`, up to 1,000 files and 2 MiB per file.

> **Status.** The six integrations follow each agent's documented hook protocol and are tested against simulated hook input
> (`tests/hook.test.ts`). They have not yet been exercised in long live sessions with every agent. If you see something
> unexpected, please [open an issue](https://github.com/Nari-Ab/agent-roast/issues/new/choose).

### Claude Code

Plugin (Claude Code 2.1.275 or later), one step:

```text
/plugin install agent-roast --marketplace Nari-Ab/agent-roast
```

Older versions: `/plugin marketplace add Nari-Ab/agent-roast`, then `/plugin install agent-roast@agent-roast`.

Or without the plugin system: `npx agent-roast hook install claude`, which writes `.claude/settings.json`:

```jsonc
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "npx --yes agent-roast@0.24.0 hook run --agent claude", "timeout": 60 } ] }
    ]
  }
}
```

The hook answers with `{"decision": "block", "reason": "..."}`, which Claude Code feeds back to the model as the reason to
continue, and sets `stop_hook_active` on the next stop so the loop ends after one round.

### Codex

```bash
npx agent-roast hook install codex      # writes .codex/hooks.json
```

Codex runs a new hook only after you trust it: open Codex and review it with `/hooks`. Project hooks load only for a trusted
project. The Stop answer is the same JSON as Claude Code's.

### Cursor

```bash
npx agent-roast hook install cursor     # writes .cursor/hooks.json
```

Cursor's `stop` hook answers with `{"followup_message": "..."}`, which Cursor submits as the next message. The hook sends one
follow-up (`loop_limit: 2` is set as a backstop).

### Gemini CLI

```bash
npx agent-roast hook install gemini     # writes .gemini/settings.json (--global: ~/.gemini/settings.json)
```

Gemini CLI's `AfterAgent` hook runs once per turn, after the model's final response, and may answer `{"decision": "deny", "reason": "..."}`: Gemini CLI
documents that as rejecting the response and retrying the turn, with the reason as the new prompt. The hook sends **one** retry. The next `AfterAgent`
input carries `stop_hook_active: true`, so the hook only warns the person (`{"systemMessage": "..."}`) and the two do not loop. When the checks are intact it answers `{}`.
The entry it writes is `{"matcher": "*", "hooks": [{"name": "agent-roast", "type": "command", "command": "npx --yes agent-roast@<version> hook run --agent gemini", "timeout": 60000}]}`
under `hooks.AfterAgent` (Gemini CLI counts the timeout in milliseconds).

Gemini CLI warns the first time it sees a project hook, and again when the command of one changes; `/hooks panel` lists them. A `.gemini/settings.json` that has comments is
not valid JSON for the installer, which leaves it alone and says so: add the entry by hand. Not covered: whether `AfterAgent` fires for a non-interactive `gemini -p` run (its
documentation does not say), and Google's Antigravity CLI: the Gemini CLI documentation says that it replaced Gemini CLI for unpaid-tier and Google One users on 18 June 2026, and its hooks are not covered here.

### GitHub Copilot

```bash
npx agent-roast hook install copilot    # writes .github/hooks/agent-roast.json (--global: ~/.copilot/hooks/agent-roast.json)
```

GitHub Copilot loads every `*.json` file of `.github/hooks` (version 1) in the Copilot CLI, in VS Code's agent mode and, from the default branch, in the cloud agent. The hook is registered under `Stop`,
the PascalCase alias of `agentStop`, which makes Copilot write the VS Code-compatible input that Claude Code's dialect shares. The entry is `{"type": "command", "command": "npx --yes agent-roast@<version> hook run --agent copilot", "timeoutSec": 60}`.
`{"decision": "block", "reason": "..."}` forces another turn with the reason as its prompt (Copilot ends the turn after 8 blocks in a row, and this hook sends one); an input with `stop_hook_active: true` only gets a warning, printed as the
display-only progress line that Copilot documents (`{"type": "progress", "message": "..."}`), because it documents no field for a message to the person. Exit code 2 does not block `agentStop`, so the hook never uses it. Copilot reads hook files when it starts: restart it after installing.
Not covered: whether `agentStop` fires in a non-interactive `copilot -p` run (the documentation does not say), and the cloud agent, whose sandbox has a restricted network that `npx` may not get through.

### Factory Droid

```bash
npx agent-roast hook install droid      # writes .factory/hooks.json (--global: ~/.factory/hooks.json)
```

Droid's `Stop` hook takes Claude Code's input and its `{"decision": "block", "reason": "..."}` answer. `hooks.json` is keyed by event name at the top of the file (no `hooks` wrapper and no version) and the entry is
`{"Stop": [{"hooks": [{"type": "command", "command": "npx --yes agent-roast@<version> hook run --agent droid", "timeout": 60}]}]}`. Droid takes a snapshot of its hooks at startup, so restart it after installing; `/hooks` shows them. Droid's documentation does not
say what `droid exec` does with hooks.

### AGENTS.md and CLAUDE.md

Hooks enforce; instructions explain. `agent-roast hook install --instructions` writes this paragraph between markers
(`<!-- agent-roast:start -->` … `<!-- agent-roast:end -->`) into `AGENTS.md` and `CLAUDE.md`, whichever exist, and replaces it
in place when you run it again:

> When a test, type check, linter or CI step fails, fix the code. Do not make the build green by skipping or deleting tests,
> weakening assertions, lowering coverage thresholds, switching off `strict`, or letting a CI step fail. If you think a check is
> wrong, say so and ask before changing it. Before you finish, run `npx agent-roast review --worktree`.

---

## MCP server

`agent-roast mcp` runs a small [MCP](https://modelcontextprotocol.io) server over stdio, so any agent that speaks MCP can ask
"did my changes weaken a check?" before it says it is done. It is read-only and offline like the rest of agent-roast: nothing is
run, written or sent, and it has no dependency. It answers both protocol eras, the `initialize` handshake of 2025-11-25 and
earlier and the per-request metadata of 2026-07-28, and Claude Code's own connection check accepts it.

| Tool | What it does |
| --- | --- |
| `review_worktree` | Everything not committed yet against `HEAD`, the same review the hook runs. |
| `review_changes` | Two committed revisions, for example `main` and a branch (`base`, optional `head`). The rules come from the base revision. |
| `stop_hook` | The Stop hook's check and answer, for plugin hooks of type `mcp_tool`. Meant to be called by a hook, not by hand. |

```bash
claude mcp add agent-roast -- npx --yes agent-roast@0.24.0 mcp      # Claude Code
codex mcp add agent-roast -- npx --yes agent-roast@0.24.0 mcp       # Codex
```

Cursor reads `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project, and other clients take the same
command and arguments:

```json
{ "mcpServers": { "agent-roast": { "command": "npx", "args": ["--yes", "agent-roast@0.24.0", "mcp"] } } }
```

The tools read only the project the server was started in and other worktrees of the same repository; a path outside it is
refused, and a server started from the filesystem root has no project at all. When a client starts servers outside your
project, name the directory: add `"--root", "/path/to/project"` to the arguments (`--root` can be given more than once). A check
that fails or runs past 25 seconds ends with a message the agent can read, not a protocol error.

A tool only helps when the agent calls it. The server tells the agent to call `review_worktree` before it says it is done, and
`hook install --instructions` writes the same advice into `AGENTS.md` and `CLAUDE.md`. For a guarantee, use the
[hook](#the-agent-hook), which does not depend on the agent remembering. To list the server in the official MCP registry, see
[maintainers](maintainers.md#mcp-registry).

---

## Git hooks

```bash
npx agent-roast init --hook        # writes .git/hooks/pre-commit, keeps an existing one
```

The hook runs `agent-roast --staged`: it compares the full source at `HEAD` with the index, so a change that is staged but
looks different in the working tree is still the one that is checked.

### The pre-commit framework

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: agent-roast
        name: agent-roast
        entry: agent-roast review --staged
        language: node
        additional_dependencies: ["agent-roast@0.24.0"]
        pass_filenames: false
        always_run: true
```

pre-commit installs the pinned package into its own environment, so the project needs no Node setup of its own beyond what
pre-commit needs to run Node hooks.

### Husky, lefthook and others

Any runner that can execute a command works: `npx agent-roast review --staged`. It exits 1 when a staged change weakens a
check, 2 when the review is incomplete, 0 otherwise.

---

## GitHub Actions

```yaml
# .github/workflows/agent-roast.yml
name: Agent Roast
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write      # only needed for `comment: true`

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0    # the review needs the merge-base
      - uses: Nari-Ab/agent-roast@v1
        with:
          comment: true     # one comment, updated on every push; silent when there is nothing to say
```

`npx agent-roast init --ci` writes a starting workflow. Inputs:

| Input | Default | Meaning |
| --- | --- | --- |
| `advisory` | `false` | Report findings without failing. Invalid configuration, Git errors and incomplete scans still fail. Use it for a trial. |
| `comment` | `false` | Keep one pull request comment up to date. Needs `pull-requests: write`; on forks the token is read-only, so only the job summary is written. |
| `fail-on` | policy | Comma-separated rules that fail the check. |
| `format` | `github` | `github` (annotations and a job summary), `terminal`, `json`, `markdown`, `sarif`. |
| `mode` | `review` | `review` (full before/after) or `audit` (the older added-lines audit). |
| `base`, `head` | the pull request | Override the compared commits. |

Outputs: `passed`, `infractions-count`, `has-supported-changes`, `complete`, `existing-count`, `removed-count`.

The Action installs a pinned package in a temporary directory outside your checkout (with `--ignore-scripts`, so a hostile
`.npmrc` in the pull request is not read), reads Git objects only, and refuses `pull_request_target`. The review uses the policy
from the **base** commit, so a pull request cannot loosen its own rules. For a trial, start with `advisory: true`.

**SARIF** for GitHub code scanning: `agent-roast review --base origin/main --format sarif > agent-roast.sarif`, then upload it
with `github/codeql-action/upload-sarif`. Source snippets are left out of SARIF.

## Other CI

```bash
# GitLab merge request pipeline (full history: GIT_DEPTH: 0)
npx agent-roast@0.24.0 review --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA" --format markdown

# Anything else
npx agent-roast@0.24.0 review --base origin/main --format github   # or json, markdown, sarif
```

Before putting it in CI, see what it would have said about your recent history: `npx agent-roast replay`.

## Programmatic use

```ts
import { reviewWorktreeChanges, reviewChanges, replayHistory } from "agent-roast";

const result = await reviewWorktreeChanges({ cwd: process.cwd() });
if (result.failedRules.length) console.error(result.output);
```

The package is ESM with bundled types. `reviewChanges({ base, head })`, `reviewStagedChanges()`, `checkProject()` and
`replayHistory({ last })` return typed results with `exitCode` and a rendered `output`.
