# Product Hunt draft: agent-roast

This is editable launch copy, not evidence of an actual launch or customer adoption.
Verify the published version and examples before posting. No message has been sent
or posted as part of this document.

## Basic information

- Name: `agent-roast`
- Tagline: `Catch coding shortcuts before they ship`
- Price: free, MIT-licensed open source
- [Website and illustrative examples](https://nari-ab.github.io/agent-roast/)
- [Source](https://github.com/Nari-Ab/agent-roast)
- [npm](https://www.npmjs.com/package/agent-roast)

The site examples are authored demonstrations, not live analysis or customer results.
Existing GIFs under `docs/assets/` illustrate older history workflows and must be
reviewed before using them in a new-version announcement.

## Suggested description

```text
agent-roast is an offline review aid for skipped or focused tests, trivial assertions,
swallowed errors, obvious stubs and compiler suppressions, in code written by people
or AI. It reports source locations and concrete next steps without an LLM API key.

Start with the code you have: npx agent-roast check
Compare complete changed source: npx agent-roast review --base origin/main
Check exactly the next commit: npx agent-roast --staged

Context review separates existing findings from new ones and can detect deletion-only
empty handlers. Configure which rules block; use advisory mode for an initial pilot.
JSON, Markdown and SARIF reports support existing review workflows. An explicitly
reviewed baseline helps adopt current-code checks without accepting new duplicate debt.

The installed analyzer makes no source uploads or telemetry calls. Installation and
optional report uploads are separate network operations. These are heuristic checks,
with false positives and missed findings, alongside compilers, linters and tests.
```

## Suggested maker comment

```text
I built agent-roast to make a narrow group of review gaps easier to spot: a disabled
test, a leftover .only, an empty catch after deleting its handler, or an obvious stub.
These patterns can be legitimate, so the tool shows evidence for human review and
lets teams decide what blocks.

The latest published release is 0.8.0. Current-code checks need no AI commit tags;
context PR/staged checks compare full source, keep old findings separate, and use
trusted policy. The CLI is free and runs offline once installed.

I would like to learn from real use: which findings were useful, which were false
positives, how long adoption took, and whether the tool is worth keeping in your
review workflow. No adoption, production accuracy or time-saved claims are made.

Try npx agent-roast check and share a minimal, non-sensitive reproducer in GitHub
Issues if something is wrong. Please do not paste private source or credentials.
```

## Claims to avoid

Do not describe the tool as eliminating regressions, identifying AI intent, having
zero false positives, replacing a test runner, running within a universal fixed
latency, or demonstrating investor traction. No pilot results have been collected
in this work. Badges are generated static artifacts; they do not update themselves.
