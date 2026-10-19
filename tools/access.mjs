// The /access/ page: what a Claude Code mod can access, answered with Anthropic's rules and the catalogue's
// own numbers. Every number is computed here from the scan data on each render, so the page moves only when
// the scan does; it never reads stars or push dates.

import { esc, arrow, repo, site } from './site.mjs'
import { LEVEL_NAMES, METHODS, classified, hasFootprint } from './grade.mjs'
import { shell } from './pages.mjs'

export const ACCESS_PATH = 'access/'
const DOCS = 'https://code.claude.com/docs/en/plugins/mods'
const LEVEL_TEXT = [
  'Draws on screen, plays audio, keeps its own stored values and reads facts about the session such as the working directory or model.',
  'Reads files, settings, environment variables, the transcript, the prompt box or other mods’ state, or writes the clipboard or the prompt box.',
  'Writes files, runs processes, changes config or environment variables, or drives Claude by sending prompts, calling tools or starting agents.',
  'Makes HTTP requests with <code>$.http.fetch</code> or calls MCP servers.',
]
const BROAD = ['writes files', 'runs processes', 'drives Claude']
const CAPABILITIES = [['runs processes', 'Runs processes'], ['reads files', 'Reads files'], ['writes files', 'Writes files'], ['network', 'Network (HTTP)'], ['MCP servers', 'Calls MCP servers'],
  ['reads env vars', 'Reads environment variables'], ['drives Claude', 'Drives Claude'], ['reads the transcript', 'Reads the transcript']]
// A hook on every event, or on every tool call or prompt with no filter recorded, sees all of them.
const WATCHED = new Set(['tool.call', 'prompt.submit'])
const watches = hook => WATCHED.has(hook.event) || hook.event === '*'
const unfiltered = hook => watches(hook) && !Object.keys(hook.matcher ?? {}).length

// Mods only, as the catalogue counts them. Each mod counts once per measure however often it repeats a call or event.
export function accessStats(records) {
  const mods = records.filter(mod => mod.kind === 'mod')
  const reported = mods.filter(hasFootprint)
  const graded = reported.map(mod => ({ mod, calls: [...new Set(mod.calls)], events: [...new Set(mod.hooks.map(hook => hook.event))] }))
    .map(entry => ({ ...entry, c: classified(entry.calls) }))
  const count = pred => graded.filter(pred).length
  const levels = [0, 1, 2, 3].map(level => count(({ calls, c }) => calls.length && c.graded && c.level === level))
  const events = new Map()
  for (const { events: names } of graded) for (const name of names) events.set(name, (events.get(name) ?? 0) + 1)
  const status = name => mods.filter(mod => mod.validate.status === name).length
  return {
    counted: mods.length,
    reported: reported.length,
    retained: reported.filter(mod => mod.validate.status === 'unknown').length,
    unavailable: mods.length - reported.length,
    levels,
    noMethods: count(({ calls }) => !calls.length),
    onlyUnclassified: count(({ calls, c }) => calls.length && !c.graded),
    broad: count(({ c }) => BROAD.some(label => c.labels.includes(label))),
    fetch: count(({ calls }) => calls.some(call => call.replace(/^\$\./, '') === 'http.fetch')),
    watched: count(({ mod }) => mod.hooks.some(watches)),
    unfiltered: count(({ mod }) => mod.hooks.some(unfiltered)),
    capabilities: CAPABILITIES.map(([label, name]) => ({ name, n: count(({ c }) => c.labels.includes(label)) })),
    ungraded: count(({ c }) => c.unclassified.length + c.foreign.length > 0),
    validation: { passed: status('passed'), warnings: status('warnings'), failed: status('failed'), unknown: status('unknown') },
    topEvents: [...events].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0)).slice(0, 4).map(([name, n]) => ({ name, n })),
  }
}

const number = n => n.toLocaleString('en')
// A zero denominator shows the count alone.
const share = (n, of) => of ? `${(100 * n / of).toFixed(1)}%` : ''
const withShare = (n, of) => of ? `${number(n)} (${share(n, of)})` : number(n)

// The API methods behind each level, grouped by the label they add, from the grading table itself.
function levelMethods(level) {
  const groups = new Map()
  for (const [member, [at, label]] of Object.entries(METHODS)) if (at === level) groups.set(label ?? 'no access label', [...(groups.get(label ?? 'no access label') ?? []), member])
  return [...groups].map(([label, members]) => `<li><span>${esc(label)}</span> ${members.map(member => `<code>${esc(member.startsWith('plugin.') ? member : '$.' + member)}</code>`).join(', ')}</li>`).join('')
}

export function renderAccessPage(data) {
  const s = accessStats(data.mods)
  const url = `${site}${ACCESS_PATH}`
  const scanned = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(data.generated))
  const title = 'What can a Claude Code mod access? | Awesome Claude Code Mods'
  const of = s.reported
  const answer = `A Claude Code mod is a plugin whose JavaScript or TypeScript hooks run inside your session with your permissions; mods aren’t sandboxed. Its code reaches files, processes and the network only through the mods API, so a static scan can list the methods it calls and the events it hooks. In the current catalogue of ${number(s.counted)} counted mods, ${number(of)} have reported footprints`
    + (of ? `: ${share(s.broad, of)} contain recorded methods classified as writing files, running processes or driving Claude, ${share(s.fetch, of)} include <code>$.http.fetch</code>, and ${share(s.unfiltered, of)} hook every tool call or every prompt with no filter recorded. ${share(s.ungraded, of)} also reference methods the grader cannot classify yet.` : '.')
    + ' Check a mod’s page before you install it.'
  const description = `Claude Code mods run with your permissions and are not sandboxed. A static scan of ${number(s.counted)} mods shows which API methods and events they use.`
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage', '@id': `${url}#page`, url, name: 'What can a Claude Code mod access?', description, inLanguage: 'en',
    isPartOf: { '@id': `${site}#website` },
    about: { '@type': 'SoftwareApplication', name: 'Claude Code', url: `${DOCS}/overview` },
  }).replace(/</g, '\\u003c')
  const stat = (name, value, denominator) => `<div><dt>${name}</dt><dd><strong>${value}</strong><span>${denominator}</span></dd></div>`
  return shell({
    title, description, canonical: url,
    head: `
<meta property="og:type" content="article"><meta property="og:title" content="What can a Claude Code mod access?"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${site}social-preview.png?v=2"><meta name="twitter:card" content="summary">
<script type="application/ld+json">${ld}</script>`,
    body: `<main class="shell mod-page access-page" id="main">
<p class="crumbs"><a href="/">All Claude Code mods</a><span aria-hidden="true">/</span><span>Access</span></p>
<h1>What can a Claude Code mod access?</h1>
<p class="lede">${answer}</p>
<p class="note">“Mod” here means a plugin with a hooks module. Plugins that carry only skills, settings hooks or MCP servers are not mods and are not in these numbers. Last full scan ${esc(scanned)} on Claude Code ${esc(data.claudeVersion)}.</p>

<section aria-labelledby="how"><h2 id="how">How does a mod get access?</h2>
<p>Its hooks run inside your Claude Code session with your permissions, and mods aren’t sandboxed (<a href="${DOCS}/overview#what-a-mod-can-reach">Anthropic: what a mod can reach</a>). To do anything outside its own code, such as drawing, reading a file, starting a process or making a request, a hook calls the mods API; it has no other way out (<a href="${DOCS}/overview#what-a-hook-can-do-with-an-event">what a hook can do with an event</a>). The events matter as much as the calls: a mod that hooks <code>tool.call</code> or <code>prompt.submit</code> sees the matching tool calls or prompts, all of them when the hook has no filter, and can change them (<a href="${DOCS}/admin#review-what-a-mod-can-do">review what a mod can do</a>).</p>
<p>That is why a static scan works: <code>claude plugin validate</code> reports the events each mod hooks and the API methods its code references, and this catalogue records both for every mod.</p></section>

<section aria-labelledby="levels"><h2 id="levels">What do the four levels mean?</h2>
<p>Each mod gets the widest level of the API methods it references. Levels order what a mod’s own code calls; they are not safety ratings and not limits on what a started program can do. Counts are reported footprints by classified calls.</p>
<div class="levels">${[0, 1, 2, 3].map(level => `<section class="level-row"><h3>L${level}, ${esc(LEVEL_NAMES[level])}<span>${withShare(s.levels[level], of)} mods</span></h3><p>${LEVEL_TEXT[level]}</p><details><summary>API methods at L${level}</summary><ul>${levelMethods(level)}</ul></details></section>`).join('')}</div>
<p>Shown apart, not as L0: ${number(s.noMethods)} reported footprints with no recorded API methods and ${number(s.onlyUnclassified)} whose methods the grader cannot classify.</p></section>

<section aria-labelledby="found"><h2 id="found">What did the scan find?</h2>
<dl class="stats">
${stat('Counted mods', number(s.counted), 'mods the catalogue counts, excluding fixtures, catalogue copies and duplicates')}
${stat('Reported footprints', number(of), `of counted mods, including ${number(s.retained)} retained records that show their last recorded footprint; ${number(s.unavailable)} counted mods have none`)}
${stat('Write files, run processes or drive Claude', withShare(s.broad, of), 'reported footprints with any of the three')}
${stat('Hook <code>tool.call</code> or <code>prompt.submit</code>', withShare(s.watched, of), 'reported footprints, with any filter, or hooking every event')}
${stat('Of those, with no filter recorded', withShare(s.unfiltered, of), 'reported footprints that see every tool call or every prompt')}
${s.capabilities.map(({ name, n }) => stat(name, withShare(n, of), 'reported footprints')).join('\n')}
${stat('Reference at least one unclassified method', withShare(s.ungraded, of), 'reported footprints')}
${stat('Validation', `${number(s.validation.passed)} passed, ${number(s.validation.warnings)} with warnings, ${number(s.validation.failed)} failed, ${number(s.validation.unknown)} not rescanned`, 'counted mods')}
${stat('Most hooked events', s.topEvents.map(({ name, n }) => `<code>${esc(name)}</code> ${withShare(n, of)}`).join(', ') || 'none', 'reported footprints, top four')}
</dl></section>

<section aria-labelledby="check"><h2 id="check">How do I check a mod before installing it?</h2>
<ol><li>Open its page from <a href="/#directory">the collection</a>.</li><li>Read the level, any unclassified calls, the events it hooks and the validation result.</li><li>Open the source at the scanned revision linked on the page.</li><li>Or run <code>claude plugin validate</code> on the plugin yourself.</li></ol></section>

<section aria-labelledby="limits"><h2 id="limits">What the scan cannot tell you</h2>
<ul><li>It is a static scan, not a runtime test.</li><li>A program the mod starts with <code>$.process.run</code> reaches the network with your own access, and network policy for <code>$.http.fetch</code> does not cover it (<a href="${DOCS}/admin#know-which-controls-still-apply">Anthropic: which controls still apply</a>). A tool call or prompt the mod rewrites changes what Claude does. Both can do more than the mod’s own calls show.</li><li>Unclassified methods have no grade.</li><li>Retained records show their last recorded footprint, not a current one.</li><li>Passing validation does not mean a mod is safe or works.</li></ul>
<p class="actions"><a class="source" href="${repo}/blob/main/SCANNING.md">How the scan works ${arrow}</a><a href="${DOCS}/overview">Anthropic’s mods overview</a><a href="/#directory">Browse the collection</a></p></section>
</main>`,
  })
}
