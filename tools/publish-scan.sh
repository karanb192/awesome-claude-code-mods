#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_RUN_ID:?}"

branch=nightly-scan
snapshot="$RUNNER_TEMP/completed-scan.json"
body="$RUNNER_TEMP/scan-pr-body.md"
refresh=${1:-}
git fetch origin main
remote_head=$(git ls-remote origin "refs/heads/$branch" | cut -f1)
pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty')
if [ "$refresh" = --refresh ] || [ "$refresh" = --check ]; then
  if [ -z "$pr" ] || [ -z "$remote_head" ]; then exit 0; fi
  git fetch origin "$remote_head"
  if git merge-base --is-ancestor origin/main "$remote_head"; then exit 0; fi
  if [ "$refresh" = --check ]; then echo 'pending=true' >> "${GITHUB_OUTPUT:?}"; exit 0; fi
  node tools/scan-publication.mjs --capture --ref "$remote_head" --snapshot "$snapshot"
else
  node tools/scan-publication.mjs --capture --snapshot "$snapshot"
fi

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
# Only a disposable Actions checkout calls this script; results are saved outside it.
git reset --hard HEAD
for attempt in {1..8}; do
  git fetch origin main
  base=$(git rev-parse origin/main)
  git switch -C "$branch" "$base"
  git branch --set-upstream-to=origin/main "$branch"
  node tools/scan-publication.mjs --snapshot "$snapshot" --cache "$RUNNER_TEMP/scan-revalidation.json"
  set +e
  node tools/changed.mjs > "$RUNNER_TEMP/scan-changes.txt"
  rc=$?
  set -e
  if [ "$rc" -gt 1 ]; then exit "$rc"; fi
  if [ "$rc" = 1 ] && [ "${SCAN_FORCE:-false}" != true ] && [ "$refresh" != --refresh ]; then exit 0; fi
  npm ci
  npm run render
  npm test
  npm run test:render
  npm run lint
  git diff --check
  git add data/repos.txt data/discovery.json data/mods.json README.md catalogue.md badges/ docs/index.html docs/mods.json docs/sitemap.xml docs/robots.txt docs/llms.txt docs/badges/ docs/mods/ docs/404.html docs/site.css docs/access/ docs/topics/ docs/browse/ docs/directory/ data/pages.json
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" != "$base" ]; then
    git reset --hard HEAD
    continue
  fi
  if git diff --cached --quiet; then
    if [ -n "$pr" ] && [ "$(gh pr view "$pr" --json state --jq .state)" = OPEN ]; then gh pr close "$pr"; fi
    exit 0
  fi
  git commit -m 'Scan: refresh footprints and badges'
  {
    echo 'Completed scan reconciled with current main. Newer published repository records and curated README edits are preserved. Review the inventory changes before merging.'
    echo
    echo "Verification run: https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
    echo
    echo '## Changes'
    head -n 300 "$RUNNER_TEMP/scan-changes.txt" | sed 's/^/- /'
    if [ "$(wc -l < "$RUNNER_TEMP/scan-changes.txt")" -gt 300 ]; then echo; echo 'The full list is in the workflow log.'; fi
  } > "$body"
  cat "$RUNNER_TEMP/scan-changes.txt"
  if [ -n "$pr" ] && [ "$(gh pr view "$pr" --json state --jq .state)" != OPEN ]; then
    if [ "$refresh" = --refresh ]; then exit 0; fi
    pr=
  fi
  git push "--force-with-lease=refs/heads/$branch:$remote_head" origin "HEAD:refs/heads/$branch"
  remote_head=$(git rev-parse HEAD)
  if [ -z "$pr" ]; then
    gh pr create --base main --head "$branch" --title 'Scan: refresh footprints and badges' --body-file "$body" --label scan
    pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number')
  else
    gh pr edit "$pr" --title 'Scan: refresh footprints and badges' --body-file "$body"
  fi
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" = "$base" ]; then exit 0; fi
done
echo 'Main advanced throughout eight attempts; publication did not finish.' >&2
exit 1
