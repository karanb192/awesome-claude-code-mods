<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme-title-dark.svg">
    <img src="assets/readme-title-light.svg" alt="Awesome Claude Code Mods" width="620">
  </picture>
  <a href="https://awesome.re"><img src="https://awesome.re/badge.svg" alt="Awesome"></a>
</h1>

> Discover Claude Code mods and see what each one can access.

Add a browser beside your conversation, keep usage in view, or check a command before it runs. Mods are plugins that change Claude Code's interface and behavior. Install a community mod or [ask Claude to build one](https://claude.dev/blog/getting-started-with-claude-code-mods/#the-shortcut-let-claude-build-it).

This collection automatically discovers public mod repositories and shows what Claude's validator says each mod can read, write or run.

[![Browse all mods](assets/browse-mods.svg)](https://mods.aidojo.si/)

<!-- stats:start -->
**1018 mods** · Last scanned 2026-10-03.
<!-- stats:end -->

![Browsing a GitHub pull request beside a Claude Code conversation using terminal-browser](assets/terminal-browser-demo.gif)

A six-second recording with [terminal-browser by zenbu-labs](https://github.com/zenbu-labs/terminal-browser). [Download the full-resolution video](assets/terminal-browser-demo.mp4?raw=1).

Access reported by the latest scan (select the badge for details):

[![Terminal-browser access reported by the scanner](badges/zenbu-labs--terminal-browser--terminal-browser-reach.svg)](https://mods.aidojo.si/#zenbu-labs--terminal-browser--terminal-browser)

## Contents

- [Use mods](#use-mods)
- [Dashboards and usage](#dashboards-and-usage)
- [While you wait](#while-you-wait)
- [Git, pull requests and CI](#git-pull-requests-and-ci)
- [Safety and privacy](#safety-and-privacy)
- [Memory and context](#memory-and-context)
- [Rendering](#rendering)
- [Agents and workflows](#agents-and-workflows)
- [Building mods](#building-mods)
- [Every mod the scanner found](#every-mod-the-scanner-found)
- [How the scan works](#how-the-scan-works)
- [Contribute](#contribute)
- [Related](#related)

## Use mods

Use **Claude Code 2.1.287 or later**. Mods are enabled by default; no feature flag is needed. Follow the chosen mod's installation instructions, or try a local plugin with `claude --plugin-dir ./path/to/plugin`.

Read the mod's source and access details before installing. Validation checks the source without running the mod; it does not guarantee safe behavior or runtime compatibility.

## Dashboards and usage

- [cctop](https://github.com/tomstagl/cctop) - A btop-style pane with context fill, tokens, cost, cache hit ratio, rate limits, per-tool latency and subagents.
- [token-ledger](https://github.com/Arunjay4213/claude-mods/tree/main/plugins/token-ledger) - A pinned line with session cost, last-turn tokens and cache hit ratio, plus `/ledger` for the table.
- [context-lens](https://github.com/Arunjay4213/claude-mods/tree/main/plugins/context-lens) - A live `/context` line with window fill and growth per turn, plus a pane with per-category bars.
- [quota-meter](https://github.com/Arunjay4213/claude-mods/tree/main/plugins/quota-meter) - The 5-hour and 7-day plan windows as a pinned status line.
- [agent-flow](https://github.com/Charlie0113-T/claude-agent-flow) - `/flow` opens a live tree of the session's subagents and teammates beside the transcript.
- [effort-cycle](https://github.com/Anerco/effort-cycle-mod) - Alt+E and Alt+Shift+E step the effort level without a transcript row, and the footer shows the model and level as a colored meter.
- [burn-meter](https://github.com/OneWave-AI/claude-code-mods/tree/main/burn-meter) - Session spend as a growing fire bar above the prompt, with 5-hour and weekly plan limits and a `/burn` pane with per-turn cost.
- [session-wrapped](https://github.com/OneWave-AI/claude-code-mods/tree/main/session-wrapped) - `/wrapped` plays an animated recap of the session and writes a shareable PNG card, with week and month totals read from local transcripts.
- [context-view](https://github.com/kongyo2/context-view) - The context window as one row above the prompt, drawn like Claude Code's own meters, with the percentage used, tokens over the window and tokens left before auto-compact, plus `/context-view` to hide or show it.
- [wavy-usage](https://github.com/BatuhanCakmakk/wavy-usage) - Desktop usage rings and an effort-level jet, with estimated cache lifetime, recent turn costs, observed 5-hour window growth and a breakdown of locally recorded sessions; the terminal gets a text band.
- [token-weather-usage](https://github.com/augiefra/claude-mods/tree/main/plugins/token-weather-usage) - One line above the prompt with context weather, a bar per prompt sized by the tokens it added, and 5-hour and 7-day limit gauges that hatch the gap with elapsed time.
- [flightdeck](https://github.com/scasella/claude-flightdeck) - A live agent dashboard pane with context and cost, an advisor timeline, every permission verdict, subagent cards and swimlanes, a turn receipt and a session log, watching without changing anything.
- [usage-band](https://github.com/pawandeepdhall/claude-mods/tree/main/plugins/usage-band) - The 5-hour and weekly limits as percentages with reset countdowns above the prompt, amber or red when on pace to run out, plus buttons for a new chat and for asking Claude to commit and push.
- [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud) - The claude-hud statusline as a mod above or below the prompt, with quota alerts, a usage forecast, a daily budget, a one-line task summary forked from the conversation, a detail pane and twelve themes.
- [todo-bar](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/todo-bar) - The task list as a progress bar above the prompt, with the running task's time, read from the todo and task tools' own results.
- [receipt](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/receipt) - One row after each turn with the files changed, lines added and removed, commands run and failed, plus a toast when the model goes in circles.
- [ts-band](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/ts-band) - Tailscale nodes above the prompt from `tailscale status --json`, listing only the relayed or offline ones, with a toast when a node comes up or goes down.
- [statuspane](https://github.com/xuanji86/claude-statuspane) - A floating status card above the prompt with model, effort, context, 5-hour and weekly limits, cost and branch, plus GitHub CI rows and progress bars any script or mod can feed.
- [agent-quick-menu](https://github.com/agentic-workbench/agent-quick-menu) - A pane and prompt band for plugin commands declared in `quick-menu.json`, plus plugin and Claude Code settings exposed through `/config`.

## While you wait

- [Mindful-Claude](https://github.com/halluton/Mindful-Claude) - A guided breathing band above the prompt while a turn runs; the spinner counts the breath with you.
- [cc-arcade](https://github.com/sezaakgun/cc-arcade) - Nine games above the prompt, paused when Claude finishes, plus a pet fed by the tests, commits and edits Claude makes.
- [claude-games](https://github.com/mohi-devhub/claude-games) - A dodge race, Breakout, a dino runner and a side-scrolling shooter that react to Claude's real edits and commits.
- [clawd-spinner](https://github.com/saiharsha03/clawd-spinner) - Clawd acts out the spinner word above the terminal spinner line while Claude works, with its own scene for each of the 189 words, drawn locally with no model calls or network.
- [cc-pokedex](https://github.com/deonmenezes/claude-mods-pokedex) - Wild creatures appear above the prompt based on where your prompt leads.
- [nibbl](https://github.com/nuromirzak/nibbl) - A pixel pet above the prompt that drops a bug when a tool fails and eats it when a test, lint or build passes; syncs event types and times to its own server.
- [time](https://github.com/diegorv/claude-functions-hook/tree/main/plugins/time) - The time you sent each message, drawn above it.
- [boss-fight](https://github.com/OneWave-AI/claude-code-mods/tree/main/boss-fight) - Failing tests spawn a pixel boss with one HP per failure, and each run that fixes tests lands a hit.
- [intermission](https://github.com/jarrodwatts/intermission) - Doom deathmatch in a Ghostty or kitty pane on macOS 15+, returning you to Claude when it finishes or needs input; downloads and runs Odamex and connects to a shared game server.
- [spinner](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/spinner) - Pixel-art scenes above the prompt while a turn runs, in fourteen themes, with a pet that follows the running tool, levels up and gets a confetti finale.
- [hitokoto](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hitokoto) - A quote fetched from the Hitokoto (一言) API above the prompt with its source, refreshed on a timer, once a day, per session or per prompt.

## Git, pull requests and CI

- [cc-pr-tracker](https://github.com/sezaakgun/cc-pr-tracker) - Watched pull requests as lines above the prompt, with merge state, review and required checks, and a toast when one changes.
- [gh-ci-status](https://github.com/diegorv/claude-functions-hook/tree/main/plugins/gh-ci-status) - GitHub Actions runs of the session's repo pinned above the prompt, with links to the PR and the run.
- [vercel-deploy-status](https://github.com/ray-amjad/awesome-claude-code-function-hooks/tree/main/plugins/vercel-deploy-status) - The Vercel deploy queue of the linked project under the prompt, woken by a push or a merge.
- [pr-bridge-watch](https://github.com/ippoan/gh-actions-live/tree/main/mods/pr-bridge-watch) - Connects a new PR's CI to a live watch over a WebSocket bridge.
- [deploy-verify](https://github.com/yash-gadodia/claude-mods/tree/main/deploy-verify) - Checks configured live URLs after recognized deploy commands, waits for relevant GitHub Actions runs when present, and adds the verification result to model context.

## Safety and privacy

- [secret-redactor](https://github.com/ray-amjad/awesome-claude-code-function-hooks/tree/main/plugins/secret-redactor) - Swaps secrets, email addresses and IPs for stable placeholders before the model reads them, and restores them on the way into a tool call.
- [honmoon-redact](https://github.com/pleaseai/honmoon/tree/main/packages/claude-plugin) - Redacts API keys and sensitive identifiers from Read, Bash and Grep output before it reaches the model.
- [kb-settings-guard](https://github.com/ray-manaloto/knowledge-base/tree/main/.claude/mods/kb-settings-guard) - Denies a delegated agent lane any write to the repo's Claude settings files.
- [claude-doctor](https://github.com/ray-manaloto/dotfiles/tree/main/.claude/skills/claude-doctor) - Reports an install health verdict at session start and refuses tool calls while the install is provably broken.
- [plugin-health](https://github.com/ray-manaloto/dotfiles/tree/main/.claude/skills/plugin-health) - Reports at session start when plugins declared in settings are not installed or are disabled for the project.
- [launch-codes](https://github.com/OneWave-AI/claude-code-mods/tree/main/launch-codes) - Requires a one-time code and confirmation for selected risky Bash commands, including `git push --force` and `vercel --prod`.
- [scope-guard](https://github.com/yash-gadodia/claude-mods/tree/main/scope-guard) - Tracks recognized file edits against a configurable threshold, with a model judge and user overrides that can permit further edits.
- [merge-gate](https://github.com/yash-gadodia/claude-mods/tree/main/merge-gate) - Checks merge permission for recognized Bash merge commands and selected pushes from feature branches to trunk.
- [receipt](https://github.com/yash-gadodia/claude-mods/tree/main/receipt) - Turns the turn footer into a receipt of edits, runs and curls, never folds a destructive command into a tool group, and names an unverified claim in the spinner.

## Memory and context

- [lcm](https://github.com/lossless-claude/lcm) - Lossless context management: DAG-based summarization that keeps every message reachable.
- [kindex-modern](https://github.com/wandercom/kindex/tree/main/src/kindex/claude_modern) - Repo-local memory and durable tasks that learn from your conversations.
- [segmem](https://github.com/mahuebel/segmem) - Segmented, scoped memory in one SQLite file: wakes at session start, recalls on every prompt, nags when stale.
- [commonplace](https://github.com/noopz/commonplace) - An LLM-maintained knowledge base for Obsidian vaults that triggers on paper sharing and research questions.
- [aside](https://github.com/JayDoubleu/aside) - A read-only side chat in a pane: ask about the session so far and a tool-less fork of the transcript answers.
- [harness-scope](https://github.com/shimo4228/harness-scope) - Per-repo profiles for global skills, agents, rules files and tools: a repo picks a named profile from ~/.claude and Claude sees only what it allows, with no network or model calls.

## Rendering

- [terminal-browser](https://github.com/zenbu-labs/terminal-browser/tree/main/claude-code-plugin) - A browser beside your Claude Code conversation for websites, local HTML previews and GitHub pull requests.
- [claude-mermaid](https://github.com/galElmalah/claude-mermaid) - Every mermaid block Claude writes is drawn as box art, in colour, where the fence was in the transcript.
- [skins](https://github.com/hellosverre/claude-skins) - Restyles the transcript with themed tool rows, reply gutters and spinner words, and draws tables, code, diffs and shell output as animated cards on the desktop.
- [mdview](https://github.com/xuanji86/claude-mdview) - Click a markdown path in the conversation to read the file rendered in a side pane with contents, find and pictures, or in Warp's own viewer, and point at any block to have Claude edit it.

## Agents and workflows

- [autodev-core](https://github.com/djnsty23/claude-auto-dev/tree/main/plugins/autodev-core) - Brainstorm, auto, iterate, audit, review and ship commands with a prd.json sprint system.
- [catalyst-probes](https://github.com/TransmuteLabs/Catalyst/tree/main/plugins/catalyst-probes) - A consultation and prompt engine configured by TOML tables of probes and prompts.
- [autotel](https://github.com/jagreehal/autotel/tree/main/packages/autotel-claude-code) - OpenTelemetry for mods: adds `$.autotel` in the engine.create fold and traces every hook dispatch.
- [homie-persona-cognition](https://github.com/TheSmokeDev/taskchad-os/tree/main/.claude/plugins/persona-cognition) - Host-bound cognitive lifecycle events for a persona system.
- [agent-race](https://github.com/OneWave-AI/claude-code-mods/tree/main/agent-race) - Puts several sessions on one track for the same task and scores tools, edits, tests and cost per lane.
- [AFKSwitch](https://github.com/augbastos/afkswitch) - A one-click presence switch above the terminal prompt that tells live sessions when you leave and collects their status when you return.
- [next-steps](https://github.com/pawandeepdhall/claude-mods/tree/main/plugins/next-steps) - After each reply, up to six Haiku-generated next steps appear above the prompt; select one or more and press Send to have Haiku compose and submit a combined prompt.
- [agentpane](https://github.com/xuanji86/claude-agentpane) - A side pane of the session's subagents with each one's current tool call and tokens, its conversation drawn in place on a click, and Stop; it opens when an agent starts and folds to a tab when they finish.
- [gsd-status-mod](https://github.com/helenkwok/gsd-status-mod) - For GSD projects: shows where work stopped and a STATE.md drift warning above the prompt, adds the handoff's next action to the hint line, and offers the command it names as a Tab suggestion.

## Building mods

- [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) - Anthropic's guide to building, testing and sharing a mod, with version requirements and working examples.
- [Claude Code mods announcement](https://claude.com/blog/claude-code-mods) - The launch overview for customizing behavior and UI in the terminal and desktop app.
- [Function Hooks: the issue](https://github.com/anthropics/claude-code/issues/91870) - The design thread: architecture PDF, nine demo videos, the cheat sheet and the community updates.
- [Anthropic's built-in mods](https://github.com/anthropics/claude-code/tree/main/mods) - Source of diff, sec-default and telemetry, with the test kit and the noun-contract convention.
- [claude-mods-skill](https://github.com/BeLazy167/claude-mods-skill) - A skill that teaches Claude to build a mod, with a working hello-mod to copy.
- [awesome-claude-code-function-hooks](https://github.com/ray-amjad/awesome-claude-code-function-hooks) - The first list, from before the rename, with two plugins and a clean tsconfig recipe.

## Every mod the scanner found

The **[full catalogue](catalogue.md#every-mod-the-scanner-found)** includes each discovered mod's description, access, observed events and validation result. [Built-in mods](catalogue.md#built-into-claude-code) are listed separately. [Search and filter the collection on the website](https://mods.aidojo.si/#directory).

## How the scan works

A scheduled scan searches GitHub for mod repositories, checks their plugin source with `claude plugin validate`, and proposes updates for review. The website and catalogue use the same scan data. Published results change when the update PR is merged.

Merging a seed submission also starts a separate publication check. New repositories with passing checks appear automatically after their generated update is merged by the workflow and the website deploys. Existing listings stay unchanged. A seed with validation failures or new review warnings stays unpublished and is reported in the workflow run; other seeds still publish. [Seed publication details](contributing.md#open-a-pull-request).

Discovery depends on GitHub's index and our search patterns, so a new mod may not appear immediately. A scan usually picks up a repository with the `claude-code-mod` topic within a few hours of its next push, and the mod appears once that scan's pull request is merged. [How discovery and validation work](catalogue.md#how-the-scan-works) covers access levels, warnings, retry handling and removal reviews.

## Contribute

Found a mod worth sharing, or a listing that needs a correction? [Open a pull request](https://github.com/karanb192/awesome-claude-code-mods/pulls). The [contribution guide](contributing.md) explains automatic discovery, manual submissions and how to dispute a footprint.

## Related

- [claude-code-hooks](https://github.com/karanb192/claude-code-hooks) - Shell-hook plugins for safety, cost, observability and productivity, the layer mods are replacing.
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) - The general Claude Code list.
