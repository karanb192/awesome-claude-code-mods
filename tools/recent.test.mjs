import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recentSince, searchRecent, hasHookModules, findRecent, describeRecent, mergeState } from './recent.mjs'
import { metaQuery, metaBatch, ghGraphql } from './meta.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOUR = 3600 * 1000
const now = Date.parse('2026-10-03T12:00:00Z')
const since = '2026-10-03T08:00:00Z'
const repo = (name, pushed = '2026-10-03T10:00:00Z', branch = 'main') => ({ full_name: name, default_branch: branch, pushed_at: pushed })
const quiet = { log: () => {} }

// files: { 'owner/repo': { 'path/hooks/hooks.json': contents } }, or { truncated: true }, or an Error to throw.
function fakeGitHub(files) {
  const calls = []
  const api = path => {
    calls.push(path)
    const tree = /^repos\/(.+?\/.+?)\/git\/trees\//.exec(path)
    const entry = files[tree[1]]
    if (entry instanceof Error) throw entry
    if (!entry) throw Object.assign(new Error('Command failed'), { stderr: 'gh: Not Found (HTTP 404)\n' })
    return entry.truncated ? { truncated: true, tree: [] } : { truncated: false, tree: Object.keys(entry).map(p => ({ type: 'blob', path: p })) }
  }
  const raw = (name, _, path) => {
    const value = files[name][path]
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  return { api, raw, calls }
}
const searchReturning = (...items) => () => ({ total_count: items.length, items })
const limited = () => Object.assign(new Error('Command failed'), { stderr: 'gh: API rate limit exceeded for installation. (HTTP 403)\n' })

test('the search window starts an hour before the checkpoint and never reaches back past a week', () => {
  assert.equal(recentSince('2026-10-03T09:00:00Z', now), '2026-10-03T08:00:00Z')
  assert.equal(recentSince('2026-09-20T00:00:00Z', now), '2026-09-26T12:00:00Z')
  assert.equal(recentSince(null, now), '2026-09-26T12:00:00Z')
})

// A search API over a fixed set of repos that honours pushed:A..B and returns one page of 100.
function timeline(items) {
  const asked = []
  const request = query => {
    asked.push(query)
    const [, lo, hi] = /pushed:(\S+)\.\.(\S+)$/.exec(query)
    const hits = items.filter(i => Date.parse(i.pushed_at) >= Date.parse(lo) && Date.parse(i.pushed_at) <= Date.parse(hi))
    return { total_count: hits.length, items: hits.slice(0, 100) }
  }
  return { request, asked }
}
const spread = (n, from, minutes) => Array.from({ length: n }, (_, i) => repo(`owner/mod-${i}`, new Date(Date.parse(from) + Math.floor(i * minutes * 60000 / n)).toISOString().replace(/\.\d{3}Z$/, 'Z')))

test('a window with more than 1,000 matches is split by push time until every slice fits one page', () => {
  const items = spread(1001, '2026-10-03T08:00:00Z', 240)
  const { request, asked } = timeline(items)
  const result = searchRecent(since, '2026-10-03T12:00:00Z', request, { queries: ['topic:claude-code-mod'], ...quiet })
  assert.equal(result.repos.length, 1001)
  assert.deepEqual(result.incomplete, [])
  assert.ok(asked.length > 10)
  assert.ok(asked.every(query => /^topic:claude-code-mod pushed:\S+Z\.\.\S+Z$/.test(query)))
})

test('every query runs, and repos are merged case-insensitively with their branch and push time', () => {
  const { request, asked } = timeline([repo('Owner/Mod'), repo('owner/mod'), repo('owner/extra', '2026-10-03T09:00:00Z', 'trunk')])
  const result = searchRecent(since, '2026-10-03T12:00:00Z', request, quiet)
  assert.equal(asked.length, 7)
  assert.ok(asked.every(query => query.endsWith(' pushed:2026-10-03T08:00:00Z..2026-10-03T12:00:00Z')))
  assert.deepEqual(result.repos, [{ repo: 'Owner/Mod', branch: 'main', pushedAt: '2026-10-03T10:00:00Z' }, { repo: 'owner/extra', branch: 'trunk', pushedAt: '2026-10-03T09:00:00Z' }])
})

test('a slice that cannot be split or a short page leaves the search incomplete and the checkpoint in place', () => {
  const crowded = Array.from({ length: 150 }, (_, i) => repo(`busy/repo-${i}`, '2026-10-03T09:00:00Z'))
  const result = searchRecent(since, '2026-10-03T12:00:00Z', timeline(crowded).request, { queries: ['q'], ...quiet })
  assert.equal(result.repos.length, 100)
  assert.match(result.incomplete[0], /^q pushed:2026-10-03T09:00:00Z\.\.2026-10-03T09:00:00Z still matched 150 repositories$/)
  const short = searchRecent(since, '2026-10-03T12:00:00Z', () => ({ total_count: 5, items: [repo('a/b')] }), { queries: ['q'], ...quiet })
  assert.match(short.incomplete[0], /returned 1 of 5 repositories/)
  assert.throws(() => searchRecent(since, '2026-10-03T12:00:00Z', () => ({ total_count: 1, items: [{}] }), { queries: ['q'] }), /invalid search item/)
  const state = { searchedThrough: '2026-10-03T09:00:00Z', checked: {}, deferred: [], pending: [] }
  const capped = findRecent(since, [], { state, request: timeline(crowded).request, api: () => ({ tree: [] }), startedAt: '2026-10-03T12:00:00Z', ...quiet })
  assert.equal(capped.state.searchedThrough, '2026-10-03T09:00:00Z')
  assert.match(describeRecent(since, capped)[0], /did not finish, so the checkpoint stays at 2026-10-03T09:00:00Z\. 7 time slices were incomplete/)
})

test('without a stored checkpoint, a failed search records the boundary it used', () => {
  const failing = () => { throw new Error('repository search failed') }
  const result = findRecent('2026-10-02T01:16:04Z', [], { request: failing, ...quiet })
  assert.equal(result.state.searchedThrough, '2026-10-02T02:16:04Z')
  assert.equal(recentSince(result.state.searchedThrough, now), '2026-10-02T01:16:04Z')
})

test('progress from the last run merges with main without losing work', () => {
  const main = { searchedThrough: '2026-10-03T06:00:00Z', checked: { 'a/one': '2026-10-03T05:00:00Z' }, deferred: [{ repo: 'd/one' }], pending: ['p/one'] }
  const cache = { searchedThrough: '2026-10-03T09:00:00Z', checked: { 'a/one': '2026-10-03T08:00:00Z', 'a/two': 'x' }, deferred: [{ repo: 'D/One' }, { repo: 'd/two' }], pending: ['P/One', 'p/two'] }
  const merged = mergeState(main, cache)
  assert.equal(merged.searchedThrough, '2026-10-03T09:00:00Z')
  assert.deepEqual(merged.checked, { 'a/one': '2026-10-03T08:00:00Z', 'a/two': 'x' })
  assert.deepEqual(merged.deferred.map(c => c.repo), ['D/One', 'd/two'])
  assert.deepEqual(merged.pending, ['P/One', 'p/two'])
  assert.equal(mergeState({ ...main, searchedThrough: null }, cache).searchedThrough, '2026-10-03T09:00:00Z')
  assert.equal(mergeState(main, { ...cache, searchedThrough: null }).searchedThrough, '2026-10-03T06:00:00Z')
})

test('only a hooks.json in a hooks folder that lists modules makes a candidate, at one API call per repo', () => {
  const { api, raw, calls } = fakeGitHub({
    'a/mod': { 'plugins/x/hooks/hooks.json': { modules: ['./ui.ts'] } },
    'a/shell': { 'hooks/hooks.json': { hooks: { PreToolUse: [] } } },
    'a/vendored': { 'node_modules/pkg/hooks/hooks.json': { modules: ['x'] } },
    'a/wrong-folder': { 'config/hooks.json': { modules: ['x'] } },
    'a/empty': { 'hooks/hooks.json': { modules: [] } },
    'a/broken': { 'hooks/hooks.json': '{' },
    'a/huge': { truncated: true },
  })
  const check = name => hasHookModules({ repo: name, branch: 'main' }, api, raw)
  assert.deepEqual(['a/mod', 'a/shell', 'a/vendored', 'a/wrong-folder', 'a/empty', 'a/broken', 'a/huge'].map(check), [true, false, false, false, false, true, true])
  assert.equal(calls.length, 7)
  assert.equal(hasHookModules({ repo: 'a/mod', branch: 'main' }, api, () => { throw new Error('curl: (22) 404') }), true)
})

test('a search that does not finish keeps the checkpoint, and known repos are never checked', () => {
  const { api, raw, calls } = fakeGitHub({ 'new/mod': { 'hooks/hooks.json': { modules: ['m'] } } })
  const state = { searchedThrough: '2026-10-03T07:00:00Z', checked: {}, deferred: [{ repo: 'new/mod', branch: 'main', pushedAt: '2026-10-03T06:00:00Z' }], pending: [] }
  const request = () => { throw new Error('repository search failed for topic:claude-code-mod: retry attempts exhausted') }
  const result = findRecent(since, ['known/mod'], { state, request, api, raw, startedAt: '2026-10-03T12:00:00Z', ...quiet })
  assert.equal(result.state.searchedThrough, '2026-10-03T07:00:00Z')
  assert.deepEqual(result.found, ['new/mod'])
  assert.equal(result.report.complete, false)
  assert.match(describeRecent(since, result)[0], /did not finish, so the checkpoint stays at 2026-10-03T07:00:00Z/)
  const ok = findRecent(since, ['known/mod'], { request: searchReturning(repo('Known/Mod')), api, raw, startedAt: '2026-10-03T12:00:00Z', ...quiet })
  assert.equal(ok.state.searchedThrough, '2026-10-03T12:00:00Z')
  assert.ok(!calls.some(path => path.startsWith('repos/Known')))
})

test('a repo past the check limit is deferred and checked first on the next run, even outside the window', () => {
  const nonMods = Array.from({ length: 3 }, (_, i) => repo(`plain/plugin-${i}`))
  const files = Object.fromEntries(nonMods.map(r => [r.full_name, { 'README.md': '' }]))
  files['late/mod'] = { 'hooks/hooks.json': { modules: ['m'] } }
  const { api, raw } = fakeGitHub(files)
  const first = findRecent(since, [], { request: searchReturning(...nonMods, repo('late/mod')), api, raw, limit: 3, startedAt: '2026-10-03T12:00:00Z', ...quiet })
  assert.deepEqual(first.found, [])
  assert.deepEqual(first.state.deferred.map(c => c.repo), ['late/mod'])
  assert.equal(Object.keys(first.state.checked).length, 3)
  assert.equal(first.state.searchedThrough, '2026-10-03T12:00:00Z')

  const asked = []
  const second = findRecent('2026-10-03T11:00:00Z', [], { state: first.state, request: q => { asked.push(q); return { total_count: 0, items: [] } }, api, raw, limit: 3, ...quiet })
  assert.deepEqual(second.found, ['late/mod'])
  assert.deepEqual(second.state.deferred, [])
  assert.ok(asked.length > 0)
})

test('a repo found not to be a mod is checked again only after a new push, and old entries are pruned', () => {
  const { api, raw, calls } = fakeGitHub({ 'plain/plugin': { 'README.md': '' } })
  const first = findRecent(since, [], { request: searchReturning(repo('plain/plugin', '2026-10-03T09:00:00Z')), api, raw, ...quiet })
  assert.deepEqual(first.state.checked, { 'plain/plugin': '2026-10-03T09:00:00Z' })
  findRecent(since, [], { state: first.state, request: searchReturning(repo('plain/plugin', '2026-10-03T09:00:00Z')), api, raw, ...quiet })
  assert.equal(calls.length, 1)
  findRecent(since, [], { state: first.state, request: searchReturning(repo('plain/plugin', '2026-10-03T11:00:00Z')), api, raw, ...quiet })
  assert.equal(calls.length, 2)
  const later = findRecent('2026-10-03T10:00:00Z', [], { state: first.state, request: searchReturning(), api, raw, ...quiet })
  assert.deepEqual(later.state.checked, {})
})

test('a rate limit stops checking and defers the rest; empty repos are not retried; other failures are', () => {
  const { api, raw, calls } = fakeGitHub({
    'gone/repo': Object.assign(new Error('Command failed'), { stderr: 'gh: Git Repository is empty. (HTTP 409)\n' }),
    'flaky/repo': new Error('socket hang up'),
    'limited/repo': limited(),
    'after/repo': { 'hooks/hooks.json': { modules: ['m'] } },
  })
  const logs = []
  const result = findRecent(since, [], { request: searchReturning(repo('gone/repo'), repo('flaky/repo'), repo('limited/repo'), repo('after/repo')), api, raw, log: line => logs.push(line) })
  assert.deepEqual(result.found, [])
  assert.deepEqual(result.state.deferred.map(c => c.repo), ['flaky/repo', 'limited/repo', 'after/repo'])
  assert.deepEqual(Object.keys(result.state.checked), ['gone/repo'])
  assert.equal(calls.length, 3)
  assert.equal(result.report.failed, 1)
  assert.match(result.report.stopped, /API rate limit exceeded/)
  assert.ok(logs.includes('skipped gone/repo: gh: Git Repository is empty. (HTTP 409)'))
  const lines = describeRecent(since, result)
  assert.match(lines[0], /matched 4 repositories; 4 needed a check, 3 were checked, 3 wait for the next run and 1 failed/)
  assert.match(lines[1], /Checking stopped at the API rate limit/)
})

test('the API budget caps checks below the limit and defers the rest', () => {
  const { api, raw, calls } = fakeGitHub({ 'a/one': { 'README.md': '' }, 'a/two': { 'README.md': '' } })
  const result = findRecent(since, [], { request: searchReturning(repo('a/one'), repo('a/two')), api, raw, limit: 200, budget: 1, ...quiet })
  assert.equal(calls.length, 1)
  assert.deepEqual(result.state.deferred.map(c => c.repo), ['a/two'])
})

test('scan metadata comes in GraphQL batches and missing repos fall back', () => {
  assert.match(metaQuery(['a/b', 'c/d.e']), /^query \{ r0: repository\(owner: "a", name: "b"\) \{ .* \} r1: repository\(owner: "c", name: "d.e"\)/)
  const queries = []
  const node = { nameWithOwner: 'A/One', stargazerCount: 5, pushedAt: 'p', createdAt: 'c', description: 'd', isArchived: true, licenseInfo: { spdxId: 'MIT' }, defaultBranchRef: { name: 'trunk' } }
  const metas = metaBatch(['A/one', 'a/missing', 'a/three'], { size: 2, log: () => {}, run: query => { queries.push(query); return queries.length === 1 ? { r0: node, r1: null } : { r0: { ...node, licenseInfo: null, defaultBranchRef: null } } } })
  assert.equal(queries.length, 2)
  assert.deepEqual(metas.get('a/one'), { stars: 5, pushedAt: 'p', createdAt: 'c', license: 'MIT', description: 'd', defaultBranch: 'trunk', archived: true, fullName: 'A/One' })
  assert.equal(metas.has('a/missing'), false)
  assert.equal(metas.get('a/three').defaultBranch, null)
  assert.equal(metaBatch(['a/b'], { log: () => {}, run: () => { throw new Error('boom') } }).size, 0)
  assert.deepEqual(ghGraphql('q', () => { throw Object.assign(new Error('gh exit 1'), { stdout: '{"data":{"r0":null},"errors":[{"type":"NOT_FOUND"}]}' }) }), { r0: null })
})

function cli(t, gh, args, { state, restore, env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'discovery-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'data'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'data/repos.txt'), 'existing/mod\n')
  writeFileSync(join(root, 'data/seeds.txt'), 'seeded/mod\n')
  writeFileSync(join(root, 'data/mods.json'), JSON.stringify({ generated: new Date(Date.now() - 2 * HOUR).toISOString(), mods: [] }))
  if (state) writeFileSync(join(root, 'data/discovery.json'), JSON.stringify(state))
  if (restore) { writeFileSync(join(root, 'restored.json'), restore); args = [...args, '--restore', join(root, 'restored.json')] }
  const binary = (name, code) => { writeFileSync(join(root, 'bin', name), '#!' + process.execPath + '\n' + code); chmodSync(join(root, 'bin', name), 0o755) }
  binary('gh', gh)
  binary('curl', `const url = process.argv.at(-1); if (url.includes('/fresh/mod/')) console.log('{"modules":["./m.ts"]}'); else process.exit(22)`)
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./discover.mjs', import.meta.url)), ...args, '--note', join(root, 'note.txt')], {
    cwd: root, env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH, GH_LOG: join(root, 'gh.log'), ...env }, encoding: 'utf8', timeout: 60000,
  })
  const read = name => { try { return readFileSync(join(root, name), 'utf8') } catch { return '' } }
  return { run, repos: read('data/repos.txt'), note: read('note.txt'), gh: read('gh.log'), state: read('data/discovery.json') }
}

const limitedGh = `
require('node:fs').appendFileSync(process.env.GH_LOG, process.argv.slice(2).join(' ') + '\\n')
console.log('HTTP/2.0 429 Too Many Requests\\nRetry-After: 1801\\n\\n{"message":"slow down"}'); process.exit(1)
`

test('a rate-limited code search keeps known candidates and seeds when asked to', t => {
  const { run, repos, note } = cli(t, limitedGh, ['--keep-on-failure'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(repos, 'existing/mod\nseeded/mod\n')
  assert.match(note, /^Code search did not finish, so discovery kept the known candidates and seeds\. code search failed/)
})

const searchGh = `
const fs = require('node:fs'), args = process.argv.slice(2)
fs.appendFileSync(process.env.GH_LOG, args.join(' ') + '\\n')
const json = value => console.log(JSON.stringify(value))
const items = JSON.parse(process.env.SEARCH_ITEMS)
if (args.includes('search/code')) { console.log('HTTP/2.0 500 Internal\\n\\n{"message":"code search must not run"}'); process.exit(1) }
if (args.includes('rate_limit')) console.log(5000)
else if (args.includes('search/repositories')) console.log('HTTP/2.0 200 OK\\n\\n' + JSON.stringify({ total_count: items.length, incomplete_results: false, items }))
else if (args[1].startsWith('repos/fresh/mod/git/trees/')) json({ truncated: false, tree: [{ type: 'blob', path: 'hooks/hooks.json' }] })
else if (args[1].startsWith('repos/fresh/plugin/git/trees/')) json({ truncated: false, tree: [{ type: 'blob', path: 'README.md' }] })
else process.exit(1)
`
const freshItems = [
  { full_name: 'fresh/mod', default_branch: 'main', pushed_at: '2026-10-03T09:00:00Z' },
  { full_name: 'fresh/plugin', default_branch: 'main', pushed_at: '2026-10-03T09:30:00Z' },
  { full_name: 'Existing/Mod', default_branch: 'main', pushed_at: '2026-10-03T09:00:00Z' },
]

test('a fast refresh skips code search, adds recent repos with hook modules and saves its progress', t => {
  const before = Date.now()
  const checkpoint = new Date(Math.floor(before / 1000) * 1000 - 2 * 3600_000).toISOString().replace('.000Z', 'Z')
  const since = new Date(Date.parse(checkpoint) - 3600_000).toISOString().replace('.000Z', 'Z')
  const items = freshItems.map(item => ({ ...item, pushed_at: checkpoint }))
  const state = { searchedThrough: checkpoint, checked: {}, deferred: [], pending: [] }
  const { run, repos, note, gh: log, state: saved } = cli(t, searchGh, ['--skip-code-search', '--recent', '--search-pause', '0'], { state, env: { SEARCH_ITEMS: JSON.stringify(items) } })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(repos, 'existing/mod\nfresh/mod\nseeded/mod\n')
  assert.ok(!log.includes('search/code'))
  assert.ok(log.includes(`q=topic:claude-code-mod pushed:${since}..`))
  assert.equal(note, `Code search was skipped; this run covers known candidates and seeds.\nRepository search since ${since} matched 3 repositories; 2 needed a check, 2 were checked, 0 wait for the next run and 0 failed.\nAdded fresh/mod.\n`)
  const progress = JSON.parse(saved)
  assert.ok(Date.parse(progress.searchedThrough) >= before - 1000)
  assert.deepEqual(progress.checked, { 'fresh/plugin': checkpoint })
  assert.deepEqual(progress.deferred, [])
  assert.deepEqual(progress.pending, ['fresh/mod'])
})

test('two fresh checkouts with no merge between them continue from the restored progress', t => {
  const env = { SEARCH_ITEMS: JSON.stringify(freshItems.slice(0, 2).reverse()) }
  const first = cli(t, searchGh, ['--skip-code-search', '--recent', '--search-pause', '0', '--check-limit', '1'], { env })
  assert.equal(first.run.status, 0, first.run.stderr)
  assert.deepEqual(JSON.parse(first.state).deferred.map(c => c.repo), ['fresh/mod'])

  const second = cli(t, searchGh, ['--skip-code-search', '--recent', '--search-pause', '0', '--check-limit', '1'], { env, restore: first.state })
  assert.equal(second.run.status, 0, second.run.stderr)
  assert.equal(second.repos, 'existing/mod\nfresh/mod\nseeded/mod\n')
  assert.ok(!second.gh.includes('repos/fresh/plugin/git/trees'))

  const third = cli(t, searchGh, ['--skip-code-search', '--recent', '--search-pause', '0'], { env: { SEARCH_ITEMS: '[]' }, restore: second.state })
  assert.equal(third.run.status, 0, third.run.stderr)
  assert.equal(third.repos, 'existing/mod\nfresh/mod\nseeded/mod\n')
  assert.match(third.note, /Carried over from earlier runs: fresh\/mod\./)
})

test('a full crawl followed by a fresh fast run without a merge keeps both runs\' additions', t => {
  const codeGh = `
const fs = require('node:fs'), args = process.argv.slice(2)
fs.appendFileSync(process.env.GH_LOG, args.join(' ') + '\\n')
if (args.includes('rate_limit')) console.log(5000)
else if (args.includes('search/code')) console.log('HTTP/2.0 200 OK\\n\\n' + JSON.stringify({ total_count: 1, incomplete_results: false, items: [{ path: 'hooks/hooks.json', repository: { full_name: 'new/code-found-mod' } }] }))
else if (args.includes('search/repositories')) console.log('HTTP/2.0 200 OK\\n\\n' + JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }))
else process.exit(1)
`
  const full = cli(t, codeGh, ['--recent', '--keep-on-failure', '--search-pause', '0'])
  assert.equal(full.run.status, 0, full.run.stderr)
  assert.deepEqual(JSON.parse(full.state).pending, ['new/code-found-mod'])

  const fast = cli(t, searchGh, ['--skip-code-search', '--recent', '--search-pause', '0'], { env: { SEARCH_ITEMS: JSON.stringify(freshItems) }, restore: full.state })
  assert.equal(fast.run.status, 0, fast.run.stderr)
  assert.equal(fast.repos, 'existing/mod\nfresh/mod\nnew/code-found-mod\nseeded/mod\n')
  assert.deepEqual(JSON.parse(fast.state).pending, ['fresh/mod', 'new/code-found-mod'])
})

test('a failed repository search still writes the known candidates and keeps the checkpoint', t => {
  const state = { searchedThrough: '2026-10-03T09:00:00Z', checked: {}, deferred: [], pending: [] }
  const { run, repos, note, state: saved } = cli(t, limitedGh, ['--skip-code-search', '--recent'], { state })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(repos, 'existing/mod\nseeded/mod\n')
  assert.match(note, /Repository search did not finish, so the checkpoint stays at 2026-10-03T09:00:00Z\. repository search failed for topic:claude-code-mod/)
  assert.equal(JSON.parse(saved).searchedThrough, '2026-10-03T09:00:00Z')
})
