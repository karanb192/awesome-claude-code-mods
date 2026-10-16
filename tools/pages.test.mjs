import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignPages, formatRegistry, indexable, readRegistry, renderModPage, renderRedirect } from './pages.mjs'

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
