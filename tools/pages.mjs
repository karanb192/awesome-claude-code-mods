// One page per mod under docs/mods/<slug>/. data/pages.json records which mod id owns each page path and
// only ever grows: a path is never handed to a different mod, so a shared or bookmarked link cannot start
// describing another mod. When a mod is renamed or confirmed as a copy, its old path redirects to the page
// of the mod that replaced it, and the registry remembers that target after the copy's record is retired.

import { esc, arrow, mark, star, repo, site, levels, reachText, track, recordDetails, validationStatus, reviewNotes } from './site.mjs'
import { hasFootprint, classified } from './grade.mjs'
import { install } from '../finder/install.mjs'
import { slugs } from './slug.mjs'

export const idOf = mod => mod.id ?? `${mod.repo}:${mod.path}`
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0
// GitHub matches repository names without case; plugin paths keep theirs.
export const identity = id => { const at = id.indexOf(':'); return at < 0 ? id : id.slice(0, at).toLowerCase() + id.slice(at) }
const SLUG = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

export function readRegistry(text) {
  const registry = text ? JSON.parse(text) : {}
  const folded = new Set()
  for (const [slug, entry] of Object.entries(registry)) {
    if (!SLUG.test(slug) || typeof entry?.id !== 'string' || (entry.to !== undefined && !SLUG.test(String(entry.to))) || folded.has(slug.toLowerCase())) throw new Error(`data/pages.json has an invalid entry for ${slug}`)
    folded.add(slug.toLowerCase())
  }
  return registry
}

// One entry per line keeps the diff of an added mod to one line.
export const formatRegistry = registry => `{\n${Object.entries(registry).sort(([a], [b]) => byText(a, b)).map(([slug, entry]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(entry)}`).join(',\n')}\n}\n`

const retained = mod => mod.validate?.status === 'unknown'

// records: the mods and built-ins that get pages. all: every scanned record, for duplicateOf links.
// A maintainer can point a retired path at another page by setting its "to" in data/pages.json; a record
// the scan only retained follows that redirect until a fresh scan finds it again.
export function assignPages(records, registry, all) {
  const entries = new Map(Object.entries(registry).sort(([a], [b]) => byText(a, b)))
  // macOS checkouts are case-insensitive, so two paths differing only in case would overwrite each other.
  const taken = new Set([...entries.keys()].map(slug => slug.toLowerCase()))
  const owned = new Map()
  for (const [slug, entry] of entries) owned.set(identity(entry.id), [...(owned.get(identity(entry.id)) ?? []), slug])
  // Input order follows stars, so candidate paths are worked out in id order. A rescanned record claims a
  // shared path before a retained copy of it under the repository's old letter case.
  const candidates = slugs([...records].sort((a, b) => byText(idOf(a), idOf(b))))
  const ordered = [...records].sort((a, b) => retained(a) - retained(b) || byText(idOf(a), idOf(b)))
  const pages = new Map(), claimed = new Set()
  for (const mod of ordered) {
    const mine = (owned.get(identity(idOf(mod))) ?? []).filter(slug => !claimed.has(slug))
    let slug = mine.find(slug => entries.get(slug).id === idOf(mod)) ?? mine[0]
    if (!slug) {
      const base = candidates.get(mod)
      slug = base
      for (let n = 2; taken.has(slug.toLowerCase()); n++) slug = `${base}--${n}`
      taken.add(slug.toLowerCase())
    }
    claimed.add(slug)
    entries.set(slug, { ...entries.get(slug), id: idOf(mod) })
    pages.set(mod, slug)
  }
  const ownerOf = new Map([...pages].map(([mod, slug]) => [slug, mod]))
  // pages is in claim order, so a rescanned record wins over a retained copy under the old letter case.
  const pageOf = new Map()
  for (const [mod, slug] of pages) if (!pageOf.has(identity(idOf(mod)))) pageOf.set(identity(idOf(mod)), slug)
  const duplicateOf = new Map(all.filter(mod => mod.kind === 'duplicate' && mod.duplicateOf).map(mod => [identity(idOf(mod)), identity(mod.duplicateOf)]))
  const resolve = (slug, seen = new Set()) => {
    const entry = entries.get(slug)
    if (!entry || seen.has(slug)) return
    seen.add(slug)
    for (let id = identity(entry.id), hops = new Set(); id && !hops.has(id); id = duplicateOf.get(id)) {
      if (pageOf.has(id)) return follow(pageOf.get(id), seen)
      hops.add(id)
    }
    return entry.to ? resolve(entry.to, seen) : undefined
  }
  // A retained page that itself redirects is not a terminal page; a cycle of them resolves to nothing.
  const follow = (slug, seen) => {
    const owner = ownerOf.get(slug), to = entries.get(slug).to
    return owner && retained(owner) && to ? resolve(to, seen) : slug
  }
  const redirects = new Map()
  for (const [slug, entry] of [...entries]) {
    const owner = ownerOf.get(slug)
    if (owner) {
      if (!retained(owner)) { if (entry.to) entries.set(slug, { id: entry.id }); continue }
      const target = entry.to ? resolve(entry.to, new Set([slug])) : undefined
      if (target) redirects.set(slug, target)
      continue
    }
    const target = resolve(slug)
    if (!target) continue
    redirects.set(slug, target)
    if (entry.to !== target) entries.set(slug, { id: entry.id, to: target })
  }
  return { pages, redirects, registry: Object.fromEntries(entries) }
}

// Failed mods stay indexable: "fails on <version>" answers a search for that mod. Retained records carry a
// footprint from an older scan, and an empty description leaves nothing to tell one page from another.
export const indexable = mod => ['passed', 'warnings', 'failed'].includes(mod.validate.status) && String(mod.description ?? '').trim() !== ''

const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c')
export const clip = (text, n) => { text = String(text ?? '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text }
const sourceOf = mod => /^https?:\/\//i.test(String(mod.url)) ? mod.url : `https://github.com/${mod.repo}`

export function shell({ title, description, canonical, robots, head = '', body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}${robots ? `<meta name="robots" content="${robots}">` : ''}<meta name="theme-color" content="#f0eee6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1c1c1a" media="(prefers-color-scheme: dark)">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/hanken-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">${head}</head><body>
<div class="mast"><header class="shell"><a href="/" class="brand" aria-label="Claude Mods home">${mark}<span>claude<span class="brand-light">mods</span></span></a><nav aria-label="Main navigation"><a href="/#directory">The collection</a><a href="/#about">About mods</a><a class="github-link" href="${repo}" aria-label="Star the Claude Code mods list on GitHub">${star}Star on GitHub</a></nav></header></div>
${body}
<footer class="shell"><a href="/" class="brand">${mark}<span>claude<span class="brand-light">mods</span></span></a><p>An independent community scan.<br>Not an official Anthropic directory.</p><a href="${repo}">Awesome Claude Code Mods on GitHub ${arrow}</a></footer>
</body></html>`.replace(/[ \t]+\n/g, '\n') + '\n'
}

const firstLine = text => clip(String(text ?? '').split('\n')[0], 160)
const callList = calls => calls.slice(0, 6).map(call => `<code>${esc(call)}</code>`).join(', ') + (calls.length > 6 ? ` and ${calls.length - 6} more` : '')
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/
const licenseUrl = license => typeof license === 'string' && SPDX.test(license) && !['NOASSERTION', 'NONE', 'Other'].includes(license) ? `https://spdx.org/licenses/${license}.html` : null

// The branches every access sentence follows, shared by the mod page summary and the compact line on topic
// pages so the two cannot drift. The level comes from classified calls alone; an incomplete footprint names
// no calls, because its partial list cannot establish what is absent.
export function accessFacts(mod) {
  const calls = [...new Set(mod.calls)]
  const c = classified(calls)
  const complete = hasFootprint(mod)
  const kind = !complete ? 'incomplete' : !calls.length ? 'none' : c.graded ? 'graded' : 'unclassified'
  const named = complete ? [...c.unclassified, ...c.foreign] : []
  return { calls, c, complete, kind, ungraded: c.unclassified.length + c.foreign.length, level: kind === 'graded' ? c.level : null, labels: kind === 'graded' ? c.labels : [], named }
}

const FOREIGN = 'Calls in a namespace that is not in the Claude Code 2.1.302 core table'
const STATE_NOTE = 'the scan does not record whose state, so this does not show that it reads another mod’s values'

// What the scan recorded, as one sentence and a short list, built only from scan fields so it never repeats
// author text. The level comes from classified calls alone; unclassified calls are named, not scored.
// A retained record describes its last recorded footprint and why it was not rescanned.
export function scanSummary(mod, version) {
  const name = esc(mod.name)
  const retained = mod.validate.status === 'unknown'
  const result = retained ? mod.lastKnownValidate : mod.validate
  const raw = result?.claudeVersion ?? version
  const at = esc(raw)
  const validation = result?.status === 'passed' ? `passed <code>claude plugin validate</code> on Claude Code ${at}`
    : result?.status === 'warnings' ? `passed <code>claude plugin validate</code> with warnings on Claude Code ${at}`
    : result?.status === 'failed' ? `fails <code>claude plugin validate</code> on Claude Code ${at}${result.errors?.length ? `: ${esc(firstLine(result.errors[0]))}` : ''}`
    : 'has no recorded validation result'
  const shortValidation = result?.status === 'passed' ? `passes validation on ${raw}` : result?.status === 'warnings' ? `passes validation with warnings on ${raw}` : result?.status === 'failed' ? `fails validation on ${raw}` : 'not validated'
  const facts = accessFacts(mod)
  const { calls, c, complete, kind, ungraded } = facts
  let sentence, access, short
  if (kind === 'incomplete') {
    sentence = `The scan could not record a complete footprint for ${name}, so its access is unknown; it ${validation}.`
    access = 'Access: unknown, the footprint is incomplete'
    short = `Scan: access unknown, ${shortValidation}.`
  } else if (kind === 'none') {
    sentence = `The validator reported no API methods for ${name}; it ${validation}.`
    access = 'Access: no API methods recorded'
    short = `Scan: no API methods recorded, ${shortValidation}.`
  } else if (kind === 'graded') {
    sentence = `${name} reaches L${c.level} (${c.name})${ungraded ? ' by its classified calls' : ''} and ${validation}.`
    access = `Access from classified calls: L${c.level}, ${c.name}${c.labels.length ? ': ' + esc(c.labels.join(', ')) : ''}`
    short = `Scan: L${c.level} ${c.name}${ungraded ? ' by classified calls' : ''}, ${shortValidation}.`
  } else {
    sentence = `The scanner could not classify any of the ${calls.length} API methods ${name} references, so its access is unknown; it ${validation}.`
    access = 'Access: unknown, no call could be classified'
    short = `Scan: access unknown, ${shortValidation}.`
  }
  // An incomplete footprint can under-report both counts, so it shows neither.
  const items = [
    ...(complete ? [`Events hooked: ${new Set(mod.hooks.map(hook => hook.event)).size}`, `API methods referenced: ${calls.length}`] : []),
    access,
    ...(complete && c.unclassified.length ? [`Unclassified calls: ${c.unclassified.length} (${callList(c.unclassified)}), full access unknown`] : []),
    ...(complete && c.foreign.length ? [`${FOREIGN}: ${c.foreign.length} (${callList(c.foreign)}), full access unknown`] : []),
    ...(complete && c.labels.includes('reads mod state') ? [`Reads mod state: ${STATE_NOTE}`] : []),
    ...(retained ? [`Last recorded footprint${mod.sourceCommit ? `, revision <code>${esc(mod.sourceCommit.slice(0, 7))}</code>` : ''}: ${esc(mod.validate.errors[0] ?? 'not rescanned in the latest scan.')}`] : []),
    'Static scan, not a runtime test',
  ]
  return {
    html: `<section class="summary" aria-label="Scan summary"><p class="summary-line">${retained ? 'In its last recorded footprint, ' + sentence.replace(/^The /, 'the ') : sentence}</p><ul>${items.map(item => `<li>${item}</li>`).join('')}</ul></section>`,
    short: (retained ? 'Last recorded scan. ' : '') + short,
    level: facts.level, labels: facts.labels, named: facts.named,
  }
}

// The same facts in one line, for lists that show many mods at once. A "reads mod state" label carries the
// owner qualification inline, because a list has no room for the summary's extra item.
export function accessLine(mod) {
  const facts = accessFacts(mod)
  const { c, kind, ungraded } = facts
  const label = name => name === 'reads mod state' ? 'reads mod state (owner not recorded)' : name
  const parts = kind === 'incomplete' ? ['Access unknown, the footprint is incomplete.']
    : kind === 'none' ? ['No API methods recorded.']
    : kind === 'graded' ? [`L${c.level} ${esc(c.name)}${ungraded ? ' by classified calls' : ''}${c.labels.length ? ': ' + esc(c.labels.map(label).join(', ')) : ''}.`]
    : ['Access unknown, no call could be classified.']
  if (kind !== 'incomplete' && c.unclassified.length) parts.push(`Unclassified calls: ${callList(c.unclassified)}, full access unknown.`)
  if (kind !== 'incomplete' && c.foreign.length) parts.push(`${FOREIGN}: ${callList(c.foreign)}, full access unknown.`)
  return { html: parts.join(' '), level: facts.level, labels: facts.labels, named: facts.named }
}

const INSTALL_FALLBACK = 'To install it, open the repository and follow the author’s setup instructions.'
const INSTALL_BUILTIN = 'It ships inside Claude Code, so there is nothing to install.'
const INSTALL_VERSION = 'Mods need Claude Code 2.1.287 or later.'
const installCaution = mod => mod.validate.status === 'failed' ? ' It fails validation in the latest scan, so it may not install.' : mod.validate.status === 'unknown' ? ' The latest scan could not confirm this mod, so the command may be out of date.' : ''

// The install hint as one line, for lists: the same command, origin and name-check note as the mod page.
export function installLine(mod) {
  if (mod.kind === 'builtin') return INSTALL_BUILTIN
  const hint = install(mod)
  if (!hint) return INSTALL_FALLBACK
  return `Install hint: <code>${esc(hint.command)}</code>, from ${esc(hint.from)}.${hint.check ? ' ' + esc(hint.check) : ''}${installCaution(mod)}`
}

const COPY = `<script>for(const b of document.querySelectorAll('[data-copy]')){b.hidden=false;b.onclick=()=>{const code=b.previousElementSibling,select=()=>{getSelection().selectAllChildren(code);b.textContent='Selected'};try{navigator.clipboard.writeText(code.textContent).then(()=>{b.textContent='Copied'},select)}catch{select()}}}</script>`

// How to install the mod: built-ins ship with Claude Code; otherwise the finder's install hint, labelled as
// a hint because the scan reads the manifest's plugin name, not the marketplace entry's.
function installBlock(mod) {
  if (mod.kind === 'builtin') return `<p class="install">${INSTALL_BUILTIN}</p>`
  const hint = install(mod)
  if (!hint) return `<p class="install">${INSTALL_FALLBACK} ${INSTALL_VERSION}</p>`
  return `<section class="install-hint" aria-labelledby="install-title"><h2 id="install-title">Install hint</h2><div class="command"><pre><code>${esc(hint.command)}</code></pre><button type="button" class="copy" data-copy hidden>Copy</button></div><p>From ${esc(hint.from)}.${hint.check ? ' ' + esc(hint.check) : ''} ${INSTALL_VERSION}${installCaution(mod)}</p></section>${COPY}`
}

// siblings: other mods from the same repository with their page paths, already in display order.
// topics: the topic pages that list this mod, as { slug, title }, so each member links its parent page.
export function renderModPage(mod, { slug, anchor, claudeVersion, siblings = [], topics = [] }) {
  const url = `${site}mods/${slug}/`
  const owner = mod.repo.split('/')[0]
  const described = String(mod.description ?? '').trim()
  const version = mod.validate.claudeVersion ?? claudeVersion
  const title = `${mod.name}, a Claude Code mod by ${owner} | Awesome Claude Code Mods`
  const summary = scanSummary(mod, version)
  const description = described
    ? `${clip(described, 154 - summary.short.length)} ${summary.short}`
    : `${mod.name} is a Claude Code mod in ${mod.repo}. See the hooks, API calls and access recorded by a static scan.`
  const shown = siblings.slice(0, 20)
  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'SoftwareSourceCode', '@id': `${url}#mod`, name: mod.name, url, codeRepository: `https://github.com/${mod.repo}`, runtimePlatform: 'Claude Code', ...(licenseUrl(mod.license) ? { license: licenseUrl(mod.license) } : {}), ...(described ? { description: described } : {}),
        author: { '@type': 'Person', name: owner, url: `https://github.com/${owner}` }, isPartOf: { '@id': `${site}#website` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Claude Code mods', item: site },
        { '@type': 'ListItem', position: 2, name: mod.name, item: url },
      ] },
    ],
  })
  const status = validationStatus(mod, version)
  const badgeUrl = kind => `https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/${anchor}-${kind}.svg`
  const snippet = `[![reach](${badgeUrl('reach')})](${url})\n[![validates](${badgeUrl('validates')})](${url})`
  const statusClass = mod.validate.status === 'passed' || mod.validate.status === 'warnings' ? '' : ' bad'
  return shell({
    title, description, canonical: url, robots: indexable(mod) ? '' : 'noindex',
    head: `
<meta property="og:type" content="website"><meta property="og:title" content="${esc(`${mod.name}, a Claude Code mod`)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${site}social-preview.png?v=2"><meta name="twitter:card" content="summary">
<script type="application/ld+json">${ld}</script>`,
    body: `<main class="shell mod-page" id="main">
<p class="crumbs"><a href="/#${esc(anchor)}">All Claude Code mods</a><span aria-hidden="true">/</span><span>${esc(mod.repo)}</span></p>
<h1>${esc(mod.name)}</h1>
<p class="byline">A Claude Code mod in <a href="https://github.com/${esc(mod.repo)}">${esc(mod.repo)}</a>${mod.kind === 'builtin' ? ', built into Claude Code' : ''}${mod.directory ? ` <span class="listed" title="Listed in Anthropic's plugin directory as ${esc(mod.directory.plugin)}">In Anthropic directory</span>` : ''}</p>
<p class="lede">${described ? esc(described) : 'No description provided by the author.'}</p>
${reviewNotes(mod).length ? `<p class="compatibility">${esc(reviewNotes(mod).join('; '))}</p>` : ''}
${summary.html}
${installBlock(mod)}
<div class="facts"><div><h2>Access</h2><span class="level">${esc(hasFootprint(mod) ? `L${mod.reach.level} ${levels[mod.reach.level]}` : 'Unknown access')}</span>${track(mod)}<span class="labels">${esc(hasFootprint(mod) ? reachText(mod) : 'The footprint is unavailable or incomplete.')}</span></div>
<div><h2>Validation</h2><span class="status${statusClass}">${esc(status)}${mod.validate.status === 'passed' || mod.validate.status === 'warnings' ? ` on Claude Code ${esc(version)}` : ''}</span></div></div>${topics.length ? `\n<p class="topics-line">Listed under ${topics.map(topic => `<a href="/topics/${esc(topic.slug)}/">${esc(topic.title)}</a>`).join(', ')}.</p>` : ''}
<p class="actions"><a class="source" href="${esc(sourceOf(mod))}">View the source on GitHub ${arrow}</a><a href="/#${esc(anchor)}">Back to the list</a></p>
<section class="record" aria-labelledby="record-title"><h2 id="record-title">What the scan recorded</h2>
${recordDetails(mod, claudeVersion)}
<p class="note">These are the hooks and API calls reported by <code>claude plugin validate</code>. Access levels describe the widest reach of those calls and are not safety ratings. Validation is a static check, not a runtime test, and a passing result does not prove that a mod works or is safe. <a href="/access/">What a mod can access and how the scan works</a>.</p></section>
${shown.length ? `<section class="siblings" aria-labelledby="siblings-title"><h2 id="siblings-title">More from ${esc(mod.repo)}</h2><ul>${shown.map(({ mod: other, slug: path }) => `<li><a href="/mods/${esc(path)}/">${esc(other.name)}</a>${String(other.description ?? '').trim() ? `<span>${esc(clip(other.description, 110))}</span>` : ''}</li>`).join('')}</ul>${siblings.length > shown.length ? `<p><a href="/?q=${encodeURIComponent(mod.repo)}#directory">See all ${siblings.length + 1} mods from ${esc(mod.repo)}</a></p>` : ''}</section>` : ''}
${mod.kind === 'builtin' ? '' : `<section class="badge-snippet" aria-labelledby="badge-title"><h2 id="badge-title">Badge for your README</h2><p><img src="/badges/${esc(anchor)}-reach.svg" alt="Reach badge for ${esc(mod.name)}"> <img src="/badges/${esc(anchor)}-validates.svg" alt="Validation badge for ${esc(mod.name)}"></p><p>Authors can show the latest scan result in their README. Each badge links to this page.</p><pre><code>${esc(snippet)}</code></pre></section>`}
</main>`,
  })
}

export function renderRedirect(target) {
  const url = `${site}mods/${target}/`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Moved</title>
<meta http-equiv="refresh" content="0; url=/mods/${esc(target)}/"><link rel="canonical" href="${esc(url)}"></head>
<body><p>This mod has moved to <a href="/mods/${esc(target)}/">${esc(url)}</a>.</p></body></html>
`
}

export function renderNotFound() {
  return shell({
    title: 'Page not found | Awesome Claude Code Mods', robots: 'noindex',
    body: `<main class="shell mod-page" id="main">
<h1>No page here.</h1>
<p class="lede">The mod may have been removed from its repository or renamed. Search the collection for it.</p>
<form class="not-found-search" role="search" action="/" method="get"><label for="q">Search mods by name, repo or description</label><input id="q" name="q" type="search" autocomplete="off"><button type="submit">Search</button></form>
<p class="actions"><a href="/#directory">Browse all mods ${arrow}</a></p>
</main>`,
  })
}
