# Awesome Claude Code Mods [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> Every Claude Code mod on GitHub, with what each one can reach.

A Claude Mod is a Claude Code plugin whose hooks are TypeScript functions that run inside Claude Code's own process. They draw above the prompt, open panes beside the transcript, rewrite tool calls, spawn agents and touch the host, all with zero tokens. Anthropic proposed them as function hooks on 2026-09-03 and committed to shipping them on 2026-09-09; the design thread is listed under Building mods below. They are early access: set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` or nothing loads, and the API can change between releases.

This list is different from a plain index in one way. Every row carries the mod's **footprint**: the events it hooks and the `$` calls it makes, printed by Claude's own `claude plugin validate` before any mod code runs. A nightly scan clones every candidate repo on GitHub and refreshes the table, the badges and the [scoreboard page](https://mods.karanbansal.in/), which is generated from the same data. The method is described below the tables.

<!-- stats:start -->
As of 2026-09-16, scanned against Claude Code 2.1.273: **1 mods** in **2 candidate repos**. 0 run host processes, 0 write files, 0 read files, 0 reach the network, 0 see every tool call, 0 see every prompt, 0 fail to validate on this version. Reach levels: L0 draws and remembers: 1 · L1 reads: 0 · L2 writes or runs: 0 · L3 network: 0.
<!-- stats:end -->

## Contents

- [Dashboards and usage](#dashboards-and-usage)
- [While you wait](#while-you-wait)
- [Git, pull requests and CI](#git-pull-requests-and-ci)
- [Safety and privacy](#safety-and-privacy)
- [Memory and context](#memory-and-context)
- [Rendering](#rendering)
- [Agents and workflows](#agents-and-workflows)
- [Building mods](#building-mods)
- [Every mod the scanner found](#every-mod-the-scanner-found)
- [Built into Claude Code](#built-into-claude-code)
- [How the scan works](#how-the-scan-works)
- [Turn mods on](#turn-mods-on)
- [Related](#related)

## Dashboards and usage

- [cctop](https://github.com/tomstagl/cctop) - A btop-style pane with context fill, tokens, cost, cache hit ratio, rate limits, per-tool latency and subagents.
- [token-ledger](https://github.com/Arunjay4213/claude-mods/tree/main/plugins/token-ledger) - A pinned line with session cost, last-turn tokens and cache hit ratio, plus `/ledger` for the table.
- [context-lens](https://github.com/Arunjay4213/claude-mods/tree/main/plugins/context-lens) - A live `/context` line with window fill and growth per turn, plus a pane with per-category bars.
- [quota-meter](https://github.com/Arunjay4213/claude-mods/tree/main/plugins/quota-meter) - The 5-hour and 7-day plan windows as a pinned status line.
- [agent-flow](https://github.com/Charlie0113-T/claude-agent-flow) - `/flow` opens a live tree of the session's subagents and teammates beside the transcript.

## While you wait

- [Mindful-Claude](https://github.com/halluton/Mindful-Claude) - A guided breathing band above the prompt while a turn runs; the spinner counts the breath with you.
- [cc-arcade](https://github.com/sezaakgun/cc-arcade) - Nine games above the prompt, paused when Claude finishes, plus a pet fed by the tests, commits and edits Claude makes.
- [claude-games](https://github.com/mohi-devhub/claude-games) - A dodge race, Breakout, a dino runner and a side-scrolling shooter that react to Claude's real edits and commits.
- [cc-pokedex](https://github.com/deonmenezes/claude-mods-pokedex) - Wild creatures appear above the prompt based on where your prompt leads.
- [time](https://github.com/diegorv/claude-functions-hook/tree/main/plugins/time) - The time you sent each message, drawn above it.

## Git, pull requests and CI

- [cc-pr-tracker](https://github.com/sezaakgun/cc-pr-tracker) - Watched pull requests as lines above the prompt, with merge state, review and required checks, and a toast when one changes.
- [gh-ci-status](https://github.com/diegorv/claude-functions-hook/tree/main/plugins/gh-ci-status) - GitHub Actions runs of the session's repo pinned above the prompt, with links to the PR and the run.
- [vercel-deploy-status](https://github.com/ray-amjad/awesome-claude-code-function-hooks/tree/main/plugins/vercel-deploy-status) - The Vercel deploy queue of the linked project under the prompt, woken by a push or a merge.
- [pr-bridge-watch](https://github.com/ippoan/gh-actions-live/tree/main/mods/pr-bridge-watch) - Connects a new PR's CI to a live watch over a WebSocket bridge.

## Safety and privacy

- [secret-redactor](https://github.com/ray-amjad/awesome-claude-code-function-hooks/tree/main/plugins/secret-redactor) - Swaps secrets, email addresses and IPs for stable placeholders before the model reads them, and restores them on the way into a tool call.
- [honmoon-redact](https://github.com/pleaseai/honmoon/tree/main/packages/claude-plugin) - Redacts API keys and sensitive identifiers from Read, Bash and Grep output before it reaches the model.
- [kb-settings-guard](https://github.com/ray-manaloto/knowledge-base/tree/main/.claude/mods/kb-settings-guard) - Denies a delegated agent lane any write to the repo's Claude settings files.
- [claude-doctor](https://github.com/ray-manaloto/dotfiles/tree/main/.claude/skills/claude-doctor) - Reports an install health verdict at session start and refuses tool calls while the install is provably broken.
- [plugin-health](https://github.com/ray-manaloto/dotfiles/tree/main/.claude/skills/plugin-health) - Reports at session start when plugins declared in settings are not installed or are disabled for the project.

## Memory and context

- [lcm](https://github.com/lossless-claude/lcm) - Lossless context management: DAG-based summarization that keeps every message reachable.
- [kindex-modern](https://github.com/wandercom/kindex/tree/main/src/kindex/claude_modern) - Repo-local memory and durable tasks that learn from your conversations.
- [segmem](https://github.com/mahuebel/segmem) - Segmented, scoped memory in one SQLite file: wakes at session start, recalls on every prompt, nags when stale.
- [commonplace](https://github.com/noopz/commonplace) - An LLM-maintained knowledge base for Obsidian vaults that triggers on paper sharing and research questions.
- [aside](https://github.com/JayDoubleu/aside) - A read-only side chat in a pane: ask about the session so far and a tool-less fork of the transcript answers.

## Rendering

- [claude-mermaid](https://github.com/galElmalah/claude-mermaid) - Every mermaid block Claude writes is drawn as box art, in colour, where the fence was in the transcript.

## Agents and workflows

- [autodev-core](https://github.com/djnsty23/claude-auto-dev/tree/main/plugins/autodev-core) - Brainstorm, auto, iterate, audit, review and ship commands with a prd.json sprint system.
- [catalyst-probes](https://github.com/TransmuteLabs/Catalyst/tree/main/plugins/catalyst-probes) - A consultation and prompt engine configured by TOML tables of probes and prompts.
- [autotel](https://github.com/jagreehal/autotel/tree/main/packages/autotel-claude-code) - OpenTelemetry for mods: adds `$.autotel` in the engine.create fold and traces every hook dispatch.
- [homie-persona-cognition](https://github.com/TheSmokeDev/taskchad-os/tree/main/.claude/plugins/persona-cognition) - Host-bound cognitive lifecycle events for a persona system.

## Building mods

- [Function Hooks: the issue](https://github.com/anthropics/claude-code/issues/91870) - The design thread: architecture PDF, nine demo videos, the cheat sheet and the community updates.
- [Anthropic's built-in mods](https://github.com/anthropics/claude-code/tree/main/mods) - Source of diff, sec-default and telemetry, with the test kit and the noun-contract convention.
- [claude-mods-skill](https://github.com/BeLazy167/claude-mods-skill) - A skill that teaches Claude to build a mod, with a working hello-mod to copy.
- [awesome-claude-code-function-hooks](https://github.com/ray-amjad/awesome-claude-code-function-hooks) - The first list, from before the rename, with two plugins and a clean tsconfig recipe.

## Every mod the scanner found

Every plugin on GitHub whose `hooks/hooks.json` names a module and that is not a test fixture or a mirror of Anthropic's own mods. Sorted by stars. Reach is the widest thing the mod's `$` calls can touch: L0 draws and remembers, L1 reads, L2 writes files, runs processes or drives Claude, L3 reaches the network. It is a footprint, not a verdict; a PR tracker has to run `gh`. Sees lists what the mod observes without a matcher.

<!-- scan:start -->
| Mod                                                                                               | What it does                                                                                                   | Reach                                                               | Sees               | Validates on | Stars |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ | ------------ | ----- |
| [mindful-claude](https://github.com/halluton/Mindful-Claude/blob/main/.claude-plugin/plugin.json) | Guided breathing exercises above the prompt while Claude works: coherent, box, 4-7-8 and the physiological si… | ![reach](badges/halluton--Mindful-Claude--mindful-claude-reach.svg) | only what it hooks | 2.1.273      | 68    |
<!-- scan:end -->

## Built into Claude Code

These ship inside the binary and load on every machine where function hooks are on. sec-default seats outermost only on managed machines and Team or Enterprise plans.

<!-- builtin:start -->
| Mod                                                                                                            | What it does                                                                                                   | Reach                                                           | Sees                                                             | Validates on | Stars  |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- | ------------ | ------ |
| [diff](https://github.com/anthropics/claude-code/blob/main/mods/diff/.claude-plugin/plugin.json)               | The diff pane as a plugin: /diff opens the session's uncommitted changes beside the transcript, file by file…  | ![reach](badges/anthropics--claude-code--diff-reach.svg)        | ...Tools.EDITING_TOOLS\|...Tools.SHELL_TOOLS calls, every prompt | 2.1.273      | 145194 |
| [sec-default](https://github.com/anthropics/claude-code/blob/main/mods/sec-default/.claude-plugin/plugin.json) | Security default for organizations: seated outermost, it keeps the organization's classic hooks, prompt conte… | ![reach](badges/anthropics--claude-code--sec-default-reach.svg) | classic hooks, the system prompt, every skill, subagent spawns   | 2.1.273      | 145194 |
| [telemetry](https://github.com/anthropics/claude-code/blob/main/mods/telemetry/.claude-plugin/plugin.json)     | Plugin analytics: adds $.telemetry in the engine.create fold, so a plugin logs an event or marks a feature's…  | ![reach](badges/anthropics--claude-code--telemetry-reach.svg)   | only what it hooks                                               | 2.1.273      | 145194 |
<!-- builtin:end -->

## How the scan works

Discovery searches GitHub code for `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` and for a `hooks/hooks.json` with a `modules` key, and adds the repos in `data/seeds.txt`. The scanner clones each repo shallow, finds every plugin with a hooks module, and runs `claude plugin validate` on its `plugin.json`. The validator inventories the source and prints the events hooked and the `$` calls made; no mod code runs. The grader turns the calls into a reach level and the hooks into a visibility list; its rules are in `tools/grade.mjs` and tested. The renderer writes the tables above, one badge pair per mod under `badges/`, and the scoreboard page under `docs/`, which GitHub Pages serves as mods.karanbansal.in.

The raw result is `data/mods.json`. Every row can be reproduced on your machine with the commands in `contributing.md`, which also has the one-line badge for your own mod.

## Turn mods on

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

in `~/.claude/settings.json`, or for one session: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`. Setting it globally loads the hooks module of every installed plugin that ships one, which is exactly what the footprints above are for.

## Related

- [claude-code-hooks](https://github.com/karanb192/claude-code-hooks) - Shell-hook plugins for safety, cost, observability and productivity, the layer mods are replacing.
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) - The general Claude Code list.
