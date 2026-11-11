# Reference

Commands, output, configuration, adoption tools and limits. For what each rule means see [rules.md](rules.md); for wiring it
into an agent, a Git hook or CI see [integrations.md](integrations.md).

## Commands

| Command | What it does |
| --- | --- |
| `agent-roast` | Reviews everything **not committed yet** against `HEAD`. On a clean tree it replays your recent commits instead, so a first run still says something. |
| `agent-roast demo` | A scripted example in a temporary repository. Nothing of yours is read. |
| `agent-roast review --base <ref>` | A pull request: the full changed files at the merge-base and at `--head` (default `HEAD`). Only new findings fail. |
| `agent-roast review --staged` | The next commit: `HEAD` against the index. Also `agent-roast --staged`. |
| `agent-roast review --worktree` | The same as the bare command, for scripts: `HEAD` against staged, unstaged and untracked files. |
| `agent-roast replay [--last <n>]` | Each of your last commits (default 50) reviewed on its own against its parent, as a pull-request check would have seen it. Never fails because of a finding. |
| `agent-roast check` | Everything that is true of the code you have now, not only what changed. Takes a baseline. |
| `agent-roast explain <rule>` | What a rule means, why it matters and what to do. |
| `agent-roast hook <run\|install\|uninstall\|status\|pause\|resume>` | Guard a coding agent; `--advisory` only warns and never sends the agent back. See [integrations](integrations.md#the-agent-hook). |
| `agent-roast mcp [--root <dir>]` | Run as a read-only MCP server over stdio, with tools to review uncommitted changes or a commit range. See [integrations](integrations.md#mcp-server). |
| `agent-roast init [--ci] [--hook]` | Writes `.agentroastrc.json`, a GitHub workflow and a Git pre-commit hook. Existing files are kept. |
| `agent-roast audit` | The original report: a score for the shortcuts a repository's history adds (`--all`, `--since`, `--verbose`, `--fail-under`). |
| `agent-roast badge` | A badge for that score (SVG, Markdown or Shields JSON). |

Options shared by the reviews: `--format terminal|json|github|markdown|sarif` (`--json` for `json`), `--fail-on <rules>` (the
rules that fail the run), `--advisory` (report everything, fail on nothing; the same as an empty `--fail-on`, but portable to
Windows shells), `--ignore-exceptions`.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Passed: no new blocking finding. |
| `1` | A blocking finding (or, for `audit`, a score below the threshold). |
| `2` | Invalid configuration or options, an unresolvable Git ref, or an **incomplete** scan. Missing coverage is never reported as clean. |

## How a review decides

`review` compares the **full contents** of every changed source file before and after, so deleting the only handler inside a
`catch` is visible even when no suspicious line was added. It reports new findings, existing findings and patterns that are no
longer there. Matching uses the rule, the source snippet and an occurrence count inside one file pair: line shifts and
Git-recognized renames do not turn old debt into new debt, and a second identical shortcut is new. This is not semantic
tracking; a rewritten snippet or a language change can need a fresh look.

- **Source is read from immutable Git blobs** at the merge-base and at the head. For `--worktree`, changed files are read from
  disk with the same checks as `check` (regular files only, no symlinks, inside the repository, at most 2 MiB each), and Git's
  change detection runs against a private copy of the index. The worktree, the index and `HEAD` are never touched. Project
  code, hooks, diff programs, `textconv` and package scripts are never executed.
- **Policy comes from the base side:** the tip of the supplied base ref, or `HEAD` for staged and working-tree reviews. A
  candidate change to `.agentroastrc.json`, `.agentroastrc` or `agent-roast.config.json` is reported and ignored for that
  review; adopt policy changes in a separate, human-reviewed commit. An explicit `--fail-on` overrides which rules block, but
  cannot enable a rule that the base policy switched off.
- **Limits:** 1,000 changed files, 2 MiB per source file, 50 MiB across the inspected versions, 30 seconds per Git command.
  Symlinked, binary or oversized source and missing objects give exit 2, never a pass. Partial clones and several merge-bases
  are unsupported; fetch the full history (`fetch-depth: 0`). The report counts what was excluded or unsupported.
- **Scope:** only changed, supported files are compared. This is not a whole-repository certification; use `check` for that.

### Reports

`terminal` shows the 20 most important findings (rules that block first, then the before/after rules, then line patterns),
each with file, line, evidence and a next step. `json` is complete and stable (`schemaVersion` `1.2.0` for context reviews).
`markdown` is the pull request comment. `github` emits annotations (GitHub shows at most 10 per level) and a job summary.
`sarif` follows SARIF 2.1.0 with rule metadata, relative locations and stable occurrence fingerprints; source snippets are
omitted. JSON and Markdown contain evidence snippets and should be handled as source code. SARIF output is generated offline;
uploading it is a separate step. A live code-scanning upload has not been tested with this release.

## Configuration

`.agentroastrc.json` in the repository root (also `.agentroastrc` or `agent-roast.config.json`; the first found wins). Run
`npx agent-roast init` for a starting file. Unknown settings, invalid severities and malformed exceptions fail with exit 2. The
file must be a regular UTF-8 file of at most 64 KiB.

```json
{
  "$schema": "./node_modules/agent-roast/schema.json",
  "failOn": ["test-skip", "trivial-assert", "test-focus", "assertion-weakened", "guard-weakened"],
  "ignorePaths": ["**/generated/**", "**/vendor/**"],
  "rules": {
    "swallowed-error": "warn",
    "type-escape": "off"
  }
}
```

- `failOn`: the rules that fail a review. An empty list makes the run advisory.
- `rules`: per rule `error`, `warn` or `off`. `off` removes findings entirely.
- `ignorePaths`: globs (`*`, `?`, `**` and directory prefixes; not full `.gitignore` syntax), at most 1,000 of at most 1,024
  characters.
- `exceptions`: see below. `scoreThreshold` and `panicLoopWindowMinutes` only affect `audit` and `badge`.

`schema.json` ships in the npm package for editor completion.

## Precise exceptions

Some skipped integrations or abstract stubs are intentional. Accept one exact finding without switching the rule off or
ignoring its file:

1. Run `agent-roast check --format json` and note the finding's `fingerprint` (rule, relative filename and trimmed snippet).
2. Add a reviewed entry to the root `.agentroastrc.json` with the fingerprint, the **total** allowed count, a reason and an
   expiry date:

```json
{
  "exceptions": [
    {
      "fingerprint": "f4d1212234f00381d0eaed359e3229fe4ff47388affc9eac0d0d89daffea13d6",
      "count": 1,
      "reason": "Integration sandbox unavailable; restore under ENG-42",
      "expires": "2026-11-15"
    }
  ]
}
```

3. Run the check again. Accepted findings stay visible with their reason and date; an extra identical occurrence still blocks;
   an expired exception stops applying (the specified day is included, in UTC).

The example fingerprint is for `it.skip('temporary');` in `auth.test.ts`; copy the fingerprint from **your** report. For
committed, staged and working-tree reviews the allowance must already exist in the trusted base policy, so a change cannot
approve itself. `--ignore-exceptions` shows accepted findings again. SARIF keeps accepted records with `suppressions`.

## Adopting it on an existing project

A **baseline** accepts the findings present today so that only new ones fail. It does not fix anything.

```bash
npx agent-roast check --write-baseline .agentroast-baseline.json   # refuses to overwrite
npx agent-roast check --baseline .agentroast-baseline.json
```

Fingerprints use the rule, the relative filename and the snippet, not the line number, so adding clean code above a finding
does not break it. Counts keep a second identical shortcut new. A baseline stores hashes and counts, not source. Treat a baseline
change as a policy change in review, and do not regenerate it silently in CI. An incomplete scan cannot write a baseline.

`check` scans tracked and non-ignored untracked files of the repository, applies its root config, skips generated directories
(`node_modules`, `dist`, `build`, `vendor`, minified files) and does not recurse into submodules. A supported file that is binary,
too large, unreadable or a symlink makes the scan incomplete (exit 2); exclude intentional cases in `ignorePaths`.

To try it without risk, see what it would have said about your history first (`agent-roast replay`) and run the Action with
`advisory: true`.

## Requirements and privacy

- Git 2.30 or newer and Node.js 18 or newer. Linux, macOS and Windows (CI runs a first-run smoke test on all three).
- **Offline.** No network request, no LLM call, no telemetry; a test inspects the bundle for network modules. The one place
  that touches the network is `npx` fetching the package, and the Action's pinned `npm install`.
- Git is run hermetically: stable path quoting, no `fsmonitor`, no external diff or `textconv`, no object replacement and no
  lazy fetching from promisor remotes (partial clones are refused rather than risk a request).

## The original history report

`agent-roast audit` (and `agent-roast --all`, `--since`) scores the shortcuts a repository's history adds, with a personality
and a share link; `badge` turns that into a README badge. It reads added lines of AI-attributed commits (signatures such as
`Co-Authored-By: Claude`) or of all commits with `--all`, needs at least 200 added lines to produce a score, and hides author
names unless `--authors` is given. The score is a size-normalized defect density; it describes the history, it does not
certify the current code, and attribution is a text heuristic that cannot prove who wrote a change. The legacy
`--base`/`--head` added-lines audit (the Action's `mode: audit`) is kept for compatibility; prefer `review`.

## Development

```bash
npm ci
npm run typecheck
npm test                 # builds, then runs the suite
npm run bench            # the labeled cheat/look-alike cases
node scripts/smoke.mjs   # first-run smoke test of the built CLI
```

Develop with Node.js 20.19+ or 22.12+; the CLI supports 18+. CLI subprocesses and real Git hooks are exercised on 18, 20 and 22
through `AGENT_ROAST_TEST_NODE`. See [CONTRIBUTING.md](../CONTRIBUTING.md).
