#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_RUN_ID:?}"
: "${RULES_BASE:?}"

branch=apply-rule-changes
body="$RUNNER_TEMP/rules-pr-body.md"
title='Apply classification rule changes to the inventory'

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

for attempt in {1..8}; do
  git fetch origin main
  base=$(git rev-parse origin/main)
  git switch -C "$branch" "$base"
  # awesome-lint resolves GitHub from the current branch's configured remote.
  git branch --set-upstream-to=origin/main "$branch"
  node tools/reclassify.mjs --base "$RULES_BASE" --result "$RUNNER_TEMP/rules-result.txt" --changes "$RUNNER_TEMP/rules-changes.txt"
  result=$(cat "$RUNNER_TEMP/rules-result.txt")
  pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty')
  if [ "$result" = unchanged ]; then
    if [ -n "$pr" ]; then gh pr close "$pr"; fi
    exit 0
  fi

  npm ci
  npm run render
  npm test
  npm run test:render
  npm run lint
  git diff --check
  git add data/mods.json README.md catalogue.md badges/ docs/index.html docs/mods.json docs/sitemap.xml docs/robots.txt docs/llms.txt docs/badges/ docs/mods/ docs/404.html docs/site.css docs/access/ docs/topics/ docs/browse/ docs/directory/ data/pages.json finder/.claude-plugin/plugin.json .claude-plugin/marketplace.json
  git commit -m "$title"
  head=$(git rev-parse HEAD)
  {
    echo "A classification rule changed on main. This refiles the committed records that change explains, without a scan, and regenerates the catalogue and website. Rendering, tests and lint passed in the producing run."
    echo
    if [ "$result" = review ]; then
      echo '**Not merged automatically:** the change refiles more than 50 records, moves the counted total by more than 0.5%, or refiles a mod that other records were collapsed onto. Check that the rule does not match more than intended, then merge or close.'
    else
      echo 'This dedicated pull request is squash-merged automatically after the checks.'
    fi
    echo
    echo '## Changes'
    head -n 300 "$RUNNER_TEMP/rules-changes.txt" | sed 's/^/- /'
    echo
    echo "Verification run: https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  } > "$body"

  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" != "$base" ]; then continue; fi
  remote_head=$(git ls-remote origin "refs/heads/$branch" | cut -f1)
  git push "--force-with-lease=refs/heads/$branch:$remote_head" origin "HEAD:refs/heads/$branch"
  if [ -z "$pr" ]; then
    gh pr create --base main --head "$branch" --title "$title" --body-file "$body"
    pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number')
  else
    gh pr edit "$pr" --title "$title" --body-file "$body"
  fi
  if [ "$result" = review ]; then
    echo "::warning title=Rule change needs review::The reclassification is large; pull request $pr was left open."
    exit 0
  fi
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" != "$base" ]; then continue; fi
  if gh pr merge "$pr" --squash --delete-branch --match-head-commit "$head" --subject "$title" --body 'Refile committed records after a classification rule change.'; then
    echo 'merged=true' >> "${GITHUB_OUTPUT:-/dev/null}"
    exit 0
  fi
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" = "$base" ]; then
    echo 'Merge failed without a main update; check repository permissions or branch rules.' >&2
    exit 1
  fi
done
echo 'Main advanced throughout eight attempts; the next scan applies the rules.' >&2
exit 1
