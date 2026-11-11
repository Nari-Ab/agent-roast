# Maintainers

How a release is made. The user-facing description of each release is `CHANGELOG.md`.

## Version pins

The version appears in several places that must agree; `tests/distribution.test.ts` fails when they do not:

- `package.json` and `package-lock.json`
- `action.yml` (the Action installs exactly this version)
- `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json` and `.claude-plugin/marketplace.json`
- `server.json` (its `version` and the package's `version`; `name` must equal `mcpName` in `package.json`)
- the install snippets in `README.md` and `docs/integrations.md`, and the site (`site/index.html`)

## Release steps

1. Move the "Unreleased" lines in `CHANGELOG.md` under a dated version heading; bump the version in every place above.
2. `npm ci && npm run typecheck && npm test && node scripts/smoke.mjs`; check `npm pack --dry-run` lists only `dist`, `README.md`,
   `LICENSE` and `schema.json`.
3. Open a pull request, wait for CI (Linux on Node 18/20/22, macOS, smoke on three systems), merge it.
4. Tag the merge commit `vX.Y.Z` (annotated) and create the GitHub release from it. To list the Action on GitHub Marketplace,
   edit the release in the web UI (there is no API) and tick **Publish this Action to the GitHub Marketplace**, choose
   "Code quality" or "Testing" as the primary category, and press **Update release**. Needed once: the account accepts the
   Marketplace Developer Agreement (the checkbox is locked until then), and the `name` in `action.yml` must not match any
   user, organization or existing action. `agent-roast` is a GitHub organization, which is why the Action is named
   "Agent Roast: weakened-test guard". GitHub asks for two-factor confirmation when publishing.
5. Publish to npm: automatically (below) or by hand with `npm publish`.
6. Move the `v1` tag to the release commit so `uses: Nari-Ab/agent-roast@v1` picks it up:
   `git tag -fa v1 -m "v1" <sha> && git push --force origin refs/tags/v1`.
7. Check from a clean directory: `npx agent-roast@X.Y.Z --version`, `npx agent-roast@X.Y.Z demo`.

## Publishing from CI, with provenance

`.github/workflows/release.yml` publishes with `npm publish --provenance`, which makes npmjs.com show the commit and workflow
that built the package. It stays idle until you enable it:

1. Allow this workflow to publish the package. In a terminal, signed in to npm (it asks for a second factor):
   `npx -y npm@latest trust github agent-roast --repo Nari-Ab/agent-roast --file release.yml --allow-publish`
   (or on npmjs.com: the package, **Settings**, **Trusted Publisher**, GitHub Actions, owner `Nari-Ab`, repository
   `agent-roast`, workflow `release.yml`, no environment). `npm trust list agent-roast` shows what is configured. The
   workflow carries no token; to publish with a token instead, add `NODE_AUTH_TOKEN` to the publish step.
2. In the repository settings add the variable `NPM_PUBLISH_FROM_CI` with the value `true`.
3. Create a GitHub release; the workflow checks that the tag matches `package.json`, runs the tests and publishes.

The workflow ran for the first time on the 0.12.2 release: it took under a minute, published without a token and signed a
provenance statement. Watch a run with `gh run watch <id> --exit-status`; the registry can answer 404 for a few minutes after.

## Claude plugin directory

`plugin/` is the plugin folder: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `README.md` and `LICENSE`. To list it in
Anthropic's directory, submit it at claude.ai/directory/manage (Submit new, Plugin bundle, repository `Nari-Ab/agent-roast`,
plugin path `plugin`) from a paid Claude plan with GitHub connected. The portal's Validate step runs more checks than
`claude plugin validate ./plugin`; the README must stay at 40 words or more and keep describing everything the plugin runs,
reads, writes and sends, because the security scan compares the behavior with it. The hook runs a pinned `npx` package, which
the directory always holds for a reviewer to read. The directory follows the default branch, so a release that bumps
`plugin/.claude-plugin/plugin.json` (it is one of the version pins) reaches it without a new submission.

## Repository settings worth having

- **Description and topics** that people search for: `ai-agents`, `claude-code`, `codex`, `cursor`, `code-review`,
  `github-actions`, `testing`, `guardrails`, `static-analysis`, `developer-tools`.
- **Social preview** (Settings, General): upload `docs/assets/social-preview.png` (1280 × 640).
- **Discussions** on, for questions that are not bugs.
- **Branch protection** on `main`: require the `Test CLI` checks.
- A **security policy** is in `SECURITY.md`; enable private vulnerability reporting.

## MCP registry

`server.json` describes `agent-roast mcp` for the [official MCP registry](https://modelcontextprotocol.io/registry/quickstart),
which hosts metadata only and checks that the npm package carries the same name in `mcpName` (`package.json`).

`.github/workflows/mcp-registry.yml` publishes it with GitHub OIDC, so there is no token and no login on a laptop. After
"Release to npm" succeeds it waits until npm serves the version in `server.json`, installs `mcp-publisher` and runs
`login github-oidc` and `publish`. To publish a version that is already on npm by hand: Actions, "Publish to the MCP registry",
Run workflow. The publisher is pinned to a release and to the sha256 in that release's checksums file; raise both together.

Check it: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=agent-roast"`. A rejection naming the namespace
usually means the owner's name differs in case: `name` in `server.json` and `mcpName` in `package.json` must stay equal and
start with `io.github.` and the GitHub owner. Without CI, install `mcp-publisher` (the quickstart has the download), run
`mcp-publisher login github`, approve the device code in the browser, then `mcp-publisher publish` from the repository root.

Each release raises `version` in `server.json` (both places) with the other pins. Community indexes such as Glama and PulseMCP
list servers from GitHub and the registry on their own; other lists (for example awesome-mcp-servers) take a pull request from a
person, and many refuse text written by a model, so write the entry yourself.

