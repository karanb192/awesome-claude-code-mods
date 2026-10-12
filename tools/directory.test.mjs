import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDirectory, listing, applyDirectory, readDirectory, MARKETPLACE } from './directory.mjs'

const entry = (name, source) => ({ pluginId: `${name}@${MARKETPLACE}`, name, marketplaceName: MARKETPLACE, source })
const raw = JSON.stringify({ installed: [], available: [
  entry('sub', { source: 'git-subdir', url: 'https://github.com/Owner/Repo', path: 'plugins/sub' }),
  entry('root', { source: 'url', url: 'https://github.com/Owner/Solo.git' }),
  entry('slash', { source: 'git-subdir', url: 'https://github.com/owner/multi.git', path: './tools/slash/' }),
  { ...entry('other', { source: 'url', url: 'https://github.com/owner/else' }), marketplaceName: 'elsewhere' },
  entry('local', 'plugins/local'),
] })

test('entries come from the directory marketplace, by repository and path', () => {
  const entries = parseDirectory(raw)
  assert.deepEqual(entries.map(e => [e.repo, e.path]), [['owner/repo', 'plugins/sub'], ['owner/solo', ''], ['owner/multi', 'tools/slash']])
})

test('a mod is listed when repository and path both match, ignoring case', () => {
  const entries = parseDirectory(raw)
  assert.deepEqual(listing({ repo: 'OWNER/repo', path: 'plugins/sub' }, entries), { plugin: `sub@${MARKETPLACE}` })
  assert.deepEqual(listing({ repo: 'owner/solo', path: '.' }, entries), { plugin: `root@${MARKETPLACE}` })
  assert.deepEqual(listing({ repo: 'owner/multi', path: 'tools/slash' }, entries), { plugin: `slash@${MARKETPLACE}` })
  assert.equal(listing({ repo: 'owner/repo', path: 'plugins/other' }, entries), null)
  assert.equal(listing({ repo: 'owner/repo', path: '.' }, entries), null)
  assert.equal(listing({ repo: 'owner/else', path: '.' }, entries), null)
})

test('an empty or malformed catalogue is an error, so a failed refresh cannot unlist every mod', () => {
  assert.throws(() => parseDirectory(JSON.stringify({ available: [] })), /no .* entries/)
  assert.throws(() => parseDirectory('{}'), /available/)
})

test('without a fresh catalogue each mod keeps its earlier listing', () => {
  const mods = [{ id: 'a', repo: 'x/y', path: '.' }, { id: 'b', repo: 'x/z', path: '.' }]
  applyDirectory(mods, null, new Map([['a', { plugin: 'a@d' }]]))
  assert.deepEqual(mods.map(m => m.directory), [{ plugin: 'a@d' }, null])
  applyDirectory(mods, parseDirectory(raw))
  assert.deepEqual(mods.map(m => m.directory), [null, null])
})

test('readDirectory refreshes the marketplace, then reads the catalogue', () => {
  const calls = []
  const entries = readDirectory((cmd, args) => { calls.push(args.join(' ')); if (args[1] === 'marketplace') throw new Error('offline'); return raw })
  assert.equal(entries.length, 3)
  assert.deepEqual(calls, [`plugin marketplace update ${MARKETPLACE}`, 'plugin list --available --json'])
})
