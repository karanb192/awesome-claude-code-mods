// One page per mod under docs/mods/<slug>/. data/pages.json records which mod id owns each page path and
// only ever grows: a path is never handed to a different mod, so a shared or bookmarked link cannot start
// describing another mod. When a mod is renamed or confirmed as a copy, its old path redirects to the page
// of the mod that replaced it, and the registry remembers that target after the copy's record is retired.

import { esc, arrow, mark, star, repo, site, levels, reachText, track, recordDetails, validationStatus, reviewNotes } from './site.mjs'
import { hasFootprint } from './grade.mjs'
import { slugs } from './slug.mjs'

export const idOf = mod => mod.id ?? `${mod.repo}:${mod.path}`
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0
// GitHub matches repository names without case; plugin paths keep theirs.
const identity = id => { const at = id.indexOf(':'); return at < 0 ? id : id.slice(0, at).toLowerCase() + id.slice(at) }
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
const clip = (text, n) => { text = String(text ?? '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text }
const sourceOf = mod => /^https?:\/\//i.test(String(mod.url)) ? mod.url : `https://github.com/${mod.repo}`

function shell({ title, description, canonical, robots, head = '', body }) {
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

// siblings: other mods from the same repository with their page paths, already in display order.
export function renderModPage(mod, { slug, anchor, claudeVersion, siblings = [] }) {
  const url = `${site}mods/${slug}/`
  const owner = mod.repo.split('/')[0]
  const described = String(mod.description ?? '').trim()
  const version = mod.validate.claudeVersion ?? claudeVersion
  const title = `${mod.name}, a Claude Code mod by ${owner} | Awesome Claude Code Mods`
  const description = described
    ? clip(described, 155)
    : `${mod.name} is a Claude Code mod in ${mod.repo}. See the hooks, API calls and access recorded by a static scan.`
  const shown = siblings.slice(0, 20)
  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'SoftwareSourceCode', '@id': `${url}#mod`, name: mod.name, url, codeRepository: `https://github.com/${mod.repo}`, ...(described ? { description: described } : {}),
        author: { '@type': 'Person', name: owner, url: `https://github.com/${owner}` }, isPartOf: { '@id': `${site}#website` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Claude Code mods', item: site },
        { '@type': 'ListItem', position: 2, name: mod.name, item: url },
      ] },
    ],
  })
  const status = validationStatus(mod, version)
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
<div class="facts"><div><h2>Access</h2><span class="level">${esc(hasFootprint(mod) ? `L${mod.reach.level} ${levels[mod.reach.level]}` : 'Unknown access')}</span>${track(mod)}<span class="labels">${esc(hasFootprint(mod) ? reachText(mod) : 'The footprint is unavailable or incomplete.')}</span></div>
<div><h2>Validation</h2><span class="status${statusClass}">${esc(status)}${mod.validate.status === 'passed' || mod.validate.status === 'warnings' ? ` on Claude Code ${esc(version)}` : ''}</span></div></div>
<p class="actions"><a class="source" href="${esc(sourceOf(mod))}">View the source on GitHub ${arrow}</a><a href="/#${esc(anchor)}">Back to the list</a></p>
<p class="install">To install it, open the repository and follow the author’s setup instructions. Mods need Claude Code 2.1.287 or later.</p>
<section class="record" aria-labelledby="record-title"><h2 id="record-title">What the scan recorded</h2>
${recordDetails(mod, claudeVersion)}
<p class="note">These are the hooks and API calls reported by <code>claude plugin validate</code>. Access levels describe the widest reach of those calls and are not safety ratings. Validation is a static check, not a runtime test, and a passing result does not prove that a mod works or is safe. <a href="${repo}/blob/main/SCANNING.md">How the scan works</a>.</p></section>
${shown.length ? `<section class="siblings" aria-labelledby="siblings-title"><h2 id="siblings-title">More from ${esc(mod.repo)}</h2><ul>${shown.map(({ mod: other, slug: path }) => `<li><a href="/mods/${esc(path)}/">${esc(other.name)}</a>${String(other.description ?? '').trim() ? `<span>${esc(clip(other.description, 110))}</span>` : ''}</li>`).join('')}</ul>${siblings.length > shown.length ? `<p><a href="/?q=${encodeURIComponent(mod.repo)}#directory">See all ${siblings.length + 1} mods from ${esc(mod.repo)}</a></p>` : ''}</section>` : ''}
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
