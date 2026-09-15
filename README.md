# Awesome Claude Code Mods [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> Every Claude Code mod on GitHub, with what each one can reach.

A Claude Mod is a Claude Code plugin whose hooks are TypeScript functions that run inside Claude Code's own process. They draw above the prompt, open panes beside the transcript, rewrite tool calls, spawn agents and touch the host, all with zero tokens. Anthropic proposed them as function hooks on 2026-09-03 and committed to shipping them on 2026-09-09; the design thread is listed under Building mods below. They are early access: set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` or nothing loads, and the API can change between releases.

This list is different from a plain index in one way. Every row carries the mod's **footprint**: the events it hooks and the `$` calls it makes, printed by Claude's own `claude plugin validate` before any mod code runs. A nightly scan clones every candidate repo on GitHub and refreshes the table, the badges and the [scoreboard page](site/index.html). The method is described below the tables.

<!-- stats:start -->
As of 2026-09-15, scanned against Claude Code 2.1.272: **31 mods** in **92 candidate repos**. 14 run host processes, 4 write files, 7 read files, 4 reach the network, 13 see every tool call, 11 see every prompt, 1 fail to validate on this version. Reach levels: L0 draws and remembers: 12 · L1 reads: 2 · L2 writes or runs: 13 · L3 network: 4.
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
| Mod                                                                                                                                                       | What it does                                                                                                     | Reach                                                                                          | Sees                                                                                                          | Validates on | Stars |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------ | ----- |
| [mindful-claude](https://github.com/halluton/Mindful-Claude/blob/main/.claude-plugin/plugin.json)                                                         | Guided breathing exercises above the prompt while Claude works: coherent, box, 4-7-8 and the physiological si…   | ![reach](badges/halluton--Mindful-Claude--mindful-claude-reach.svg)                            | only what it hooks                                                                                            | 2.1.272      | 56    |
| [kindex-modern](https://github.com/wandercom/kindex/blob/main/src/kindex/claude_modern/.claude-plugin/plugin.json)                                        | Repo-local Kindex memory and durable tasks for Claude function hooks (qualified on 2.1.263)                      | ![reach](badges/wandercom--kindex--kindex-modern-reach.svg)                                    | the system prompt, every prompt, every tool call                                                              | 2.1.272      | 30    |
| [lcm](https://github.com/lossless-claude/lcm/blob/main/.claude-plugin/plugin.json)                                                                        | Lossless context management: DAG-based summarization that preserves every message                                | ![reach](badges/lossless-claude--lcm--lcm-reach.svg)                                           | the system prompt, every prompt, every tool call                                                              | 2.1.272      | 27    |
| [homie-persona-cognition](https://github.com/TheSmokeDev/taskchad-os/blob/master/.claude/plugins/persona-cognition/.claude-plugin/plugin.json)            | Host-bound cognitive lifecycle events for The Homie.                                                             | ![reach](badges/TheSmokeDev--taskchad-os--homie-persona-cognition-reach.svg)                   | every tool call, every prompt                                                                                 | 2.1.272      | 24    |
| [cc-arcade](https://github.com/sezaakgun/cc-arcade/blob/main/.claude-plugin/plugin.json)                                                                  | Games above the Claude Code prompt (snake, Tetris, 2048, Minesweeper, Flappy, Pong, typing test, Space Invade…   | ![reach](badges/sezaakgun--cc-arcade--cc-arcade-reach.svg)                                     | every tool call                                                                                               | 2.1.272      | 17    |
| [autotel](https://github.com/jagreehal/autotel/blob/main/packages/autotel-claude-code/.claude-plugin/plugin.json)                                         | OpenTelemetry for Claude Code plugins: adds $.autotel in the engine.create fold so a plugin records spans, tr…   | ![reach](badges/jagreehal--autotel--autotel-reach.svg)                                         | everything                                                                                                    | 2.1.272      | 8     |
| [agent-flow](https://github.com/Charlie0113-T/claude-agent-flow/blob/main/.claude-plugin/plugin.json)                                                     | The agent flow pane: /flow opens a live tree of the session's subagents and teammates beside the transcript,…    | ![reach](badges/Charlie0113-T--claude-agent-flow--agent-flow-reach.svg)                        | subagent spawns, every tool call, classic hooks                                                               | 2.1.272      | 4     |
| [honmoon-redact](https://github.com/pleaseai/honmoon/blob/main/packages/claude-plugin/.claude-plugin/plugin.json)                                         | Client-side secret/PII redaction hooks: keep API keys and sensitive identifiers out of Claude Code's model co…   | ![reach](badges/pleaseai--honmoon--honmoon-redact-reach.svg)                                   | Read\|Bash\|Grep\|WebFetch calls, every prompt                                                                | 2.1.272      | 4     |
| [autodev-core](https://github.com/djnsty23/claude-auto-dev/blob/main/plugins/autodev-core/.claude-plugin/plugin.json)                                     | Autonomous development workflow: brainstorm, auto, iterate, audit, review, ship, plus the prd.json sprint sys…   | ![reach](badges/djnsty23--claude-auto-dev--autodev-core-reach.svg)                             | every prompt, Bash calls                                                                                      | 2.1.272      | 3     |
| [commonplace](https://github.com/noopz/commonplace/blob/main/.claude-plugin/plugin.json)                                                                  | LLM-maintained knowledge base for Obsidian vaults. Auto-triggers on paper sharing, vault health queries, conc…   | ![reach](badges/noopz--commonplace--commonplace-reach.svg)                                     | Bash calls, Write\|Edit calls, every tool call, subagent spawns, every skill, the system prompt, every prompt | 2.1.272      | 3     |
| [catalyst-probes](https://github.com/TransmuteLabs/Catalyst/blob/main/plugins/catalyst-probes/.claude-plugin/plugin.json)                                 | Consultation and prompt engine for Claude Mods. The module is the core; \[probe.<id>\] tables in probes.toml ar… | ![reach](badges/TransmuteLabs--Catalyst--catalyst-probes-reach.svg)                            | the system prompt, every tool call                                                                            | 2.1.272      | 3     |
| [signet-eval-functions](https://github.com/wandercom/signet-eval/blob/main/adapters/claude-function/.claude-plugin/plugin.json)                           | Optional Claude Code 2.1.263 function hooks for Signet-eval policy and output redaction                          | ![reach](badges/wandercom--signet-eval--signet-eval-functions-reach.svg)                       | only what it hooks                                                                                            | fails        | 3     |
| [claude-doctor](https://github.com/ray-manaloto/dotfiles/blob/main/.agents/skills/claude-doctor/.claude-plugin/plugin.json)                               | Reports the claude-doctor verdict at session start and refuses tool calls while the install is provably broken   | ![reach](badges/ray-manaloto--dotfiles--claude-doctor-reach.svg)                               | classic hooks                                                                                                 | 2.1.272      | 2     |
| [plugin-health](https://github.com/ray-manaloto/dotfiles/blob/main/.claude/skills/plugin-health/.claude-plugin/plugin.json)                               | Reports at session start when plugins declared in settings are not actually installed or are disabled for thi…   | ![reach](badges/ray-manaloto--dotfiles--plugin-health-reach.svg)                               | classic hooks                                                                                                 | 2.1.272      | 2     |
| [cc-pr-tracker](https://github.com/sezaakgun/cc-pr-tracker/blob/main/.claude-plugin/plugin.json)                                                          | Watch GitHub PRs from a Claude Code session: merge state, review and required checks above the prompt, with a…   | ![reach](badges/sezaakgun--cc-pr-tracker--cc-pr-tracker-reach.svg)                             | every prompt, Bash calls                                                                                      | 2.1.272      | 2     |
| [secret-redactor](https://github.com/ray-amjad/awesome-claude-code-function-hooks/blob/main/plugins/secret-redactor/.claude-plugin/plugin.json)           | Keeps secrets, email addresses and IP addresses out of the session transcript: swaps each one for a stable pl…   | ![reach](badges/ray-amjad--awesome-claude-code-function-hooks--secret-redactor-reach.svg)      | every prompt, every tool call, the system prompt                                                              | 2.1.272      | 1     |
| [vercel-deploy-status](https://github.com/ray-amjad/awesome-claude-code-function-hooks/blob/main/plugins/vercel-deploy-status/.claude-plugin/plugin.json) | Pins the Vercel deploy queue of the linked project under the prompt: every deploy queued, building or just fi…   | ![reach](badges/ray-amjad--awesome-claude-code-function-hooks--vercel-deploy-status-reach.svg) | Bash calls                                                                                                    | 2.1.272      | 1     |
| [context-lens](https://github.com/Arunjay4213/claude-mods/blob/main/plugins/context-lens/.claude-plugin/plugin.json)                                      | A live /context: a pinned line under the prompt with the window fill and the growth per turn, and /context-le…   | ![reach](badges/Arunjay4213--claude-mods--context-lens-reach.svg)                              | compaction                                                                                                    | 2.1.272      | 0     |
| [quota-meter](https://github.com/Arunjay4213/claude-mods/blob/main/plugins/quota-meter/.claude-plugin/plugin.json)                                        | Shows the subscription plan limits - the 5-hour window, the 7-day window and a gateway spend limit - as a pin…   | ![reach](badges/Arunjay4213--claude-mods--quota-meter-reach.svg)                               | only what it hooks                                                                                            | 2.1.272      | 0     |
| [token-ledger](https://github.com/Arunjay4213/claude-mods/blob/main/plugins/token-ledger/.claude-plugin/plugin.json)                                      | A per-turn cost and token ledger: a pinned status line with the session cost, the last turn's tokens and the…    | ![reach](badges/Arunjay4213--claude-mods--token-ledger-reach.svg)                              | only what it hooks                                                                                            | 2.1.272      | 0     |
| [function-hooks](https://github.com/bsamiee/Rasm/blob/main/.claude/plugins/function-hooks/.claude-plugin/plugin.json)                                     | Denies policy-refused tool calls, records hook events as observation rows, delivers findings per lineage         | ![reach](badges/bsamiee--Rasm--function-hooks-reach.svg)                                       | every tool call, classic hooks                                                                                | 2.1.272      | 0     |
| [cc-pokedex](https://github.com/deonmenezes/claude-mods-pokedex/blob/main/.claude-plugin/plugin.json)                                                     | Catch wild creatures above the Claude Code prompt: where your prompt leads (water, grass, fire, bugs, plans,…    | ![reach](badges/deonmenezes--claude-mods-pokedex--cc-pokedex-reach.svg)                        | every prompt, every tool call                                                                                 | 2.1.272      | 0     |
| [gh-ci-status](https://github.com/diegorv/claude-functions-hook/blob/main/plugins/gh-ci-status/.claude-plugin/plugin.json)                                | GitHub Actions runs of the session's repo, pinned above the prompt, with links to the PR and the run             | ![reach](badges/diegorv--claude-functions-hook--gh-ci-status-reach.svg)                        | classic hooks                                                                                                 | 2.1.272      | 0     |
| [time](https://github.com/diegorv/claude-functions-hook/blob/main/plugins/time/.claude-plugin/plugin.json)                                                | The time you sent each message, drawn above it                                                                   | ![reach](badges/diegorv--claude-functions-hook--time-reach.svg)                                | only what it hooks                                                                                            | 2.1.272      | 0     |
| [claude-mermaid](https://github.com/galElmalah/claude-mermaid/blob/main/.claude-plugin/plugin.json)                                                       | Mermaid diagrams in Claude Code: every ```mermaid block Claude writes is drawn as box art, in colour, right w…   | ![reach](badges/galElmalah--claude-mermaid--claude-mermaid-reach.svg)                          | only what it hooks                                                                                            | 2.1.272      | 0     |
| [pr-bridge-watch](https://github.com/ippoan/gh-actions-live/blob/main/mods/pr-bridge-watch/.claude-plugin/plugin.json)                                    | gh pr create / pr-push.sh で PR ができたら、その branch の CI を gh-actions-bridge の ws /watch に Monitor で繋ぐ Claude Mod…    | ![reach](badges/ippoan--gh-actions-live--pr-bridge-watch-reach.svg)                            | every prompt, every tool call, Bash calls                                                                     | 2.1.272      | 0     |
| [aside](https://github.com/JayDoubleu/aside/blob/main/.claude-plugin/plugin.json)                                                                         | Read-only side chat: /aside opens a pane beside the transcript where you ask about the session so far; answer…   | ![reach](badges/JayDoubleu--aside--aside-reach.svg)                                            | only what it hooks                                                                                            | 2.1.272      | 0     |
| [segmem](https://github.com/mahuebel/segmem/blob/main/.claude-plugin/plugin.json)                                                                         | Segmented, scoped memory for agents: one file, SQLite, no daemon. Wake at session start, recall on every prom…   | ![reach](badges/mahuebel--segmem--segmem-reach.svg)                                            | the system prompt, every prompt, subagent spawns, Bash calls, mcp__segmem__recall calls                       | 2.1.272      | 0     |
| [claude-games](https://github.com/mohi-devhub/claude-games/blob/main/.claude-plugin/plugin.json)                                                          | Arcade games above the Claude Code prompt (a dodge race, Breakout, a dino runner and a side-scrolling shooter…   | ![reach](badges/mohi-devhub--claude-games--claude-games-reach.svg)                             | every tool call                                                                                               | 2.1.272      | 0     |
| [kb-settings-guard](https://github.com/ray-manaloto/knowledge-base/blob/main/.claude/mods/kb-settings-guard/.claude-plugin/plugin.json)                   | Denies a delegated agent lane any write to this repo's Claude settings files.                                    | ![reach](badges/ray-manaloto--knowledge-base--kb-settings-guard-reach.svg)                     | tool calls                                                                                                    | 2.1.272      | 0     |
| [cctop](https://github.com/tomstagl/cctop/blob/main/plugin/.claude-plugin/plugin.json)                                                                    | btop-style live dashboard for Claude Code internals: /cctop opens it in a side pane, cctop-insights lets the…    | ![reach](badges/tomstagl--cctop--cctop-reach.svg)                                              | compaction, every tool call, the cctop skill                                                                  | 2.1.272      | 0     |
<!-- scan:end -->

## Built into Claude Code

These ship inside the binary and load on every machine where function hooks are on. sec-default seats outermost only on managed machines and Team or Enterprise plans.

<!-- builtin:start -->
| Mod                                                                                                            | What it does                                                                                                   | Reach                                                           | Sees                                                                   | Validates on | Stars  |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ | ------ |
| [diff](https://github.com/anthropics/claude-code/blob/main/mods/diff/.claude-plugin/plugin.json)               | The diff pane as a plugin: /diff opens the session's uncommitted changes beside the transcript, file by file…  | ![reach](badges/anthropics--claude-code--diff-reach.svg)        | ...Tools.EDITING_TOOLS calls, ...Tools.SHELL_TOOLS calls, every prompt | 2.1.272      | 145097 |
| [sec-default](https://github.com/anthropics/claude-code/blob/main/mods/sec-default/.claude-plugin/plugin.json) | Security default for organizations: seated outermost, it keeps the organization's classic hooks, prompt conte… | ![reach](badges/anthropics--claude-code--sec-default-reach.svg) | classic hooks, the system prompt, every skill, subagent spawns         | 2.1.272      | 145097 |
| [telemetry](https://github.com/anthropics/claude-code/blob/main/mods/telemetry/.claude-plugin/plugin.json)     | Plugin analytics: adds $.telemetry in the engine.create fold, so a plugin logs an event or marks a feature's…  | ![reach](badges/anthropics--claude-code--telemetry-reach.svg)   | only what it hooks                                                     | 2.1.272      | 145097 |
<!-- builtin:end -->

## How the scan works

Discovery searches GitHub code for `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` and for a `hooks/hooks.json` with a `modules` key, and adds the repos in `data/seeds.txt`. The scanner clones each repo shallow, finds every plugin with a hooks module, and runs `claude plugin validate` on its `plugin.json`. The validator inventories the source and prints the events hooked and the `$` calls made; no mod code runs. The grader turns the calls into a reach level and the hooks into a visibility list; its rules are in `tools/grade.mjs` and tested. The renderer writes the tables above, one badge pair per mod under `badges/`, and the scoreboard page under `site/`.

The raw result is `data/mods.json`. Every row can be reproduced on your machine with the commands in `contributing.md`, which also has the one-line badge for your own mod.

## Turn mods on

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

in `~/.claude/settings.json`, or for one session: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`. Setting it globally loads the hooks module of every installed plugin that ships one, which is exactly what the footprints above are for.

## Related

- [claude-code-hooks](https://github.com/karanb192/claude-code-hooks) - Shell-hook plugins for safety, cost, observability and productivity, the layer mods are replacing.
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) - The general Claude Code list.
