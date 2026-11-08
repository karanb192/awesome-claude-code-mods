#!/usr/bin/env node
// Renders data/mods.json into the README count, catalogue, one SVG badge pair
// per mod under badges/ and docs/badges/, the directory under docs/ (its full rows in docs/directory/), A to Z
// pages under docs/browse/, topic pages under docs/topics/ (membership from data/topics.json) and one page per
// mod under docs/mods/, whose paths are kept in data/pages.json.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, rmSync, existsSync } from 'node:fs'
import { LEVEL_NAMES, grade, hasFootprint } from './grade.mjs'
import { renderSite, renderSitemap, renderRobots, renderLlms, reviewNotes, css, browseKeys } from './site.mjs'
import { renderBrowsePage } from './browse.mjs'
import { assignPages, formatRegistry, idOf, indexable, readRegistry, renderModPage, renderNotFound, renderRedirect } from './pages.mjs'
import { siteAnchors } from './slug.mjs'
import { ACCESS_PATH, renderAccessPage } from './access.mjs'
import { TOPICS_PATH, listedMembers, readTopics, renderTopicPage, topicMembers, topicSummary } from './topics.mjs'

const data = JSON.parse(readFileSync('data/mods.json', 'utf8'))
for (const m of data.mods) {
  m.description = String(m.description ?? '').replace(/\s*[\u2014\u2013]\s*/g, ': ')
  if (!hasFootprint(m)) m.footprint = { status: 'unavailable' }
  // Grades from recorded calls on every render, so a grading change reaches every output at once.
  m.reach = grade(m.calls, hasFootprint(m))
}
const mods = data.mods.filter(m => m.kind === 'mod')
const builtins = data.mods.filter(m => m.kind === 'builtin')
const catalogs = [...new Set(data.mods.filter(m => m.kind === 'catalog').map(m => m.repo))].map(repo => ({ repo, n: data.mods.filter(m => m.kind === 'catalog' && m.repo === repo).length }))
const asOf = data.generated.slice(0, 10)

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/[\[\]]/g, '\\$&').replace(/\n/g, ' ')
const manifestUrl = m => `https://github.com/${m.repo}/blob/${m.defaultBranch ?? 'main'}/${m.path === '.' ? '' : m.path + '/'}.claude-plugin/plugin.json`
const keys = siteAnchors(data.mods)
const slug = m => keys.get(m)
const short = (s, n = 110) => { s = String(s ?? '').replace(/\s+/g, ' ').replace(/\s*[\u2014\u2013]\s*/g, ': ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }

// Anthropic palette (olive, clay, deep clay, plum, error red) with ivory text, matching claude.com and claude.dev.
const LEVEL_COLORS = ['#788c5d', '#c96442', '#a94e2f', '#827dbd']
const FAIL_COLOR = '#b53333'
const reachText = m => !hasFootprint(m) ? 'unknown access' : m.reach.labels.length ? m.reach.labels.join(', ') : 'draws only'
const validates = m => ['passed', 'warnings'].includes(m.validate.status)
const validationText = m => validates(m) ? data.claudeVersion : m.validate.status === 'failed' ? `fails on ${data.claudeVersion}` : 'not verified'
const scanText = m => [validationText(m), ...reviewNotes(m)].join('; ')

function badge(label, value, color) {
  const w = s => Math.round(s.length * 6.4 + 12)
  const lw = w(label), vw = w(value)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${lw}" height="20" fill="#5e5d59"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
<g fill="#faf9f5" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>
`
}

// badges/ is what the README and contributing.md link via raw.githubusercontent.com; docs/badges/ is the same
// set served from the Pages domain.
const BADGE_DIRS = ['badges', 'docs/badges']
for (const dir of BADGE_DIRS) mkdirSync(dir, { recursive: true })
const expectedBadges = new Set([...mods, ...builtins].flatMap(m => [`${slug(m)}-reach.svg`, `${slug(m)}-validates.svg`]))
for (const dir of BADGE_DIRS) {
  for (const file of readdirSync(dir)) {
    if (/-(reach|validates)\.svg$/.test(file) && !expectedBadges.has(file)) unlinkSync(`${dir}/${file}`)
  }
}
const writeBadge = (file, svg) => { for (const dir of BADGE_DIRS) writeFileSync(`${dir}/${file}`, svg) }
for (const m of [...mods, ...builtins]) {
  writeBadge(`${slug(m)}-reach.svg`, badge('reach', `${hasFootprint(m) ? 'L' + m.reach.level + ' ' : ''}${reachText(m)}`, hasFootprint(m) ? LEVEL_COLORS[m.reach.level] : '#5e5d59'))
  writeBadge(`${slug(m)}-validates.svg`, badge('validates on', scanText(m), !validates(m) ? FAIL_COLOR : reviewNotes(m).length ? LEVEL_COLORS[1] : LEVEL_COLORS[0]))
}

const count = pred => mods.filter(pred).length
const has = label => m => m.reach.labels.includes(label)
const stats = `As of ${asOf}, scanned against Claude Code ${data.claudeVersion}: **${mods.length} mods** in **${data.repos} candidate repos**. `
  + `${count(has('runs processes'))} run host processes, ${count(has('writes files'))} write files, ${count(has('reads files'))} read files, `
  + `${count(has('network'))} reach the network, ${count(m => m.sees.includes('every tool call'))} see every tool call, `
  + `${count(m => m.sees.includes('every prompt'))} see every prompt, ${count(m => m.validate.status === 'failed')} fail to validate on this version. `
  + `Reach levels: ${[0, 1, 2, 3].map(l => `L${l} ${LEVEL_NAMES[l]}: ${count(m => m.reach.level === l)}`).join(' · ')}.`
  + ` Unknown access: ${count(m => !hasFootprint(m))}.`
  + ` ${count(m => m.directory)} are also listed in Anthropic's plugin directory.`
  + (catalogs.length ? ` Not counted: ${catalogs.map(c => `[${c.repo}](https://github.com/${c.repo}) repackages ${c.n} mods`).join(', ')}, a catalogue named here once instead of once per copy.` : '')

const row = m => [`[${cell(m.name)}](${manifestUrl(m)})`, cell(short(m.description)), `![reach](badges/${slug(m)}-reach.svg)`, cell(hasFootprint(m) ? m.sees.join(', ') || 'only what it hooks' : 'unknown; incomplete footprint'), scanText(m), m.directory ? 'listed' : 'no', String(m.stars ?? '?')]
// awesome-lint wants aligned pipes and padded cells, so every column is padded to its widest cell.
function table(rows) {
  const head = ['Mod', 'What it does', 'Reach', 'Sees', 'Validates on', 'In Anthropic directory', 'Stars']
  const all = [head, ...rows.map(row)]
  const widths = head.map((_, i) => Math.max(...all.map(r => r[i].length)))
  const line = r => `| ${r.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`
  return [line(head), `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`, ...rows.map(r => line(row(r)))].join('\n')
}

function updateBlocks(file, blocks) {
  let text = readFileSync(file, 'utf8')
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`)
    if (!re.test(text)) throw new Error(`${file} is missing the ${name} markers`)
    text = text.replace(re, () => `<!-- ${name}:start -->\n${body}\n<!-- ${name}:end -->`)
  }
  writeFileSync(file, text)
}
updateBlocks('README.md', { stats: `**${mods.length} mods** · Last scanned ${asOf}.` })
updateBlocks('catalogue.md', { stats, scan: table(mods), builtin: table(builtins) })

const records = [...mods, ...builtins]
const identity = assignPages(records, readRegistry(existsSync('data/pages.json') ? readFileSync('data/pages.json', 'utf8') : ''), data.mods)
const pageOf = mod => identity.pages.get(mod)
const byRepo = new Map()
for (const m of [...records].sort((a, b) => a.name.localeCompare(b.name, 'en') || (idOf(a) < idOf(b) ? -1 : 1))) byRepo.set(m.repo, [...(byRepo.get(m.repo) ?? []), m])

const browsable = records.filter(m => !identity.redirects.has(pageOf(m)))
const letters = browseKeys(browsable)
// A topic lists the members of its rule that have an indexable page of their own. A stale id in the rule is
// reported and tolerated, so a retirement never breaks the render.
const topics = existsSync(TOPICS_PATH) ? readTopics(readFileSync(TOPICS_PATH, 'utf8')) : []
const listedIn = new Map(topics.map(topic => {
  const { members, stale } = topicMembers(topic, data.mods)
  for (const id of stale) console.warn(`topic ${topic.slug}: ${id} names no counted mod`)
  return [topic, listedMembers(members).filter(m => browsable.includes(m)).map(m => ({ mod: m, slug: pageOf(m) }))]
}))
const shownTopics = topics.filter(topic => listedIn.get(topic).length)
const topicsOf = new Map()
for (const topic of shownTopics) for (const { mod } of listedIn.get(topic)) topicsOf.set(mod, [...(topicsOf.get(mod) ?? []), topic])
const { html: site, parts } = renderSite(data, identity.pages, letters, shownTopics)
// Googlebot reads the first 2 MB of a page; this ceiling keeps every generated page well inside it.
const MAX_PAGE_BYTES = 1_000_000
const checkSize = (file, html) => { if (Buffer.byteLength(html) > MAX_PAGE_BYTES) throw new Error(`${file} is ${Buffer.byteLength(html)} bytes, over the ${MAX_PAGE_BYTES} byte page ceiling`) }
checkSize('docs/index.html', site)
mkdirSync('docs/mods', { recursive: true })
writeFileSync('docs/index.html', site)
rmSync('docs/directory', { recursive: true, force: true })
mkdirSync('docs/directory')
parts.forEach((part, i) => { checkSize(`docs/directory/${i + 1}.json`, part); writeFileSync(`docs/directory/${i + 1}.json`, part + '\n') })
writeFileSync('docs/mods.json', JSON.stringify(data, null, 2) + '\n')
// Everything under docs/mods/ is generated, so a folder this render does not write belongs to a retired mod.
const pageFolders = new Set([...identity.pages.values(), ...identity.redirects.keys()])
for (const entry of readdirSync('docs/mods')) if (!pageFolders.has(entry)) rmSync(`docs/mods/${entry}`, { recursive: true, force: true })
if (new Set(identity.pages.values()).size !== records.length) throw new Error('two mods were given the same page path')
for (const m of records) {
  if (identity.redirects.has(pageOf(m))) continue
  mkdirSync(`docs/mods/${pageOf(m)}`, { recursive: true })
  const siblings = byRepo.get(m.repo).filter(other => other !== m).map(other => ({ mod: other, slug: pageOf(other) }))
  writeFileSync(`docs/mods/${pageOf(m)}/index.html`, renderModPage(m, { slug: pageOf(m), anchor: slug(m), claudeVersion: data.claudeVersion, siblings, topics: topicsOf.get(m) ?? [] }))
}
for (const [from, to] of identity.redirects) {
  mkdirSync(`docs/mods/${from}`, { recursive: true })
  writeFileSync(`docs/mods/${from}/index.html`, renderRedirect(to))
}
writeFileSync('docs/site.css', css + readFileSync(new URL('./page.css', import.meta.url), 'utf8'))
mkdirSync('docs/browse', { recursive: true })
for (const entry of readdirSync('docs/browse')) if (!letters.includes(entry)) rmSync(`docs/browse/${entry}`, { recursive: true, force: true })
const entries = browsable.map(mod => ({ mod, slug: pageOf(mod) }))
for (const key of letters) {
  const html = renderBrowsePage(key, entries, letters, shownTopics)
  checkSize(`docs/browse/${key}/index.html`, html)
  mkdirSync(`docs/browse/${key}`, { recursive: true })
  writeFileSync(`docs/browse/${key}/index.html`, html)
}
// Everything under docs/topics/ is generated, so a folder whose slug left the data file is removed.
mkdirSync('docs/topics', { recursive: true })
for (const entry of readdirSync('docs/topics')) if (!topics.some(topic => topic.slug === entry)) rmSync(`docs/topics/${entry}`, { recursive: true, force: true })
for (const topic of topics) {
  const html = renderTopicPage(topic, listedIn.get(topic), { topics: topics.filter(other => shownTopics.includes(other) || other === topic), letters, version: data.claudeVersion })
  checkSize(`docs/topics/${topic.slug}/index.html`, html)
  mkdirSync(`docs/topics/${topic.slug}`, { recursive: true })
  writeFileSync(`docs/topics/${topic.slug}/index.html`, html)
}
writeFileSync('docs/404.html', renderNotFound())
mkdirSync('docs/access', { recursive: true })
writeFileSync('docs/access/index.html', renderAccessPage(data))
writeFileSync('data/pages.json', formatRegistry(identity.registry))
writeFileSync('docs/sitemap.xml', renderSitemap([ACCESS_PATH, ...shownTopics.map(topic => `topics/${topic.slug}/`), ...letters.map(key => `browse/${key}/`), ...records.filter(indexable).map(m => `mods/${pageOf(m)}/`).sort()]))
writeFileSync('docs/robots.txt', renderRobots())
writeFileSync('docs/llms.txt', renderLlms(data, shownTopics.map(topic => ({ slug: topic.slug, title: topic.title, summary: topicSummary(topic, listedIn.get(topic).length) }))))
console.log(`rendered ${mods.length} mods and ${builtins.length} built-ins into README.md, catalogue.md, badges/, docs/, docs/badges/, docs/mods/, docs/browse/, docs/topics/ and docs/access/`)
