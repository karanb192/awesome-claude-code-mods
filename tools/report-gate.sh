#!/usr/bin/env bash
set -euo pipefail

# Reports the required ci-gate check on a commit a workflow pushed for its own pull request. Pull requests
# opened with the workflow token start no workflows, so the run that built and checked the commit reports
# the check itself. Call it only after that run's tests, render and lint passed for this commit.
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_RUN_ID:?}"
sha=${1:?usage: report-gate.sh <commit sha>}

gh api --method POST "repos/$GITHUB_REPOSITORY/statuses/$sha" \
  -f state=success \
  -f context=ci-gate \
  -f description='Tests, render and lint passed in the run that produced this commit' \
  -f target_url="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" > /dev/null
