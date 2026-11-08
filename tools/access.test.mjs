import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessStats, renderAccessPage } from './access.mjs'

const record = (name, extra = {}) => ({
  id: `o/r:${name}`, repo: 'o/r', path: name, name, kind: 'mod', description: `${name} does one thing.`, stars: 1,
  footprint: { status: 'reported' }, hooks: [], calls: [], sees: [], surfaceModules: [],
  validate: { status: 'passed', claudeVersion: '2.1.302', errors: [] }, ...extra,
})
const RETAINED = 'Repository could not be scanned; showing the last known footprint.'
const MISSING = 'Not found in this scan; retained pending weekly retirement review.'
// Hand-counted: a-f have reported footprints, g has none, h is not a mod.
const records = [
  record('a', { hooks: [{ event: 'tool.call', matcher: {} }, { event: 'tool.call', matcher: {} }], calls: ['$.fs.write', '$.fs.write', '$.http.fetch'] }),
  record('b', { validate: { status: 'warnings', errors: [] }, hooks: [{ event: 'tool.call', matcher: { tool: 'Bash' } }, { event: 'prompt.submit', matcher: {} }], calls: ['$.ui.notice'] }),
  record('c', { hooks: [{ event: 'tool.call', matcher: { tool: '?' } }], calls: ['$.fs.read', '$.other.thing'] }),
  record('d', { validate: { status: 'failed', errors: ['bad manifest'] }, hooks: [{ event: 'session.start', matcher: {} }] }),
  record('e', { hooks: [{ event: 'session.start', matcher: {} }], calls: ['$.fs.bogus'] }),
  record('f', { validate: { status: 'unknown', errors: [RETAINED] }, lastKnownValidate: { status: 'passed' }, hooks: [{ event: '*', matcher: {} }], calls: ['$.process.run'] }),
  record('g', { footprint: { status: 'unavailable' }, validate: { status: 'unknown', errors: [MISSING] }, hooks: [{ event: 'tool.call', matcher: {} }], calls: ['$.http.fetch'] }),
  record('h', { kind: 'fixture', hooks: [{ event: 'tool.call', matcher: {} }], calls: ['$.http.fetch'] }),
]
const data = (mods, generated = '2026-10-17T22:00:00Z') => ({ generated, claudeVersion: '2.1.302', repos: 1, mods })

test('statistics count mods once per measure over the right denominator', () => {
  const s = accessStats(records)
  assert.deepEqual({ counted: s.counted, reported: s.reported, retained: s.retained, unavailable: s.unavailable }, { counted: 7, reported: 6, retained: 1, unavailable: 1 })
  assert.deepEqual(s.levels, [1, 1, 1, 1], 'levels come from classified calls of reported footprints only')
  assert.equal(s.noMethods, 1, 'no recorded methods is not L0')
  assert.equal(s.onlyUnclassified, 1, 'only unclassified methods is not L0')
  assert.equal(s.broad, 2)
  assert.equal(s.fetch, 1)
  assert.equal(s.watched, 4, 'filtered, unfiltered, unknown-matcher and every-event hooks all count')
  assert.equal(s.unfiltered, 3, 'a filter with an unknown value is still a filter')
  assert.equal(s.ungraded, 2, 'unclassified calls and calls outside the core table')
  assert.deepEqual(s.validation, { passed: 3, warnings: 1, failed: 1, unknown: 2 })
  assert.deepEqual(s.topEvents, [{ name: 'tool.call', n: 3 }, { name: 'session.start', n: 2 }, { name: '*', n: 1 }, { name: 'prompt.submit', n: 1 }])
  assert.deepEqual(Object.fromEntries(s.capabilities.map(({ name, n }) => [name, n])), {
    'Runs processes': 1, 'Reads files': 1, 'Writes files': 1, 'Network (HTTP)': 1, 'Calls MCP servers': 0,
    'Reads environment variables': 0, 'Drives Claude': 0, 'Reads the transcript': 0,
  })
})

test('the page states each share with its denominator and links the sources', () => {
  const html = renderAccessPage(data(records))
  assert.match(html, /In the current catalogue of 7 counted mods, 6 have reported footprints: 33\.3% contain recorded methods classified as writing files, running processes or driving Claude, 16\.7% include <code>\$\.http\.fetch<\/code>, and 50\.0% hook every tool call or every prompt with no filter recorded\. 33\.3% also reference methods the grader cannot classify yet\./)
  assert.match(html, /<link rel="canonical" href="https:\/\/mods\.aidojo\.si\/access\/">/)
  assert.match(html, /Last full scan Oct 17, 2026 on Claude Code 2\.1\.302/)
  assert.match(html, /including 1 retained records that show their last recorded footprint; 1 counted mods have none/)
  assert.match(html, /1 reported footprints with no recorded API methods and 1 whose methods the grader cannot classify/)
  for (const anchor of ['overview#what-a-mod-can-reach', 'overview#what-a-hook-can-do-with-an-event', 'admin#review-what-a-mod-can-do', 'admin#know-which-controls-still-apply']) assert.ok(html.includes(`https://code.claude.com/docs/en/plugins/mods/${anchor}`), anchor)
  assert.match(html, /"@type":"WebPage"/)
  assert.doesNotMatch(html, /FAQPage|dateModified|[–—]/)
  assert.doesNotMatch(html.replace(/not mean a mod is safe/, ''), /\bsafe\b|\bis sandboxed/i)
})

test('a zero denominator shows counts without percentages', () => {
  const none = renderAccessPage(data([]))
  assert.match(none, /catalogue of 0 counted mods, 0 have reported footprints\. Check/)
  assert.doesNotMatch(none, /NaN|Infinity|%/)
  const unknown = renderAccessPage(data([records[6]]))
  assert.doesNotMatch(unknown, /NaN|Infinity|%/)
})

test('event and method names from scanned source are escaped', () => {
  const hostile = record('x', { hooks: [{ event: '<img src=x onerror=alert(1)>', matcher: {} }], calls: ['$.fs.read'] })
  const html = renderAccessPage(data([hostile]))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.doesNotMatch(html, /<img src=x/)
})

test('the page is deterministic and does not move with stars or push dates', () => {
  const first = renderAccessPage(data(records))
  assert.equal(renderAccessPage(data(records)), first)
  assert.equal(renderAccessPage(data([...records].reverse().map(mod => ({ ...mod, stars: mod.stars + 500, pushedAt: '2026-10-19T00:00:00Z' })))), first)
})
