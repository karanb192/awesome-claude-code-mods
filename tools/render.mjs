#!/usr/bin/env node
// Renders data/mods.json into the README's generated blocks, one SVG badge pair
// per mod under badges/, and the standalone scoreboard page under site/.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { LEVEL_NAMES } from './grade.mjs'

const data = JSON.parse(readFileSync('data/mods.json', 'utf8'))
for (const m of data.mods) m.description = String(m.description ?? '').replace(/\s*[\u2014\u2013]\s*/g, ': ')
const mods = data.mods.filter(m => m.kind === 'mod')
const builtins = data.mods.filter(m => m.kind === 'builtin')
const asOf = data.generated.slice(0, 10)

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/[\[\]]/g, '\\$&').replace(/\n/g, ' ')
// The table links the manifest that was validated, so the curated entries above keep the only link to each repo.
const manifestUrl = m => `https://github.com/${m.repo}/blob/${m.defaultBranch ?? 'main'}/${m.path === '.' ? '' : m.path + '/'}.claude-plugin/plugin.json`
const slug = m => `${m.repo.replace('/', '--')}--${m.name}`.replace(/[^A-Za-z0-9._-]/g, '-')
const short = (s, n = 110) => { s = String(s ?? '').replace(/\s+/g, ' ').replace(/\s*[\u2014\u2013]\s*/g, ': ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }

const LEVEL_COLORS = ['#2da44e', '#bf8700', '#e36209', '#8250df']
const reachText = m => m.reach.labels.length ? m.reach.labels.join(', ') : 'draws only'

function badge(label, value, color) {
  const w = s => Math.round(s.length * 6.4 + 12)
  const lw = w(label), vw = w(value)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>
`
}

mkdirSync('badges', { recursive: true })
for (const m of [...mods, ...builtins]) {
  writeFileSync(`badges/${slug(m)}-reach.svg`, badge('reach', `L${m.reach.level} ${reachText(m)}`, LEVEL_COLORS[m.reach.level]))
  const ok = m.validate.status !== 'failed'
  writeFileSync(`badges/${slug(m)}-validates.svg`, badge('validates on', ok ? data.claudeVersion : `fails on ${data.claudeVersion}`, ok ? '#2da44e' : '#d1242f'))
}

const count = pred => mods.filter(pred).length
const has = label => m => m.reach.labels.includes(label)
const stats = `As of ${asOf}, scanned against Claude Code ${data.claudeVersion}: **${mods.length} mods** in **${data.repos} candidate repos**. `
  + `${count(has('runs processes'))} run host processes, ${count(has('writes files'))} write files, ${count(has('reads files'))} read files, `
  + `${count(has('network'))} reach the network, ${count(m => m.sees.includes('every tool call'))} see every tool call, `
  + `${count(m => m.sees.includes('every prompt'))} see every prompt, ${count(m => m.validate.status === 'failed')} fail to validate on this version. `
  + `Reach levels: ${[0, 1, 2, 3].map(l => `L${l} ${LEVEL_NAMES[l]}: ${count(m => m.reach.level === l)}`).join(' · ')}.`

const row = m => [`[${cell(m.name)}](${manifestUrl(m)})`, cell(short(m.description)), `![reach](badges/${slug(m)}-reach.svg)`, cell(m.sees.join(', ') || 'only what it hooks'), m.validate.status === 'failed' ? 'fails' : data.claudeVersion, String(m.stars ?? '?')]
// awesome-lint wants aligned pipes and padded cells, so every column is padded to its widest cell.
function table(rows) {
  const head = ['Mod', 'What it does', 'Reach', 'Sees', 'Validates on', 'Stars']
  const all = [head, ...rows.map(row)]
  const widths = head.map((_, i) => Math.max(...all.map(r => r[i].length)))
  const line = r => `| ${r.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`
  return [line(head), `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`, ...rows.map(r => line(row(r)))].join('\n')
}

let readme = readFileSync('README.md', 'utf8')
const replaceBlock = (name, body) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`)
  if (!re.test(readme)) throw new Error(`README is missing the ${name} markers`)
  readme = readme.replace(re, `$1\n${body}\n$2`)
}
replaceBlock('stats', stats)
replaceBlock('scan', table(mods))
replaceBlock('builtin', table(builtins))
writeFileSync('README.md', readme)

// Scoreboard page: one file, no dependencies, light mode.
const detail = m => `<details><summary>hooks and calls</summary><p><b>Hooks:</b> ${esc(m.hooks.map(h => h.event + (Object.keys(h.matcher).length ? '{' + Object.entries(h.matcher).map(([k, v]) => `${k}=${v}`).join(', ') + '}' : '')).join(', ') || 'none')}</p><p><b>Calls:</b> ${esc(m.calls.join(', ') || 'nothing on $')}</p>${m.surfaceModules.length ? `<p><b>Surface modules:</b> ${esc(m.surfaceModules.join(', '))}</p>` : ''}${m.validate.errors.length ? `<p><b>Validator said:</b> ${esc(m.validate.errors.join('; '))}</p>` : ''}</details>`
const trow = m => `<tr data-level="${m.reach.level}" data-name="${esc(m.name)} ${esc(m.repo)} ${esc(m.description)}"><td><a href="${m.url}">${esc(m.name)}</a><div class="repo">${esc(m.repo)}</div></td><td>${esc(short(m.description, 160))}${detail(m)}</td><td><span class="lvl l${m.reach.level}">L${m.reach.level}</span> ${esc(reachText(m))}</td><td>${esc(m.sees.join(', ') || 'only what it hooks')}</td><td class="${m.validate.status === 'failed' ? 'bad' : 'ok'}">${m.validate.status === 'failed' ? 'fails' : esc(data.claudeVersion)}</td><td class="num">${m.stars ?? '?'}</td></tr>`
const site = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Mods scoreboard: every mod on GitHub and what it can reach</title>
<style>
:root{--ink:#1b1f24;--muted:#5f6b7a;--line:#e4e7ec;--soft:#f6f8fa;--accent:#0b6bcb}
*{box-sizing:border-box}body{max-width:1100px;margin:0 auto;padding:28px 20px 60px;color:var(--ink);background:#fff;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1{font-size:1.6rem;margin:0 0 4px}p{max-width:72ch}a{color:var(--accent)}.meta{color:var(--muted);font-size:13px}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}input,select{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);cursor:pointer;white-space:nowrap}
.repo{color:var(--muted);font-size:12px}.num{text-align:right}.ok{color:#2da44e}.bad{color:#d1242f}
.lvl{display:inline-block;font:600 11px/1 ui-monospace,Menlo,monospace;padding:3px 6px;border-radius:8px;color:#fff}
.l0{background:#2da44e}.l1{background:#bf8700}.l2{background:#e36209}.l3{background:#8250df}
details{margin-top:4px;font-size:12px;color:var(--muted)}summary{cursor:pointer}
.legend{background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:10px 14px;font-size:13px;margin:12px 0}
</style></head><body>
<h1>Claude Mods scoreboard</h1>
<p class="meta">Every Claude Code mod found on GitHub, with what each one can reach, read straight off Claude's own plugin validator. Generated ${esc(data.generated)} against Claude Code ${esc(data.claudeVersion)}. Source and list: <a href="https://github.com/karanb192/awesome-claude-code-mods">awesome-claude-code-mods</a>.</p>
<p>${esc(stats.replace(/\*\*/g, ''))}</p>
<div class="legend"><b>Reach</b> is the widest thing a mod's <code>$</code> calls can touch: L0 draws and remembers, L1 reads (files, env, settings), L2 writes files, runs processes or drives Claude, L3 reaches the network. It is a footprint, not a verdict: a PR tracker needs to run <code>gh</code>. <b>Sees</b> lists the events a mod hooks without a matcher.</div>
<div class="controls"><input id="q" type="search" placeholder="filter by name, repo, description"><select id="lvl"><option value="">all reach levels</option><option value="0">L0 draws and remembers</option><option value="1">L1 reads</option><option value="2">L2 writes or runs</option><option value="3">L3 network</option></select><span class="meta" id="n"></span></div>
<table id="t"><thead><tr><th data-k="name">Mod</th><th>What it does</th><th data-k="level">Reach</th><th>Sees</th><th data-k="validates">Validates on</th><th data-k="stars">Stars</th></tr></thead><tbody>
${mods.map(trow).join('\n')}
</tbody></table>
<h2>Built into Claude Code</h2>
<table><thead><tr><th>Mod</th><th>What it does</th><th>Reach</th><th>Sees</th><th>Validates on</th><th>Stars</th></tr></thead><tbody>
${builtins.map(trow).join('\n')}
</tbody></table>
<script>
var q=document.getElementById('q'),lvl=document.getElementById('lvl'),rows=[].slice.call(document.querySelectorAll('#t tbody tr')),n=document.getElementById('n');
function apply(){var s=q.value.toLowerCase(),l=lvl.value,c=0;rows.forEach(function(r){var ok=(!l||r.dataset.level===l)&&(!s||r.dataset.name.toLowerCase().indexOf(s)>=0);r.hidden=!ok;if(ok)c++});n.textContent=c+' of '+rows.length+' mods'}
q.addEventListener('input',apply);lvl.addEventListener('change',apply);apply();
document.querySelectorAll('#t th[data-k]').forEach(function(th,i){th.addEventListener('click',function(){var idx=[].indexOf.call(th.parentNode.children,th),dir=th.dataset.dir==='asc'?'desc':'asc';th.dataset.dir=dir;var tb=document.querySelector('#t tbody');rows.sort(function(a,b){var x=a.children[idx].textContent.trim(),y=b.children[idx].textContent.trim();var nx=parseFloat(x.replace(/^L/,'')),ny=parseFloat(y.replace(/^L/,''));var c=(!isNaN(nx)&&!isNaN(ny))?nx-ny:x.localeCompare(y);return dir==='asc'?c:-c});rows.forEach(function(r){tb.appendChild(r)})})});
</script></body></html>
`
mkdirSync('site', { recursive: true })
writeFileSync('site/index.html', site)
writeFileSync('site/mods.json', JSON.stringify(data, null, 2) + '\n')
console.log(`rendered ${mods.length} mods and ${builtins.length} built-ins into README.md, badges/ and site/`)
