#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_RUN_ID:?}"

branch=publish-approved-seeds
body="$RUNNER_TEMP/seed-pr-body.md"
skipped="$RUNNER_TEMP/seed-skipped.md"

# Seeds that could not publish stay pending for the next run; surface them without failing the job.
finish() {
  if [ -s "$skipped" ]; then
    sed 's/^- /::warning title=Seed not published::/' "$skipped"
    { echo '## Seeds not published'; echo; cat "$skipped"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  fi
  exit "$1"
}

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

for attempt in {1..8}; do
  git fetch origin main
  base=$(git rev-parse origin/main)
  git switch -C "$branch" "$base"
  # awesome-lint resolves GitHub from the current branch's configured remote.
  git branch --set-upstream-to=origin/main "$branch"
  node tools/seed-publication.mjs --repos "$RUNNER_TEMP/seeds.txt" --scan "$RUNNER_TEMP/seed-scan.json" --result "$RUNNER_TEMP/seed-result.txt" --skipped "$skipped"
  if [ "$(cat "$RUNNER_TEMP/seed-result.txt")" = unchanged ]; then
    pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty')
    if [ -n "$pr" ]; then gh pr close "$pr"; fi
    finish 0
  fi

  npm ci
  npm run render
  npm test
  npm run test:render
  npm run lint
  git diff --check
  git add data/repos.txt data/mods.json README.md catalogue.md badges/ docs/index.html docs/mods.json docs/badges/
  git commit -m 'Publish approved seed mods'
  seed_head=$(git rev-parse HEAD)
  {
    echo 'Publish missing repositories already approved in data/seeds.txt. Existing inventory entries and the full-scan date are preserved. Validation, rendering and lint passed in the producing run.'
    echo
    echo 'This dedicated publication PR is automatically squash-merged after the checks. Ordinary scan and retirement PRs still need review.'
    if [ -s "$skipped" ]; then
      echo
      echo '## Seeds not published'
      echo
      cat "$skipped"
      echo
      echo 'These seeds stay pending and are retried by later runs. Fix or remove the seed to clear them.'
    fi
    echo
    echo "Verification run: https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  } > "$body"

  # Rebuild on a newer main with the same scan, without repeating clone/validation work.
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" != "$base" ]; then
    continue
  fi
  remote_head=$(git ls-remote origin "refs/heads/$branch" | cut -f1)
  git push "--force-with-lease=refs/heads/$branch:$remote_head" origin "HEAD:refs/heads/$branch"

  pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty')
  if [ -z "$pr" ]; then
    gh pr create --base main --head "$branch" --title 'Publish approved seed mods' --body-file "$body"
    pr=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number')
  else
    gh pr edit "$pr" --title 'Publish approved seed mods' --body-file "$body"
  fi
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" != "$base" ]; then continue; fi
  if gh pr merge "$pr" --squash --delete-branch --match-head-commit "$seed_head" --subject 'Publish approved seed mods' --body 'Publish validated additions from approved seeds.'; then
    finish 0
  fi
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" = "$base" ]; then
    echo 'Publication merge failed without a main update; check repository permissions or branch rules.' >&2
    exit 1
  fi
done
echo 'Main advanced throughout eight publication attempts; pending seeds will be retried by the next run.' >&2
exit 1
