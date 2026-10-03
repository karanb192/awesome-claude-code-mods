import { test } from 'node:test'
import assert from 'node:assert/strict'
import { search as discover } from './discover.mjs'
import { createSearchRequest } from './github-search.mjs'
import { mergeRepos, newSeeds, prScanRepos } from './candidates.mjs'
import { reconcile, checkRequired } from './inventory.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const response = items => ({ total_count: items.length, incomplete_results: false, items })
const search = (q, run, attempts = 4, wait = () => {}, pause = 10) => discover(q, createSearchRequest({ run, attempts, wait, pause, random: () => 0, log: () => {} }))
const files = n => Array.from({ length: n }, (_, i) => ({ path: `file-${i}`, repository: { full_name: `owner/repo-${i}` }, size: i * 100 }))
function api(items) {
  return (q, page) => {
    const range = /size:(\d+)\.\.(\d+)/.exec(q)
    const tail = /size:>=(\d+)/.exec(q)
    const found = items.filter(item => range ? item.size >= +range[1] && item.size <= +range[2] : tail ? item.size >= +tail[1] : true)
    return { ...response(found), items: found.slice((page - 1) * 100, page * 100) }
  }
}

test('oversized search partitions retrieve all 1756 files, including boundary sizes', () => {
  const items = files(1756)
  items[1].size = 393215
  items[2].size = 393216
  items[3].size = 196607
  items[4].size = 196608
  const found = search('flag', api(items), 2, () => {})
  assert.equal(new Set(found).size, 1756)
})

test('exactly 1000 files paginate completely and requests are paced', () => {
  const waits = []
  assert.equal(search('flag', api(files(1000)), 2, n => waits.push(n)).length, 1000)
  assert.deepEqual(waits, Array(9).fill(10))
})

test('changing pagination recovers through smaller complete size partitions', () => {
  const items = files(150)
  const found = search('flag', (q, page) => {
    const result = api(items)(q, page)
    if (!q.includes('size:') && page === 2) result.total_count++
    return result
  }, 1, () => {})
  assert.equal(new Set(found).size, 150)
})

test('a saturated single-byte partition fails rather than silently truncating', () => {
  assert.throws(() => search('flag', api(files(1001).map(item => ({ ...item, size: 7 }))), 1, () => {}), /still capped/)
})

test('incomplete responses retry, and persistent incompleteness fails', () => {
  let calls = 0
  const flaky = () => ++calls === 1 ? { ...response([]), incomplete_results: true } : response(files(1))
  assert.equal(search('flag', flaky, 2, () => {}).length, 1)
  assert.equal(calls, 2)
  assert.throws(() => search('flag', () => ({ ...response([]), incomplete_results: true }), 2, () => {}), /incomplete search/)
})

test('pagination cannot silently skip files, repeat files or change total counts', () => {
  const items = files(101)
  assert.throws(() => search('flag', (_, page) => ({ ...response(items), items: page === 1 ? items.slice(0, 100) : [] }), 1, () => {}), /partial pagination/)
  assert.throws(() => search('flag', (_, page) => ({ ...response(items), items: page === 1 ? items.slice(0, 100) : items.slice(0, 1) }), 1, () => {}), /partial pagination/)
  assert.throws(() => search('flag', (_, page) => ({ ...api(items)('flag', page), total_count: page === 1 ? 101 : 102 }), 1, () => {}), /count changed/)
})

test('rate limits respect server hints, retry exhaustion fails and auth errors stop immediately', () => {
  const waits = []
  let calls = 0
  assert.throws(() => search('flag', () => { calls++; throw Object.assign(new Error('try again in 243s'), { status: 429 }) }, 3, n => waits.push(n), 0), /code search failed/)
  assert.equal(calls, 3)
  assert.deepEqual(waits.filter(Boolean), [244, 244])
  calls = 0
  assert.throws(() => search('flag', () => { calls++; throw new Error('HTTP 401') }, 4, () => {}), /401/)
  assert.equal(calls, 1)
})

test('candidate history survives a search omission and PR seeds are case-insensitive', () => {
  assert.deepEqual(mergeRepos(['old/mod'], ['New/Mod'], ['new/mod']), ['New/Mod', 'old/mod'])
  assert.deepEqual(newSeeds(['old/mod'], ['OLD/mod', 'new/mod']), ['new/mod'])
  assert.deepEqual(prScanRepos(['old/mod'], ['old/mod', 'new/mod'], ['new/mod'], true), ['new/mod'])
  assert.deepEqual(prScanRepos(['old/mod'], ['old/mod', 'new/mod'], ['new/mod'], false), ['new/mod', 'old/mod'])
  assert.deepEqual(prScanRepos(['old/mod'], ['old/mod'], [], true), ['old/mod'])
})

const prior = { id: 'old/mod:.', repo: 'old/mod', kind: 'mod', validate: { status: 'passed', claudeVersion: 'old' }, calls: ['$.fs.read'] }
test('daily absence is unverified, fresh weekly absence retires, and failed clones never retire', () => {
  const checked = new Map([['old/mod', 'revision']])
  const daily = reconcile([prior], [], checked)
  assert.equal(daily.mods[0].validate.status, 'unknown')
  assert.deepEqual(daily.mods[0].calls, prior.calls)
  assert.deepEqual(daily.mods[0].lastKnownValidate, prior.validate)
  assert.deepEqual(reconcile([prior], [], checked, true).retired, [{ id: prior.id, repo: prior.repo, revision: 'revision', reason: 'hook module no longer present in a fresh checkout' }])
  assert.equal(reconcile([prior], [], new Map(), true).mods.length, 1)
  const failed = { ...prior, validate: { status: 'failed' } }
  assert.deepEqual(reconcile([prior], [failed], checked, true).mods, [failed])
})

test('new-seed requirements reject absent, failed and unscanned plugins', () => {
  const checked = new Map([['old/mod', 'revision']])
  assert.doesNotThrow(() => checkRequired(['OLD/mod'], [prior], checked))
  assert.throws(() => checkRequired(['old/mod'], [], checked), /new seed/)
  assert.throws(() => checkRequired(['old/mod'], [prior], new Map()), /new seed/)
  assert.throws(() => checkRequired(['old/mod'], [{ ...prior, validate: { status: 'failed' } }], checked), /new seed/)
})

test('scanner CLI retains unavailable entries and rejects an invalid newly submitted seed', t => {
  const root = mkdtempSync(join(tmpdir(), 'discovery-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'data'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'data/repos.txt'), 'old/mod\n')
  writeFileSync(join(root, 'data/required.txt'), 'old/mod\n')
  writeFileSync(join(root, 'data/mods.json'), JSON.stringify({ mods: [prior] }))
  const script = fileURLToPath(new URL('./scan.mjs', import.meta.url))
  const binary = (name, code) => {
    const path = join(root, 'bin', name)
    writeFileSync(path, '#!' + process.execPath + '\n' + code)
    chmodSync(path, 0o755)
  }
  binary('claude', 'console.log("2.1.287")')
  binary('git', 'process.exit(1)')
  const env = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH }
  execFileSync(process.execPath, [script, '--retire'], { cwd: root, env, stdio: 'pipe' })
  assert.equal(JSON.parse(readFileSync(join(root, 'data/mods.json'))).mods[0].validate.status, 'unknown')
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'data/retirements.json'))).repos, [])
  const result = spawnSync(process.execPath, [script, '--required', 'data/required.txt'], { cwd: root, env, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /new seed old\/mod/)

  binary('gh', 'console.log(JSON.stringify({stars:0,defaultBranch:"main"}))')
  binary('git', `
    const fs = require('node:fs'), path = require('node:path');
    if (process.argv[2] === 'clone') {
      const dir = process.argv.at(-1); fs.mkdirSync(dir, {recursive:true});
      if (process.env.TEST_MALFORMED) {
        fs.mkdirSync(path.join(dir,'hooks'));
        fs.writeFileSync(path.join(dir,'hooks/hooks.json'), '{');
      }
    } else console.log('a'.repeat(40));
  `)
  writeFileSync(join(root, 'data/mods.json'), JSON.stringify({ mods: [prior] }))
  execFileSync(process.execPath, [script, '--retire'], { cwd: root, env: { ...env, TEST_MALFORMED: '1' }, stdio: 'pipe' })
  assert.equal(JSON.parse(readFileSync(join(root, 'data/mods.json'))).mods.length, 1)
  assert.equal(readFileSync(join(root, 'data/repos.txt'), 'utf8'), 'old/mod\n')
  execFileSync(process.execPath, [script, '--retire'], { cwd: root, env, stdio: 'pipe' })
  assert.equal(JSON.parse(readFileSync(join(root, 'data/mods.json'))).mods.length, 0)
  const retired = JSON.parse(readFileSync(join(root, 'data/retirements.json')))
  assert.equal(retired.plugins[0].revision, 'a'.repeat(40))
  assert.equal(retired.repos[0].repo, 'old/mod')
  assert.equal(readFileSync(join(root, 'data/repos.txt'), 'utf8'), '\n')
})

test('scanner CLI skips a repository with no commits instead of crashing', t => {
  const root = mkdtempSync(join(tmpdir(), 'discovery-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'data'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'data/repos.txt'), 'old/mod\nempty/repo\n')
  writeFileSync(join(root, 'data/mods.json'), JSON.stringify({ mods: [prior] }))
  const script = fileURLToPath(new URL('./scan.mjs', import.meta.url))
  const binary = (name, code) => {
    const path = join(root, 'bin', name)
    writeFileSync(path, '#!' + process.execPath + '\n' + code)
    chmodSync(path, 0o755)
  }
  binary('claude', 'console.log("2.1.287")')
  binary('gh', 'console.log(JSON.stringify({stars:0,defaultBranch:"main"}))')
  // Both clones succeed; only the empty one has no HEAD to resolve.
  binary('git', `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    if (args[0] === 'clone') { fs.mkdirSync(args.at(-1), {recursive:true}); process.exit(0) }
    if (args.includes('rev-parse') && args.some(a => a.endsWith('empty__repo'))) process.exit(128);
    console.log('a'.repeat(40));
  `)
  const env = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH }
  const result = spawnSync(process.execPath, [script, '--retire'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /clone is empty: empty\/repo/)
  const retired = JSON.parse(readFileSync(join(root, 'data/retirements.json')))
  assert.deepEqual(retired.repos.map(entry => entry.repo), ['old/mod'], 'the empty repository is not retired, only the checked one')
  assert.equal(readFileSync(join(root, 'data/repos.txt'), 'utf8'), 'empty/repo\n')
})
