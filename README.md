# Awesome Claude Code Mods [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

A community list of Claude Code mods (function hooks) for **Claude Code 2.1.287+**. A mod is a plugin that uses JavaScript or TypeScript functions to change Claude Code's interface or behavior. [Browse the catalogue](https://mods.aidojo.si/).

Add a browser beside your conversation, keep usage in view, or check a command before it runs. Install a community mod or [ask Claude to build one](https://claude.dev/blog/getting-started-with-claude-code-mods/#the-shortcut-let-claude-build-it).

This community catalogue scans public GitHub repositories and records what Claude's validator reports each mod can read, write, run or send over the network. It is an independent scan, not an official Anthropic directory.

<!-- stats:start -->
**2686 mods** · Last scanned 2026-10-06.
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
- [model-pick](https://github.com/joshuatonga/mini-claude-mods/tree/main/model-pick) - `/pick` fuzzy-searches a model and effort combo and applies it through `/model` and `/effort`, with favorites, typed aliases and the last five picks.
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
- [weektoken](https://github.com/3dnow/claude-mods/tree/main/weektoken) - Pace for the 5-hour, 7-day and per-model weekly limits such as Fable, shown as usage against elapsed time above the prompt, plus a `/weektoken` pane with a run-out forecast and a burn-up chart of past windows.
- [clawd-dash](https://github.com/pinkpixel-dev/clawd-dash) - A three-column dashboard under the prompt with 5-hour, 7-day and context gauges, model, effort, cost, session stats, git status and file changes, plus an animated pixel Clawd that works, celebrates and relaxes along with the session.

## While you wait

- [Mindful-Claude](https://github.com/halluton/Mindful-Claude) - A guided breathing band above the prompt while a turn runs; the spinner counts the breath with you.
- [cc-arcade](https://github.com/sezaakgun/cc-arcade) - Nine games above the prompt, paused when Claude finishes, plus a pet fed by the tests, commits and edits Claude makes.
- [claude-games](https://github.com/mohi-devhub/claude-games) - A dodge race, Breakout, a dino runner and a side-scrolling shooter that react to Claude's real edits and commits.
- [clawd-tales](https://github.com/plaxagoras/clawd-tales) - Clawd acts out every tool call above the prompt with a one-line caption, joined by subagents tinted by model, with failing tests as bugs, todos as pellets and context fill as weather, drawn locally with no model calls or network.
- [clawd-spinner](https://github.com/saiharsha03/clawd-spinner) - Clawd acts out the spinner word above the terminal spinner line while Claude works, with its own scene for each of the 189 words, drawn locally with no model calls or network.
- [heavens-feel](https://github.com/yedidyakfir/heavens-feel) - A Fate/stay night: Heaven's Feel cast for your session, with an animated pixel Sakura in a pane and above the prompt who acts out each tool call, a Servant for every subagent whose transcript opens from its card, and a Master's or Servant's face beside each reply, drawn locally with no model calls or network.
- [cc-pokedex](https://github.com/deonmenezes/claude-mods-pokedex) - Wild creatures appear above the prompt based on where your prompt leads.
- [nibbl](https://github.com/nuromirzak/nibbl) - A pixel pet above the prompt that drops a bug when a tool fails and eats it when a test, lint or build passes; syncs event types and times to its own server.
- [time](https://github.com/diegorv/claude-functions-hook/tree/main/plugins/time) - The time you sent each message, drawn above it.
- [combo-meter](https://github.com/SARTHAK2511/claude-combo) - A fighting-game combo counter above the prompt: every clean tool call is a hit and every error breaks the chain, with D to SSS ranks, special moves like a red-to-green test, a pixel-art counter, toasts, chiptune effects on macOS and an all-time record, making no network calls.
- [boss-fight](https://github.com/OneWave-AI/claude-code-mods/tree/main/boss-fight) - Failing tests spawn a pixel boss with one HP per failure, and each run that fixes tests lands a hit.
- [intermission](https://github.com/jarrodwatts/intermission) - Doom deathmatch in a Ghostty or kitty pane on macOS 15+, returning you to Claude when it finishes or needs input; downloads and runs Odamex and connects to a shared game server.
- [spinner](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/spinner) - Pixel-art scenes above the prompt while a turn runs, in fourteen themes, with a pet that follows the running tool, levels up and gets a confetti finale.
- [hitokoto](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hitokoto) - A quote fetched from the Hitokoto (一言) API above the prompt with its source, refreshed on a timer, once a day, per session or per prompt.
- [minefield](https://github.com/reporails/arcade/tree/main/minefield) - Minesweeper in a pane beside the transcript, with big square tiles when docked, a best time and a face that follows your cursor, hooking no prompt or tool call and making no network calls.
- [meanwhile](https://github.com/njp-coder/meanwhile) - One question a day above the prompt, written by a daily Haiku call from the Hacker News front page and new GitHub repos, with the answer after 40 seconds of Claude working or on Show answer, and `/wrapped` for a share card of the day.
- [cs-radio](https://github.com/ben-rogerson/claude-counter-strike) - Counter-Strike 1.6 radio calls on Claude Code events, from "Fire in the hole" when a deploy starts to "Bomb has been defused" when a long turn lands, played from your own CS install or bundled soundalikes.
- [claude-pokemon](https://github.com/dgokcin/claude-pokemon-mod) - Any of the 151 gen 1 Pokémon above the prompt to feed, pet and evolve, with a Poké Ball for each running subagent and 135 animated attacks.
- [Pixel Play](https://github.com/chrisluo5311/Pixel-Play) - A docked pane that streams a YouTube or local playlist through mpv and yt-dlp while an animated pixel-art skin of your choice dances beside the conversation.

## Git, pull requests and CI

- [cc-pr-tracker](https://github.com/sezaakgun/cc-pr-tracker) - Watched pull requests as lines above the prompt, with merge state, review and required checks, and a toast when one changes.
- [gh-ci-status](https://github.com/diegorv/claude-functions-hook/tree/main/plugins/gh-ci-status) - GitHub Actions runs of the session's repo pinned above the prompt, with links to the PR and the run.
- [vercel-deploy-status](https://github.com/ray-amjad/awesome-claude-code-function-hooks/tree/main/plugins/vercel-deploy-status) - The Vercel deploy queue of the linked project under the prompt, woken by a push or a merge.
- [pr-bridge-watch](https://github.com/ippoan/gh-actions-live/tree/main/mods/pr-bridge-watch) - Connects a new PR's CI to a live watch over a WebSocket bridge.
- [deploy-verify](https://github.com/yash-gadodia/claude-mods/tree/main/deploy-verify) - Checks configured live URLs after recognized deploy commands, waits for relevant GitHub Actions runs when present, and adds the verification result to model context.
- [pr-pulse](https://github.com/gerricchaplin/pr-pulse) - Live status, merge readiness, failed-check drill-down, review threads and change alerts for your GitHub pull requests, in a pane that collapses to a band above the prompt.
- [github-issues](https://github.com/MarcoCarnevali/claude-code-mods/tree/main/github-issues) - A pane of a repository's GitHub issues as cards, with tabs, search, a label filter, linked pull requests and a picker of your repositories, plus a button that hands an issue to Claude, all read through the GitHub CLI.

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
- [micro-compaction](https://github.com/ruihe774/cc-micro-compaction) - Adds `/compact micro`, which replaces Read results with placeholders and drops thinking without a model call, leaving every other message as it was.
- [pinboard](https://github.com/sirkitree/pinboard) - A pane that keeps open decisions, the task list and links Claude creates in view while the transcript scrolls, updated through its own tool.
- [mokkan](https://github.com/vicmpen/mokkan/tree/main/claude-plugin) - `/mokkan` docks a pane of todos and timed reminders beside the transcript, shared with every Claude Code, Codex and terminal session through the mokkan server (api.mokkan.dev), which emails a due reminder nobody acknowledges.
- [agent-compact-advisor](https://github.com/apolenkov/agent-compact-advisor) - A 0-100 score in the status line for how good a moment it is to `/compact`, with a ready `/compact` suggestion past a threshold and a template added to every compaction that keeps the goal, decisions and open leftovers; it never compacts by itself, and its one network call goes to a local Kev endpoint on loopback.

## Rendering

- [terminal-browser](https://github.com/zenbu-labs/terminal-browser/tree/main/claude-code-plugin) - A browser beside your Claude Code conversation for websites, local HTML previews and GitHub pull requests.
- [claude-mermaid](https://github.com/galElmalah/claude-mermaid) - Every mermaid block Claude writes is drawn as box art, in colour, where the fence was in the transcript.
- [skins](https://github.com/hellosverre/claude-skins) - Restyles the transcript with themed tool rows, reply gutters and spinner words, and draws tables, code, diffs and shell output as animated cards on the desktop.
- [mdview](https://github.com/xuanji86/claude-mdview) - Click a markdown path in the conversation to read the file rendered in a side pane with contents, find and pictures, or in Warp's own viewer, and point at any block to have Claude edit it.
- [gfm-render](https://github.com/briangtn/claude-gfm-render) - Draws GitHub alerts, task lists, strikethrough and Mermaid diagrams in Claude's replies, as box art in the terminal and SVG on the desktop.
- [ko-ui](https://github.com/moduvoice/claude-code-ko-ui) - Shows slash-command descriptions, `/config` rows, spinner words, tool-call summaries and some transcript lines in Korean from a static dictionary, with no model calls or network.
- [explain-as](https://github.com/Sumit189/explain-claude-mod) - `/explain` turns answers into plain ASD-STE100 prose, a Mermaid diagram or an HTML page shown as a zoomable picture in a pane (screenshot by a local headless Chrome), or a narrated canvas explainer video that plays in Chrome.
- [prismantis](https://github.com/NahumLitvin/prismantis) - Redraws Claude's replies in a chosen colour theme, with tables, highlighted code, numbers and paths, GitHub alerts, mermaid diagrams and charts as box art, and right-to-left Hebrew and Arabic.
- [tex-display](https://github.com/samox73/claude-code-latex) - Draws LaTeX display math in Claude's replies as typeset pictures in kitty and Ghostty and as Unicode text elsewhere, with MathJax bundled, so it runs no processes and writes no files.

## Agents and workflows

- [agent-shell-watch](https://github.com/apolenkov/agent-shell-watch) - A status line and a `/shell-watch` pane for every Bash call, background task and delegated agent run of the session (Codex, Pi, Devin), with elapsed time, output freshness, the current output line and errors.
- [agent-council](https://github.com/apolenkov/agent-council) - `/council` runs the Codex, Pi, Devin and OpenCodeReview CLIs on the working diff in parallel, which sends the diff to their providers, and merges their findings into agreements, disagreements and unique findings.
- [autodev-core](https://github.com/djnsty23/claude-auto-dev/tree/main/plugins/autodev-core) - Brainstorm, auto, iterate, audit, review and ship commands with a prd.json sprint system.
- [catalyst-probes](https://github.com/TransmuteLabs/Catalyst/tree/main/plugins/catalyst-probes) - A consultation and prompt engine configured by TOML tables of probes and prompts.
- [autotel](https://github.com/jagreehal/autotel/tree/main/packages/autotel-claude-code) - OpenTelemetry for mods: adds `$.autotel` in the engine.create fold and traces every hook dispatch.
- [homie-persona-cognition](https://github.com/TheSmokeDev/taskchad-os/tree/main/.claude/plugins/persona-cognition) - Host-bound cognitive lifecycle events for a persona system.
- [agent-race](https://github.com/OneWave-AI/claude-code-mods/tree/main/agent-race) - Puts several sessions on one track for the same task and scores tools, edits, tests and cost per lane.
- [AFKSwitch](https://github.com/augbastos/afkswitch) - A one-click presence switch above the terminal prompt that tells live sessions when you leave and collects their status when you return.
- [prompt-spellcheck](https://github.com/ljmerza/prompt-spellcheck/tree/main/plugins/prompt-spellcheck) - Uses an extra Haiku call to correct typos before a submitted prompt reaches the model, skips fenced code, and shows changes in a toast, with a `/spellcheck` toggle.
- [next-steps](https://github.com/pawandeepdhall/claude-mods/tree/main/plugins/next-steps) - After each reply, up to six Haiku-generated next steps appear above the prompt; select one or more and press Send to have Haiku compose and submit a combined prompt.
- [agentpane](https://github.com/xuanji86/claude-agentpane) - A side pane of the session's subagents with each one's current tool call and tokens, its conversation drawn in place on a click, and Stop; it opens when an agent starts and folds to a tab when they finish.
- [gsd-status-mod](https://github.com/helenkwok/gsd-status-mod) - For GSD projects: shows where work stopped and a STATE.md drift warning above the prompt, adds the handoff's next action to the hint line, and offers the command it names as a Tab suggestion.
- [claude-council](https://github.com/danzerzine/claude-council) - A band above the prompt that brings GPT in as fresh eyes on a stuck question, with its answer, Claude's take and GPT's reply pasted into the chat, and can have Codex check every handover against the chat's spec and send gross violations back before the agent answers.

## Building mods

- [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) - Anthropic's guide to building, testing and sharing a mod, with version requirements and working examples.
- [Claude Code mods announcement](https://claude.com/blog/claude-code-mods) - The launch overview for customizing behavior and UI in the terminal and desktop app.
- [Function Hooks: the issue](https://github.com/anthropics/claude-code/issues/91870) - The design thread: architecture PDF, nine demo videos, the cheat sheet and the community updates.
- [Anthropic's built-in mods](https://github.com/anthropics/claude-code/tree/main/mods) - Source of diff, sec-default and telemetry, with the test kit and the noun-contract convention.
- [claude-mods-skill](https://github.com/BeLazy167/claude-mods-skill) - A skill that teaches Claude to build a mod, with a working hello-mod to copy.
- [mod-builder](https://github.com/noeltock/mod-builder) - A skill that mocks up, builds and tests a mod so it looks native in the terminal and the desktop app.
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
