#!/usr/bin/env node
// Renders data/mods.json into the README count, catalogue, one SVG badge pair
// per mod under badges/ and docs/badges/, and the directory under docs/.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { LEVEL_NAMES } from './grade.mjs'
import { renderSite, renderSitemap, renderRobots, renderLlms, reviewNotes } from './site.mjs'
import { slugs } from './slug.mjs'

const data = JSON.parse(readFileSync('data/mods.json', 'utf8'))
for (const m of data.mods) m.description = String(m.description ?? '').replace(/\s*[\u2014\u2013]\s*/g, ': ')
const mods = data.mods.filter(m => m.kind === 'mod')
const builtins = data.mods.filter(m => m.kind === 'builtin')
const catalogs = [...new Set(data.mods.filter(m => m.kind === 'catalog').map(m => m.repo))].map(repo => ({ repo, n: data.mods.filter(m => m.kind === 'catalog' && m.repo === repo).length }))
const asOf = data.generated.slice(0, 10)

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/[\[\]]/g, '\\$&').replace(/\n/g, ' ')
const manifestUrl = m => `https://github.com/${m.repo}/blob/${m.defaultBranch ?? 'main'}/${m.path === '.' ? '' : m.path + '/'}.claude-plugin/plugin.json`
const keys = slugs([...mods, ...builtins])
const slug = m => keys.get(m)
const short = (s, n = 110) => { s = String(s ?? '').replace(/\s+/g, ' ').replace(/\s*[\u2014\u2013]\s*/g, ': ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }

// Anthropic palette (olive, clay, deep clay, plum, error red) with ivory text, matching claude.com and claude.dev.
const LEVEL_COLORS = ['#788c5d', '#c96442', '#a94e2f', '#827dbd']
const FAIL_COLOR = '#b53333'
const reachText = m => m.reach.labels.length ? m.reach.labels.join(', ') : 'draws only'
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
  writeBadge(`${slug(m)}-reach.svg`, badge('reach', `L${m.reach.level} ${reachText(m)}`, LEVEL_COLORS[m.reach.level]))
  writeBadge(`${slug(m)}-validates.svg`, badge('validates on', scanText(m), !validates(m) ? FAIL_COLOR : reviewNotes(m).length ? LEVEL_COLORS[1] : LEVEL_COLORS[0]))
}

const count = pred => mods.filter(pred).length
const has = label => m => m.reach.labels.includes(label)
const stats = `As of ${asOf}, scanned against Claude Code ${data.claudeVersion}: **${mods.length} mods** in **${data.repos} candidate repos**. `
  + `${count(has('runs processes'))} run host processes, ${count(has('writes files'))} write files, ${count(has('reads files'))} read files, `
  + `${count(has('network'))} reach the network, ${count(m => m.sees.includes('every tool call'))} see every tool call, `
  + `${count(m => m.sees.includes('every prompt'))} see every prompt, ${count(m => m.validate.status === 'failed')} fail to validate on this version. `
  + `Reach levels: ${[0, 1, 2, 3].map(l => `L${l} ${LEVEL_NAMES[l]}: ${count(m => m.reach.level === l)}`).join(' · ')}.`
  + ` ${count(m => m.directory)} are also listed in Anthropic's plugin directory.`
  + (catalogs.length ? ` Not counted: ${catalogs.map(c => `[${c.repo}](https://github.com/${c.repo}) repackages ${c.n} mods`).join(', ')}, a catalogue named here once instead of once per copy.` : '')

const row = m => [`[${cell(m.name)}](${manifestUrl(m)})`, cell(short(m.description)), `![reach](badges/${slug(m)}-reach.svg)`, cell(m.sees.join(', ') || 'only what it hooks'), scanText(m), m.directory ? 'listed' : 'no', String(m.stars ?? '?')]
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

const site = renderSite(data)
mkdirSync('docs', { recursive: true })
writeFileSync('docs/index.html', site)
writeFileSync('docs/mods.json', JSON.stringify(data, null, 2) + '\n')
writeFileSync('docs/sitemap.xml', renderSitemap())
writeFileSync('docs/robots.txt', renderRobots())
writeFileSync('docs/llms.txt', renderLlms(data))
console.log(`rendered ${mods.length} mods and ${builtins.length} built-ins into README.md, catalogue.md, badges/, docs/ and docs/badges/`)
