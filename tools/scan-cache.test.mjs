import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scanner = fileURLToPath(new URL('./scan.mjs', import.meta.url))

// Runs the real scanner against stand-in git, gh and claude commands that log every clone and
// validator call, so a test can tell a reused finding from a fresh inspection.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'scan-cache-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['bin', 'data', 'tmp']) mkdirSync(join(root, dir))
  const state = { revision: 'a'.repeat(40), version: 'fixture', stars: 1, description: 'First description', crash: '', fail: '', twins: false }
  const stateFile = join(root, 'state.json'), callsFile = join(root, 'calls.log')
  for (const [file, text] of Object.entries({ 'repos.txt': 'fixture/mod\n', 'seeds.txt': '', 'duplicates.txt': '', 'catalogs.txt': '', 'fixture-exceptions.txt': '' })) writeFileSync(join(root, 'data', file), text)
  const command = (name, source) => writeFileSync(join(root, 'bin', name), `#!${process.execPath}\nconst fs = require('node:fs'), p = require('node:path'), state = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE, 'utf8')), args = process.argv.slice(2)\n${source}`, { mode: 0o755 })
  command('gh', `console.log(JSON.stringify({ data: { r0: { nameWithOwner: 'fixture/mod', stargazerCount: state.stars, description: state.description, defaultBranchRef: { name: 'main', target: { oid: state.revision } } } } }))`)
  command('git', `
if (args[0] === 'clone') {
  fs.appendFileSync(process.env.FIXTURE_CALLS, 'clone\\n')
  const dir = args.at(-1)
  const plugin = (at, name) => {
    fs.mkdirSync(p.join(at, 'hooks'), { recursive: true }); fs.mkdirSync(p.join(at, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(p.join(at, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.ts'] }))
    fs.writeFileSync(p.join(at, 'hooks/register.ts'), 'export function register($) {}')
    fs.writeFileSync(p.join(at, '.claude-plugin/plugin.json'), JSON.stringify({ name }))
  }
  if (state.twins) { plugin(p.join(dir, 'plugins/a'), 'twin'); plugin(p.join(dir, 'plugins/b'), 'twin') }
  else {
    plugin(dir, 'cache-fixture')
    fs.writeFileSync(p.join(dir, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'cache-fixture', plugins: [{ name: 'cache-fixture', source: './' }] }))
  }
} else if (args[0] === '-C') console.log(state.revision)
else process.exit(1)
`)
  command('claude', `
if (args[0] === '--version') { console.log(state.version + ' (Claude Code)'); process.exit(0) }
if (args[1] !== 'validate') process.exit(1)
const type = args.at(-1).includes('marketplace') ? 'marketplace' : 'plugin'
fs.appendFileSync(process.env.FIXTURE_CALLS, 'validate ' + type + '\\n')
if (state.twins) {
  // plugins/a has an empty footprint, which is also what a crashed validation of plugins/b parses to.
  if (process.cwd().endsWith('/a')) { console.log('✔ Validation passed'); process.exit(0) }
  if (state.crash === 'twin') process.exit(137)
}
if (state.crash === type) process.exit(137)
if (state.fail === type) { console.log('✘ Found 1 error:\\n  ❯ name: invalid\\n\\n✘ Validation failed'); process.exit(1) }
console.log('  ❯ ./register.ts hooks: session.start\\n  ❯ ./register.ts calls: $.fs.read\\n✔ Validation passed')
`)
  let runs = 0
  function run({ cache = true } = {}) {
    writeFileSync(stateFile, JSON.stringify(state))
    writeFileSync(callsFile, '')
    const out = join(root, `out-${runs++}.json`)
    const result = spawnSync(process.execPath, [scanner, '--out', out, '--include-checked', ...(cache ? ['--cache', join(root, 'cache.json')] : [])], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH, TMPDIR: join(root, 'tmp'), FIXTURE_STATE: stateFile, FIXTURE_CALLS: callsFile },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    const data = JSON.parse(readFileSync(out, 'utf8'))
    delete data.generated
    return { data, calls: readFileSync(callsFile, 'utf8').split('\n').filter(Boolean) }
  }
  return { root, state, run }
}

test('a cached repository needs no clone and records what a fresh scan records', t => {
  const f = fixture(t)
  const fresh = f.run()
  assert.ok(fresh.calls.includes('clone'))
  const cached = f.run()
  assert.deepEqual(cached.calls, [])
  assert.deepEqual(cached.data, fresh.data)
  assert.deepEqual(f.run({ cache: false }).data, fresh.data)
})

test('metadata and classification lists apply to reused findings', t => {
  const f = fixture(t)
  f.run()
  f.state.stars = 99
  f.state.description = 'Updated description'
  writeFileSync(join(f.root, 'data/catalogs.txt'), 'fixture/mod\n')
  const next = f.run()
  assert.deepEqual(next.calls, [])
  assert.equal(next.data.mods[0].stars, 99)
  assert.equal(next.data.mods[0].description, 'Updated description')
  assert.equal(next.data.mods[0].kind, 'catalog')
})

test('a moved commit, a new validator or a different scanner key rescans', t => {
  const f = fixture(t)
  f.run()
  f.state.revision = 'b'.repeat(40)
  assert.ok(f.run().calls.includes('clone'), 'moved commit')
  f.state.version = 'fixture-next'
  assert.ok(f.run().calls.includes('clone'), 'new validator version')
  const path = join(f.root, 'cache.json')
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), key: 'other' }))
  assert.ok(f.run().calls.includes('clone'), 'different scanner key')
})

for (const type of ['plugin', 'marketplace']) {
  test(`a crashed ${type} validation is retried, not reused, on an unchanged commit`, t => {
    const f = fixture(t)
    const status = data => type === 'plugin' ? data.mods[0].validate.status : data.mods[0].marketplaces[0].status
    f.state.crash = type
    assert.equal(status(f.run().data), 'unknown')
    f.state.crash = ''
    const recovered = f.run()
    assert.ok(recovered.calls.includes('clone'))
    assert.equal(status(recovered.data), 'passed')
    assert.deepEqual(f.run().calls, [], 'the recovered result is cached')
  })
}

test('a crashed validation that duplicate filtering drops still blocks reuse', t => {
  const f = fixture(t)
  f.state.twins = true
  f.state.crash = 'twin'
  assert.deepEqual(f.run().data.mods.map(m => m.path), ['plugins/a'])
  f.state.crash = ''
  const recovered = f.run()
  assert.ok(recovered.calls.includes('clone'))
  assert.deepEqual(recovered.data.mods.map(m => m.path).sort(), ['plugins/a', 'plugins/b'])
  assert.deepEqual(recovered.data, f.run({ cache: false }).data)
})

test('a crashed validation already in an older cache is not reused', t => {
  const f = fixture(t)
  f.run()
  const path = join(f.root, 'cache.json'), cache = JSON.parse(readFileSync(path, 'utf8'))
  cache.repos['fixture/mod'].plugins[0].validate.status = 'unknown'
  writeFileSync(path, JSON.stringify(cache))
  const next = f.run()
  assert.ok(next.calls.includes('clone'))
  assert.equal(next.data.mods[0].validate.status, 'passed')
})

test('a validator that reports a failure is a settled result and is reused', t => {
  const f = fixture(t)
  f.state.fail = 'plugin'
  assert.equal(f.run().data.mods[0].validate.status, 'failed')
  const cached = f.run()
  assert.deepEqual(cached.calls, [])
  assert.equal(cached.data.mods[0].validate.status, 'failed')
})
