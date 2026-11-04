# Maintainers

How a release is made. The user-facing description of each release is `CHANGELOG.md`.

## Version pins

The version appears in several places that must agree; `tests/distribution.test.ts` fails when they do not:

- `package.json` and `package-lock.json`
- `action.yml` (the Action installs exactly this version)
- `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json` and `.claude-plugin/marketplace.json`
- the install snippets in `README.md` and `docs/integrations.md`, and the site (`site/index.html`)

## Release steps

1. Move the "Unreleased" lines in `CHANGELOG.md` under a dated version heading; bump the version in every place above.
2. `npm ci && npm run typecheck && npm test && node scripts/smoke.mjs`; check `npm pack --dry-run` lists only `dist`, `README.md`,
   `LICENSE` and `schema.json`.
3. Open a pull request, wait for CI (Linux on Node 18/20/22, macOS, smoke on three systems), merge it.
4. Tag the merge commit `vX.Y.Z` (annotated) and create the GitHub release from it. Tick **Publish this Action to the GitHub
   Marketplace** the first time, and keep the category on "Code quality" or "Continuous integration".
5. Publish to npm: automatically (below) or by hand with `npm publish`.
6. Move the `v1` tag to the release commit so `uses: Nari-Ab/agent-roast@v1` picks it up:
   `git tag -fa v1 -m "v1" <sha> && git push --force origin refs/tags/v1`.
7. Check from a clean directory: `npx agent-roast@X.Y.Z --version`, `npx agent-roast@X.Y.Z demo`.

## Publishing from CI, with provenance

`.github/workflows/release.yml` publishes with `npm publish --provenance`, which makes npmjs.com show the commit and workflow
that built the package. It stays idle until you enable it:

1. On npmjs.com open the package, **Settings**, **Trusted Publisher**, choose GitHub Actions and enter owner `Nari-Ab`,
   repository `agent-roast`, workflow `release.yml`. (Alternatively create an automation token and store it as the repository
   secret `NPM_TOKEN`.)
2. In the repository settings add the variable `NPM_PUBLISH_FROM_CI` with the value `true`.
3. Create a GitHub release; the workflow checks that the tag matches `package.json`, runs the tests and publishes.

This workflow has not run yet. Expect to adjust it on the first real release.

## Repository settings worth having

- **Description and topics** that people search for: `ai-agents`, `claude-code`, `codex`, `cursor`, `code-review`,
  `github-actions`, `testing`, `guardrails`, `static-analysis`, `developer-tools`.
- **Social preview** (Settings, General): upload `docs/assets/social-preview.png` (1280 × 640).
- **Discussions** on, for questions that are not bugs.
- **Branch protection** on `main`: require the `Test CLI` checks.
- A **security policy** is in `SECURITY.md`; enable private vulnerability reporting.
