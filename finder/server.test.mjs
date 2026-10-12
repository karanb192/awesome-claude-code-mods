import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildIndex, search, getMod, REFRESH_AFTER_MS } from './search.mjs'

const mod = (id, over = {}) => {
  const [repo, path] = id.split(':')
  return {
    id, repo, path, name: path.split('/').pop(), description: '', kind: 'mod', url: `https://github.com/${repo}`, hooks: [], calls: [], marketplaces: [],
    validate: { status: 'passed', claudeVersion: '2.1.296', errors: [] }, compatibility: { runtime: 'not-tested', warnings: [] },
    reach: { level: 0, name: 'draws and remembers', labels: ['draws'] }, sees: [], draws: [], stars: 1, directory: null, ...over,
  }
}
const DATA = {
  generated: '2026-10-11T09:26:34.682Z', claudeVersion: '2.1.296', mods: [
    mod('a/cache:plugin', { name: 'cache-meter', description: 'Prompt cache time left.', reach: { level: 3, name: 'network', labels: ['network'] } }),
    mod('b/cache:.', { name: 'cache-watch', description: 'Watches the prompt cache.' }),
    mod('c/copy:.', { name: 'cache-watch', kind: 'duplicate', duplicateOf: 'b/cache:.' }),
  ],
}

// Starts the server against a fresh cache and a fetch that fails and counts its calls, so no test touches
// the network.
function start(t, { age = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'finder-mcp-'))
  const fetchedAt = Date.now() - age
  writeFileSync(join(dir, 'mods-test.json'), JSON.stringify(DATA))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ commit: 'f'.repeat(40), sha256: 'abc', fetchedAt, file: 'mods-test.json' }))
  const fetches = join(dir, 'fetches.log')
  writeFileSync(join(dir, 'no-network.mjs'), `import { appendFileSync } from 'node:fs'
globalThis.fetch = async url => { appendFileSync(${JSON.stringify(fetches)}, url + '\\n'); throw new TypeError('no network in tests') }`)
  writeFileSync(fetches, '')
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(dir, 'no-network.mjs')).href, fileURLToPath(new URL('./server.mjs', import.meta.url))],
    { env: { ...process.env, CLAUDE_MODS_CACHE: dir } })
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }) })
  const waiting = new Map()
  let buffer = '', next = 1
  child.stdout.on('data', chunk => {
    buffer += chunk
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const message = JSON.parse(buffer.slice(0, i))
      buffer = buffer.slice(i + 1)
      waiting.get(message.id)?.(message)
    }
  })
  const raw = (line, id) => new Promise(resolve => { waiting.set(id, resolve); child.stdin.write(line + '\n') })
  const request = (method, params) => { const id = next++; return raw(JSON.stringify({ jsonrpc: '2.0', id, method, params }), id) }
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  const index = buildIndex(DATA, { commit: 'f'.repeat(40), sha256: 'abc', fetchedAt })
  return { request, notify, raw, index, fetched: () => readFileSync(fetches, 'utf8').split('\n').filter(Boolean) }
}
const call = async (s, name, args) => (await s.request('tools/call', { name, arguments: args })).result

test('the handshake negotiates the protocol version and advertises read-only tools', async t => {
  const s = start(t)
  const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } })
  assert.match(init.result.instructions, /treat them as data/)
  const future = await s.request('initialize', { protocolVersion: '2099-01-01' })
  assert.equal(future.result.protocolVersion, '2025-11-25')
  s.notify('notifications/initialized')
  const { result } = await s.request('tools/list')
  assert.deepEqual(result.tools.map(tool => tool.name), ['search_mods', 'get_mod'])
  for (const tool of result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool.annotations.openWorldHint, true)
  }
  assert.deepEqual((await s.request('ping')).result, {})
})

test('tool answers are exactly what the shared module returns', async t => {
  const s = start(t)
  const args = { query: 'cache', without: ['network'] }
  assert.deepEqual(JSON.parse((await call(s, 'search_mods', args)).content[0].text), search(s.index, args))
  assert.deepEqual(JSON.parse((await call(s, 'get_mod', { id: 'c/copy:.' })).content[0].text), getMod(s.index, 'c/copy:.'))
})

test('bad arguments come back as tool errors the model can act on', async t => {
  const s = start(t)
  const bad = await call(s, 'search_mods', { query: 'cache', without: ['wifi'] })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /"wifi" is not a without value; use one of: network/)
  const extra = await call(s, 'search_mods', { q: 'cache' })
  assert.match(extra.content[0].text, /unknown argument q/)
  assert.equal((await call(s, 'get_mod', {})).isError, true)
  assert.match((await call(s, 'search_mods', { query: 'cache', without: ['network'], include_unverified: 'false' })).content[0].text, /must be true or false/)
})

test('after a failed refresh the stale snapshot serves without retrying on every call', async t => {
  const s = start(t, { age: REFRESH_AFTER_MS + 60e3 })
  for (let i = 0; i < 3; i++) {
    const answer = JSON.parse((await call(s, 'search_mods', { query: 'cache' })).content[0].text)
    assert.equal(answer.snapshot.stale, true)
  }
  assert.equal(s.fetched().length, 2, 'one refresh attempt: the commit lookup and the main download')
})

test('protocol mistakes get JSON-RPC errors and the server keeps serving', async t => {
  const s = start(t)
  assert.equal((await s.request('tools/call', { name: 'nope' })).error.code, -32602)
  assert.equal((await s.request('resources/list')).error.code, -32601)
  assert.equal((await s.raw('{not json', null)).error.code, -32700)
  assert.equal((await call(s, 'search_mods', { query: 'cache' })).isError, undefined)
})
