#!/usr/bin/env node
// Renders data/mods.json into the README's generated blocks, one SVG badge pair
// per mod under badges/ and docs/badges/, and the standalone scoreboard page under docs/,
// which GitHub Pages serves at https://mods.karanbansal.in/.

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

// badges/ is what the README and contributing.md link via raw.githubusercontent.com; docs/badges/ is the same
// set served from the Pages domain.
const BADGE_DIRS = ['badges', 'docs/badges']
for (const dir of BADGE_DIRS) mkdirSync(dir, { recursive: true })
const writeBadge = (file, svg) => { for (const dir of BADGE_DIRS) writeFileSync(`${dir}/${file}`, svg) }
for (const m of [...mods, ...builtins]) {
  writeBadge(`${slug(m)}-reach.svg`, badge('reach', `L${m.reach.level} ${reachText(m)}`, LEVEL_COLORS[m.reach.level]))
  const ok = m.validate.status !== 'failed'
  writeBadge(`${slug(m)}-validates.svg`, badge('validates on', ok ? data.claudeVersion : `fails on ${data.claudeVersion}`, ok ? '#2da44e' : '#d1242f'))
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

// Scoreboard page: one file, light mode, Inter like the main site. The strip at the top is
// one segment per mod coloured by reach, and doubles as the level filter.
const LEVEL_WORDS = ['draws and remembers', 'reads', 'writes or runs', 'reaches the network']
const hookText = h => h.event + (Object.keys(h.matcher).length ? '{' + Object.entries(h.matcher).map(([k, v]) => `${k}=${v}`).join(', ') + '}' : '')
const detail = m => `<details><summary>hooks and calls</summary><dl><dt>hooks</dt><dd><code>${esc(m.hooks.map(hookText).join(', ') || 'none')}</code></dd><dt>calls</dt><dd><code>${esc(m.calls.join(', ') || 'nothing on $')}</code></dd>${m.surfaceModules.length ? `<dt>surface modules</dt><dd><code>${esc(m.surfaceModules.join(', '))}</code></dd>` : ''}${m.validate.errors.length ? `<dt>validator said</dt><dd>${esc(m.validate.errors.join('; '))}</dd></dl>` : '</dl>'}</details>`
const track = m => `<span class="track" aria-label="reach level ${m.reach.level}, ${LEVEL_WORDS[m.reach.level]}">${[0, 1, 2, 3].map(i => `<i class="${i <= m.reach.level ? 'on l' + m.reach.level : ''}"></i>`).join('')}</span>`
const trow = m => `<tr id="${esc(slug(m))}" data-level="${m.reach.level}" data-name="${esc(m.name)} ${esc(m.repo)} ${esc(m.description)}" data-stars="${m.stars ?? -1}">
<td><a href="${m.url}">${esc(m.name)}</a><span class="repo">${esc(m.repo)}</span></td>
<td>${esc(short(m.description, 150))}${detail(m)}</td>
<td class="reach">${track(m)}<span class="labels">${esc(reachText(m))}</span></td>
<td class="sees">${esc(m.sees.join(', ') || 'only what it hooks')}</td>
<td class="ver ${m.validate.status === 'failed' ? 'bad' : ''}"><code>${m.validate.status === 'failed' ? 'fails on ' + esc(data.claudeVersion) : esc(data.claudeVersion)}</code></td>
<td class="num">${m.stars ?? ''}</td></tr>`
const byDepth = [...mods].sort((a, b) => b.reach.level - a.reach.level || (b.stars ?? -1) - (a.stars ?? -1))
const strip = byDepth.map(m => `<a class="seg l${m.reach.level}" href="#${esc(slug(m))}" title="${esc(m.name)}: L${m.reach.level} ${esc(reachText(m))}" data-level="${m.reach.level}"></a>`).join('')
const legend = [0, 1, 2, 3].map(l => `<button type="button" class="lv" data-level="${l}" aria-pressed="false"><i class="l${l}"></i>L${l} ${LEVEL_WORDS[l]}<b>${count(m => m.reach.level === l)}</b></button>`).join('')
const thead = `<thead><tr><th><button type="button" data-k="name">Mod</button></th><th>What it does</th><th><button type="button" data-k="level">Reach</button></th><th class="sees">Sees</th><th class="ver">Validates on</th><th class="num"><button type="button" data-k="stars">Stars</button></th></tr></thead>`
const site = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Mods scoreboard: every mod on GitHub and what it can reach</title>
<meta name="description" content="Every Claude Code mod found on GitHub, with what each one can reach and see, read off Claude's own plugin validator. ${mods.length} mods scanned against Claude Code ${esc(data.claudeVersion)} on ${asOf}.">
<link rel="canonical" href="https://mods.karanbansal.in/">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--ground:#f5f7f6;--ink:#16211d;--muted:#5b6864;--line:#d6ddd9;--well:#e9eeeb;--l0:#cfe4da;--l1:#86b8a6;--l2:#337a66;--l3:#113d33;--bad:#a8321e;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}html{background:var(--ground)}
body{max-width:1120px;margin:0 auto;padding:40px 24px 80px;color:var(--ink);background:var(--ground);font:15px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:inherit;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--l1)}a:hover{text-decoration-color:var(--ink)}
:focus-visible{outline:2px solid var(--l2);outline-offset:2px}
code{font:12.5px/1.5 var(--mono)}
h1{font-size:2rem;line-height:1.15;font-weight:600;letter-spacing:-0.01em;margin:0 0 12px;max-width:26ch}
h2{font-size:1.15rem;font-weight:600;margin:56px 0 12px}
p{max-width:66ch;margin:0 0 12px}
.lead{color:var(--muted);margin-bottom:28px}
.strip{display:flex;gap:2px;height:56px;margin:0 0 10px}
.seg{flex:1 1 0;min-width:4px;display:block;border-radius:2px;text-decoration:none}
.seg:hover,.seg:focus-visible{outline:2px solid var(--ink);outline-offset:1px;z-index:1}
.l0{background:var(--l0)}.l1{background:var(--l1)}.l2{background:var(--l2)}.l3{background:var(--l3)}
.legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 0 20px}
.lv{font:inherit;font-size:14px;color:var(--ink);background:none;border:0;padding:6px 0;display:inline-flex;align-items:center;gap:8px;cursor:pointer;border-bottom:2px solid transparent}
.lv i{width:14px;height:14px;border-radius:2px;display:inline-block}
.lv b{font-weight:500;color:var(--muted)}
.lv[aria-pressed="true"]{border-bottom-color:var(--ink)}
.tools{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:28px 0 8px}
.tools input{font:inherit;font-size:14px;padding:8px 12px;border:1px solid var(--line);border-radius:4px;background:#fff;color:var(--ink);min-width:260px}
.count{color:var(--muted);font-size:14px}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14px;background:#fff;border:1px solid var(--line);border-radius:6px;overflow:hidden}
th,td{text-align:left;padding:12px 12px;border-top:1px solid var(--line);vertical-align:top}
thead th{border-top:0;background:var(--well);font-weight:500;font-size:13px;white-space:nowrap}
th button{font:inherit;font-weight:500;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}
th button:hover{text-decoration-color:var(--ink)}
td a{font-weight:500}
.repo{display:block;font:12px/1.4 var(--mono);color:var(--muted);margin-top:2px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.reach{min-width:190px}
.track{display:inline-flex;gap:3px;margin-bottom:5px}
.track i{width:22px;height:9px;border-radius:2px;background:var(--well)}
.track i.on.l0{background:var(--l0)}.track i.on.l1{background:var(--l1)}.track i.on.l2{background:var(--l2)}.track i.on.l3{background:var(--l3)}
.labels{display:block;font-size:13px;color:var(--muted)}
.sees{color:var(--muted);max-width:220px}
.ver code{color:var(--l2)}.ver.bad code{color:var(--bad)}
details{margin-top:6px;font-size:12.5px;color:var(--muted)}summary{cursor:pointer;color:var(--muted)}
dl{margin:6px 0 0}dt{font-weight:500;margin-top:4px}dd{margin:0}dd code{color:var(--ink);word-break:break-word}
tr:target td{background:#fbf6e3}
.quiet table{color:var(--muted)}
footer{margin-top:64px;color:var(--muted);font-size:13px;max-width:66ch}
@media (max-width:720px){body{padding:24px 16px 60px}h1{font-size:1.5rem}.sees,th.sees,.ver,th.ver{display:none}.strip{height:40px}.reach{min-width:150px}}
</style></head><body>
<h1>${mods.length} Claude Code mods on GitHub, and how far each one reaches into your machine</h1>
<p class="lead">Read straight off Claude Code's own plugin validator, which lists a mod's hooks and <code>$</code> calls before any of its code runs. Scanned against Claude Code ${esc(data.claudeVersion)} on ${asOf}, rescanned nightly. Source, method and the curated list: <a href="https://github.com/karanb192/awesome-claude-code-mods">awesome-claude-code-mods</a>.</p>
<div class="strip" role="img" aria-label="One segment per mod, coloured by reach level, deepest first">${strip}</div>
<div class="legend" role="group" aria-label="Filter by reach level">${legend}</div>
<p>Reach is the widest thing a mod's <code>$</code> calls can touch. It is a footprint, not a verdict. A PR tracker has to run <code>gh</code>, and a breathing band only draws. Sees lists what a mod observes without a matcher, such as every prompt or every tool call.</p>
<div class="tools"><input id="q" type="search" placeholder="Filter by name, repo or description" aria-label="Filter mods"><span class="count" id="n"></span></div>
<div class="wrap"><table id="t">${thead}<tbody>
${mods.map(trow).join('\n')}
</tbody></table></div>
<h2>Built into Claude Code</h2>
<p class="lead">These ship inside the binary. sec-default seats outermost only on managed machines and Team or Enterprise plans.</p>
<div class="wrap quiet"><table>${thead.replace(/<button type="button" data-k="[a-z]+">([^<]+)<\/button>/g, '$1')}<tbody>
${builtins.map(trow).join('\n')}
</tbody></table></div>
<footer><p>Every row is the validator's output for that mod's <code>plugin.json</code>, recorded in <a href="https://github.com/karanb192/awesome-claude-code-mods/blob/main/data/mods.json">data/mods.json</a>. Mod authors get a reach badge and a validates-on badge for their README; the <a href="https://github.com/karanb192/awesome-claude-code-mods/blob/main/contributing.md">contributing notes</a> have the one-line snippet. Missing a mod, or think a footprint is wrong? Open a pull request with your validator output.</p></footer>
<script>
(function(){
var q=document.getElementById('q'),n=document.getElementById('n'),tb=document.querySelector('#t tbody');
var rows=[].slice.call(tb.querySelectorAll('tr')),lv=[].slice.call(document.querySelectorAll('.lv')),level='';
function apply(){var s=q.value.toLowerCase(),c=0;rows.forEach(function(r){var ok=(level===''||r.dataset.level===level)&&(!s||r.dataset.name.toLowerCase().indexOf(s)>=0);r.hidden=!ok;if(ok)c++});n.textContent=c===rows.length?rows.length+' mods':c+' of '+rows.length+' mods';lv.forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.level===level))})}
lv.forEach(function(b){b.addEventListener('click',function(){level=level===b.dataset.level?'':b.dataset.level;apply()})});
document.querySelectorAll('.seg').forEach(function(s){s.addEventListener('click',function(e){e.preventDefault();level=level===s.dataset.level?'':s.dataset.level;apply();var t=document.getElementById(s.getAttribute('href').slice(1));if(t){t.hidden=false;t.scrollIntoView({block:'center'});history.replaceState(null,'',s.getAttribute('href'))}})});
q.addEventListener('input',apply);
document.querySelectorAll('#t th button').forEach(function(b){b.addEventListener('click',function(){var k=b.dataset.k,dir=b.dataset.dir==='asc'?'desc':'asc';b.dataset.dir=dir;rows.sort(function(x,y){var c;if(k==='stars')c=(+x.dataset.stars)-(+y.dataset.stars);else if(k==='level')c=(+x.dataset.level)-(+y.dataset.level)||(+y.dataset.stars)-(+x.dataset.stars);else c=x.dataset.name.localeCompare(y.dataset.name);return dir==='asc'?c:-c});rows.forEach(function(r){tb.appendChild(r)})})});
apply();
})();
</script></body></html>
`
mkdirSync('docs', { recursive: true })
writeFileSync('docs/index.html', site)
writeFileSync('docs/mods.json', JSON.stringify(data, null, 2) + '\n')
console.log(`rendered ${mods.length} mods and ${builtins.length} built-ins into README.md, badges/, docs/ and docs/badges/`)
