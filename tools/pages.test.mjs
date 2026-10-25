import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessLine, assignPages, formatRegistry, indexable, installLine, readRegistry, renderModPage, renderRedirect, scanSummary } from './pages.mjs'
import { grade } from './grade.mjs'

const mod = (repo, name, extra = {}) => ({
  id: `${repo}:${extra.path ?? name}`, repo, name, path: name, kind: 'mod', description: `${name} does one useful thing for a Claude Code session.`,
  url: `https://github.com/${repo}`, stars: 1, reach: { level: 0, labels: [] }, sees: [], hooks: [], calls: [], surfaceModules: [],
  validate: { status: 'passed', claudeVersion: '2.1.300', errors: [] }, ...extra,
})
const assign = (records, registry = {}, all = records) => assignPages(records, registry, all)
const slugOf = (result, id) => [...result.pages].find(([m]) => m.id === id)?.[1]

test('new mods take their homepage anchor and the registry records each owner', () => {
  const result = assign([mod('a/one', 'clip'), mod('b/two', 'meter')])
  assert.equal(slugOf(result, 'a/one:clip'), 'a--one--clip')
  assert.deepEqual(result.registry, { 'a--one--clip': { id: 'a/one:clip' }, 'b--two--meter': { id: 'b/two:meter' } })
  assert.equal(result.redirects.size, 0)
})

test('paths do not depend on input order or star counts', () => {
  const records = [mod('a/r', 'x', { path: 'deep/x' }), mod('a/r', 'x', { path: 'other/x' }), mod('b/r', 'y')]
  const forward = assign(records)
  const shuffled = assign([records[2], { ...records[1], stars: 900 }, records[0]].map(m => ({ ...m })))
  assert.deepEqual(forward.registry, shuffled.registry)
})

test('a later same-named plugin nearer the root does not take an existing page', () => {
  const deep = mod('a/r', 'clip', { path: 'plugins/clip' })
  const first = assign([deep])
  assert.equal(slugOf(first, deep.id), 'a--r--clip')
  const root = mod('a/r', 'clip', { path: '.' })
  const second = assign([deep, root], first.registry)
  assert.equal(slugOf(second, deep.id), 'a--r--clip')
  assert.notEqual(slugOf(second, root.id), 'a--r--clip')
  assert.equal(second.registry['a--r--clip'].id, deep.id)
})

test('names that collide with another plugin\'s path suffix get the same paths in any order', () => {
  const records = [mod('a/r', 'x', { path: '.' }), mod('a/r', 'x', { path: 'y' }), mod('a/r', 'x--y', { path: 'z' })]
  const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]].map(order => assign(order.map(i => records[i])).registry)
  for (const registry of orders) assert.deepEqual(registry, orders[0])
})

test('a repository that changes letter case keeps its pages', () => {
  const before = mod('Owner/Repo', 'Tool')
  const first = assign([before])
  const after = { ...mod('owner/repo', 'Tool') }
  const second = assign([after], first.registry)
  assert.equal(slugOf(second, after.id), 'Owner--Repo--Tool')
  assert.deepEqual(second.registry, { 'Owner--Repo--Tool': { id: after.id } })
  const plugin = assign([mod('owner/repo', 'tool')], second.registry)
  assert.notEqual(slugOf(plugin, 'owner/repo:tool'), 'Owner--Repo--Tool', 'plugin paths keep their case')
})

test('paths that differ only in case never share a folder', () => {
  const result = assign([mod('a/r', 'Clip')], { 'a--r--clip': { id: 'gone/r:clip' } })
  assert.equal(slugOf(result, 'a/r:Clip'), 'a--r--Clip--2')
})

test('a renamed or copied mod redirects to its keeper, and keeps redirecting after the copy is retired', () => {
  const old = mod('old/name', 'tool')
  const first = assign([old])
  const renamed = mod('new/name', 'tool')
  const copy = { ...old, kind: 'duplicate', duplicateOf: renamed.id }
  const second = assign([renamed], first.registry, [renamed, copy])
  assert.deepEqual([...second.redirects], [['old--name--tool', 'new--name--tool']])
  assert.deepEqual(second.registry['old--name--tool'], { id: old.id, to: 'new--name--tool' })
  const retired = assign([renamed], second.registry, [renamed])
  assert.deepEqual([...retired.redirects], [['old--name--tool', 'new--name--tool']])
  const gone = assign([mod('c/d', 'other')], retired.registry, [])
  assert.equal(gone.redirects.size, 0)
  assert.ok(gone.registry['old--name--tool'], 'a retired path stays reserved')
})

test('a second rename keeps the first redirect pointing at the newest page in the same render', () => {
  const a = mod('x/a', 'm'), b = mod('x/b', 'm'), c = mod('x/c', 'm')
  const first = assign([b], assign([a]).registry, [b, { ...a, kind: 'duplicate', duplicateOf: b.id }])
  const retired = assign([b], first.registry, [b])
  const second = assign([c], retired.registry, [c, { ...b, kind: 'duplicate', duplicateOf: c.id }])
  assert.deepEqual([...second.redirects].sort(), [['x--a--m', 'x--c--m'], ['x--b--m', 'x--c--m']])
  assert.equal(second.registry['x--a--m'].to, 'x--c--m')
})

test('a retained record under the old letter case never shares a page with the rescanned one', () => {
  const first = assign([mod('Owner/Repo', 'tool')])
  const stale = mod('Owner/Repo', 'tool', { validate: { status: 'unknown', errors: [] } })
  const fresh = mod('owner/repo', 'tool')
  const second = assign([stale, fresh], first.registry)
  assert.equal(slugOf(second, fresh.id), 'Owner--Repo--tool')
  assert.notEqual(slugOf(second, stale.id), 'Owner--Repo--tool')
  const third = assign([fresh, stale], second.registry)
  assert.deepEqual(third.registry, second.registry, 'both paths stay put on the next render')
})

test('a retained record follows a hand-set redirect until a fresh scan finds it again', () => {
  const keeper = mod('new/repo', 'tool')
  const gone = mod('deleted/repo', 'tool', { validate: { status: 'unknown', errors: ['Repository could not be scanned; showing the last known footprint.'] } })
  const registry = { ...assign([gone, keeper]).registry }
  registry['deleted--repo--tool'] = { id: gone.id, to: 'new--repo--tool' }
  const held = assign([gone, keeper], registry)
  assert.deepEqual([...held.redirects], [['deleted--repo--tool', 'new--repo--tool']])
  assert.equal(held.registry['deleted--repo--tool'].to, 'new--repo--tool')
  const back = assign([{ ...gone, validate: { status: 'passed', errors: [] } }, keeper], held.registry)
  assert.equal(back.redirects.size, 0)
  assert.deepEqual(back.registry['deleted--repo--tool'], { id: gone.id })
})

test('a redirect to a repository that changed case lands on the rescanned page, not the retained copy', () => {
  const old = mod('Owner/Repo', 'tool'), copy = mod('x/y', 'tool')
  const first = assign([old, copy])
  const stale = { ...old, validate: { status: 'unknown', errors: [] } }
  const fresh = mod('owner/repo', 'tool')
  const second = assign([stale, fresh], first.registry, [stale, fresh, { ...copy, kind: 'duplicate', duplicateOf: fresh.id }])
  assert.equal(slugOf(second, fresh.id), 'Owner--Repo--tool')
  assert.equal(second.redirects.get('x--y--tool'), 'Owner--Repo--tool')
})

test('retained records that redirect follow each other to a live page, and a cycle of them redirects nowhere', () => {
  const gone = status => ({ validate: { status, errors: [] } })
  const a = mod('x/a', 'm', gone('unknown')), b = mod('x/b', 'm', gone('unknown')), c = mod('x/c', 'm')
  const base = assign([a, b, c]).registry
  const chain = assign([a, b, c], { ...base, 'x--a--m': { id: a.id, to: 'x--b--m' }, 'x--b--m': { id: b.id, to: 'x--c--m' } })
  assert.deepEqual([...chain.redirects].sort(), [['x--a--m', 'x--c--m'], ['x--b--m', 'x--c--m']])
  const cycle = assign([a, b, c], { ...base, 'x--a--m': { id: a.id, to: 'x--b--m' }, 'x--b--m': { id: b.id, to: 'x--a--m' } })
  assert.equal(cycle.redirects.size, 0)
  assert.equal(slugOf(cycle, a.id), 'x--a--m')
  assert.equal(cycle.registry['x--a--m'].to, 'x--b--m', 'a hand-set target is kept for the maintainer to fix')
})

test('a maintainer can point a retired path at another page by hand', () => {
  const keeper = mod('new/home', 'tool')
  const result = assign([keeper], { 'old--home--tool': { id: 'old/home:tool', to: 'new--home--tool' } })
  assert.deepEqual([...result.redirects], [['old--home--tool', 'new--home--tool']])
})

test('duplicate chains resolve to the surviving keeper and cycles stop', () => {
  const a = mod('x/a', 'm'), b = mod('x/b', 'm'), c = mod('x/c', 'm')
  const registry = assign([a, b, c]).registry
  const chain = assign([c], registry, [c, { ...a, kind: 'duplicate', duplicateOf: b.id }, { ...b, kind: 'duplicate', duplicateOf: c.id }])
  assert.equal(chain.redirects.get('x--a--m'), 'x--c--m')
  const cycle = assign([mod('z/z', 'z')], registry, [{ ...a, kind: 'duplicate', duplicateOf: b.id }, { ...b, kind: 'duplicate', duplicateOf: a.id }])
  assert.equal(cycle.redirects.size, 0)
})

test('a mod that returns reclaims its page and drops its recorded redirect', () => {
  const back = mod('r/back', 'tool')
  const result = assign([back, mod('r/keeper', 'tool')], { 'r--back--tool': { id: back.id, to: 'r--keeper--tool' }, 'r--keeper--tool': { id: 'r/keeper:tool' } })
  assert.equal(slugOf(result, back.id), 'r--back--tool')
  assert.deepEqual(result.registry['r--back--tool'], { id: back.id })
  assert.equal(result.redirects.size, 0)
})

test('the registry format is sorted, one entry per line, and rejects unsafe paths', () => {
  const text = formatRegistry({ b: { id: 'x' }, a: { id: 'y', to: 'b' } })
  assert.equal(text, '{\n  "a": {"id":"y","to":"b"},\n  "b": {"id":"x"}\n}\n')
  assert.deepEqual(readRegistry(text), { a: { id: 'y', to: 'b' }, b: { id: 'x' } })
  assert.throws(() => readRegistry('{"../escape": {"id": "x"}}'), /invalid entry/)
  for (const slug of ['..', '.', '.hidden']) assert.throws(() => readRegistry(JSON.stringify({ [slug]: { id: 'x' } })), /invalid entry/)
  assert.throws(() => readRegistry('{"Foo": {"id": "a"}, "foo": {"id": "b"}}'), /invalid entry/)
  assert.throws(() => readRegistry('{"a": {"id": "x", "to": "../b"}}'), /invalid entry/)
  assert.throws(() => readRegistry('{"ok": {}}'), /invalid entry/)
})

test('search engines index failed mods but not retained records or empty descriptions', () => {
  assert.equal(indexable(mod('a/b', 'c')), true)
  assert.equal(indexable(mod('a/b', 'c', { validate: { status: 'failed', errors: ['x'] } })), true)
  assert.equal(indexable(mod('a/b', 'c', { validate: { status: 'unknown', errors: [] } })), false)
  assert.equal(indexable(mod('a/b', 'c', { description: '  ' })), false)
})

test('author text is escaped in the page body, metadata and structured data', () => {
  const hostile = mod('evil/repo', '<img src=x onerror=alert(1)>', { description: 'Ends the script </script><script>alert(1)</script> & "quotes"' })
  const html = renderModPage(hostile, { slug: 'evil--repo--x', anchor: 'evil--repo--x', claudeVersion: '2.1.300' })
  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<script>alert/)
  assert.equal(html.match(/<\/script>/g).length, 1, 'only the JSON-LD block closes a script')
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  assert.equal(ld['@graph'][0].description, hostile.description)
  assert.match(html, /<link rel="canonical" href="https:\/\/mods\.aidojo\.si\/mods\/evil--repo--x\/">/)
  assert.match(html, /<a href="\/#evil--repo--x">/)
  assert.doesNotMatch(html, /noindex/)
})

test('pages carry no stars or scan dates, and noindex follows the gate', () => {
  const page = renderModPage(mod('a/b', 'c', { stars: 4321, pushedAt: '2026-10-01T00:00:00Z' }), { slug: 's', anchor: 's', claudeVersion: '2.1.300' })
  assert.doesNotMatch(page, /4321|4,321|2026-10-01/)
  const unknown = renderModPage(mod('a/b', 'c', { validate: { status: 'unknown', claudeVersion: '2.1.291', errors: ['Repository could not be scanned; showing the last known footprint.'] }, lastKnownValidate: { status: 'passed', claudeVersion: '2.1.291', errors: [] } }), { slug: 's', anchor: 's', claudeVersion: '2.1.300' })
  assert.match(unknown, /<meta name="robots" content="noindex">/)
  assert.match(unknown, /Validation on 2\.1\.291/)
  assert.match(unknown, /Last known result<\/dt><dd>Passed on 2\.1\.291/)
})

test('a redirect stub sends visitors and crawlers to the keeper', () => {
  const html = renderRedirect('new--name--tool')
  assert.match(html, /<meta http-equiv="refresh" content="0; url=\/mods\/new--name--tool\/">/)
  assert.match(html, /<link rel="canonical" href="https:\/\/mods\.aidojo\.si\/mods\/new--name--tool\/">/)
})

test('a mod page offers README badges that link back to it, and built-ins do not', () => {
  const page = renderModPage(mod('a/b', 'c'), { slug: 'a--b--c', anchor: 'a--b--c', claudeVersion: '2.1.300' })
  const snippet = page.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1].replace(/&#39;|&quot;|&amp;/g, m => ({ '&#39;': "'", '&quot;': '"', '&amp;': '&' })[m])
  assert.equal(snippet, '[![reach](https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/a--b--c-reach.svg)](https://mods.aidojo.si/mods/a--b--c/)\n[![validates](https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/a--b--c-validates.svg)](https://mods.aidojo.si/mods/a--b--c/)')
  assert.match(page, /<img src="\/badges\/a--b--c-reach\.svg"/)
  assert.doesNotMatch(renderModPage(mod('anthropics/claude-code', 'x', { kind: 'builtin' }), { slug: 's', anchor: 's', claudeVersion: '2.1.300' }), /badge-snippet/)
})

const scanned = (calls, extra = {}) => mod('a/b', 'tool', { calls, reach: grade(calls), hooks: [{ event: 'session.start', matcher: {} }, { event: 'tool.call', matcher: { tool: 'Bash' } }, { event: 'tool.call', matcher: { tool: 'Edit' } }], ...extra })
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()

test('the scan summary states the level of classified calls and names the calls it cannot classify', () => {
  const summary = scanSummary(scanned(['$.env.get', '$.process.run', '$.prompt.steer', '$.fs.readFile']), '2.1.300')
  assert.match(text(summary.html), /^tool reaches L2 \(writes or runs\) by its classified calls and passed claude plugin validate on Claude Code 2\.1\.300\./)
  assert.match(text(summary.html), /Events hooked: 2 API methods referenced: 4 Access from classified calls: L2, writes or runs: runs processes, reads env vars/)
  assert.match(summary.html, /Unclassified calls: 2 \(<code>\$\.prompt\.steer<\/code>, <code>\$\.fs\.readFile<\/code>\), full access unknown/)
  assert.match(text(summary.html), /Static scan, not a runtime test/)
  assert.equal(summary.short, 'Scan: L2 writes or runs by classified calls, passes validation on 2.1.300.')
  const clean = scanSummary(scanned(['$.ui.open']), '2.1.300')
  assert.match(text(clean.html), /^tool reaches L0 \(draws and remembers\) and passed/)
  assert.doesNotMatch(clean.html, /Unclassified/)
})

test('unclassified calls never lift the level a page states', () => {
  const calls = ['$.ui.open', '$.prompt.steer']
  assert.equal(grade(calls).level, 1, 'the stored level counts the unclassified call as 1')
  assert.match(text(scanSummary(scanned(calls), '2.1.300').html), /reaches L0 \(draws and remembers\) by its classified calls/)
  const none = scanSummary(scanned(['$.prompt.steer', '$.fs.readFile']), '2.1.300')
  assert.match(text(none.html), /^The scanner could not classify any of the 2 API methods tool references, so its access is unknown/)
  assert.match(none.html, /Unclassified calls: 2 \(<code>\$\.prompt\.steer<\/code>, <code>\$\.fs\.readFile<\/code>\), full access unknown/)
  const empty = scanSummary(scanned([]), '2.1.300')
  assert.match(text(empty.html), /^The validator reported no API methods for tool; it passed/)
  assert.match(text(empty.html), /Access: no API methods recorded/)
  assert.doesNotMatch(empty.html + empty.short, /none beyond|no API calls/)
  assert.equal(empty.short, 'Scan: no API methods recorded, passes validation on 2.1.300.')
})

test('incomplete footprints, failures and retained records are worded for what the scan knows', () => {
  const partial = scanSummary(scanned(['$.fs.write'], { footprint: { status: 'unavailable' } }), '2.1.300')
  assert.match(text(partial.html), /^The scan could not record a complete footprint for tool, so its access is unknown/)
  assert.doesNotMatch(partial.html, /L2|Events hooked|API methods referenced/)
  const failed = scanSummary(scanned(['$.ui.open'], { validate: { status: 'failed', claudeVersion: '2.1.300', errors: ['manifest <bad>\nsecond line'] } }), '2.1.300')
  assert.match(failed.html, /fails <code>claude plugin validate<\/code> on Claude Code 2\.1\.300: manifest &lt;bad&gt;\./)
  assert.doesNotMatch(failed.html, /second line/)
  for (const reason of ['Not found in this scan; retained pending weekly retirement review.', 'Repository could not be scanned; showing the last known footprint.']) {
    const kept = scanSummary(scanned(['$.ui.open'], { sourceCommit: 'abcdef1234567', validate: { status: 'unknown', claudeVersion: '2.1.291', errors: [reason] }, lastKnownValidate: { status: 'passed', claudeVersion: '2.1.291', errors: [] } }), '2.1.300')
    assert.match(text(kept.html), /^In its last recorded footprint, tool reaches L0 \(draws and remembers\) and passed claude plugin validate on Claude Code 2\.1\.291\./)
    assert.ok(kept.html.includes(`Last recorded footprint, revision <code>abcdef1</code>: ${reason}`))
    assert.doesNotMatch(kept.html, /last successful/i)
  }
  const keptPartial = scanSummary(scanned(['$.ui.open'], { footprint: { status: 'unavailable' }, validate: { status: 'unknown', errors: ['Repository could not be scanned; showing the last known footprint.'] } }), '2.1.300')
  assert.match(text(keptPartial.html), /^In its last recorded footprint, the scan could not record a complete footprint/)
})

test('events are counted once however many hooks share them, and generated copy has no dashes', () => {
  const summary = scanSummary(scanned(['$.ui.open']), '2.1.300')
  assert.match(text(summary.html), /Events hooked: 2 /)
  assert.doesNotMatch(summary.html + summary.short, /[–—]/)
})

test('a mod page offers an install hint when the scan saw a marketplace or Anthropic directory entry', () => {
  const page = (extra = {}) => renderModPage(mod('a/b', 'tool', extra), { slug: 's', anchor: 's', claudeVersion: '2.1.300' })
  const root = page({ marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'b', status: 'passed', errors: [] }] })
  assert.match(root, /<h2 id="install-title">Install hint<\/h2><div class="command"><pre><code>\/plugin install tool --marketplace a\/b<\/code><\/pre><button type="button" class="copy" data-copy hidden>Copy<\/button>/)
  assert.match(root, /From the repository's own marketplace\. Confirm the plugin name/)
  assert.equal(root.match(/<\/script>/g).length, 2, 'JSON-LD plus the copy button script')
  assert.match(page({ directory: { plugin: 'tool' } }), /<code>\/plugin install tool<\/code>/)
  const none = page({ marketplaces: [{ path: 'sub/.claude-plugin/marketplace.json', name: 'b', status: 'passed', errors: [] }] })
  assert.match(none, /follow the author’s setup instructions/)
  assert.doesNotMatch(none, /data-copy/)
  assert.match(page({ marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'b', status: 'passed', errors: [] }], validate: { status: 'failed', claudeVersion: '2.1.300', errors: ['x'] } }), /It fails validation in the latest scan, so it may not install\./)
  const builtin = renderModPage(mod('anthropics/claude-code', 'x', { kind: 'builtin', directory: { plugin: 'x' } }), { slug: 's', anchor: 's', claudeVersion: '2.1.300' })
  assert.match(builtin, /It ships inside Claude Code, so there is nothing to install\./)
  assert.doesNotMatch(builtin, /Install hint/)
})

test('metadata keeps the purpose first, adds the scan, and the index gate does not move', () => {
  const long = 'A very long purpose sentence that keeps going '.repeat(6)
  const page = renderModPage(mod('a/b', 'tool', { description: long, license: 'MIT' }), { slug: 's', anchor: 's', claudeVersion: '2.1.300' })
  const meta = page.match(/<meta name="description" content="([^"]*)">/)[1]
  assert.ok(meta.startsWith('A very long purpose sentence'))
  assert.ok(meta.endsWith('Scan: no API methods recorded, passes validation on 2.1.300.'))
  assert.ok(meta.length <= 160, `meta is ${meta.length} characters`)
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'][0]
  assert.equal(ld.runtimePlatform, 'Claude Code')
  assert.equal(ld.license, 'https://spdx.org/licenses/MIT.html')
  for (const license of ['NOASSERTION', null, undefined, 'Other']) {
    assert.equal(JSON.parse(renderModPage(mod('a/b', 'tool', { license }), { slug: 's', anchor: 's', claudeVersion: '2.1.300' }).match(/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'][0].license, undefined)
  }
  const blank = mod('a/b', 'tool', { description: '' })
  assert.equal(indexable(blank), false)
  assert.match(renderModPage(blank, { slug: 's', anchor: 's', claudeVersion: '2.1.300' }), /<meta name="robots" content="noindex">/)
})

test('a page changes when the scan changes', () => {
  const opts = { slug: 's', anchor: 's', claudeVersion: '2.1.300' }
  assert.notEqual(renderModPage(scanned(['$.ui.open']), opts), renderModPage(scanned(['$.ui.open', '$.http.fetch']), opts))
})

test('calls in other namespaces and mod state reads are stated apart from the level', () => {
  const mixed = scanSummary(scanned(['$.state.get', '$.mods.hello', '$.prompt.steer']), '2.1.300')
  assert.match(text(mixed.html), /^tool reaches L1 \(reads\) by its classified calls/)
  assert.match(mixed.html, /Unclassified calls: 1 \(<code>\$\.prompt\.steer<\/code>\), full access unknown/)
  assert.match(mixed.html, /Calls in a namespace that is not in the Claude Code 2.1.302 core table: 1 \(<code>\$\.mods\.hello<\/code>\), full access unknown/)
  assert.match(mixed.html, /Reads mod state: the scan does not record whose state/)
  const foreignOnly = scanSummary(scanned(['$.mods.hello', '$.widgets.card']), '2.1.300')
  assert.match(text(foreignOnly.html), /^The scanner could not classify any of the 2 API methods tool references, so its access is unknown/)
  assert.doesNotMatch(foreignOnly.html, /reaches L/)
  assert.doesNotMatch(scanSummary(scanned(['$.store.get']), '2.1.300').html, /mod state/)
})

test('the compact access line follows the same branches as the scan summary', () => {
  const line = (calls, extra) => accessLine(scanned(calls, extra)).html
  assert.equal(line(['$.fs.write'], { footprint: { status: 'unavailable' } }), 'Access unknown, the footprint is incomplete.')
  assert.equal(line([]), 'No API methods recorded.')
  assert.equal(line(['$.prompt.steer', '$.fs.readFile']), 'Access unknown, no call could be classified. Unclassified calls: <code>$.prompt.steer</code>, <code>$.fs.readFile</code>, full access unknown.')
  assert.equal(line(['$.env.get', '$.process.run']), 'L2 writes or runs: runs processes, reads env vars.')
  assert.equal(line(['$.ui.open']), 'L0 draws and remembers: draws.')
  assert.equal(line(['$.ui.open', '$.prompt.steer']), 'L0 draws and remembers by classified calls: draws. Unclassified calls: <code>$.prompt.steer</code>, full access unknown.', 'an unclassified core call never lifts the level')
  assert.equal(line(['$.ui.open', '$.sidebar.set']), 'L0 draws and remembers by classified calls: draws. Calls in a namespace that is not in the Claude Code 2.1.302 core table: <code>$.sidebar.set</code>, full access unknown.')
  assert.equal(line(['$.state.get', '$.store.get']), 'L1 reads: reads mod state (owner not recorded), persists state.')
  assert.doesNotMatch(line(['$.store.get']), /mod state/)
  for (const calls of [['$.fs.write'], [], ['$.prompt.steer'], ['$.ui.open', '$.prompt.steer', '$.mods.hello', '$.state.get'], ['$.http.fetch', '$.process.run']]) {
    for (const extra of [{}, { footprint: { status: 'unavailable' } }, { validate: { status: 'unknown', errors: ['x'] }, lastKnownValidate: { status: 'passed' } }]) {
      const record = scanned(calls, extra)
      const summary = scanSummary(record, '2.1.300'), compact = accessLine(record)
      assert.deepEqual({ level: compact.level, labels: compact.labels, named: compact.named }, { level: summary.level, labels: summary.labels, named: summary.named }, `${calls} ${JSON.stringify(extra)}`)
      for (const call of compact.named) assert.ok(summary.html.includes(`<code>${call}</code>`) && compact.html.includes(`<code>${call}</code>`), call)
    }
  }
})

test('the install line prints the command, its origin and the name check as the mod page does', () => {
  const root = { marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'b', status: 'passed', errors: [] }] }
  assert.equal(installLine(mod('a/b', 'tool', root)), "Install hint: <code>/plugin install tool --marketplace a/b</code>, from the repository's own marketplace. Confirm the plugin name in the repository's README before installing.")
  assert.equal(installLine(mod('a/b', 'tool', { directory: { plugin: 'tool' } })), "Install hint: <code>/plugin install tool</code>, from Anthropic's plugin directory.")
  assert.equal(installLine(mod('a/b', 'tool', { ...root, validate: { status: 'failed', claudeVersion: '2.1.300', errors: ['x'] } })), "Install hint: <code>/plugin install tool --marketplace a/b</code>, from the repository's own marketplace. Confirm the plugin name in the repository's README before installing. It fails validation in the latest scan, so it may not install.")
  assert.equal(installLine(mod('a/b', 'tool')), 'To install it, open the repository and follow the author’s setup instructions.')
  assert.equal(installLine(mod('a/b', 'x<y', root)), "Install hint: <code>/plugin install x&lt;y --marketplace a/b</code>, from the repository's own marketplace. Confirm the plugin name in the repository's README before installing.")
  assert.equal(installLine(mod('anthropics/claude-code', 'x', { kind: 'builtin' })), 'It ships inside Claude Code, so there is nothing to install.')
  const page = renderModPage(mod('a/b', 'tool', root), { slug: 's', anchor: 's', claudeVersion: '2.1.300' })
  assert.match(page, /From the repository's own marketplace\. Confirm the plugin name in the repository's README before installing\. Mods need Claude Code 2\.1\.287 or later\./)
})

test('a member mod page links its topic page, and a non-member page is unchanged', () => {
  const options = { slug: 's', anchor: 's', claudeVersion: '2.1.300' }
  const plain = renderModPage(mod('a/b', 'tool'), options)
  assert.equal(renderModPage(mod('a/b', 'tool'), { ...options, topics: [] }), plain)
  const listed = renderModPage(mod('a/b', 'tool'), { ...options, topics: [{ slug: 'prompt-cache', title: 'Prompt cache mods for Claude Code' }, { slug: 'x', title: 'X & <y>' }] })
  assert.match(listed, /<\/div><\/div>\n<p class="topics-line">Listed under <a href="\/topics\/prompt-cache\/">Prompt cache mods for Claude Code<\/a>, <a href="\/topics\/x\/">X &amp; &lt;y&gt;<\/a>\.<\/p>\n<p class="actions">/)
})
