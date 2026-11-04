# Security

## Reporting a vulnerability

Please report it privately through
[GitHub security advisories](https://github.com/Nari-Ab/agent-roast/security/advisories/new) instead of a public issue. You
will get an answer within a few days. Fixes ship in a new release, and the advisory credits you unless you prefer otherwise.

## What counts

agent-roast promises to be safe to run on code you do not trust: it reads Git objects (or, for `--worktree` and `check`,
regular files inside the repository), never runs project code, hooks, diff programs or package scripts, and makes no network
request. A report is in scope when it breaks one of those properties, for example:

- a path, symlink or Git setting that makes it read outside the repository, run a program, or write outside its own files;
- a way for the change under review to switch off or weaken the policy that reviews it;
- input that makes `hook run` block an agent forever, or run a command;
- a crafted report (terminal, Markdown, SARIF, annotations) that injects control sequences or markup.

A finding that is simply wrong (false alarm or missed shortcut) is not a vulnerability; please open a normal issue with the
before and after.

## Supported versions

Only the latest release is supported.
