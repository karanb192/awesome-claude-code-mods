import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { siteAnchors } from './slug.mjs'
import { hasFootprint } from './grade.mjs'

export const css = readFileSync(new URL('./site.css', import.meta.url), 'utf8')
const script = readFileSync(new URL('./site-client.js', import.meta.url), 'utf8')
export const repo = 'https://github.com/karanb192/awesome-claude-code-mods'
export const site = 'https://mods.aidojo.si/'
const rawCatalogue = 'https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/catalogue.md'
export const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const url = value => /^https?:\/\//i.test(String(value)) ? esc(value) : '#directory'
export const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>'
export const mark = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M11 5H5v22h6M21 5h6v22h-6M16 10v12M10 16h12"/></svg>'
export const star = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L2.9 9.6l6.3-.9Z"/></svg>'
export const levels = ['Draws & remembers', 'Reads', 'Writes or runs', 'Uses the network']
const levelOf = mod => hasFootprint(mod) ? mod.reach.level : 'unknown'
const accessGroups = mods => [...levels.map((label, level) => ({ label, level, count: mods.filter(mod => levelOf(mod) === level).length })),
  { label: 'Unknown access', level: 'unknown', count: mods.filter(mod => !hasFootprint(mod)).length }]
const hookText = hook => hook.event + (Object.keys(hook.matcher).length ? ' {' + Object.entries(hook.matcher).map(([k, v]) => `${k}=${v}`).join(', ') + '}' : '')
const sourceUrl = (mod, file, line) => `https://github.com/${mod.repo}/blob/${mod.sourceCommit ?? mod.defaultBranch ?? 'main'}/${file.split('/').map(encodeURIComponent).join('/')}${line ? '#L' + line : ''}`
export const reviewNotes = mod => [
  ...((mod.marketplaces ?? []).some(p => p.status === 'failed') ? ['marketplace fails'] : []),
  ...((mod.marketplaces ?? []).some(p => p.status === 'unknown') ? ['marketplace not verified'] : []),
  ...((mod.compatibility?.warnings ?? []).some(w => w.code !== 'ui-review-incomplete') ? ['review UI rewrite'] : []),
  ...((mod.compatibility?.warnings ?? []).some(w => w.code === 'ui-review-incomplete') ? ['UI review incomplete'] : []),
]
export const reachText = mod => !hasFootprint(mod) ? 'unknown access' : mod.reach.labels.join(', ') || 'draws only'
export const validationStatus = (mod, version) => ['passed', 'warnings'].includes(mod.validate.status) ? (mod.validate.status === 'warnings' ? 'Passed with warnings' : 'Passed') : mod.validate.status === 'failed' ? `fails on ${version}` : 'not verified'
export const track = mod => `<span class="track" aria-label="${hasFootprint(mod) ? 'Reach level ' + mod.reach.level + ': ' + levels[mod.reach.level] : 'Unknown access'}">${[0, 1, 2, 3].map(i => `<i class="${hasFootprint(mod) && i <= mod.reach.level ? 'on l' + mod.reach.level : ''}"></i>`).join('')}</span>`

// The full scan record of one mod, shown on its page. A retained record that was not rescanned keeps the
// validator version that produced its footprint, so the label names that version rather than the current one.
export function recordDetails(mod, claudeVersion) {
  const version = mod.validate.claudeVersion ?? claudeVersion
  const last = mod.validate.status === 'unknown' && mod.lastKnownValidate
  const compatibility = (mod.marketplaces ?? []).map(p => `<dt>Marketplace ${esc(p.status)}</dt><dd><a href="${esc(sourceUrl(mod, p.path))}">${esc(p.name ?? p.path)}</a>${p.errors.length ? ': ' + esc(p.errors.join('; ')) : ''}</dd>`).join('')
    + (mod.compatibility?.warnings ?? []).map(w => `<dt>${w.code === 'ui-review-incomplete' ? 'UI review incomplete' : 'UI rewrite review'}</dt><dd>${esc(w.message)} ${(w.evidence ?? []).map(e => `<a href="${esc(sourceUrl(mod, e.file, e.line))}">${esc(e.file)}:${e.line}</a>`).join(', ')}</dd>`).join('')
  return `<dl>
    ${mod.directory ? `<dt>Anthropic directory</dt><dd>Listed as <code>${esc(mod.directory.plugin)}</code></dd>` : ''}${!hasFootprint(mod) ? '\n    <dt>Footprint</dt><dd>Unavailable or incomplete. Recorded events and calls below may omit access.</dd>' : ''}
    <dt>Observed events</dt><dd>${esc(mod.sees.join(', ') || (hasFootprint(mod) ? 'Only what it hooks' : 'unknown'))}</dd>
    <dt>Hooks</dt><dd><code>${esc(mod.hooks.map(hookText).join(', ') || (hasFootprint(mod) ? 'none' : 'not reported'))}</code></dd>
    <dt>API calls</dt><dd><code>${esc(mod.calls.join(', ') || (hasFootprint(mod) ? 'none recorded' : 'not reported'))}</code></dd>
    ${mod.surfaceModules.length ? `<dt>Surface modules</dt><dd><code>${esc(mod.surfaceModules.join(', '))}</code></dd>` : ''}
    <dt>Validation on ${esc(version)}</dt><dd>${esc(validationStatus(mod, version))}</dd>
    ${last ? `<dt>Last known result</dt><dd>${esc(validationStatus({ validate: last }, last.claudeVersion ?? version))}${last.claudeVersion ? ' on ' + esc(last.claudeVersion) : ''}</dd>` : ''}
    ${mod.validate.errors.length ? `<dt>Validator output</dt><dd>${esc(mod.validate.errors.join('; '))}</dd>` : ''}
    ${mod.sourceCommit ? `<dt>Scanned revision</dt><dd><a href="https://github.com/${esc(mod.repo)}/tree/${esc(mod.sourceCommit)}"><code>${esc(mod.sourceCommit.slice(0, 12))}</code></a></dd>` : ''}
    ${compatibility}</dl>`
}

// pages maps each record to its page folder under mods/; the homepage links each name there.
// The homepage carries the first rows only; the browser loads the rest from docs/directory/<n>.json. Googlebot reads
// only the first 2 MB of each page or fetched resource, so the full list in one file would be cut short.
export const INITIAL_ROWS = 100
const PART_BYTES = 900_000

// Splits the rows and strip marks, in order, into parts under PART_BYTES each. Every part carries the snapshot id the
// page asks for, so a browser never combines parts cached from different publications.
function directoryParts(rows, segments, snapshot) {
  const parts = [{ rows: [], strip: [] }]
  let size = 0
  for (const [kind, html] of [...rows.map(row => ['rows', row]), ...segments.map(segment => ['strip', segment])]) {
    const bytes = Buffer.byteLength(JSON.stringify(html)) + 1
    if (size + bytes > PART_BYTES && size) { parts.push({ rows: [], strip: [] }); size = 0 }
    parts.at(-1)[kind].push(html)
    size += bytes
  }
  return parts.map(part => JSON.stringify({ snapshot, rows: part.rows, strip: part.strip.join('') }))
}
// The A to Z pages that link every mod with ordinary HTML, grouped by the first character of its name.
export const browseKey = name => { const c = String(name ?? '').trim().charAt(0).toLowerCase(); return /^[a-z]$/.test(c) ? c : /^[0-9]$/.test(c) ? '0-9' : 'other' }
const BROWSE_ORDER = [...'abcdefghijklmnopqrstuvwxyz', '0-9', 'other']
export const browseKeys = records => BROWSE_ORDER.filter(key => records.some(mod => browseKey(mod.name) === key))
// letters: the browse keys that have a page, from browseKeys over the records the A to Z pages list.
export const browseNav = (letters, current) => `<div class="browse" role="navigation" aria-label="Browse all mods from A to Z"><span>Browse A to Z</span>${letters.map(key => key === current ? `<b aria-current="page">${key.toUpperCase()}</b>` : `<a href="/browse/${key}/">${key === 'other' ? 'Other' : key.toUpperCase()}</a>`).join('')}</div>`
// topics: the topic pages to link, as { slug, short }; the row is empty when no topic has a listed mod.
export const topicNav = (topics, current) => topics.length ? `<div class="browse topics" role="navigation" aria-label="Browse mods by topic"><span>Browse by topic</span>${topics.map(topic => topic.slug === current ? `<b aria-current="page">${esc(topic.short)}</b>` : `<a href="/topics/${esc(topic.slug)}/">${esc(topic.short)}</a>`).join('')}</div>` : ''

// Returns the homepage and the parts of the full rows and strip it loads. letters: the A to Z pages to link;
// topics: the topic pages to link.
export function renderSite(data, pages, letters = [], topics = []) {
  const mods = data.mods.filter(mod => mod.kind === 'mod')
  const builtins = data.mods.filter(mod => mod.kind === 'builtin')
  const keys = siteAnchors(data.mods)
  const slug = mod => keys.get(mod)
  const catalogs = [...new Set(data.mods.filter(mod => mod.kind === 'catalog').map(mod => mod.repo))]
  const date = data.generated.slice(0, 10)
  const dateLabel = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(data.generated))
  const status = mod => validationStatus(mod, data.claudeVersion)
  const row = mod => `<tr id="${esc(slug(mod))}" data-level="${levelOf(mod)}" data-name="${esc(mod.name)} ${esc(mod.repo)} ${esc(mod.description)}" data-stars="${mod.stars ?? -1}" data-listed="${mod.directory ? 1 : 0}">
    <td class="identity"><a class="mod-name" href="mods/${esc(pages.get(mod))}/">${esc(mod.name)}</a><a class="repo" href="${url(mod.url)}" aria-label="${esc(mod.repo)} on GitHub">${esc(mod.repo)}${arrow}</a>${mod.directory ? `<span class="listed" title="Listed in Anthropic's plugin directory as ${esc(mod.directory.plugin)}">In Anthropic directory</span>` : ''}</td>
    <td class="description"><p>${esc(mod.description || 'No description provided by the author.')}</p>${reviewNotes(mod).length ? `<p class="compatibility">${esc(reviewNotes(mod).join('; '))}</p>` : ''}</td>
    <td class="reach">${track(mod)}<span class="labels">${esc(reachText(mod))}</span>${mod.validate.status === 'failed' || !['passed', 'warnings'].includes(mod.validate.status) ? `<span class="status bad">${esc(status(mod))}</span>` : mod.validate.status === 'warnings' ? '<span class="status">Validator warnings</span>' : ''}</td>
    <td class="num"><span class="mobile-label">Repository stars </span>${mod.stars == null ? 'Unknown' : Number(mod.stars).toLocaleString('en')}</td></tr>`
  const heading = sortable => `<thead><tr><th scope="col">${sortable ? '<button type="button" data-k="name">Mod <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 12V3L2 6m3-3 3 3m3-2v9l-3-3m3 3 3-3"/></svg></button>' : 'Mod'}</th><th scope="col">What it does</th><th scope="col">${sortable ? '<button type="button" data-k="level">Access <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 12V3L2 6m3-3 3 3m3-2v9l-3-3m3 3 3-3"/></svg></button>' : 'Access'}</th><th scope="col" class="num">${sortable ? '<button type="button" data-k="stars">Repo stars <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 12V3L2 6m3-3 3 3m3-2v9l-3-3m3 3 3-3"/></svg></button>' : 'Repo stars'}</th></tr></thead>`
  const segments = [...mods].sort((a, b) => (hasFootprint(a) ? a.reach.level : 4) - (hasFootprint(b) ? b.reach.level : 4)).map(mod => `<a class="seg l${levelOf(mod)}" href="#${esc(slug(mod))}" title="${esc(mod.name)}: ${hasFootprint(mod) ? 'L' + mod.reach.level + ' ' : ''}${esc(reachText(mod))}" aria-label="${esc(mod.name)}: ${esc(hasFootprint(mod) ? levels[mod.reach.level] : 'Unknown access')}" data-level="${levelOf(mod)}"></a>`)
  // One claim, worded the same on GitHub, the site, llms.txt and the social card, so search engines and assistants
  // describe the catalogue in one voice. The count is live; the repo About carries a floor instead.
  const n = mods.length.toLocaleString('en')
  const claim = `${n} Claude Code mods, with what each one can access before you install it. Context and usage meters, prompt cache warmers, status lines, guards and more, with install hints.`
  const title = `Awesome Claude Code Mods | ${n} mods and what each can access`
  const description = claim
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${site}#website`, url: site, name: 'Awesome Claude Code Mods', description, inLanguage: 'en' },
      { '@type': 'CollectionPage', '@id': `${site}#page`, url: site, name: title, description, inLanguage: 'en', isPartOf: { '@id': `${site}#website` }, mainEntity: { '@id': `${site}#dataset` }, about: { '@type': 'SoftwareApplication', name: 'Claude Code', url: 'https://code.claude.com/docs/en/plugins/mods/overview' } },
      { '@type': 'Dataset', '@id': `${site}#dataset`, name: 'Claude Code mods catalogue', url: site, license: 'https://creativecommons.org/publicdomain/zero/1.0/', isAccessibleForFree: true,
        description: `${mods.length} Claude Code mods scanned from public GitHub repositories on Claude Code ${data.claudeVersion}, with the hooks, API calls, access level and validation result of each mod.`,
        keywords: ['Claude Code', 'Claude Code mods', 'function hooks', 'Claude Code plugins', 'awesome list'],
        creator: { '@type': 'Person', name: 'Karan Bansal', url: 'https://github.com/karanb192' },
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${site}mods.json` },
          { '@type': 'DataDownload', encodingFormat: 'text/markdown', contentUrl: rawCatalogue },
        ] },
    ],
  }).replace(/</g, '\\u003c')
  const snapshot = createHash('sha256').update(JSON.stringify([mods.map(row), segments])).digest('hex').slice(0, 12)
  const parts = directoryParts(mods.map(row), segments, snapshot)
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f0eee6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1c1c1a" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${site}"><link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/json" href="${site}mods.json" title="Claude Code mods catalogue data">
<link rel="alternate" type="text/plain" href="${site}llms.txt" title="Awesome Claude Code Mods for language models">
<meta property="og:type" content="website"><meta property="og:title" content="Awesome Claude Code Mods"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${site}">
<meta property="og:image" content="${site}social-preview.png?v=2"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Awesome Claude Code Mods. Make Claude Code your own.">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="./fonts/hanken-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/ld+json">${jsonLd}</script>
<style>${css}</style></head><body>
<a class="skip" href="#directory">Skip to the mod directory</a>
<div class="mast"><header class="shell"><a href="./" class="brand" aria-label="Claude Mods home">${mark}<span>claude<span class="brand-light">mods</span></span></a><nav aria-label="Main navigation"><a href="#directory">The collection</a><a href="#about">About mods</a><a class="github-link" href="${repo}" aria-label="Star the Claude Code mods list on GitHub">${star}Star on GitHub</a></nav></header>
</div><main><div class="mast"><section class="hero shell" aria-labelledby="title"><div class="hero-intro"><h1 id="title">Awesome<br><span>Claude Code Mods</span></h1><p>Make Claude Code your own. ${n} mods scanned from public GitHub repositories, with what each one can access before you install it. Context and usage meters, prompt cache warmers, status lines, guards and more, with install hints.</p></div>
<section class="finder" aria-labelledby="finder-title"><div class="finder-intro"><h2 id="finder-title">Ask Claude to find a mod</h2><p>Search this catalogue from your Claude session, with matches and their recorded access.</p><p class="finder-example">Try “Find a mod that helps with code reviews”.</p><p class="finder-credit"><a href="${repo}/tree/main/finder">mod-finder</a>, built by <a href="https://github.com/karanb192">Karan Bansal</a>, the catalogue maintainer.</p></div>
<details class="finder-setup"><summary>Set up mod-finder</summary><p>Install in a Claude Code terminal session and complete the installation prompts.</p><div class="finder-command"><div class="finder-command-actions" hidden><span id="finder-copy-status" role="status"></span><button id="finder-copy" type="button" aria-label="Copy install command">Copy</button></div><pre><code id="finder-command"><span>/plugin</span> <span>install</span> <span>mod-finder</span> <span>--marketplace</span> <span>karanb192/</span><wbr><span>awesome-claude-code-mods</span></code></pre></div><p>Then run <code>/reload-plugins</code> before asking for a mod. Requires Node 18 or later.</p><p>The plugin runs a local MCP server that downloads this catalogue from GitHub and caches it on your computer. It gives Claude two read-only tools to search the catalogue and look up individual mods.</p><p><a href="${repo}/blob/main/finder/README.md#in-claude-code-mcp">Setup and Desktop instructions</a></p></details></section>
</section></div>
<section class="directory shell" id="directory" aria-labelledby="directory-title"><div class="section-heading"><div><h2 id="directory-title">The collection<span class="total">${mods.length}</span></h2><p>Find something useful. See what it can access.</p></div><a href="${repo}/blob/main/contributing.md">Submit a mod ${arrow}</a></div>
${browseNav(letters)}${topicNav(topics)}
<div class="catalog-search"><form class="search" role="search" action="#directory"><label class="sr-only" for="q">Search mods by name, repo or description</label><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="q" name="q" type="search" placeholder="Search by name or what it does" autocomplete="off" aria-controls="t"><button id="clear-search" class="clear-search" type="button" aria-label="Clear search" hidden><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></form>
<div class="result-bar"><span id="n" role="status" aria-live="polite">${mods.length} mods</span><div><button id="reset" type="button" hidden>Clear filters</button><span>Scanned <time datetime="${esc(date)}">${dateLabel}</time></span></div></div></div>
<div class="filter-heading"><span>Filter by access</span><a href="#method">How we check ${arrow}</a></div><div class="legend" role="group" aria-label="Filter by reach level or directory listing"><button type="button" class="lv all" data-level="" aria-pressed="true">All mods</button>${accessGroups(mods).map(({ label, level, count }) => `<button type="button" class="lv" data-level="${level}" aria-pressed="false"><i class="l${level}"></i><span>${label}</span><b>${count}</b></button>`).join('')}<button type="button" class="lv listed-filter" aria-pressed="false"><span>In Anthropic directory</span><b>${mods.filter(mod => mod.directory).length}</b></button></div>
<noscript><p class="notice">Search and sorting need JavaScript. The ${Math.min(INITIAL_ROWS, mods.length)} most-starred mods are listed below, and each name opens its page. Browse all ${mods.length} from A to Z.</p></noscript>
<p id="load-note" class="notice" hidden>Showing the ${Math.min(INITIAL_ROWS, mods.length)} most-starred mods. The full list did not load, so browse every mod from A to Z instead.</p>
<table id="t" data-total="${mods.length}" data-parts="${parts.length}" data-snapshot="${snapshot}"><caption class="sr-only">Claude Code community mods. Sort by mod name, access level or hosting repository stars.</caption>${heading(true)}<tbody>${mods.slice(0, INITIAL_ROWS).map(row).join('\n')}</tbody></table>
<div id="empty" class="empty" hidden><h3>No mods found.</h3><p>Try a broader search or clear the access filter.</p><button type="button" data-reset>Show all mods ${arrow}</button></div>
<div class="directory-end"><p>Stars belong to the hosting repository, not the individual mod. Recorded with this scan.</p><a href="#directory">Back to search ${arrow}</a></div>
</section>
<div class="info"><section class="about" id="about"><div class="shell about-grid"><h2>Your session.<br>A few new tricks.</h2><div><p>Mods are Claude Code plugins that run JavaScript or TypeScript hooks inside your session. They can add a dashboard, open a pane, change tool behavior, or bring context into the conversation.</p><p>Mods are on by default in Claude Code 2.1.287 and later. Choose a mod, open its repository, and follow the author’s setup instructions. The API can change between releases.</p><a class="text-link" href="${repo}#use-mods">How to use mods ${arrow}</a><a class="text-link" href="access/">What can a mod access? ${arrow}</a><a class="text-link" href="https://claude.dev/blog/getting-started-with-claude-code-mods/">Build your first mod ${arrow}</a></div></div></section>
<section class="method shell" id="method" aria-labelledby="method-title"><div class="section-heading"><div><h2 id="method-title">A closer look at access.</h2><p>One mark per mod, colored by its widest recorded access. Select a mark to find its entry.</p></div><a href="./mods.json">Download the data ${arrow}</a></div><div class="strip" role="group" aria-label="Mods by recorded access, including unknown access"></div><p id="strip-note" class="notice" hidden>The marks load with the full list, which did not load. Every mod is also listed from A to Z.</p><noscript><p class="notice">The marks need JavaScript. Every mod is also listed from A to Z.</p></noscript><ul class="strip-legend" aria-label="Access color legend">${accessGroups(mods).map(({ label, level, count }) => `<li><i class="l${level}" aria-hidden="true"></i><span>${esc(label)}</span><span class="legend-count">${count} ${count === 1 ? 'mod' : 'mods'}</span></li>`).join('')}</ul>
<div class="method-copy"><p>Each entry records the hooks and API calls reported by <code>claude plugin validate</code>. Access levels describe the widest reach of those calls. They are not safety ratings. Unknown access means the footprint is unavailable or incomplete; recorded calls may show only part of its access.</p><p>Validation is a static check, not a runtime compatibility test. A passing result does not prove that a mod works or is safe. Marketplace results describe that install route separately. “Review UI rewrite” flags control-character strings in UI source or local imports; it does not prove those strings reach a text rewrite. Each mod’s page lists its hooks, API calls, validator output and source links. See the <a href="${repo}/issues/21">2.1.287 compatibility report</a>.</p></div>
<div class="scan-note"><p>This scan used Claude Code ${esc(data.claudeVersion)} on ${dateLabel}. <a href="${repo}/blob/main/SCANNING.md">Read the method</a> or <a href="${rawCatalogue}">download the catalogue as raw Markdown</a>.</p>${catalogs.length ? `<p>Repackaged catalogs are excluded from the mod count: ${catalogs.map(name => `<a href="https://github.com/${esc(name)}">${esc(name)}</a>`).join(', ')}.</p>` : ''}</div>
${builtins.length ? `<details class="builtins" id="built-in-mods"><summary>Also built into Claude Code <span>${builtins.length} mods</span></summary><p>These ship inside the binary. sec-default seats outermost only on managed machines and Team or Enterprise plans.</p><table><caption class="sr-only">Built-in Claude Code mods</caption>${heading(false)}<tbody>${builtins.map(row).join('\n')}</tbody></table></details>` : ''}
</section></div></main>
<footer class="shell"><a href="./" class="brand">${mark}<span>claude<span class="brand-light">mods</span></span></a><p>An independent community scan.<br>Not an official Anthropic directory.</p><a href="${repo}">Awesome Claude Code Mods on GitHub ${arrow}</a></footer>
<script>${script}</script></body></html>`.replace(/[ \t]+\n/g, '\n') + '\n'
  return { html, parts }
}

export function renderSitemap(paths = []) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${site}</loc><changefreq>daily</changefreq></url>
${paths.map(path => `<url><loc>${site}${esc(path)}</loc></url>\n`).join('')}</urlset>
`
}

export function renderRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${site}sitemap.xml
`
}

// llms.txt (llmstxt.org): what an agent needs to describe or query the list without parsing the page.
// topics: the topic pages with listed mods, as { slug, title, summary }.
export function renderLlms(data, topics = []) {
  const mods = data.mods.filter(mod => mod.kind === 'mod')
  const date = data.generated.slice(0, 10)
  const byLevel = accessGroups(mods).map(({ label, level, count }) => `${level === 'unknown' ? '' : 'L' + level + ' '}${label}: ${count}`).join(', ')
  const short = text => { text = String(text || 'No description provided by the author.').replace(/\s+/g, ' ').trim(); return text.length > 160 ? text.slice(0, 159).trimEnd() + '…' : text }
  const line = mod => `- [${mod.name}](${/^https?:\/\//i.test(String(mod.url)) ? mod.url : `https://github.com/${mod.repo}`}): ${short(mod.description)}`
  const starred = [...mods].filter(mod => mod.stars != null).sort((a, b) => b.stars - a.stars).slice(0, 25)
  return `# Awesome Claude Code Mods

> ${mods.length.toLocaleString('en')} Claude Code mods, with what each one can access before you install it. Context and usage meters, prompt cache warmers, status lines, guards and more, with install hints. Scanned from public GitHub repositories with claude plugin validate; an independent scan, not an official Anthropic directory. Last scanned ${date} on Claude Code ${data.claudeVersion}.

Mods are Claude Code plugins whose JavaScript or TypeScript hooks run inside a session. They need Claude Code 2.1.287 or later and are on by default. Each entry records the hooks and API calls reported by \`claude plugin validate\`. Access levels describe the widest reach of those calls and are not safety ratings. An unavailable or incomplete footprint has unknown access, not L0; recorded calls may show only part of its access. Mods per level: ${byLevel}.

## Catalogue

- [Browse the mods](${site}): searchable directory with access and validation details for every mod
- [mods.json](${site}mods.json): every mod with its hooks, API calls, access level, stars and validation result
- [catalogue.md](${rawCatalogue}): the same catalogue as Markdown tables
- [What can a Claude Code mod access?](${site}access/): how mods get access, what the four levels mean and what the scan found across the catalogue
- [README](${repo}#readme): Featured picks, how to use mods, how the scan works
${topics.length ? `
## Topics

${topics.map(topic => `- [${topic.title}](${site}topics/${topic.slug}/): ${topic.summary}`).join('\n')}
` : ''}
## Ask Claude to find a mod

Install mod-finder in a Claude Code terminal session with \`/plugin install mod-finder --marketplace karanb192/awesome-claude-code-mods\`, complete the installation prompts, then run \`/reload-plugins\` before asking “Find a mod that helps with code reviews”. It requires Node 18 or later. For Desktop Code local sessions, follow the terminal installation route in the setup guide below.

- [Mod finder setup and tools](${repo}/blob/main/finder/README.md#in-claude-code-mcp): installation, search_mods and get_mod, cache behavior and the limits of access filters

## Most starred mods

${starred.map(line).join('\n')}

## Official documentation

- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview): what a mod is, how to install one, what it can reach
- [Create a mod](https://code.claude.com/docs/en/plugins/mods/create): ask Claude for a mod or write one
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference): events, API methods, elements and limits

## Optional

- [Contributing](${repo}/blob/main/contributing.md): how to submit a mod
- [How the scan works](${repo}#how-the-scan-works): discovery, validation and grading
`
}
