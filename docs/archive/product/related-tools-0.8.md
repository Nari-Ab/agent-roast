# Related tools and choices for Agent Roast 0.8

Reviewed on 28 October 2026. This comparison informed design choices; no third-party
implementation was copied or vendored. Features below are not a claim of novelty,
superior accuracy, market demand or a replacement for those tools.

| Project / primary reference | Useful existing idea | Choice for Agent Roast |
| --- | --- | --- |
| [Semgrep ignore and triage behavior](https://docs.semgrep.dev/ignoring-files-folders-code) | Distinguishes excluding source from accepting a detected finding; ignored findings remain records. | Accept narrowly identified findings through reviewed policy, and report their reason/expiry separately from fixes. Candidate source comments must not silently disable the trusted review policy. |
| [Ruff unused-noqa (RUF100)](https://docs.astral.sh/ruff/rules/unused-noqa/) | Stale suppressions can be surfaced rather than becoming invisible permanent policy. | Make expired exceptions visible and let the corresponding finding return. Do not infer which unrelated lint suppressions are valid without running that linter. |
| [Gitleaks baseline workflow](https://github.com/gitleaks/gitleaks#creating-a-baseline) | Accept old findings explicitly while keeping new problems visible. | Retain reviewed baseline adoption; extra duplicate occurrences must remain new. Adding a blanket baseline is different from accepting one justified exception. |
| [reviewdog filter modes](https://github.com/reviewdog/reviewdog#filter-mode) | Added-line filtering can omit findings on unchanged lines; file/nofilter modes retain them. It supports SARIF input. | Keep deletion-only findings in the report even if GitHub cannot show an inline annotation. Document integration filters rather than dropping diagnostics to fit the PR view. |
| [eslint-plugin-jest no-focused-tests](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-focused-tests.md) | Language-aware checks catch exclusive calls and bracket-property syntax; developer suggestions avoid blind automatic fixes. | Improve known source patterns, state parser/alias limits and recommend native runner protections. Do not claim a small lexer matches a full language-aware linter. |

The compared source repositories [reviewdog](https://github.com/reviewdog/reviewdog/blob/master/LICENSE),
[Gitleaks](https://github.com/gitleaks/gitleaks/blob/master/LICENSE), and
[eslint-plugin-jest](https://github.com/jest-community/eslint-plugin-jest/blob/main/LICENSE)
carry MIT licenses. [Ruff's license file](https://github.com/astral-sh/ruff/blob/main/LICENSE)
includes its MIT license and third-party notices. Semgrep is referenced through its
published documentation; no Semgrep source is incorporated. The new implementation
is original, so these references are design attribution, not a vendored-code notice.

## Public presentation issues found

The primary site still showed v0.2.1, a nonexistent Action `range` input, claimed
panic-loop was a PR blocker, and implied universal sub-200ms execution and no false
positives. Its examples used synthetic scores without clear labeling. Historical
launch/article copy repeated those claims and treated findings as proof of AI intent.
The current cleanup keeps the existing layout but presents current check/review/staged
workflows, valid Action inputs, default severities, explicit demo labels and limitations.
The installed analyzer's offline behavior is distinguished from npm installation,
optional report upload and the website's font request. Older binary GIF/video assets
remain legacy illustrations and are not evidence of present accuracy or adoption.

## Still to validate with real users

Measure which findings teams act on, false positives with denominators, time to first
useful result, CI latency by repository size, and repeat use. These are pilot questions,
not collected results. No one was contacted or automatically enrolled in a pilot.
