# Contributing

Two ways to get a mod listed.

## Let the scanner find it

A daily scan searches GitHub code for repositories that mention `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` or ship a `hooks/hooks.json` with a `modules` key. Public repositories matching those patterns become candidates once GitHub indexes them and discovery succeeds. Every three hours, a faster scan also checks repositories pushed since the last complete search that have the topic `claude-code-mod`, `claude-code-mods`, `claude-mods`, `function-hooks` or `claude-code-plugin`, or "claude mod" in the name or description. With the `claude-code-mod` topic, a scan usually picks up a mod within a few hours of its next push, often before code search indexes it. Results appear after the generated update pull request is merged. Known candidates are retained even when a later search omits them.

## Open a pull request

1. Add your `owner/repo` to `data/seeds.txt`, one per line.
   If you renamed a repository on GitHub, nothing is needed: the scan reads the current name and counts each plugin once, under that name. If you moved a mod to a different repository and the table lists both, add the pair to `data/duplicates.txt` so the old copy stops counting.
   A repo that repackages other authors' mods as a catalogue goes in `data/catalogs.txt`: it is named once with its count rather than listed per copy.
   If the scan files an installable mod as test material only because of its folder name (such as `bench` or `probe`), add its id to `data/fixture-exceptions.txt`.

   Each distinct installable mod counts once, however many mods its repository holds. Sharing a repository or helper code does not make mods duplicates; only a confirmed copy or a renamed repository goes in `data/duplicates.txt`.
2. If you want a curated entry (not only a row in the generated table), add one line under the matching section of `README.md` in this exact shape:

   `- [name](https://github.com/owner/repo) - What it does, one sentence, ending with a period.`

3. Run `npm test` and `npm run lint`. Both must pass.

PR checks scan newly added seeds. A new seed must clone successfully and contain mod plugins that validate; warnings are allowed. A pull request that changes `tools/` (tests aside), the package files, the workflows, `data/catalogs.txt` or `data/fixture-exceptions.txt` rescans every committed candidate alongside the seeds, so tooling and classification changes are checked against the whole collection. A change to `data/duplicates.txt` that only appends pairs between two counted mods, neither named elsewhere in the list, is applied to the committed inventory without a rescan; removing, reversing, reordering or chaining pairs rescans everything. Global search runs in scheduled scans, not in PR checks.

After a seed PR is merged, the `publish approved seeds` workflow scans approved repositories that have no published inventory entries. It adds all their mod entries, regenerates the catalogue and website, checks the result, then opens and squash-merges a dedicated publication PR automatically. It requests a GitHub Pages build explicitly. No second maintainer merge is needed for successful additions. A repository already represented in the inventory follows the normal refresh workflow.

This path preserves existing entries and the last full-scan date. It uses the published validator version, so adding a seed does not imply that the whole catalogue was revalidated. A seed whose repository fails to clone, cannot be fully inspected, fails validation, has a failing marketplace, carries a UI compatibility warning, looks like a duplicate of a listed mod or would change an existing duplicate decision is left out of that publication; the other seeds still publish. Left-out seeds are listed in the run summary and in the publication PR, and they stay pending: a scheduled retry runs every three hours at minute 23, and a later main push also retries them. Fix the repository or remove the seed to clear them. The workflow reads current main, so coalesced pushes do not lose earlier unpublished seeds.

Duplicate rules involving a new seed are checked during publication. Rules between entries already published wait for a reviewed full scan; merging those rules does not block unrelated seed additions or silently change older listings. A new seed that would reclassify an existing mod still waits for review.

Publication runs share a separate queue and never scan in parallel with each other. When several contributor PRs merge, the active run reuses its completed scan on the latest main and repeats generation and checks if needed. The next queued run reads current main and scans all remaining unpublished seeds together. Already published seeds are skipped. A full scan can still run independently; its newer records are preserved. Eight consecutive main changes during publication stop that run for a later retry.

Missing plugins stay listed as unverified during scheduled scans. Weekly retirement proposals require a fresh successful checkout and record the revision used to establish that a hook module is gone. Clone failures and failed validation are not removal evidence. Curated descriptions need a separate human review when an upstream project changes.

The count in `README.md` and the statistics and tables in [catalogue.md](catalogue.md) are generated. Do not edit anything between `<!-- scan:start -->` and `<!-- scan:end -->`, `<!-- builtin:start -->` and `<!-- builtin:end -->`, or `<!-- stats:start -->` and `<!-- stats:end -->`. The renderer would overwrite your change.

## What gets a curated entry

The generated catalogue lists discovered mods, including failed and unverified results. The curated sections in the README list mods that a person would install: a README that explains what it does, an install path that works, and a footprint that matches the description. A game that hooks every tool call to feed a pet is fine. A game that calls `$.http.fetch` without saying why is not.

## Badges

Every scanned mod gets two badges you can paste into your README:

```markdown
![reach](https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/OWNER--REPO--NAME-reach.svg)
![validates](https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/OWNER--REPO--NAME-validates.svg)
```

Replace `OWNER--REPO--NAME` with your GitHub owner, repo and the `name` from your `plugin.json`, joined by double dashes. The exact file names are in the `badges/` folder.

## Disputing a footprint

The footprint is whatever `claude plugin validate` printed for your plugin on the version in the table. If it looks wrong, open an issue with the validator's output from your machine. If the validator and the scanner disagree, the scanner has a bug and it gets fixed.

## Running the tools

The scan keeps plugin validation, marketplace validation and UI source warnings separate. For a reserved-name failure, rename the manifest entry and update its marketplace listing and install instructions. For a UI source warning, inspect the linked strings and any values passed to `next()` as `props.text`. Use plain text for rewrites, then test the mod in an interactive session. A static pass alone does not test that path. The [compatibility report](https://github.com/karanb192/awesome-claude-code-mods/issues/21) describes the 2.1.287 restrictions.

```sh
npm test            # parser, grader and compatibility scanner tests
npx playwright install chromium  # once, for browser checks
npm run test:render  # generated statuses, badges and responsive layout
npm run lint        # awesome-lint on README.md
npm run discover    # refresh data/repos.txt (needs gh logged in)
npm run discover -- --recent --skip-code-search  # the three-hourly scan: seeds plus repos pushed since the last search; progress in data/discovery.json
npm run discover -- --recent --keep-on-failure   # the daily scan: a failed code search keeps the known candidates
npm run scan        # clone, validate, write data/mods.json (needs the claude CLI)
npm run scan -- --retire  # weekly removal audit; writes revision evidence for review
npm run render      # regenerate README count, catalogue.md, badges/ and docs/
node tools/changed.mjs   # exit 0 if the scan differs from HEAD on anything but stars and timestamps
```

### Website

The landing page is generated from `data/mods.json`. Edit `tools/site.mjs`, `tools/site.css` or `tools/site-client.js`, then run `npm run render`. Do not edit `docs/index.html` directly.

Each scheduled scan runs this renderer and includes the updated README count, catalogue, landing page and public JSON in the same automated scan pull request. Merging that pull request publishes the collection through GitHub Pages. No separate website edit or pull request is needed for new scanned mods.

Approved seed additions use the separate automatic publication path above. Broader discovery, updates to existing mods and retirement proposals still require review of their generated PRs.

The nightly scan reuses its completed results when main advances during publication. It preserves repository records changed on main since the scan started, including additions and retirements, then regenerates the catalogue and website using current main. If a concurrent record was validated with a different Claude Code version, it revalidates that record at its published source commit using the scan's version. Validation, footprint and marketplace evidence are updated without changing its classification or pulling in newer upstream commits. Those results are cached across publication retries. New seeds that were not scanned stay candidates for seed publication. Up to eight publication attempts reuse the full scan instead of repeating it.

Main pushes and completed seed-publication runs also refresh an open nightly scan PR without a full rescan. Nightly scans, refreshes and weekly retirement runs share a queue with room for up to 100 pending jobs or runs, so a new refresh does not replace a waiting scan. Each reads current main when it starts; redundant refreshes exit before installing dependencies. Contributor checks keep their separate cancellation groups. The scan PR still needs your review and merge. Changes to scanner inputs or classification rules require a fresh scan, as do conflicting duplicate decisions. Missing pinned source or incomplete revalidation stops publication. Weekly retirement proposals still need their separate review.

Search, filtering and sorting run in the browser; the full collection remains readable without JavaScript. Search stays above the results while browsing. The page follows the system's light or dark appearance through `prefers-color-scheme`.

Run `npm run test:render` to check the generated page and its browser interactions. Preview the `docs/` folder with a local static server. GitHub Pages serves this folder, with the domain in `docs/CNAME`.

The social sharing graphic comes from `tools/social.html`. Run `npm run render:social` after editing it. This is a designed graphic, not a screenshot of a running mod.
