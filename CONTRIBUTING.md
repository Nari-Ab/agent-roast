# Contributing to agent-roast

Thanks for looking. The most useful thing you can send is **a real example the detector got wrong**: a finding that was a
false alarm, or a weakened check it did not catch. [Open an issue](https://github.com/Nari-Ab/agent-roast/issues/new/choose)
with the before and after (a few lines are enough), or add it as a labeled case yourself, as described below.

## Set up

```bash
npm ci
npm run typecheck
npm test                 # builds first, then runs the suite
node dist/cli.js demo    # see the CLI you just built
```

Develop with Node.js 20.19+ or 22.12+. The published CLI supports Node.js 18+, and CI checks it on 18, 20 and 22 on Linux,
the full suite on macOS, and a first-run smoke test (`node scripts/smoke.mjs`) on Linux, macOS and Windows.

## Add a labeled case

`benchmarks/cases.mjs` holds hand-labeled before/after changes. Each entry has the files before and after, and what must
happen:

- `expect: "test-skip"` (or any rule name): a shortcut the detector must report;
- `expect: null`: a harmless look-alike that must stay silent;
- `expect: "miss"`: a known gap, kept in the file so the documentation stays honest.

When you add or change a detector, add both a cheat and a look-alike. `npm run bench` prints the totals and `npm test` runs
every case.

## Principles

- **Offline, Git objects only.** The tool never runs project code, hooks or package scripts, and makes no network request.
- **Policy comes from the trusted side.** A change must not be able to switch off the rules that review it.
- **A false alarm costs more than a miss.** People stop reading a tool that cries wolf. Prefer a conservative rule with a
  documented gap over a broad one.
- **Say what it cannot see.** Limits belong in the documentation next to the feature.

A new rule needs a cheat case, a look-alike case, a guide in `src/rules.ts` (shown by `agent-roast explain`), a row in the
rule table of `docs/rules.md`, and a line under "Unreleased" in `CHANGELOG.md`.

## Pull requests

Keep them focused. CI must pass. Describe what the change makes visible to a user, and attach the case that motivated it.
By contributing you agree that your work is released under the [MIT license](LICENSE).
