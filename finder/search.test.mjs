import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSnapshot, buildIndex, search, getMod, InputError, MAX_LIMIT, REFRESH_AFTER_MS, MAX_STALE_MS } from './search.mjs'
import { parseValidateOutput } from '../tools/parse.mjs'
import { visibility } from '../tools/grade.mjs'

const mod = (id, over = {}) => {
  const [repo, path] = id.split(':')
  return {
    id, repo, path, name: path.split('/').pop(), description: '', kind: 'mod', sourceCommit: 'c'.repeat(40), defaultBranch: 'main',
    url: `https://github.com/${repo}/tree/main/${path}`, modules: ['./register.ts'], hooks: [], calls: [], marketplaces: [],
    validate: { status: 'passed', claudeVersion: '2.1.296', errors: [] }, compatibility: { runtime: 'not-tested', warnings: [] },
    reach: { level: 0, name: 'draws and remembers', labels: ['draws'] }, sees: [], draws: ['Pane'], stars: 1, directory: null, ...over,
  }
}
const net = { level: 3, name: 'network', labels: ['network', 'draws'] }
const DATA = {
  generated: '2026-10-11T09:26:34.682Z', claudeVersion: '2.1.296', repos: 9, mods: [
    mod('a/reviews:mods/review-desk', { description: 'Shows the staged diff for review.' }),
    mod('b/tools:mods/diff-pane', { description: 'A pane for code review of pull requests.', stars: 500 }),
    mod('c/claude-code-mods:mods/clock', { description: 'A clock above the prompt.' }),
    mod('d/cache:plugin', { name: 'cache-meter', description: 'Prompt cache time left.', reach: net }),
    mod('e/cache:.', { name: 'cache-watch', description: 'Watches the prompt cache.' }),
    mod('f/cache:.', { name: 'cache-guess', description: 'Cache countdown.', validate: { status: 'unknown', claudeVersion: '2.1.291', errors: ['Not found in this scan'] } }),
    mod('g/eye:.', { name: 'cache-eye', description: 'Cache stats from every prompt.', sees: ['every prompt'] }),
    ...['one', 'two', 'three'].map(n => mod(`h/pack:mods/review-${n}`, { description: 'Review helper.', stars: 9000 })),
    mod('i/copy:mods/review-desk', { kind: 'duplicate', duplicateOf: 'a/reviews:mods/review-desk' }),
    mod('j/fixtures:test/review-fixture', { kind: 'fixture' }),
    mod('k/market:.', { name: 'market-mod', marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'k-market', status: 'passed', errors: [] }] }),
  ],
}
const index = buildIndex(DATA, { commit: 'f'.repeat(40), sha256: 'abc', fetchedAt: Date.parse('2026-10-11T10:00:00Z') })
const ids = out => out.results.map(r => r.id)

test('name matches outrank description matches, and filler words match nothing', () => {
  const out = search(index, { query: 'find me a code review mod' })
  assert.ok(ids(out).indexOf('a/reviews:mods/review-desk') < ids(out).indexOf('b/tools:mods/diff-pane'), 'a name match beats more stars')
  assert.ok(!ids(out).includes('c/claude-code-mods:mods/clock'), '"code" and "mods" in a repository name are not matches')
  assert.ok(!ids(out).some(id => id.startsWith('i/') || id.startsWith('j/')), 'duplicates and fixtures are not search results')
  assert.deepEqual(out.results.find(r => r.id === 'a/reviews:mods/review-desk').matched, ['review (name)'])
})

test('"pull request" and "PR" are the same words', () => {
  assert.ok(ids(search(index, { query: 'PR viewer' })).includes('b/tools:mods/diff-pane'))
})

test('access filters drop mods with the access and mods whose footprint is unverified', () => {
  const out = search(index, { query: 'cache', without: ['network', 'every prompt'] })
  assert.deepEqual(ids(out), ['e/cache:.'])
  assert.match(out.notes[0], /not proof/)
  const loose = search(index, { query: 'cache', without: ['network'], include_unverified: true })
  assert.deepEqual(ids(loose).sort(), ['e/cache:.', 'f/cache:.', 'g/eye:.'])
  assert.equal(loose.results.find(r => r.id === 'f/cache:.').validation.footprint, 'unverified')
  assert.deepEqual(ids(search(index, { query: 'cache', max_reach: 2 })).sort(), ['e/cache:.', 'g/eye:.'])
})

test('access filters leave out mods with calls the scan could not classify', () => {
  // The shape of vinta/hal-9000:plugins/hal-grammar-check: it calls $.process.spawn, which the grader has no
  // rule for, so its labels and level 1 say nothing about running processes.
  const spawner = mod('l/hal:plugins/grammar-check', { description: 'Grammar check.', reach: { level: 1, name: 'reads', labels: ['other: $.process.spawn', 'draws'] } })
  const plain = mod('m/plain:.', { name: 'grammar-pane', description: 'Grammar tips.' })
  const odd = buildIndex({ generated: DATA.generated, mods: [spawner, plain] })
  for (const filter of [{ without: ['runs processes'] }, { max_reach: 1 }]) {
    const out = search(odd, { query: 'grammar', ...filter })
    assert.deepEqual(ids(out), ['m/plain:.'], JSON.stringify(filter))
    assert.match(out.notes.join(' '), /Left out 1 mod that otherwise matched \(1 with calls the scan could not classify\)/)
  }
  const loose = search(odd, { query: 'grammar', without: ['runs processes'], include_unverified: true })
  assert.deepEqual(ids(loose).sort(), ['l/hal:plugins/grammar-check', 'm/plain:.'])
  assert.deepEqual(loose.results.find(r => r.id === 'l/hal:plugins/grammar-check').access.unclassified_calls, ['$.process.spawn'])
  assert.deepEqual(ids(search(odd, { query: 'grammar' })).sort(), ['l/hal:plugins/grammar-check', 'm/plain:.'], 'no filter, no exclusion')
  const none = search(odd, { query: 'grammar check', without: ['runs processes'], repo: 'l/hal' })
  assert.ok(!none.notes.some(n => /Nothing matched/.test(n)), 'a held-back match is not reported as no match')
  for (const filter of [{ max_reach: 3 }, { without: ['every prompt'] }]) {
    assert.equal(search(odd, { query: 'grammar', ...filter }).total, 2, `${JSON.stringify(filter)} cannot be broken by an unclassified call`)
  }
  assert.throws(() => search(odd, { query: 'grammar', without: ['runs processes'], include_unverified: 'false' }), /include_unverified must be true or false/)
})

test('sees filters read the hooks, not only the sees labels', () => {
  const hook = (event, matcher = {}) => ({ event, matcher })
  const watcher = (id, hooks, sees = []) => mod(id, { name: `${id.split('/')[0]}-watch`, description: 'Watches tools.', hooks, sees })
  const odd = buildIndex({ generated: DATA.generated, mods: [
    watcher('star/a:.', [hook('*')], ['everything']),
    watcher('classic/a:.', [hook('classic.PreToolUse')], ['classic hooks']),
    // The validator's own form for /^[\s\S]*$/: the source is a JSON string, so its backslashes are escaped.
    watcher('allre/a:.', [hook('tool.call', { tool: String.raw`/"^[\\s\\S]*$"/` })], [String.raw`/"^[\\s\\S]*$"/ calls`]),
    watcher('badre/a:.', [hook('tool.call', { tool: String.raw`/"^[\s"/` })]),
    watcher('narrow/a:.', [hook('tool.call', { tool: '/"^mcp__"/' }), hook('tool.call', { tool: 'Edit|Write' }), hook('classic.PostToolUse', { tool_name: 'Bash' })], ['/"^mcp__"/ calls']),
    watcher('dynamic/a:.', [hook('tool.call', { tool: '?' })], ['? calls']),
    watcher('prompt/a:.', [hook('classic.UserPromptSubmit')], ['classic hooks']),
  ] })
  const out = search(odd, { query: 'watch', without: ['every tool call'] })
  assert.deepEqual(ids(out).sort(), ['narrow/a:.', 'prompt/a:.'])
  assert.match(out.notes.join(' '), /2 with hooks whose reach the scan could not pin down/)
  assert.ok(ids(search(odd, { query: 'watch', without: ['every tool call'], include_unverified: true })).includes('dynamic/a:.'))
  assert.deepEqual(ids(search(odd, { query: 'watch', without: ['every prompt'] })).sort(), ['allre/a:.', 'badre/a:.', 'classic/a:.', 'dynamic/a:.', 'narrow/a:.'])
  assert.ok(!ids(search(odd, { query: 'watch', without: ['the system prompt'] })).includes('star/a:.'))
})

test('a match-all regex straight from claude plugin validate counts as seeing every tool call', () => {
  // Captured from claude plugin validate 2.1.296 for on('tool.call', { tool: /^[\s\S]*$/ }, ...).
  const printed = String.raw`  ❯ ./register.ts hooks: tool.call{tool=/"^[\\s\\S]*$"/}
  ❯ ./register.ts calls: nothing on $

✔ Validation passed`
  const { status, modules } = parseValidateOutput(printed)
  const hooks = modules.flatMap(m => m.hooks)
  const all = mod('re/all:.', { name: 'regex-watch', description: 'Watches tools.', hooks, sees: visibility(hooks), validate: { status, claudeVersion: '2.1.296', errors: [] } })
  const odd = buildIndex({ generated: DATA.generated, mods: [all] })
  assert.equal(search(odd, { query: 'watch' }).total, 1)
  const out = search(odd, { query: 'watch', without: ['every tool call'] })
  assert.equal(out.total, 0)
  assert.ok(!out.notes.some(n => /Left out/.test(n)), 'excluded outright, not held as unclear')
})

test('one repository fills at most two places before other repositories get theirs', () => {
  const out = search(index, { query: 'review' })
  const firstFour = ids(out).slice(0, 4)
  assert.equal(firstFour.filter(id => id.startsWith('h/')).length, 2)
  const thirdFromPack = ids(out).filter(id => id.startsWith('h/'))[2]
  assert.ok(ids(out).indexOf(thirdFromPack) > ids(out).indexOf('b/tools:mods/diff-pane'), 'the third result from one pack waits behind the other repositories')
  assert.equal(search(index, { query: 'review', repo: 'h/pack' }).total, 3)
})

test('pages are bounded and cursors walk the whole result set', () => {
  const seen = []
  let cursor
  do {
    const out = search(index, { query: 'review', limit: 2, cursor })
    assert.ok(out.results.length <= 2)
    seen.push(...ids(out))
    cursor = out.next_cursor
  } while (cursor)
  assert.equal(seen.length, search(index, { query: 'review' }).total)
  assert.equal(new Set(seen).size, seen.length)
  for (const bad of [{ limit: 0 }, { limit: MAX_LIMIT + 1 }, { max_reach: 4 }, { cursor: 'x' }, { without: ['nonsense'] }]) {
    assert.throws(() => search(index, { query: 'review', ...bad }), InputError)
  }
})

test('a query that matches nothing says so', () => {
  const out = search(index, { query: 'xyzzy' })
  assert.equal(out.total, 0)
  assert.match(out.notes.join(' '), /Nothing matched/)
})

test('every answer names the snapshot it came from', () => {
  const { snapshot } = search(index, { query: 'review' })
  assert.deepEqual(snapshot, { commit: 'f'.repeat(40), sha256: 'abc', scanned: DATA.generated, claude_version: '2.1.296', fetched_at: '2026-10-11T10:00:00.000Z' })
})

test('lookups resolve copies, repositories, old IDs and case', () => {
  const copy = getMod(index, 'i/copy:mods/review-desk')
  assert.equal(copy.status, 'duplicate')
  assert.equal(copy.mod.id, 'a/reviews:mods/review-desk')
  assert.equal(getMod(index, 'A/Reviews:mods/review-desk').mod.id, 'a/reviews:mods/review-desk')
  assert.match(getMod(index, 'j/fixtures:test/review-fixture').mod.note, /not counted/)
  const repo = getMod(index, 'h/pack')
  assert.equal(repo.status, 'repository')
  assert.equal(repo.ids.length, 3)
  const gone = getMod(index, 'old-owner/reviews:mods/review-desk')
  assert.equal(gone.status, 'not_found')
  assert.equal(gone.suggestions[0].id, 'a/reviews:mods/review-desk')
  assert.throws(() => getMod(index, ''), InputError)
})

test('lookups by owner and name, or name alone, resolve when unique and list when not', () => {
  const byOwner = getMod(index, 'd/cache-meter')
  assert.equal(byOwner.matched_by, 'owner and name')
  assert.equal(byOwner.mod.id, 'd/cache:plugin')
  assert.equal(getMod(index, 'cache-watch').mod.id, 'e/cache:.')
  assert.equal(getMod(index, 'review-desk').mod.id, 'a/reviews:mods/review-desk', 'its duplicate does not make the name ambiguous')
  const twins = buildIndex({ ...DATA, mods: [mod('x/one:.', { name: 'twin' }), mod('y/two:.', { name: 'twin' })] })
  const many = getMod(twins, 'twin')
  assert.equal(many.status, 'ambiguous')
  assert.deepEqual(many.ids.map(x => x.id), ['x/one:.', 'y/two:.'])
})

test('details carry evidence links pinned to the scanned commit and an install hint only when the scan saw one', () => {
  const { mod: m } = getMod(index, 'k/market:.')
  assert.equal(m.install.command, '/plugin install market-mod --marketplace k/market')
  assert.equal(m.manifest, `https://github.com/k/market/blob/${'c'.repeat(40)}/.claude-plugin/plugin.json`)
  assert.equal(getMod(index, 'e/cache:.').mod.install, null)
})

// A stand-in for raw.githubusercontent.com and the GitHub API that counts requests.
function server({ commit = 'a'.repeat(40), body = JSON.stringify(DATA), apiDown = false, rawDown = false, etag = '"v1"' } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push(url)
    if (url.startsWith('https://api.test/')) {
      if (apiDown) return new Response('limited', { status: 403 })
      return Response.json([{ sha: commit }])
    }
    if (rawDown) throw new TypeError('fetch failed')
    if (init.headers?.['if-none-match'] === etag) return new Response(null, { status: 304 })
    return new Response(body, { headers: { etag } })
  }
  return { fetch, calls, opts: { fetch, raw: 'https://raw.test', api: 'https://api.test' } }
}
function cache(t) {
  const dir = mkdtempSync(join(tmpdir(), 'finder-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const T0 = Date.parse('2026-10-11T00:00:00Z')

test('the first load downloads the snapshot at the commit that published it', async t => {
  const dir = cache(t), s = server()
  const { data, revision } = await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 })
  assert.equal(data.mods.length, DATA.mods.length)
  assert.equal(revision.commit, 'a'.repeat(40))
  assert.equal(s.calls.at(-1), `https://raw.test/karanb192/awesome-claude-code-mods/${'a'.repeat(40)}/docs/mods.json`)
})

test('a fresh cache answers without the network, and an unchanged commit skips the download', async t => {
  const dir = cache(t), s = server()
  await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 })
  s.calls.length = 0
  await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 + 1000 })
  assert.deepEqual(s.calls, [])
  const later = await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 + REFRESH_AFTER_MS + 1 })
  assert.equal(s.calls.length, 1, 'only the commit lookup')
  assert.equal(later.revision.fetchedAt, T0 + REFRESH_AFTER_MS + 1)
})

test('a new commit replaces the whole snapshot and removes the old file', async t => {
  const dir = cache(t)
  await loadSnapshot({ ...server().opts, cacheDir: dir, now: T0 })
  const next = { ...DATA, generated: '2026-10-12T00:00:00.000Z', mods: DATA.mods.slice(0, 3) }
  const { data, revision } = await loadSnapshot({ ...server({ commit: 'b'.repeat(40), body: JSON.stringify(next) }).opts, cacheDir: dir, now: T0, refresh: 'force' })
  assert.equal(data.mods.length, 3)
  assert.equal(revision.commit, 'b'.repeat(40))
  assert.deepEqual(readdirSync(dir).filter(f => f.startsWith('mods-')), [revision.file])
})

test('without the API it falls back to main and revalidates with the ETag', async t => {
  const dir = cache(t), s = server({ apiDown: true })
  const first = await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 })
  assert.equal(first.revision.commit, null)
  assert.ok(first.revision.sha256)
  assert.ok(s.calls.includes('https://raw.test/karanb192/awesome-claude-code-mods/main/docs/mods.json'))
  const again = await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0, refresh: 'force' })
  assert.equal(again.revision.sha256, first.revision.sha256)
  assert.ok(!again.revision.stale)
})

test('a failed refresh serves the cached snapshot marked stale, up to a week', async t => {
  const dir = cache(t)
  await loadSnapshot({ ...server().opts, cacheDir: dir, now: T0 })
  const down = server({ commit: 'b'.repeat(40), rawDown: true })
  const stale = await loadSnapshot({ ...down.opts, cacheDir: dir, now: T0 + REFRESH_AFTER_MS + 1 })
  assert.equal(stale.revision.stale, true)
  assert.equal(stale.revision.commit, 'a'.repeat(40))
  assert.match(stale.revision.refreshError, /fetch failed/)
  assert.equal(search(buildIndex(stale.data, stale.revision), { query: 'review' }).snapshot.stale, true)
  await assert.rejects(loadSnapshot({ ...down.opts, cacheDir: dir, now: T0 + MAX_STALE_MS + 1 }), /more than 7 days old/)
})

test('offline never touches the network and still applies the age limits', async t => {
  const s = server()
  await assert.rejects(loadSnapshot({ ...s.opts, cacheDir: cache(t), now: T0, refresh: 'never' }), /offline and there is no cached copy/)
  assert.deepEqual(s.calls, [])
  const dir = cache(t)
  await loadSnapshot({ ...server().opts, cacheDir: dir, now: T0 })
  const fresh = await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 + 1000, refresh: 'never' })
  assert.ok(!fresh.revision.stale)
  const old = await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 + REFRESH_AFTER_MS + 1, refresh: 'never' })
  assert.equal(old.revision.stale, true)
  assert.match(old.revision.refreshError, /offline/)
  await assert.rejects(loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 + 30 * 86400e3, refresh: 'never' }), /more than 7 days old/)
  assert.deepEqual(s.calls, [])
})

test('a cache with a missing or future age, or a file that is not a snapshot, counts as no cache', async t => {
  const s = server()
  for (const [meta, body] of [
    [{ file: 'm.json' }, DATA],
    [{ file: 'm.json', fetchedAt: '2026-09-01' }, DATA],
    [{ file: 'm.json', fetchedAt: T0 + 30 * 86400e3 }, DATA],
    [{ file: 'm.json', fetchedAt: T0 }, { generated: 'x' }],
  ]) {
    const dir = cache(t)
    writeFileSync(join(dir, 'm.json'), JSON.stringify(body))
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
    await assert.rejects(loadSnapshot({ ...s.opts, cacheDir: dir, now: T0, refresh: 'never' }), /no cached copy/, JSON.stringify(meta))
    const fixed = await loadSnapshot({ ...s.opts, cacheDir: dir, now: T0 })
    assert.equal(fixed.revision.fetchedAt, T0, 'auto mode downloads a fresh copy')
  }
})

test('a broken download never replaces a good cache, and with no cache it is an error', async t => {
  const dir = cache(t)
  await loadSnapshot({ ...server().opts, cacheDir: dir, now: T0 })
  const broken = await loadSnapshot({ ...server({ commit: 'b'.repeat(40), body: '{"mods": [' }).opts, cacheDir: dir, now: T0, refresh: 'force' })
  assert.equal(broken.revision.stale, true)
  assert.equal(broken.revision.commit, 'a'.repeat(40))
  const wrong = await loadSnapshot({ ...server({ commit: 'b'.repeat(40), body: '{"mods": []}' }).opts, cacheDir: dir, now: T0, refresh: 'force' })
  assert.match(wrong.revision.refreshError, /not a mods.json snapshot/)
  await assert.rejects(loadSnapshot({ ...server({ rawDown: true }).opts, cacheDir: cache(t), now: T0 }), /could not download/)
})

const published = fileURLToPath(new URL('../docs/mods.json', import.meta.url))

test('answers from the published snapshot stay small', { skip: !existsSync(published) }, () => {
  const real = buildIndex(JSON.parse(readFileSync(published, 'utf8')))
  const sizes = real.data.mods.map(m => JSON.stringify(getMod(real, m.id)).length)
  assert.ok(Math.max(...sizes) < 16000, `largest get_mod answer is ${Math.max(...sizes)} bytes`)
  for (const filter of [{ without: ['runs processes'] }, { max_reach: 1 }]) {
    assert.ok(!ids(search(real, { query: 'grammar check', limit: MAX_LIMIT, ...filter })).includes('vinta/hal-9000:plugins/hal-grammar-check'), JSON.stringify(filter))
  }
  const sees = (query, repo) => ids(search(real, { query, repo, without: ['every tool call'], limit: MAX_LIMIT }))
  assert.ok(!sees('autotel', 'jagreehal/autotel').includes('jagreehal/autotel:packages/autotel-claude-code'), 'a * hook sees every tool call')
  assert.ok(!sees('beads guard', 'baselane-sh/mods').includes('baselane-sh/mods:plugins/beads-guard'), 'a classic PreToolUse hook sees every tool call')
  for (const query of ['review', 'cache', 'a', '']) {
    const size = JSON.stringify(search(real, { query, limit: MAX_LIMIT })).length
    assert.ok(size < 24000, `a full page for "${query}" is ${size} bytes`)
  }
})

test('the command line prints exactly what the module returns', t => {
  const dir = cache(t)
  const file = 'mods-test.json'
  writeFileSync(join(dir, file), JSON.stringify(DATA))
  // --offline marks a cache older than the refresh interval stale, so the parity cache is written fresh.
  const meta = { commit: 'f'.repeat(40), sha256: 'abc', fetchedAt: Date.now(), file }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
  const index = buildIndex(DATA, meta)
  const cli = fileURLToPath(new URL('./find-mods.mjs', import.meta.url))
  const run = (...args) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--offline'], { encoding: 'utf8', env: { ...process.env, CLAUDE_MODS_CACHE: dir } })
    return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null }
  }
  assert.deepEqual(run('search', 'cache', '--without', 'network,every prompt').json, search(index, { query: 'cache', without: ['network', 'every prompt'] }))
  assert.deepEqual(run('get', 'i/copy:mods/review-desk').json, getMod(index, 'i/copy:mods/review-desk'))
  const bad = run('search', 'cache', '--without', 'nonsense')
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /not a without value/)
  const both = run('search', 'cache', '--refresh')
  assert.equal(both.status, 2, '--offline with --refresh is refused, not resolved by going online')
  assert.match(both.stderr, /contradict/)
})
