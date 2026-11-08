import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findingsModules, findingsPackages, findingsKey } from './inspect.mjs'
import { buildIndex, search, getMod } from '../finder/search.mjs'
import { reviewSeed } from './seed-publication.mjs'

const scanner = fileURLToPath(new URL('./scan.mjs', import.meta.url))

// Runs the real scanner against stand-in git, gh and claude commands that log every clone and
// validator call, so a test can tell a reused finding from a fresh inspection.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'scan-cache-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['bin', 'data', 'tmp']) mkdirSync(join(root, dir))
  const state = { revision: 'a'.repeat(40), version: 'fixture', stars: 1, description: 'First description', crash: '', fail: '', twins: false, calls: '$.fs.read', output: true }
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
    fs.writeFileSync(p.join(at, 'hooks/register.ts'), state.source ?? 'export function register($) {}')
    fs.writeFileSync(p.join(at, '.claude-plugin/plugin.json'), JSON.stringify({ name }))
  }
  if (state.twins) { plugin(p.join(dir, 'plugins/a'), 'twin'); plugin(p.join(dir, 'plugins/b'), 'twin') }
  else {
    plugin(dir, 'cache-fixture')
    fs.writeFileSync(p.join(dir, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'cache-fixture', plugins: [{ name: 'cache-fixture', source: './' }] }))
  }
} else if (args[0] === '-C') {
  if (state.inspectionFailure && args[1].endsWith('fixture__mod') && !args.includes('--verify')) {
    fs.rmSync(args[1], { recursive: true, force: true }); fs.writeFileSync(args[1], 'unreadable checkout')
  }
  console.log(state.revision)
}
else process.exit(1)
`)
  command('claude', `
if (args[0] === '--version') { console.log(state.version + ' (Claude Code)'); process.exit(0) }
if (args[1] !== 'validate') process.exit(1)
const type = args.at(-1).includes('marketplace') ? 'marketplace' : 'plugin'
fs.appendFileSync(process.env.FIXTURE_CALLS, 'validate ' + type + '\\n')
if (state.twins && !state.fail) {
  // plugins/a has an empty footprint, which is also what a crashed validation of plugins/b parses to.
  if (process.cwd().endsWith('/a')) { console.log('  ❯ ./register.ts hooks: nothing\\n  ❯ ./register.ts calls: nothing on $\\n✔ Validation passed'); process.exit(0) }
  if (state.crash === 'twin') process.exit(137)
}
if (state.crash === type) process.exit(137)
if (state.output) console.log('  ❯ ./register.ts hooks: ' + (state.source ? 'ui.render{component=AssistantMessage}' : 'session.start') + '\\n  ❯ ./register.ts calls: ' + state.calls)
if (state.fail === type) { console.log('✘ Found 1 error:\\n  ❯ name: invalid\\n\\n✘ Validation failed'); process.exit(1) }
console.log('✔ Validation passed')
`)
  let runs = 0
  function run({ cache = true, previous, retire = false, required = false } = {}) {
    writeFileSync(stateFile, JSON.stringify(state))
    writeFileSync(callsFile, '')
    const out = join(root, `out-${runs++}.json`)
    if (previous) writeFileSync(out, JSON.stringify(previous))
    const result = spawnSync(process.execPath, [scanner, '--out', out, '--include-checked', ...(cache ? ['--cache', join(root, 'cache.json')] : []), ...(retire ? ['--retire'] : []), ...(required ? ['--required', join(root, 'data/repos.txt')] : [])], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH, TMPDIR: join(root, 'tmp'), FIXTURE_STATE: stateFile, FIXTURE_CALLS: callsFile },
    })
    assert.ifError(result.error)
    if (required) return result
    assert.equal(result.status, 0, result.stderr)
    const data = JSON.parse(readFileSync(out, 'utf8'))
    delete data.generated
    return { data, stderr: result.stderr, calls: readFileSync(callsFile, 'utf8').split('\n').filter(Boolean) }
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

test('incomplete source analysis is retried, blocks seeds and cannot retire earlier records', t => {
  const f = fixture(t)
  const previous = f.run().data
  const missing = { ...previous.mods[0], id: 'fixture/mod:removed', path: 'removed' }
  previous.mods.push(missing)
  f.state.revision = 'b'.repeat(40)
  f.state.source = 'const value=' + '('.repeat(12000) + '1' + ')'.repeat(12000)
  const first = f.run({ previous, retire: true })
  assert.deepEqual(first.data.checkedRepos, [])
  assert.equal(first.data.mods.find(m => m.path === 'removed').validate.status, 'unknown')
  assert.ok(first.data.mods[0].compatibility.warnings.some(w => w.code === 'ui-review-incomplete'))
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'cache.json'))).repos, {})
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'data/retirements.json'))).plugins, [])
  const required = f.run({ required: true })
  assert.notEqual(required.status, 0)
  assert.match(required.stderr, /new seed fixture\/mod must clone successfully/)
  f.state.source = 'const value="safe"'
  const recovered = f.run()
  assert.ok(recovered.calls.includes('clone'))
  assert.deepEqual(recovered.data.checkedRepos, ['fixture/mod'])
  assert.deepEqual(recovered.data.mods[0].compatibility.warnings, [])
  assert.deepEqual(f.run().calls, [])
})

test('a repository inspection failure preserves its records and lets healthy siblings finish', t => {
  const f = fixture(t)
  const previous = f.run().data
  f.state.revision = 'b'.repeat(40)
  f.state.inspectionFailure = true
  writeFileSync(join(f.root, 'data/repos.txt'), 'fixture/mod\nfixture/healthy\n')
  const next = f.run({ previous, retire: true })
  assert.match(next.stderr, /inspection failed: fixture\/mod/)
  assert.deepEqual(next.data.checkedRepos, ['fixture/healthy'])
  const retained = next.data.mods.find(m => m.repo === 'fixture/mod')
  assert.equal(retained.validate.status, 'unknown')
  assert.equal(retained.sourceCommit, previous.mods[0].sourceCommit)
  assert.deepEqual(retained.calls, previous.mods[0].calls)
  assert.equal(next.data.mods.find(m => m.repo === 'fixture/healthy').validate.status, 'passed')
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(f.root, 'cache.json'))).repos), ['fixture/healthy'])
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'data/retirements.json'))).plugins, [])
  assert.notEqual(f.run({ required: true }).status, 0)
  f.state.inspectionFailure = false
  assert.deepEqual(f.run().data.checkedRepos, ['fixture/healthy', 'fixture/mod'])
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

test('a crashed same-name plugin stays recorded and still blocks cache reuse', t => {
  const f = fixture(t)
  f.state.twins = true
  f.state.crash = 'twin'
  assert.deepEqual(f.run().data.mods.map(m => m.path).sort(), ['plugins/a', 'plugins/b'])
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

test('early validation failure never turns network access into L0 and does not hide same-name plugins', t => {
  const f = fixture(t)
  f.state.calls = '$.http.fetch'
  const first = f.run().data.mods[0]
  assert.equal(first.reach.level, 3)
  f.state.revision = 'b'.repeat(40)
  f.state.fail = 'plugin'
  f.state.output = false
  const failed = f.run().data.mods[0]
  assert.equal(failed.sourceCommit, 'b'.repeat(40))
  assert.equal(failed.validate.status, 'failed')
  assert.equal(failed.footprint.status, 'unavailable')
  assert.equal(failed.reach.level, null)
  assert.deepEqual(failed.calls, [])
  assert.deepEqual(f.run().data.mods[0], failed, 'a cache hit keeps the unavailable state')
  f.state.revision = 'c'.repeat(40)
  f.state.twins = true
  const twins = f.run().data.mods
  assert.equal(twins.length, 2)
  assert.ok(twins.every(m => m.validate.status === 'failed' && m.reach.level === null))
  f.state.revision = 'd'.repeat(40)
  f.state.twins = false
  f.state.output = true
  assert.equal(f.run().data.mods[0].reach.level, 3, 'a failure with complete reported calls keeps its reach')
  f.state.revision = 'e'.repeat(40)
  f.state.fail = ''
  f.state.calls = 'nothing on $'
  const recovered = f.run().data.mods[0]
  assert.equal(recovered.footprint.status, 'reported')
  assert.equal(recovered.reach.level, 0)
})

test('cached findings are keyed on the checkout reader, not on code that only shapes records', () => {
  const modules = findingsModules()
  for (const file of ['tools/inspect.mjs', 'tools/validate.mjs', 'tools/parse.mjs', 'tools/compatibility.mjs']) assert.ok(modules.includes(file), file)
  for (const file of ['tools/scan.mjs', 'tools/grade.mjs', 'tools/kind.mjs', 'tools/dedupe.mjs', 'tools/render.mjs']) assert.ok(!modules.includes(file), file)
})

test('truncated successful validation stays unknown through scans, cache and publication filters', t => {
  const f = fixture(t)
  f.state.calls = '$.fs.read, $.http.fet… [+2 chars]'
  const first = f.run().data
  const record = first.mods[0]
  assert.equal(record.validate.status, 'passed')
  assert.equal(record.footprint.status, 'unavailable')
  assert.equal(record.reach.level, null)
  assert.equal(record.reach.minimumLevel, 1)
  assert.deepEqual(record.calls, ['$.fs.read'])
  const index = buildIndex(first)
  assert.equal(getMod(index, record.id).mod.validation.footprint, 'unavailable')
  assert.deepEqual(search(index, {}).results.map(result => result.id), [record.id])
  for (const filter of [{ without: ['network'] }, { max_reach: 1 }, { without: ['every prompt'] }]) {
    assert.deepEqual(search(index, filter).results, [])
  }
  assert.match(reviewSeed(first.mods, first.claudeVersion, new Set()), /footprint unavailable/)
  const cached = f.run()
  assert.deepEqual(cached.calls, [])
  assert.deepEqual(cached.data.mods[0], record)
  assert.notEqual(f.run({ required: true }).status, 0)
  f.state.revision = 'b'.repeat(40)
  f.state.calls = '$.fs.read, $.http.fetch'
  const recovered = f.run().data.mods[0]
  assert.equal(recovered.footprint.status, 'reported')
  assert.equal(recovered.reach.level, 3)
})

test('a new parser release in the lockfile retires cached findings; other dependency changes do not', () => {
  const lockText = readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
  assert.deepEqual(Object.keys(findingsPackages()), ['typescript'])
  const relock = (name, version) => {
    const lock = JSON.parse(lockText)
    lock.packages[`node_modules/${name}`] = { ...lock.packages[`node_modules/${name}`], version }
    return JSON.stringify(lock)
  }
  const key = findingsKey('fixture', lockText)
  assert.notEqual(findingsKey('fixture', relock('typescript', '0.0.1')), key, 'TypeScript bump')
  assert.equal(findingsKey('fixture', relock('playwright', '0.0.1')), key, 'Playwright bump')
})
