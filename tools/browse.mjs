// One page per first character under /browse/<key>/, linking every mod page with ordinary HTML so crawlers and
// readers without JavaScript reach the whole catalogue. Rows carry no stars or dates, so a rescan that only
// moves those leaves these pages untouched.

import { esc, site, levels, browseKey, browseNav, topicNav } from './site.mjs'
import { hasFootprint } from './grade.mjs'
import { shell } from './pages.mjs'

const clip = (text, n) => { text = String(text ?? '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text }
const byName = (a, b) => a.mod.name.localeCompare(b.mod.name, 'en') || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)

// entries: { mod, slug } for every record listed under A to Z; letters: the keys that have a page; topics: the topic
// pages to link.
export function renderBrowsePage(key, entries, letters, topics = []) {
  const label = key === 'other' ? 'other characters' : key === '0-9' ? 'a digit' : key.toUpperCase()
  const url = `${site}browse/${key}/`
  const list = entries.filter(({ mod }) => browseKey(mod.name) === key).sort(byName)
  const access = mod => hasFootprint(mod) ? `L${mod.reach.level} ${levels[mod.reach.level]}` : 'Unknown access'
  return shell({
    title: `Claude Code mods starting with ${label} | Awesome Claude Code Mods`,
    description: `${list.length} Claude Code mods whose names start with ${label}, each with what a static scan recorded it can access.`,
    canonical: url,
    body: `<main class="shell mod-page browse-page" id="main">
<p class="crumbs"><a href="/">All Claude Code mods</a><span aria-hidden="true">/</span><span>Browse</span></p>
<h1>Claude Code mods starting with ${esc(label)}</h1>
<p class="lede">${list.length} ${list.length === 1 ? 'mod' : 'mods'}. Each name opens the mod’s page with its hooks, API calls, access and install hint. See <a href="/access/">what a Claude Code mod can access</a>.</p>
${browseNav(letters, key)}${topicNav(topics)}
<ul class="browse-list">${list.map(({ mod, slug }) => `<li><a href="/mods/${esc(slug)}/">${esc(mod.name)}</a><span class="repo">${esc(mod.repo)}${mod.kind === 'builtin' ? ', built into Claude Code' : ''}</span><span class="access">${esc(access(mod))}</span>${String(mod.description ?? '').trim() ? `<p>${esc(clip(mod.description, 160))}</p>` : ''}</li>`).join('')}</ul>
</main>`,
  })
}
