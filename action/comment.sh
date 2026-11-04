#!/usr/bin/env bash
# Posts the agent-roast report as one pull request comment and keeps that comment up to date.
# Usage: comment.sh <markdown-report-file>   (needs GH_TOKEN, GITHUB_REPOSITORY and PR_NUMBER)
# It never fails the job: a fork's token is read-only, and the report is also in the job summary.
set -u
body_file="${1:?usage: comment.sh <markdown-report-file>}"
marker='<!-- agent-roast:comment -->'
repo="${GITHUB_REPOSITORY:-}"
number="${PR_NUMBER:-}"
if [ -z "$repo" ] || [ -z "$number" ]; then
  echo "::notice::agent-roast: there is no pull request to comment on."
  exit 0
fi

# The newest comment this action wrote earlier, if any.
existing="$(gh api "repos/$repo/issues/$number/comments" --paginate --jq ".[] | select(.body | startswith(\"$marker\")) | .id" 2>/dev/null | tail -n 1)" || existing=""

# Nothing to report and nothing to correct: stay quiet instead of adding a comment to every pull request.
if grep -q '\*\*0 new\*\*' "$body_file" && ! grep -q 'Accepted exceptions' "$body_file" && [ -z "$existing" ]; then
  exit 0
fi

payload="$(mktemp)"
{
  printf '%s\n' "$marker"
  cat "$body_file"
  printf '\n\n<sub>Checked offline by [agent-roast](https://github.com/Nari-Ab/agent-roast): the code did not leave this runner.</sub>\n'
} > "$payload"

if [ -n "$existing" ]; then
  gh api --method PATCH "repos/$repo/issues/comments/$existing" -F "body=@$payload" > /dev/null 2>&1 \
    || echo "::notice::agent-roast: could not update its comment (a read-only token on a fork?). The report is in the job summary."
else
  gh api --method POST "repos/$repo/issues/$number/comments" -F "body=@$payload" > /dev/null 2>&1 \
    || echo "::notice::agent-roast: could not post a comment (a read-only token on a fork?). The report is in the job summary."
fi
rm -f "$payload"
exit 0
