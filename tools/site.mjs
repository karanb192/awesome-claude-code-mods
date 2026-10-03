import { readFileSync } from 'node:fs'
import { slugs } from './slug.mjs'

const css = readFileSync(new URL('./site.css', import.meta.url), 'utf8')
const script = readFileSync(new URL('./site-client.js', import.meta.url), 'utf8')
const repo = 'https://github.com/karanb192/awesome-claude-code-mods'
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const url = value => /^https?:\/\//i.test(String(value)) ? esc(value) : '#directory'
const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>'
const mark = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M11 5H5v22h6M21 5h6v22h-6M16 10v12M10 16h12"/></svg>'
const star = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L2.9 9.6l6.3-.9Z"/></svg>'
const levels = ['Draws & remembers', 'Reads files', 'Writes or runs', 'Uses the network']
const hookText = hook => hook.event + (Object.keys(hook.matcher).length ? ' {' + Object.entries(hook.matcher).map(([k, v]) => `${k}=${v}`).join(', ') + '}' : '')
const sourceUrl = (mod, file, line) => `https://github.com/${mod.repo}/blob/${mod.sourceCommit ?? mod.defaultBranch ?? 'main'}/${file.split('/').map(encodeURIComponent).join('/')}${line ? '#L' + line : ''}`
export const reviewNotes = mod => [
  ...((mod.marketplaces ?? []).some(p => p.status === 'failed') ? ['marketplace fails'] : []),
  ...((mod.marketplaces ?? []).some(p => p.status === 'unknown') ? ['marketplace not verified'] : []),
  ...(mod.compatibility?.warnings?.length ? ['review UI rewrite'] : []),
]

export function renderSite(data) {
  const mods = data.mods.filter(mod => mod.kind === 'mod')
  const builtins = data.mods.filter(mod => mod.kind === 'builtin')
  const keys = slugs([...mods, ...builtins])
  const slug = mod => keys.get(mod)
  const catalogs = [...new Set(data.mods.filter(mod => mod.kind === 'catalog').map(mod => mod.repo))]
  const date = data.generated.slice(0, 10)
  const dateLabel = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(data.generated))
  const reachText = mod => mod.reach.labels.join(', ') || 'draws only'
  const status = mod => ['passed', 'warnings'].includes(mod.validate.status) ? (mod.validate.status === 'warnings' ? 'Passed with warnings' : 'Passed') : mod.validate.status === 'failed' ? `fails on ${data.claudeVersion}` : 'not verified'
  const compatibilityDetail = mod => (mod.marketplaces ?? []).map(p => `<dt>Marketplace ${esc(p.status)}</dt><dd><a href="${esc(sourceUrl(mod, p.path))}">${esc(p.name ?? p.path)}</a>${p.errors.length ? ': ' + esc(p.errors.join('; ')) : ''}</dd>`).join('')
    + (mod.compatibility?.warnings ?? []).map(w => `<dt>UI rewrite review</dt><dd>${esc(w.message)} ${(w.evidence ?? []).map(e => `<a href="${esc(sourceUrl(mod, e.file, e.line))}">${esc(e.file)}:${e.line}</a>`).join(', ')}</dd>`).join('')
  const detail = mod => `<details><summary>Access & validation details</summary><dl>
    <dt>Observed events</dt><dd>${esc(mod.sees.join(', ') || 'Only what it hooks')}</dd>
    <dt>Hooks</dt><dd><code>${esc(mod.hooks.map(hookText).join(', ') || 'none')}</code></dd>
    <dt>API calls</dt><dd><code>${esc(mod.calls.join(', ') || 'none recorded')}</code></dd>
    ${mod.surfaceModules.length ? `<dt>Surface modules</dt><dd><code>${esc(mod.surfaceModules.join(', '))}</code></dd>` : ''}
    <dt>Validation on ${esc(data.claudeVersion)}</dt><dd>${esc(status(mod))}</dd>
    ${mod.validate.errors.length ? `<dt>Validator output</dt><dd>${esc(mod.validate.errors.join('; '))}</dd>` : ''}
    ${compatibilityDetail(mod)}</dl></details>`
  const track = mod => `<span class="track" aria-label="Reach level ${mod.reach.level}: ${levels[mod.reach.level]}">${[0, 1, 2, 3].map(i => `<i class="${i <= mod.reach.level ? 'on l' + mod.reach.level : ''}"></i>`).join('')}</span>`
  const row = mod => `<tr id="${esc(slug(mod))}" data-level="${mod.reach.level}" data-name="${esc(mod.name)} ${esc(mod.repo)} ${esc(mod.description)}" data-stars="${mod.stars ?? -1}">
    <td class="identity"><a class="mod-name" href="${url(mod.url)}">${esc(mod.name)}${arrow}</a><span class="repo">${esc(mod.repo)}</span></td>
    <td class="description"><p>${esc(mod.description || 'No description provided by the author.')}</p>${reviewNotes(mod).length ? `<p class="compatibility">${esc(reviewNotes(mod).join('; '))}</p>` : ''}${detail(mod)}</td>
    <td class="reach">${track(mod)}<span class="labels">${esc(reachText(mod))}</span>${mod.validate.status === 'failed' || !['passed', 'warnings'].includes(mod.validate.status) ? `<span class="status bad">${esc(status(mod))}</span>` : mod.validate.status === 'warnings' ? '<span class="status">Validator warnings</span>' : ''}</td>
    <td class="num"><span class="mobile-label">Repository stars </span>${mod.stars == null ? 'Unknown' : Number(mod.stars).toLocaleString('en')}</td></tr>`
  const heading = sortable => `<thead><tr><th scope="col">${sortable ? '<button type="button" data-k="name">Mod <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 12V3L2 6m3-3 3 3m3-2v9l-3-3m3 3 3-3"/></svg></button>' : 'Mod'}</th><th scope="col">What it does</th><th scope="col">${sortable ? '<button type="button" data-k="level">Access <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 12V3L2 6m3-3 3 3m3-2v9l-3-3m3 3 3-3"/></svg></button>' : 'Access'}</th><th scope="col" class="num">${sortable ? '<button type="button" data-k="stars">Repo stars <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 12V3L2 6m3-3 3 3m3-2v9l-3-3m3 3 3-3"/></svg></button>' : 'Repo stars'}</th></tr></thead>`
  const strip = [...mods].sort((a, b) => a.reach.level - b.reach.level).map(mod => `<a class="seg l${mod.reach.level}" href="#${esc(slug(mod))}" title="${esc(mod.name)}: L${mod.reach.level} ${esc(reachText(mod))}" aria-label="${esc(mod.name)}: ${esc(levels[mod.reach.level])}" data-level="${mod.reach.level}"></a>`).join('')
  const description = `Discover ${mods.length} Claude Code mods. Find dashboards, memory tools, browsers and more, with source links and recorded access details.`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Awesome Claude Code Mods | Make Claude Code your own</title>
<meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f3f3ee" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="https://mods.aidojo.si/"><link rel="icon" href="./favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:title" content="Awesome Claude Code Mods"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="https://mods.aidojo.si/">
<meta property="og:image" content="https://mods.aidojo.si/social-preview.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Awesome Claude Code Mods. Make Claude Code your own.">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="./fonts/hanken-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="./fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>${css}</style></head><body>
<a class="skip" href="#directory">Skip to the mod directory</a>
<div class="mast"><header class="shell"><a href="./" class="brand" aria-label="Claude Mods home">${mark}<span>claude<span class="brand-light">mods</span></span></a><nav aria-label="Main navigation"><a href="#directory">The collection</a><a href="#about">About mods</a><a class="github-link" href="${repo}" aria-label="Star the Claude Code mods list on GitHub">${star}Star on GitHub</a></nav></header>
</div><main><div class="mast"><section class="hero shell" aria-labelledby="title"><div class="hero-intro"><h1 id="title">Make Claude Code<br><span>your own.</span></h1><p>Little additions to the way you code.<br> Discover community-built mods for your terminal, your workflow, and everything in between.</p></div>
</section></div>
<section class="directory shell" id="directory" aria-labelledby="directory-title"><div class="section-heading"><div><h2 id="directory-title">The collection<span class="total">${mods.length}</span></h2><p>Find something useful. See what it can access.</p></div><a href="${repo}/blob/main/contributing.md">Submit a mod ${arrow}</a></div>
<div class="catalog-search"><form class="search" role="search" action="#directory"><label class="sr-only" for="q">Search mods by name, repo or description</label><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="q" name="q" type="search" placeholder="Search by name or what it does" autocomplete="off" aria-controls="t"><button id="clear-search" class="clear-search" type="button" aria-label="Clear search" hidden><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></form>
<div class="result-bar"><span id="n" role="status" aria-live="polite">${mods.length} mods</span><div><button id="reset" type="button" hidden>Clear filters</button><span>Scanned <time datetime="${esc(date)}">${dateLabel}</time></span></div></div></div>
<div class="filter-heading"><span>Filter by access</span><a href="#method">How we check ${arrow}</a></div><div class="legend" role="group" aria-label="Filter by reach level"><button type="button" class="lv all" data-level="" aria-pressed="true">All mods</button>${levels.map((label, level) => `<button type="button" class="lv" data-level="${level}" aria-pressed="false"><i class="l${level}"></i><span>${label}</span><b>${mods.filter(mod => mod.reach.level === level).length}</b></button>`).join('')}</div>
<noscript><p class="notice">Search and sorting need JavaScript. All mods and their details are listed below.</p></noscript>
<table id="t"><caption class="sr-only">Claude Code community mods. Sort by mod name, access level or hosting repository stars.</caption>${heading(true)}<tbody>${mods.map(row).join('\n')}</tbody></table>
<div id="empty" class="empty" hidden><h3>No mods found.</h3><p>Try a broader search or clear the access filter.</p><button type="button" data-reset>Show all mods ${arrow}</button></div>
<div class="directory-end"><p>Stars belong to the hosting repository, not the individual mod. Recorded with this scan.</p><a href="#directory">Back to search ${arrow}</a></div>
</section>
<div class="info"><section class="about" id="about"><div class="shell about-grid"><h2>Your session.<br>A few new tricks.</h2><div><p>Mods are Claude Code plugins that run JavaScript or TypeScript hooks inside your session. They can add a dashboard, open a pane, change tool behavior, or bring context into the conversation.</p><p>Mods are on by default in Claude Code 2.1.287 and later. Choose a mod, open its repository, and follow the author’s setup instructions. The API can change between releases.</p><a class="text-link" href="${repo}#use-mods">How to use mods ${arrow}</a><a class="text-link" href="https://claude.dev/blog/getting-started-with-claude-code-mods/">Build your first mod ${arrow}</a></div></div></section>
<section class="method shell" id="method" aria-labelledby="method-title"><div class="section-heading"><div><h2 id="method-title">A closer look at access.</h2><p>One mark per mod, colored by its widest recorded access. Select a mark to find its entry.</p></div><a href="./mods.json">Download the data ${arrow}</a></div><div class="strip" role="group" aria-label="Mods coloured by access level, draws only through network">${strip}</div><ul class="strip-legend" aria-label="Access color legend">${levels.map((label, level) => { const count = mods.filter(mod => mod.reach.level === level).length; return `<li><i class="l${level}" aria-hidden="true"></i><span>${esc(label)}</span><span class="legend-count">${count} ${count === 1 ? 'mod' : 'mods'}</span></li>` }).join('')}</ul>
<div class="method-copy"><p>Each entry records the hooks and API calls reported by <code>claude plugin validate</code>. Access levels describe the widest reach of those calls. They are not safety ratings.</p><p>Validation is a static check, not a runtime compatibility test. A passing result does not prove that a mod works or is safe. Marketplace results describe that install route separately. “Review UI rewrite” flags control-character strings in UI source or local imports; it does not prove those strings reach a text rewrite. Open “Access &amp; validation details” for errors and source links. See the <a href="${repo}/issues/21">2.1.287 compatibility report</a>.</p></div>
<div class="scan-note"><p>This scan used Claude Code ${esc(data.claudeVersion)} on ${dateLabel}. <a href="${repo}#how-the-scan-works">Read the method</a>.</p>${catalogs.length ? `<p>Repackaged catalogs are excluded from the mod count: ${catalogs.map(name => `<a href="https://github.com/${esc(name)}">${esc(name)}</a>`).join(', ')}.</p>` : ''}</div>
${builtins.length ? `<details class="builtins"><summary>Also built into Claude Code <span>${builtins.length} mods</span></summary><p>These ship inside the binary. sec-default seats outermost only on managed machines and Team or Enterprise plans.</p><table><caption class="sr-only">Built-in Claude Code mods</caption>${heading(false)}<tbody>${builtins.map(row).join('\n')}</tbody></table></details>` : ''}
</section></div></main>
<footer class="shell"><a href="./" class="brand">${mark}<span>claude<span class="brand-light">mods</span></span></a><p>A community collection.</p><a href="${repo}">Explore on GitHub ${arrow}</a></footer>
<script>${script}</script></body></html>`.replace(/[ \t]+\n/g, '\n') + '\n'
}
