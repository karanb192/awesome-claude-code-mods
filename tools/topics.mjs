// Topic pages under docs/topics/<slug>/: one page per category a searcher asks for, such as prompt cache mods,
// that explains the category in plain words and links every member's own page. A mod joins a topic by the rule
// in data/topics.json, applied here at render time: patterns over its name and description, plus ids to include
// or exclude. The page prose lives in this file keyed by slug, so no HTML enters the data file.
//
//   node tools/topics.mjs --list <slug>   every match with the pattern that hit, excluded, off-page and stale ids, and the listed count

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { esc, site, browseNav, topicNav } from './site.mjs'
import { hasFootprint } from './grade.mjs'
import { accessFacts, accessLine, clip, idOf, identity, indexable, installLine, shell } from './pages.mjs'

export const TOPICS_PATH = 'data/topics.json'
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAINTAINER = 'karanb192'
const DOCS = 'https://code.claude.com/docs/en/plugins/mods'
const CACHING = 'https://platform.claude.com/docs/en/build-with-claude/prompt-caching'
const CONTEXT = 'https://code.claude.com/docs/en/context-window#when-your-context-fills-up'
const LIMITS = 'https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work'
const COSTS = 'https://code.claude.com/docs/en/costs'
const PRICING = 'https://platform.claude.com/docs/en/about-claude/pricing'
// Three groups by repository stars, name order inside each, so a rescan that only moves stars changes nothing
// while every repository stays inside its group. Unknown star counts sit in the lowest group.
export const GROUPS = [
  { min: 100, heading: 'Repositories with 100 stars or more' },
  { min: 10, heading: 'Repositories with 10 to 99 stars' },
  { min: 0, heading: 'Repositories with under 10 stars' },
]
export const groupOf = stars => GROUPS.findIndex(group => (stars ?? 0) >= group.min)

const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0
const mods = n => `${n} ${n === 1 ? 'mod' : 'mods'}`
const verb = (n, word) => n === 1 ? word + 's' : word
const join = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

// What each topic says, in catalogue-authored words only. Every figure is computed from the listed records.
const PROSE = {
  'prompt-cache': {
    summary: n => `${mods(n)} that ${verb(n, 'show')} the cache timer, ${verb(n, 'keep')} it warm or ${verb(n, 'warn')} before a cold send.`,
    lede: n => `${mods(n)} that ${verb(n, 'show')} Claude’s prompt cache timer, ${verb(n, 'keep')} the cache warm while you are away, or ${verb(n, 'warn')} before a message that would be sent against a lapsed cache. Each name opens the mod’s page with its hooks, API calls, access and installation guidance.`,
    sections: f => {
      const named = f.named(/^cache-(clock|timer)$/i)
      const levels = join([...[0, 1, 2, 3].filter(level => named.levels[level]).map(level => `${named.levels[level]} at L${level}`), ...(named.unlevelled ? [`${named.unlevelled} with no classified level`] : [])])
      const namedSentence = named.n ? ` Of the ${mods(named.n)} here named cache-clock or cache-timer, ${named.reported ? `${named.reported} ${named.reported === 1 ? 'has a reported footprint' : 'have reported footprints'}; by classified calls, ${levels}` : 'none has a reported footprint'}.` : ''
      const modelSentence = f.reported ? ` Of the ${mods(f.reported)} here with reported footprints, ${f.modelCalls} ${verb(f.modelCalls, 'record')} a <code>$.model</code> method or <code>$.prompt.submit</code>; a recorded call does not identify a warmer.` : ''
      const hookSentence = f.promptHooks ? ` ${f.promptHooks} of the ${mods(f.n)} here ${verb(f.promptHooks, 'record')} a <code>prompt.submit</code> hook${f.promptHooksIncomplete ? `, ${f.promptHooksIncomplete} of them with an incomplete footprint, where coverage is unknown` : ''}.` : ''
      return `<section aria-labelledby="what"><h2 id="what">What these mods do</h2>
<p>Claude’s API caches a prompt prefix. When a request repeats a prefix that is already cached, the API reuses it at the cache read price; otherwise it processes the full prompt and caches the prefix. A hit needs an identical prefix, and a change earlier in the prompt invalidates what follows. By default an entry lives 5 minutes, or 1 hour with the extended option, and each use refreshes it at no extra cost. In API billing a cache write costs 1.25 or 2 times the base input price and a read 0.1 times on most models (<a href="${CACHING}#how-prompt-caching-works">Anthropic: how prompt caching works</a>, <a href="${CACHING}#pricing">pricing</a>). Which lifetime a Claude Code session gets, and how it is billed, depends on the account and the setup; this page does not state it, and each mod’s README says what it assumes.</p>
<p>These mods do three jobs. A timer shows how long the entry has left and how much of the last request the cache served. A warmer sends a request that reuses the cached prefix before the entry lapses, so the entry is refreshed. A guard warns before a message that would be sent against a lapsed entry and shows an estimate of the write. Some compact or hand off a session while the entry is still live instead.</p></section>

<section aria-labelledby="choose"><h2 id="choose">How to choose one</h2>
<ul><li>A warming request is a model request on your plan or API key (<a href="${DOCS}/overview#what-a-mod-can-reach">Anthropic: what a mod can reach</a>). Read the mod’s README for how often it sends, for how long, and how to stop it.</li>
<li>Read the calls line on the mod’s page, and the README, for the job each call does. <code>$.model.fork</code> runs one completion over the session’s own transcript so the API serves that prefix from its cache; <code>$.model.complete</code> runs a completion with no history; <code>$.prompt.submit</code> submits a prompt as you. Any of them can belong to a warmer, a guard, a compaction tool or something else. A level does not tell you the job, and the job does not tell you the level.${namedSentence}${modelSentence}</li>
<li>Read the hooks line. A <code>prompt.submit</code> hook sees matching prompts, or every prompt when no filter is recorded (<a href="${DOCS}/admin#review-what-a-mod-can-do">Anthropic: review what a mod can do</a>). When the footprint is incomplete, event coverage is unknown.${hookSentence}</li>
<li>Check which lifetime the mod assumes. The API offers 5 minutes and 1 hour; what your session gets depends on how it is billed, and the README says what the mod assumes.</li>
<li>The scan is static. It lists what the code references, not what it does at runtime. A level does not limit what a program the mod starts can do (<a href="${DOCS}/admin#know-which-controls-still-apply">Anthropic: which controls still apply</a>). “Reads mod state” means the scan saw a state read and does not record whose state. See <a href="/access/">what a mod can access</a>.</li></ul></section>`
    },
  },
  'usage-meters': {
    summary: n => `${mods(n)} that ${verb(n, 'show')} context fill, token use, plan limits or estimated cost, or ${verb(n, 'warn')} before a limit.`,
    lede: n => `${mods(n)} that ${verb(n, 'show')} how full your context window is, how much of your plan’s 5-hour and weekly windows you have used or the session’s estimated cost so far, or ${verb(n, 'warn')} you before a limit. Each name opens the mod’s page with its hooks, API calls, access and installation guidance.`,
    sections: f => {
      const callSentence = f.reported ? ` Of the ${mods(f.reported)} here with reported footprints, ${f.usageCalls} ${verb(f.usageCalls, 'record')} <code>$.session.usage</code>, ${f.fetchCalls} ${verb(f.fetchCalls, 'record')} <code>$.http.fetch</code>, ${f.processCalls} ${verb(f.processCalls, 'record')} a process call and ${f.modelCalls} ${verb(f.modelCalls, 'record')} a <code>$.model</code> method or <code>$.prompt.submit</code>.` : ''
      const hookSentence = f.promptHooks ? ` ${f.promptHooks} of the ${mods(f.n)} here ${verb(f.promptHooks, 'record')} a <code>prompt.submit</code> hook${f.promptHooksIncomplete ? `, ${f.promptHooksIncomplete} of them with an incomplete footprint, where coverage is unknown` : ''}.` : ''
      return `<section aria-labelledby="what"><h2 id="what">What these mods do</h2>
<p>Two different measures, in Anthropic’s words. The context window is what one session holds. When it fills, Claude Code compacts it, at a threshold that depends on the model and the configuration, and <code>/context</code> shows what fills it (<a href="${CONTEXT}">Anthropic: when your context fills up</a>). Account consumption is separate: a subscription has a 5-hour window and a weekly window, shared across Claude’s surfaces, plus model-specific windows where the plan has them, and <code>/usage</code> shows the ones the account reports (<a href="${LIMITS}">how usage and length limits work</a>, <a href="${COSTS}#when-a-developer-asks-about-a-limit">Claude Code: when a developer asks about a limit</a>). Cost is an estimate: Claude Code computes a session’s dollar figure locally from token counts and list or configured prices, on an API key as well as on a subscription, and the bill lives in the Console or at the provider (<a href="${COSTS}#using-the-usage-command">Claude Code: track your costs</a>, <a href="${PRICING}">API pricing</a>).</p>
<p>A mod reads all three through <code>$.session.usage</code>, which returns the context fill, the account’s rate-limit windows and the estimated session cost, with readings the harness lacks left absent (<a href="${DOCS}/api#reach-files-processes-and-the-network">Anthropic: reach files, processes and the network</a>). Some mods fetch figures from elsewhere or compute their own. They draw them as a band above the prompt, a status line, a pane, a toast or a notification, as bars, rings, weather or a pet, and some warn or ask before a limit.</p></section>

<section aria-labelledby="choose"><h2 id="choose">How to choose one</h2>
<ul><li>Check what it measures: this session, the whole account, or one part of it such as subagents or one tool. The description says which, and the README says how it reads the figure.</li>
<li>Read the calls line on the mod’s page, and the README, for the job each call does. A recorded <code>$.session.usage</code> reads the harness’s own figures. A recorded <code>$.http.fetch</code> can be a gateway’s figures coming in or figures going out. A recorded model method or <code>$.prompt.submit</code> is a request on your plan or API key, which may belong to a warmer, a compaction step or something else (<a href="${DOCS}/api#call-a-model">Anthropic: call a model</a>). A program the mod starts reaches the network with your own access, which network policy does not cover (<a href="${DOCS}/admin#know-which-controls-still-apply">Anthropic: which controls still apply</a>).${callSentence}</li>
<li>A dollar figure is an estimate at API prices, and mods do not all use the same prices. A subscription’s allowance is not a bill.</li>
<li>Read the hooks line. A <code>prompt.submit</code> hook sees matching prompts, or every prompt when no filter is recorded (<a href="${DOCS}/admin#review-what-a-mod-can-do">Anthropic: review what a mod can do</a>). When the footprint is incomplete, event coverage is unknown.${hookSentence}</li>
<li>The scan is static. It lists what the code references, not what it does at runtime. A level does not limit what a program the mod starts can do. “Reads mod state” means the scan saw a state read and does not record whose state. See <a href="/access/">what a mod can access</a>.</li></ul></section>`
    },
  },
}
export const PROSE_SLUGS = Object.keys(PROSE)

export function readTopics(text) {
  const topics = JSON.parse(text)
  if (!Array.isArray(topics)) throw new Error(`${TOPICS_PATH} must be an array of topics`)
  const slugs = new Set()
  const read = topic => {
    if (!SLUG.test(String(topic?.slug)) || slugs.has(topic.slug)) throw new Error(`${TOPICS_PATH} has an invalid or repeated slug ${JSON.stringify(topic?.slug)}`)
    slugs.add(topic.slug)
    for (const field of ['title', 'short', 'description']) if (typeof topic[field] !== 'string' || !topic[field].trim()) throw new Error(`topic ${topic.slug} needs a ${field}`)
    for (const field of ['patterns', 'include', 'exclude', 'related']) if (!Array.isArray(topic[field]) || topic[field].some(value => typeof value !== 'string')) throw new Error(`topic ${topic.slug} needs ${field} as an array of strings`)
    if (!PROSE[topic.slug]) throw new Error(`topic ${topic.slug} has no prose in tools/topics.mjs`)
    const rules = topic.patterns.map(pattern => {
      try { return { pattern, re: new RegExp(pattern, 'i') } } catch (error) { throw new Error(`topic ${topic.slug} has an invalid pattern ${JSON.stringify(pattern)}: ${error.message}`) }
    })
    return { ...topic, rules }
  }
  const result = topics.map(read)
  for (const topic of result) for (const slug of topic.related) if (!slugs.has(slug) || slug === topic.slug) throw new Error(`topic ${topic.slug} relates to ${JSON.stringify(slug)}, which is not another topic in ${TOPICS_PATH}`)
  return result
}

// The renderer's own normalisation of author text: a dash becomes a colon and a space, whitespace collapses.
const normal = text => String(text ?? '').replace(/\s*[—–]\s*/g, ': ').replace(/\s+/g, ' ').trim()
// The first rule whose pattern matches the mod's name or description. Only counted mods can match.
export const matchOf = (topic, mod) => mod.kind === 'mod' ? topic.rules.find(({ re }) => re.test(normal(mod.name)) || re.test(normal(mod.description))) : undefined

// Every counted mod the rule admits: pattern matches minus excluded ids, plus included ids. A stale id names
// no counted mod; it is reported, not fatal, because a retirement or a rename must not break the render.
export function topicMembers(topic, records) {
  const counted = records.filter(mod => mod.kind === 'mod')
  const byId = new Map(counted.map(mod => [identity(idOf(mod)), mod]))
  const excluded = new Set(topic.exclude.map(identity))
  const hits = counted.map(mod => ({ mod, pattern: matchOf(topic, mod)?.pattern })).filter(hit => hit.pattern)
  const matched = new Set(hits.map(hit => hit.mod))
  const included = topic.include.map(identity).filter(id => byId.has(id) && !excluded.has(id)).map(id => byId.get(id)).filter(mod => !matched.has(mod))
  const members = [...counted.filter(mod => matched.has(mod) && !excluded.has(identity(idOf(mod)))), ...included]
  const stale = [...topic.include, ...topic.exclude].filter(id => !byId.has(identity(id)))
  return { members, hits, stale }
}

// What the page lists: members that pass the mod page's index gate, so the page never links a noindex page.
export const listedMembers = members => members.filter(indexable)

export const topicSummary = (topic, n) => PROSE[topic.slug].summary(n)

const byName = (a, b) => a.mod.name.localeCompare(b.mod.name, 'en') || byText(idOf(a.mod), idOf(b.mod))

function figures(entries) {
  const reported = entries.filter(({ mod }) => hasFootprint(mod))
  const promptHooks = entries.filter(({ mod }) => mod.hooks.some(hook => hook.event === 'prompt.submit'))
  return {
    n: entries.length,
    reported: reported.length,
    modelCalls: reported.filter(({ mod }) => mod.calls.some(call => /^\$\.model\./.test(call) || call === '$.prompt.submit')).length,
    usageCalls: reported.filter(({ mod }) => mod.calls.includes('$.session.usage')).length,
    fetchCalls: reported.filter(({ mod }) => mod.calls.includes('$.http.fetch')).length,
    processCalls: reported.filter(({ mod }) => mod.calls.some(call => call === '$.process.run' || call === '$.process.spawn')).length,
    promptHooks: promptHooks.length,
    promptHooksIncomplete: promptHooks.filter(({ mod }) => !hasFootprint(mod)).length,
    named: pattern => {
      const named = entries.filter(({ mod }) => pattern.test(mod.name)).map(({ mod }) => accessFacts(mod))
      return { n: named.length, reported: named.filter(f => f.complete).length, levels: [0, 1, 2, 3].map(level => named.filter(f => f.level === level).length), unlevelled: named.filter(f => f.complete && f.level === null).length }
    },
  }
}

const entry = ({ mod, slug }, version) => {
  const owner = mod.repo.split('/')[0]
  const described = clip(mod.description, 160)
  return `<li><a class="name" href="/mods/${esc(slug)}/">${esc(mod.name)}</a><span class="repo">${esc(mod.repo)}</span>${owner.toLowerCase() === MAINTAINER ? '<span class="maintainer">Built by the catalogue maintainer</span>' : ''}${described ? `<p class="what">${esc(described)}</p>` : ''}<p class="scan">${accessLine(mod).html}${mod.validate.status === 'failed' ? ` Fails validation on Claude Code ${esc(mod.validate.claudeVersion ?? version)}.` : ''}</p><p class="scan">${installLine(mod)}</p></li>`
}

// One entry per line, so an added or edited member is a one-line change in a scan PR diff.
// entries: { mod, slug } for every listed member, in any order. topics: the topic pages to link, as { slug, short, title },
// including this one; letters: the A to Z pages; version: the scan's Claude Code version for failures.
export function renderTopicPage(topic, entries, { topics = [], letters = [], version } = {}) {
  const prose = PROSE[topic.slug]
  const url = `${site}topics/${topic.slug}/`
  const listed = [...entries].sort(byName)
  const groups = GROUPS.map((group, i) => ({ ...group, i, entries: listed.filter(({ mod }) => groupOf(mod.stars) === i) })).filter(group => group.entries.length)
  const title = `${topic.title} | Awesome Claude Code Mods`
  const shown = new Set(topics.map(other => other.slug))
  const related = topic.related.filter(slug => shown.has(slug)).map(slug => topics.find(other => other.slug === slug))
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${url}#page`, url, name: topic.title, description: topic.description, inLanguage: 'en', isPartOf: { '@id': `${site}#website` }, about: { '@type': 'SoftwareApplication', name: 'Claude Code', url: `${DOCS}/overview` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Claude Code mods', item: site },
        { '@type': 'ListItem', position: 2, name: topic.short, item: url },
      ] },
    ],
  }).replace(/</g, '\\u003c')
  const seeAlso = [
    ...related.map(other => `<a href="/topics/${esc(other.slug)}/">${esc(other.title)}</a>`),
    '<a href="/access/">What can a Claude Code mod access?</a>',
    `<a href="${letters.length ? `/browse/${esc(letters[0])}/` : '/#directory'}">Browse all mods A to Z</a>`,
    '<a href="/#directory">The collection</a>',
  ]
  return shell({
    title, description: topic.description, canonical: url, robots: listed.length ? '' : 'noindex',
    head: `
<meta property="og:type" content="website"><meta property="og:title" content="${esc(topic.title)}"><meta property="og:description" content="${esc(topic.description)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${site}social-preview.png?v=2"><meta name="twitter:card" content="summary">
<script type="application/ld+json">${ld}</script>`,
    body: `<main class="shell mod-page topic-page" id="main">
<p class="crumbs"><a href="/">All Claude Code mods</a><span aria-hidden="true">/</span><span>${esc(topic.short)}</span></p>
<h1>${esc(topic.title)}</h1>
<p class="lede">${listed.length ? prose.lede(listed.length) : 'No mods in this topic in the latest scan.'}</p>
${browseNav(letters)}${topicNav(topics, topic.slug)}
${prose.sections(figures(listed))}
${groups.map(group => `
<section class="group" aria-labelledby="group-${group.i}"><h2 id="group-${group.i}">${group.heading}</h2>
<ul class="topic-list">
${group.entries.map(item => entry(item, version)).join('\n')}
</ul></section>`).join('')}
${listed.length ? '' : '<p class="empty-topic">No mods in this topic in the latest scan.</p>'}
<section aria-labelledby="see-also"><h2 id="see-also">See also</h2><p class="actions">${seeAlso.join('')}</p></section>
</main>`,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { list: { type: 'string' } } })
  if (!values.list) { console.error('usage: node tools/topics.mjs --list <slug>'); process.exit(2) }
  const topic = readTopics(readFileSync(TOPICS_PATH, 'utf8')).find(topic => topic.slug === values.list)
  if (!topic) throw new Error(`no topic ${values.list} in ${TOPICS_PATH}`)
  const data = JSON.parse(readFileSync('data/mods.json', 'utf8'))
  const { members, hits, stale } = topicMembers(topic, data.mods)
  const excluded = new Set(topic.exclude.map(identity))
  const listed = new Set(listedMembers(members))
  const state = mod => excluded.has(identity(idOf(mod))) ? 'excluded' : listed.has(mod) ? 'listed' : 'off page'
  for (const { mod, pattern } of hits) console.log(`${state(mod)}\t${idOf(mod)}\t${mod.stars ?? '?'}\t${pattern}`)
  for (const mod of members.filter(mod => !hits.some(hit => hit.mod === mod))) console.log(`${state(mod)}\t${idOf(mod)}\t${mod.stars ?? '?'}\tinclude`)
  for (const id of stale) console.log(`stale\t${id}`)
  console.log(`${hits.length} matches, ${hits.filter(hit => excluded.has(identity(idOf(hit.mod)))).length} excluded, ${members.length - listed.size} off page, ${listed.size} listed`)
}
