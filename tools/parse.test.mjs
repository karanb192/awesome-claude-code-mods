import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseValidateOutput, parseHooks, parseCalls, footprintStatus } from './parse.mjs'
import { grade, visibility, drawsOn, hasFootprint } from './grade.mjs'
import { validate, validateAsync, spawnAsync, relativePaths } from './validate.mjs'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SAMPLE = `Validating plugin manifest: /x/.claude-plugin/plugin.json

Validating hooks: /x/hooks/hooks.json

  ❯ ./register.tsx hooks: session.start, prompt.submit, tool.call{tool=Bash}, turn.complete, ui.render{component=AbovePrompt}, ui.render{component=Pane, surface=terminal}
  ❯ ./register.tsx calls: $.clock.after (via reveal, throwNow), $.clock.now, $.env.get, $.fs.exists, $.process.run, $.ui.open, $.ui.resolve
  ❯ ./register.tsx surface modules: hooks/boards/a.tsx, hooks/boards/b.tsx

✔ Validation passed
`

test('parses hooks, matchers, calls and surface modules', () => {
  const r = parseValidateOutput(SAMPLE)
  assert.equal(r.status, 'passed')
  assert.equal(r.modules.length, 1)
  const m = r.modules[0]
  assert.deepEqual(m.hooks[2], { event: 'tool.call', matcher: { tool: 'Bash' } })
  assert.deepEqual(m.hooks[5], { event: 'ui.render', matcher: { component: 'Pane', surface: 'terminal' } })
  assert.deepEqual(m.calls, ['$.clock.after', '$.clock.now', '$.env.get', '$.fs.exists', '$.process.run', '$.ui.open', '$.ui.resolve'])
  assert.deepEqual(m.surfaceModules, ['hooks/boards/a.tsx', 'hooks/boards/b.tsx'])
})

test('nothing on $ means no calls', () => {
  assert.deepEqual(parseCalls('nothing on $'), [])
  assert.deepEqual(parseHooks('tool.call'), [{ event: 'tool.call', matcher: {} }])
})

test('nested matchers and quoted punctuation remain inside their hook', () => {
  assert.deepEqual(parseHooks('command.run{origin={kind=composer}|{kind=bridge}}, prompt.submit{origin={kind=composer, source=[one,two]}}, tool.call{tool=/"^(a,b|x=y|[}])$"/}, session.end'), [
    { event: 'command.run', matcher: { origin: '{kind=composer}|{kind=bridge}' } },
    { event: 'prompt.submit', matcher: { origin: '{kind=composer, source=[one,two]}' } },
    { event: 'tool.call', matcher: { tool: '/"^(a,b|x=y|[}])$"/' } },
    { event: 'session.end', matcher: {} },
  ])
  assert.deepEqual(parseHooks('session.start, command.run{origin={kind=bridge}'), [{ event: 'session.start', matcher: {} }])
  const parsed = parseValidateOutput('  ❯ ./a.ts hooks: session.start, tool.call{tool=/"[}]"/}, command.run{origin={kind=bridge}[+10 chars]}\n  ❯ ./a.ts calls: nothing on $\n✔ Validation passed')
  assert.deepEqual(parsed.modules[0].hooks, [
    { event: 'session.start', matcher: {} },
    { event: 'tool.call', matcher: { tool: '/"[}]"/' } },
  ])
  assert.equal(footprintStatus(parsed, ['./a.ts']).status, 'unavailable')
})

test('footprint coverage requires hooks and explicit calls for every declared module', () => {
  const read = text => parseValidateOutput(text + '\n✘ Validation failed')
  const full = '  ❯ ./a.ts hooks: session.start\n  ❯ ./a.ts calls: $.http.fetch'
  assert.equal(footprintStatus(read(full), ['./a.ts']).status, 'reported')
  assert.equal(footprintStatus(read(full), ['./a.ts', './b.ts']).status, 'unavailable')
  for (const text of ['', '  ❯ ./a.ts hooks: session.start', '  ❯ ./a.ts calls: $.http.fetch',
    '  ❯ ./a.ts hooks: session.start\n  ❯ ./a.ts calls:', '  ❯ ./a.ts hooks: session.start\n  ❯ ./a.ts calls: unknown']) {
    assert.equal(footprintStatus(read(text), ['./a.ts']).status, 'unavailable', text)
  }
  const empty = read('  ❯ ./a.ts hooks: nothing\n  ❯ ./a.ts calls: nothing on $')
  assert.equal(footprintStatus(empty, ['a.ts']).status, 'reported')
  assert.equal(grade(empty.modules[0].calls).level, 0)
  assert.equal(footprintStatus(empty, [null]).status, 'unavailable')
})

test('unknown access retains a lower bound and treats legacy failures conservatively', () => {
  assert.deepEqual(grade(['$.http.fetch'], false), { level: null, name: 'unknown', labels: ['network'], minimumLevel: 3 })
  for (const calls of [[], ['$.http.fetch']]) assert.equal(hasFootprint({ calls, validate: { status: 'failed' } }), false)
  assert.equal(hasFootprint({ calls: [], validate: { status: 'passed' } }), true)
  assert.equal(hasFootprint({ calls: [], validate: { status: 'unknown' }, lastKnownValidate: { status: 'warnings' } }), true)
  assert.equal(hasFootprint({ footprint: { status: 'reported' }, validate: { status: 'failed' } }), true)
  assert.equal(hasFootprint({ footprint: { status: 'unavailable' }, validate: { status: 'passed' } }), false)
})

test('truncated validator lists retain whole entries but never establish a complete footprint', () => {
  const read = (hooks, calls, surfaces = '') => parseValidateOutput(`  ❯ ./register.ts hooks: ${hooks}\n  ❯ ./register.ts calls: ${calls}\n${surfaces && `  ❯ ./register.ts surface modules: ${surfaces}`}\n✔ Validation passed`)
  const cut = read('session.start, ui.render{component=Pane, r… [+281 chars]', '$.http.fetch (via first, second), $.ui.clos… [+250 chars]')
  assert.equal(cut.status, 'passed')
  assert.deepEqual(cut.modules[0].hooks, [{ event: 'session.start', matcher: {} }])
  assert.deepEqual(cut.modules[0].calls, ['$.http.fetch'])
  assert.equal(footprintStatus(cut, ['./register.ts']).status, 'unavailable')
  assert.equal(grade(cut.modules[0].calls, false).level, null)
  assert.equal(grade(cut.modules[0].calls, false).minimumLevel, 3)
  for (const r of [
    read('session.st… [+1 char]', 'nothing on $'),
    read('session.start', '$.ui.log (via first, seco… [+20 chars]'),
    read('session.start', '$.http.fetch, $.ui.clos... [+250 chars]'),
    read('session.start', 'nothing on $', 'hooks/a.tsx, hooks/par… [+10 chars]'),
  ]) {
    assert.equal(footprintStatus(r, ['./register.ts']).status, 'unavailable')
    assert.ok(!JSON.stringify(r.modules[0].hooks).includes('chars'))
  }
  assert.deepEqual(read('session.start', '$.ui.log (via first, seco… [+20 chars]').modules[0].calls, [])
  assert.deepEqual(read('session.start', 'nothing on $', 'hooks/a.tsx, hooks/par… [+10 chars]').modules[0].surfaceModules, ['hooks/a.tsx'])
  const mixed = parseValidateOutput(SAMPLE + '  ❯ ./b.ts hooks: nothing\n  ❯ ./b.ts calls: $.fs.wri… [+2 chars]')
  assert.equal(footprintStatus(mixed, ['./register.tsx', './b.ts']).status, 'unavailable')
})

test('embedded character-count markers discard the affected matcher before parsing it', () => {
  for (const suffix of ['', ', ui.render{component=Pane, r… [+248 chars]']) {
    const parsed = parseValidateOutput(`  ❯ ./register.ts hooks: session.start, command.run{command=status}, tool.call{tool=/"^mcp__(?:service|[0-9a-fA-F]{8})__"[+47 chars]/}, session.end${suffix}\n  ❯ ./register.ts calls: $.http.fetch\n✔ Validation passed`)
    assert.equal(parsed.status, 'passed')
    assert.deepEqual(parsed.modules[0].hooks, [
      { event: 'session.start', matcher: {} },
      { event: 'command.run', matcher: { command: 'status' } },
    ])
    assert.deepEqual(footprintStatus(parsed, ['./register.ts']), { status: 'unavailable', reason: 'Validator output was truncated' })
    assert.deepEqual(parsed.modules[0].calls, ['$.http.fetch'])
  }
})

test('failed validation carries the error line', () => {
  const r = parseValidateOutput('✘ Found 1 error:\n\n  ❯ directory: No manifest found\n\n✘ Validation failed\n')
  assert.equal(r.status, 'failed')
  assert.deepEqual(r.errors, ['directory: No manifest found'])
})

test('warnings status and author warning is not an error', () => {
  const r = parseValidateOutput('⚠ Found 1 warning:\n\n  ❯ author: No author information provided\n\n  ❯ ./r.ts hooks: tool.call\n  ❯ ./r.ts calls: nothing on $\n\n✔ Validation passed with warnings\n')
  assert.equal(r.status, 'warnings')
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.modules[0].calls, [])
})

test('grade orders by the widest reach and keeps labels readable', () => {
  assert.deepEqual(grade(['$.ui.log', '$.store.set']), { level: 0, name: 'draws and remembers', labels: ['persists state', 'draws'] })
  assert.equal(grade(['$.fs.exists', '$.env.get']).level, 1)
  assert.equal(grade(['$.process.run']).level, 2)
  assert.equal(grade(['$.http.fetch', '$.ui.log']).level, 3)
  assert.deepEqual(grade(['$.fs.write', '$.process.run']).labels, ['runs processes', 'writes files'])
  assert.deepEqual(grade([]), { level: 0, name: 'draws and remembers', labels: [] })
})

test('visibility names what a hook can observe', () => {
  assert.deepEqual(visibility([{ event: 'tool.call', matcher: {} }, { event: 'prompt.submit', matcher: {} }]), ['every tool call', 'every prompt'])
  assert.deepEqual(visibility([{ event: 'tool.call', matcher: { tool: 'Bash' } }]), ['Bash calls'])
  assert.deepEqual(visibility([{ event: '*', matcher: {} }]), ['everything'])
  assert.deepEqual(drawsOn([{ event: 'ui.render', matcher: { component: 'Pane' } }, { event: 'turn.start', matcher: {} }]), ['Pane'])
})

import { fingerprint, describeChange, looksPartial } from './changed.mjs'
import { applyDuplicates, applyDuplicatesWithRenames, suspectDuplicates, readDuplicates, renamePairs, appliesWithoutRescan } from './dedupe.mjs'
import { reconcile } from './inventory.mjs'
import { kindOf, readCatalogs } from './kind.mjs'
import { reclassify, needsReview } from './reclassify.mjs'

const base = { claudeVersion: '2.1.272', mods: [
  { id: 'a/b:.', repo: 'a/b', kind: 'mod', name: 'x', description: 'd', hooks: [], calls: ['$.ui.log'], reach: { level: 0 }, sees: [], validate: { status: 'passed' }, archived: false, stars: 5 },
  { id: 'c/d:tests/f', repo: 'c/d', kind: 'fixture', name: 'f', description: '', hooks: [], calls: [], reach: { level: 0 }, sees: [], validate: { status: 'passed' }, archived: false, stars: 0 },
] }
const clone = () => JSON.parse(JSON.stringify(base))

test('stars and timestamps are not a change', () => {
  const after = clone(); after.mods[0].stars = 900; after.generated = 'later'
  assert.equal(fingerprint(base), fingerprint(after))
  assert.deepEqual(describeChange(base, after), [])
})

test('a new mod, a footprint change, a validate flip and a version bump are changes', () => {
  const after = clone()
  after.mods[0].calls = ['$.ui.log', '$.http.fetch']; after.mods[0].reach.level = 3
  after.mods.push({ ...clone().mods[0], id: 'e/f:.', name: 'y' })
  after.claudeVersion = '2.1.280'
  assert.notEqual(fingerprint(base), fingerprint(after))
  assert.deepEqual(describeChange(base, after), ['Claude Code 2.1.272 to 2.1.280', 'new: e/f:.', 'a/b:.: reach L0 to L3'])
  const broken = clone(); broken.mods[0].validate.status = 'failed'
  assert.deepEqual(describeChange(base, broken), ['a/b:.: validate passed to failed', 'a/b:.: reach L0 to unknown'])
})

test('a listed duplicate collapses onto its successor; an unlisted same-owner same-name pair is only flagged', () => {
  const mods = () => [
    { id: 'o/mono:queue', repo: 'o/mono', name: 'queue', kind: 'mod' },
    { id: 'o/queue-plugin:.', repo: 'o/queue-plugin', name: 'queue', kind: 'mod' },
    { id: 'o/lint:.', repo: 'o/lint', name: 'lint', kind: 'mod' },
    { id: 'o/tools:lint', repo: 'o/tools', name: 'lint', kind: 'mod' },
    { id: 'p/queue:.', repo: 'p/queue', name: 'queue', kind: 'mod' },
    { id: 'o/x:tests/queue', repo: 'o/x', name: 'queue', kind: 'fixture' },
  ]
  const list = new Map([['o/queue-plugin:.', 'o/mono:queue']])
  const applied = applyDuplicates(mods(), list)
  assert.deepEqual(applied.filter(m => m.kind === 'duplicate').map(m => [m.id, m.duplicateOf]), [['o/queue-plugin:.', 'o/mono:queue']])
  assert.deepEqual(suspectDuplicates(applied), [['o/lint:.', 'o/tools:lint']])
  const orphaned = applyDuplicates(mods().filter(m => m.id !== 'o/mono:queue'), list)
  assert.equal(orphaned.find(m => m.id === 'o/queue-plugin:.').kind, 'mod')
  const listed = [...readDuplicates('data/duplicates.txt')]
  assert.deepEqual(listed[0], ['galElmalah/claude-queue-plugin:.', 'galElmalah/claude-mods:claude-queue'])
  for (const pair of listed) assert.ok(pair.length === 2 && pair.every(id => /^[\w.-]+\/[\w.-]+:\S+$/.test(id)) && pair[0] !== pair[1], pair.join(' '))
  assert.deepEqual([...readDuplicates('data/no-such-file.txt')], [])
})

test('a retained duplicate follows an explicit keeper move only when the new keeper is counted', () => {
  const records = [
    { id: 'o/repo:.', kind: 'duplicate', duplicateOf: 'o/repo:old' },
    { id: 'o/repo:old', kind: 'mod' },
    { id: 'o/repo:new', kind: 'mod' },
  ]
  const rules = new Map([['o/repo:.', 'o/repo:new'], ['o/repo:old', 'o/repo:new']])
  const retained = reconcile(records.map(m => ({ ...m, repo: 'o/repo', validate: { status: 'passed', claudeVersion: '1' } })), [], new Map()).mods
  const result = applyDuplicates(structuredClone(retained), rules)
  assert.deepEqual(result.map(m => [m.kind, m.duplicateOf]), [
    ['duplicate', 'o/repo:new'], ['duplicate', 'o/repo:new'], ['mod', undefined],
  ])
  assert.deepEqual(applyDuplicates(structuredClone(result), rules), result)
  for (const kind of [null, 'fixture', 'catalog', 'duplicate']) {
    const unavailable = retained.filter(m => m.id !== 'o/repo:new')
    if (kind) unavailable.push({ id: 'o/repo:new', kind })
    assert.deepEqual(applyDuplicates(structuredClone(unavailable), rules), unavailable)
  }
})

test('only an appended pair between counted mods skips the PR rescan', () => {
  const counted = id => ({ id, repo: id.split(':')[0], kind: 'mod' })
  const committed = [
    counted('o/a:.'), counted('o/b:.'), counted('o/c:.'), counted('o/d:.'), counted('o/e:.'),
    { ...counted('o/x:.'), kind: 'duplicate', duplicateOf: 'o/y:.' }, counted('o/y:.'),
    { ...counted('o/old:.'), kind: 'duplicate', duplicateOf: 'O/New:.' }, counted('O/New:.'),
  ]
  const base = '# copy keeper\no/x:. o/y:.\n'
  assert.ok(appliesWithoutRescan(base, base, committed), 'an unchanged list')
  assert.ok(appliesWithoutRescan(base, base + 'o/a:.   o/b:.\n# note\n', committed), 'an appended pair, spacing and comments aside')
  assert.ok(!appliesWithoutRescan(base, '# copy keeper\n', committed), 'a removed pair')
  assert.ok(!appliesWithoutRescan(base, 'o/y:. o/x:.\n', committed), 'a reversed pair')
  assert.ok(!appliesWithoutRescan(base + 'o/a:. o/b:.\n', 'o/a:. o/b:.\no/x:. o/y:.\n', committed), 'reordered pairs')
  assert.ok(!appliesWithoutRescan(base, base + 'o/c:. o/d:.\no/d:. o/e:.\n', committed), 'a chain')
  assert.ok(!appliesWithoutRescan(base, base + 'o/y:. o/a:.\n', committed), 'a keeper already named in the list')
  assert.ok(!appliesWithoutRescan(base, base + 'o/old:. o/a:.\n', committed), 'a copy already collapsed by a rename')
  assert.ok(!appliesWithoutRescan(base, base + 'n/seed:. o/a:.\n', committed), 'a copy not yet in the inventory')
  assert.ok(!appliesWithoutRescan(base, base + 'o/a:. n/seed:.\n', committed), 'a keeper not yet in the inventory')
  const applied = committed.map(m => m.id === 'o/a:.' ? { ...m, kind: 'duplicate', duplicateOf: 'o/b:.' } : m)
  assert.ok(appliesWithoutRescan(base, base + 'o/a:. o/b:.\n', applied), 'a pair the committed inventory already applies')
  assert.ok(!appliesWithoutRescan(base, base + 'o/a:. o/c:.\n', applied), 'a copy collapsed onto a different keeper')
})

test('an append the PR check applies without a rescan matches a fresh classification', () => {
  const fresh = () => ['o/a:.', 'o/b:.', 'o/x:.', 'o/y:.'].map(id => ({ id, repo: id.split(':')[0], kind: 'mod', validate: { status: 'passed', claudeVersion: '1' } }))
  const view = mods => mods.map(({ id, kind, duplicateOf }) => ({ id, kind, duplicateOf })).sort((a, b) => a.id.localeCompare(b.id))
  const before = new Map([['o/x:.', 'o/y:.']]), after = new Map([...before, ['o/a:.', 'o/b:.']])
  const committed = applyDuplicatesWithRenames(fresh(), before, new Map())
  assert.ok(appliesWithoutRescan('o/x:. o/y:.\n', 'o/x:. o/y:.\no/a:. o/b:.\n', committed))
  const zeroRepoScan = applyDuplicatesWithRenames(reconcile(structuredClone(committed), [], new Map()).mods, after, new Map())
  assert.deepEqual(view(zeroRepoScan), view(applyDuplicatesWithRenames(fresh(), after, new Map())))
})

test('a repository GitHub reports under a new name collapses onto that name', () => {
  const mods = [
    { id: 'o/old-name:plugins/a', repo: 'o/old-name', path: 'plugins/a', kind: 'mod' },
    { id: 'o/old-name:plugins/b', repo: 'o/old-name', path: 'plugins/b', kind: 'mod' },
    { id: 'O/New-Name:plugins/a', repo: 'O/New-Name', path: 'plugins/a', kind: 'mod' },
    { id: 'o/mono:x', repo: 'o/mono', path: 'x', kind: 'mod' },
    { id: 'o/standalone:.', repo: 'o/standalone', path: '.', kind: 'mod' },
  ]
  const currentName = new Map([['o/old-name', 'o/new-name'], ['o/new-name', 'O/New-Name'], ['o/mono', 'o/mono'], ['o/standalone', 'o/standalone']])
  const fresh = new Set(mods.map(m => m.id))
  const pairs = renamePairs(mods, currentName, fresh)
  assert.deepEqual([...pairs], [['o/old-name:plugins/a', 'O/New-Name:plugins/a']], 'only a plugin whose new-name copy was scanned, repository matched without regard to case')
  const applied = applyDuplicates(structuredClone(mods), pairs)
  assert.deepEqual(applied.filter(m => m.kind === 'mod').map(m => m.id), ['o/old-name:plugins/b', 'O/New-Name:plugins/a', 'o/mono:x', 'o/standalone:.'])
  assert.equal(renamePairs(mods, new Map(), fresh).size, 0, 'no metadata, no collapse')
  const stale = new Set([...fresh].filter(id => id !== 'O/New-Name:plugins/a'))
  assert.equal(renamePairs(mods, currentName, stale).size, 0, 'a retained record of a failed clone never hides a fresh copy')
})

test('two old names of a repository whose current name is not a candidate collapse onto one', () => {
  const plugin = (repo, sourceCommit = 'c1') => ({ id: `${repo}:plugin`, repo, path: 'plugin', sourceCommit, kind: 'mod' })
  const mods = [plugin('o/prompt-bar'), plugin('o/ClauDiscombobulating'), plugin('o/other')]
  const currentName = new Map([['o/prompt-bar', 'o/ClauDiscobombulating'], ['o/claudiscombobulating', 'o/ClauDiscobombulating'], ['o/other', 'o/other']])
  const fresh = new Set(mods.map(m => m.id))
  const pairs = renamePairs(mods, currentName, fresh)
  assert.deepEqual([...pairs], [['o/prompt-bar:plugin', 'o/ClauDiscombobulating:plugin']])
  assert.deepEqual(applyDuplicates(structuredClone(mods), pairs).filter(m => m.kind === 'mod').map(m => m.id), ['o/ClauDiscombobulating:plugin', 'o/other:plugin'])
  assert.equal(renamePairs([plugin('o/prompt-bar', 'c2'), mods[1]], currentName, new Set(['o/prompt-bar:plugin', 'o/ClauDiscombobulating:plugin'])).size, 0, 'different commits are not proven to be one checkout')
  assert.equal(renamePairs(mods, currentName, new Set(['o/ClauDiscombobulating:plugin'])).size, 0, 'a retained record never joins a pair')
  const listed = [...mods, plugin('o/ClauDiscobombulating')]
  assert.deepEqual([...renamePairs(listed, currentName, new Set(listed.map(m => m.id)))].sort(), [['o/ClauDiscombobulating:plugin', 'o/ClauDiscobombulating:plugin'], ['o/prompt-bar:plugin', 'o/ClauDiscobombulating:plugin']], 'a fresh copy under the current name still wins')
})

test('rename pairs keep plugin paths case-sensitive', () => {
  const mods = [
    { id: 'o/old:plugins/A', repo: 'o/old', path: 'plugins/A', kind: 'mod' },
    { id: 'o/old:plugins/a', repo: 'o/old', path: 'plugins/a', kind: 'mod' },
    { id: 'o/new:plugins/A', repo: 'o/new', path: 'plugins/A', kind: 'mod' },
    { id: 'o/new:plugins/a', repo: 'o/new', path: 'plugins/a', kind: 'mod' },
  ]
  const pairs = renamePairs(mods, new Map([['o/old', 'o/new'], ['o/new', 'o/new']]), new Set(mods.map(m => m.id)))
  assert.deepEqual([...pairs], [['o/old:plugins/A', 'o/new:plugins/A'], ['o/old:plugins/a', 'o/new:plugins/a']])
})

test('a rename and a listed move together leave one copy counted', () => {
  const mods = () => [
    { id: 'o/old:.', repo: 'o/old', path: '.', kind: 'mod' },
    { id: 'o/new:.', repo: 'o/new', path: '.', kind: 'mod' },
    { id: 'o/market:p', repo: 'o/market', path: 'p', kind: 'mod' },
  ]
  const renames = new Map([['o/old:.', 'o/new:.']])
  const counted = list => applyDuplicatesWithRenames(mods(), list, renames).filter(m => m.kind === 'mod').map(m => m.id)
  assert.deepEqual(counted(new Map([['o/new:.', 'o/market:p']])), ['o/market:p'], 'listed under the current name')
  assert.deepEqual(counted(new Map([['o/old:.', 'o/market:p']])), ['o/market:p'], 'listed under the old name')
  assert.deepEqual(counted(new Map([['o/old:.', 'o/new:.']])), ['o/new:.', 'o/market:p'], 'a listed rename that the scan also detects')
  assert.deepEqual(counted(new Map()), ['o/new:.', 'o/market:p'])
})

test('the change list names a collapse and a suspected pair', () => {
  const after = clone()
  after.mods.push({ ...clone().mods[0], id: 'a/b-plugin:.', kind: 'duplicate', duplicateOf: 'a/b:.' })
  assert.deepEqual(describeChange(base, after), ['new: a/b-plugin:. (duplicate of a/b:.)'])
  const flipped = clone(); flipped.mods[0].kind = 'duplicate'; flipped.mods[0].duplicateOf = 'a/mono:x'
  assert.deepEqual(describeChange(base, flipped), ['a/b:.: mod to duplicate (duplicate of a/mono:x)'])
  assert.notEqual(fingerprint(base), fingerprint(flipped))
  const twins = clone(); twins.mods.push({ ...clone().mods[0], id: 'a/c:.', repo: 'a/c' })
  assert.deepEqual(describeChange(base, twins), ['new: a/c:.', 'possible duplicate: a/b:. and a/c:. share an owner and a name; if they are one mod, add the pair to data/duplicates.txt'])
})

test('kindOf files built-ins, fixtures, mirrors and catalogue copies, and counts the rest', () => {
  const catalogs = new Set(['cat/templates'])
  assert.equal(kindOf('anthropics/claude-code', 'mods/diff', { name: 'diff' }), 'builtin')
  assert.equal(kindOf('a/b', 'tests/fixtures/x', { name: 'x' }), 'fixture')
  assert.equal(kindOf('a/b', 'stubs/clip', { name: 'clip' }), 'fixture')
  const exceptions = new Set(['a/b:mods/abilities/bench'])
  assert.equal(kindOf('a/b', 'mods/abilities/bench', { name: 'bench' }), 'fixture')
  assert.equal(kindOf('a/b', 'mods/abilities/bench', { name: 'bench' }, new Set(), exceptions), 'mod')
  assert.equal(kindOf('a/b', 'labs/bench', { name: 'bench' }, new Set(), exceptions), 'fixture', 'an exception covers only its own id')
  assert.equal(kindOf('a/b', 'mods/abilities/bench', { name: 'bench', description: 'Not a plugin to install.' }, new Set(), exceptions), 'fixture', 'a description that rules it out still wins')
  assert.equal(kindOf('a/b', 'plugins/clip', { name: 'clip' }), 'mod')
  assert.equal(kindOf('a/b', '.', { name: 'x', description: 'A test fixture, not a product mod' }), 'fixture')
  assert.equal(kindOf('a/b', 'tools/demo', { name: 'x-demo', description: 'Development only: plays a scripted turn for screenshots.' }), 'fixture')
  assert.equal(kindOf('a/b', '.', { name: 'x', description: 'Speeds up development only when tests pass.' }), 'mod', 'the phrase must open the description')
  assert.equal(kindOf('a/b', 'skills/builder/assets/probe-mod', { name: 'probe-mod', description: '[probe] Loaded headlessly by the builder. Not a mod to install.' }), 'fixture')
  assert.equal(kindOf('a/b', 'plugins/clip', { name: 'clip', description: 'A mod to install from the marketplace.' }), 'mod')
  assert.equal(kindOf('a/b', 'upstreams/claude-code/mods/telemetry', { name: 'telemetry' }), 'fixture')
  assert.equal(kindOf('a/b', 'vendor/mods/telemetry', { name: 'telemetry' }), 'mirror')
  assert.equal(kindOf('cat/templates', 'components/mods/games/tetris', { name: 'tetris' }, catalogs), 'catalog')
  assert.equal(kindOf('cat/templates', 'tests/fixtures/x', { name: 'x' }, catalogs), 'fixture')
  assert.equal(kindOf('a/b', 'plugins/x', { name: 'x' }, catalogs), 'mod')
  assert.deepEqual([...readCatalogs('data/catalogs.txt')], ['Dandeppert/Claude-mods', 'davila7/claude-code-templates', 'DrishtantKaushal/AwesomeClaudeCodeMods', 'hyonnie-t/claude-mods'])
  assert.deepEqual([...readCatalogs('data/no-such-file.txt')], [])
  const after = clone()
  after.mods.push({ ...clone().mods[0], id: 'cat/templates:mods/x', repo: 'cat/templates', kind: 'catalog' })
  assert.deepEqual(describeChange(base, after), ['new: cat/templates:mods/x (catalog, not counted)'])
})

test('fixtures never count', () => {
  const after = clone(); after.mods[1].calls = ['$.http.fetch']
  assert.equal(fingerprint(base), fingerprint(after))
})

// Internal plugins at beasaltfish/idle-arcade@728bef3ad14714aefd0e0c8baadc2456aeb7a8f6.
for (const [name, description] of [
  ['_probe', 'Throwaway linkage probe: shows in a pane what events reach a plugin. Open it with /probe.'],
  ['_shared-tests', 'Test host for shared/ code: carries the bundled copy so the shared tests run under claude plugin test. Not published.'],
]) {
  test(`idle-arcade ${name} is test material, scoped to its repository and directory`, () => {
    const repo = 'beasaltfish/idle-arcade', path = `plugins/${name}`, manifest = { name, description }
    assert.equal(kindOf(repo, path, manifest), 'fixture')
    assert.equal(kindOf(repo, path, {}), 'fixture', 'the path rule does not depend on description wording')
    assert.equal(kindOf(repo.toUpperCase(), path, manifest), 'fixture')
    assert.equal(kindOf(repo, `${path}/nested`, {}), 'fixture')
    assert.equal(kindOf(repo, `${path}-product`, {}), 'mod')
    assert.equal(kindOf('another/idle-arcade', path, {}), 'mod')
    assert.equal(kindOf(repo, path, manifest, new Set(), new Set([`${repo}:${path}`])), 'mod')
  })
}

test('idle-arcade keeps all seven marketplace mods and unrelated private-looking names', () => {
  for (const name of ['idle-arcade', 'fish-shooter', 'brick-breaker', 'snake', 'space-shooter', 'tap-flyer', 'jump-runner', '_new-game']) {
    assert.equal(kindOf('beasaltfish/idle-arcade', `plugins/${name}`, { name }), 'mod', name)
  }
})

test('development probes stay out while their products and unrelated paths count', () => {
  const probes = [
    ['capibara-html/GuildFlow', 'poc/plugin'],
    ['danielpg95/modster-hunter', 'spikes/p5-39-desktop-art/mod'],
    ['kopylow/wobbly-volley', 'prototypes/p1-band'],
    ['kopylow/wobbly-volley', 'prototypes/p2-client-court'],
    ['kopylow/wobbly-volley', 'prototypes/p4-key-helper'],
    ['partalemre/MODZ', 'tools/kit-gallery'],
  ]
  for (const [repo, path] of probes) {
    assert.equal(kindOf(repo, path, {}), 'fixture')
    assert.equal(kindOf(repo.toUpperCase(), path, {}), 'fixture')
    assert.equal(kindOf(repo, path + '/nested', {}), 'fixture')
    assert.equal(kindOf('another/product', path, {}), 'mod')
    assert.equal(kindOf(repo, path + '-product', {}), 'mod')
    assert.equal(kindOf(repo, path, {}, new Set(), new Set([`${repo}:${path}`])), 'mod')
  }
  assert.equal(kindOf('capibara-html/GuildFlow', 'guildflow', {}), 'mod')
  assert.equal(kindOf('kopylow/wobbly-volley', '.', {}), 'mod')
  assert.equal(kindOf('kopylow/wobbly-volley', 'prototypes/new-game', {}), 'mod')
  assert.equal(kindOf('fran343/claude-mods', 'pruebas-e2e', {}), 'mod')
  assert.equal(kindOf('danielpg95/modster-hunter', 'modster-hunter', {}), 'mod')
  assert.equal(kindOf('danielpg95/modster-hunter', 'spikes/finished-game', {}), 'mod')
  assert.equal(kindOf('partalemre/MODZ', 'mods/filetree', {}), 'mod')
  assert.equal(kindOf('partalemre/MODZ', 'tools/new-product', {}), 'mod')
})

test('field experiments stay out while finished guards and unrelated repositories count', () => {
  const repo = 'RobGruhl/claude-mod-learnings'
  const paths = [
    'experiments/claude-lookalike', 'experiments/e1-fail-open', 'experiments/e2-order',
    'experiments/e3-moves', 'experiments/e4-alias', 'experiments/e4-computed',
    'experiments/e4-destructure', 'experiments/e4-dynamic-import', 'experiments/e4-pass-arrow',
    'experiments/e4-static-ok', 'experiments/e5-after-next', 'experiments/e6-mention',
    'experiments/e7-twice', 'experiments/e7-twice-matcher', 'experiments/latency',
    'experiments/live-probe',
  ]
  for (const path of paths) {
    assert.equal(kindOf(repo, path, {}), 'fixture', path)
    assert.equal(kindOf('another/claude-mod-learnings', path, {}), 'mod', path)
  }
  for (const path of ['experiments/cascade-guard', 'tutorial/.reference/skeleton-guard', 'experiments/e10-product', 'experiments/latency-meter', 'plugins/live-probe']) {
    assert.equal(kindOf(repo, path, {}), 'mod', path)
  }
  assert.equal(kindOf(repo.toLowerCase(), paths[0], {}), 'fixture')
  assert.equal(kindOf(repo, paths[0] + '/nested', {}), 'fixture')
  const exceptions = new Set([`${repo}:${paths[0]}`])
  assert.equal(kindOf(repo, paths[0], {}, new Set(), exceptions), 'mod')
  assert.equal(kindOf(repo, paths[0], { description: 'A test fixture.' }, new Set(), exceptions), 'fixture')
})

test('course exercises stay out while finished mods and unrelated repositories count', () => {
  const paths = [
    '02-first-mod/broken/2-5-syntax-error',
    '03-events/3-1-start', '03-events/3-2-start', '03-events/3-3-start', '03-events/3-4-start', '03-events/3-5-secret-guard',
    '04-test-pilot/4-4-start', '05-ui/broken/5-4-refused',
    '08-testing/errors/1-hook-skipped', '08-testing/errors/2-worker-crash', '08-testing/errors/3-refused',
    '08-testing/errors/4-reload-failed', '08-testing/errors/5-no-command-hook', '09-distribution/tool-tally',
  ]
  for (const path of paths) {
    assert.equal(kindOf('kurushiba/claude-mods', path, { name: 'lesson' }), 'fixture', path)
    assert.equal(kindOf('another/claude-mods', path, { name: 'lesson' }), 'mod', path)
  }
  for (const path of ['.', 'final/test-pilot', 'final/model-router', 'plugins/error-monitor', '03-events-dashboard']) {
    assert.equal(kindOf('kurushiba/claude-mods', path, { name: 'finished' }), 'mod', path)
  }
  assert.equal(kindOf('Kurushiba/claude-mods', paths[0], {}), 'fixture')
  const exceptions = new Set([`kurushiba/claude-mods:${paths[0]}`])
  assert.equal(kindOf('kurushiba/claude-mods', paths[0], {}, new Set(), exceptions), 'mod')
  assert.equal(kindOf('kurushiba/claude-mods', paths[0], { description: 'A test fixture.' }, new Set(), exceptions), 'fixture')
})

test('qualification helpers stay out while the product and unrelated repositories count', () => {
  const repo = 'milocosmopolitan/redacton'
  const paths = ['authority-companion', 'config-race-companion', 'helper-counter', 'race-companion', 'ui-companion'].map(name => `qualification/${name}`)
  for (const path of paths) {
    assert.equal(kindOf(repo, path, {}), 'fixture', path)
    assert.equal(kindOf('another/redacton', path, {}), 'mod', path)
  }
  for (const path of ['.', 'plugins/redacton', 'qualification-dashboard']) {
    assert.equal(kindOf(repo, path, {}), 'mod', path)
  }
  assert.equal(kindOf('Milocosmopolitan/Redacton', paths[0], {}), 'fixture')
  const exceptions = new Set([`${repo}:${paths[0]}`])
  assert.equal(kindOf(repo, paths[0], {}, new Set(), exceptions), 'mod')
  assert.equal(kindOf(repo, paths[0], { description: 'Not a plugin to install.' }, new Set(), exceptions), 'fixture')
})

test('Transceiver measurement probe stays out while its product and unrelated paths count', () => {
  const repo = 'partalemre/transceiver', path = 'spike/tx-probe'
  assert.equal(kindOf(repo, path, {}), 'fixture')
  assert.equal(kindOf('PartalEmre/Transceiver', path, {}), 'fixture')
  assert.equal(kindOf(repo, `${path}/nested`, {}), 'fixture')
  for (const other of ['.', 'spike/tx-probe-extra', 'spike/product']) assert.equal(kindOf(repo, other, {}), 'mod')
  assert.equal(kindOf('other/transceiver', path, {}), 'mod')
  assert.equal(kindOf(repo, path, {}, new Set(), new Set([`${repo}:${path}`])), 'mod')
})

test('account-rotator recording harness and jet-router eval probe stay out while their products count', () => {
  const cases = [['ivokund/claude-account-rotator', 'demo/harness', ['.', 'demo', 'demo/harness-extra']], ['jetsongdev/jet-router', 'eval/cache-measure/b1/effort-probe', ['.', 'eval', 'eval/cache-measure-extra']]]
  for (const [repo, path, others] of cases) {
    assert.equal(kindOf(repo, path, {}), 'fixture', path)
    assert.equal(kindOf(repo.toUpperCase(), path, {}), 'fixture', path)
    assert.equal(kindOf(repo, `${path}/nested`, {}), 'fixture', path)
    for (const other of others) assert.equal(kindOf(repo, other, {}), 'mod', other)
    assert.equal(kindOf(`other/${repo.split('/')[1]}`, path, {}), 'mod', path)
    assert.equal(kindOf(repo, path, {}, new Set(), new Set([`${repo}:${path}`])), 'mod', path)
  }
})

test('Foreman development probes stay out while its product and unrelated paths count', () => {
  const repo = 'andrey342/foreman'
  for (const path of ['spike/mod', 'spike/v02', 'spike/mod/nested']) {
    assert.equal(kindOf(repo, path, {}), 'fixture', path)
    assert.equal(kindOf('Andrey342/Foreman', path, {}), 'fixture', path)
    assert.equal(kindOf('another/foreman', path, {}), 'mod', path)
  }
  for (const path of ['.', 'plugins/foreman', 'spike/model', 'spike/v020', 'spike/other']) {
    assert.equal(kindOf(repo, path, {}), 'mod', path)
  }
  const exceptions = new Set([`${repo}:spike/mod`])
  assert.equal(kindOf(repo, 'spike/mod', {}, new Set(), exceptions), 'mod')
  assert.equal(kindOf(repo, 'spike/mod', { description: 'A test fixture.' }, new Set(), exceptions), 'fixture')
})

test('Ostrakon development plugins stay out without excluding its installable plugin', () => {
  const repo = 'gaius-codius/ostrakon'
  const paths = ['tools/experiments/spc', 'tools/experiments/spw', 'tools/experiments/spx', 'tools/experiments/spx0', 'tools/gallery', 'tools/mockups']
  for (const path of paths) {
    assert.equal(kindOf(repo, path, {}), 'fixture', path)
    assert.equal(kindOf('Gaius-Codius/Ostrakon', path, {}), 'fixture', path)
    assert.equal(kindOf('another/ostrakon', path, {}), 'mod', path)
  }
  for (const path of ['plugin', 'tools/gallery-mod', 'tools/mockups-live', 'tools/experiments/spx01', 'tools/experiments/other']) {
    assert.equal(kindOf(repo, path, {}), 'mod', path)
  }
  const exceptions = new Set([`${repo}:tools/gallery`])
  assert.equal(kindOf(repo, 'tools/gallery', {}, new Set(), exceptions), 'mod')
  assert.equal(kindOf(repo, 'tools/gallery', { description: 'A test fixture.' }, new Set(), exceptions), 'fixture')
})

test('the dispatch replay harness does not count as a shipped mod', () => {
  const repo = 'cdeust/claude-mods'
  assert.equal(kindOf(repo, 'scripts/replay-dispatch', {}), 'fixture')
  assert.equal(kindOf(repo, 'scripts/replay-dispatch/probe', {}), 'fixture')
  assert.equal(kindOf('Cdeust/Claude-Mods', 'scripts/replay-dispatch', {}), 'fixture')
  for (const path of ['scripts/replay-dispatcher', 'mods/zetetic-autopilot', 'mods/replay-dispatch']) {
    assert.equal(kindOf(repo, path, {}), 'mod', path)
  }
  assert.equal(kindOf('another/claude-mods', 'scripts/replay-dispatch', {}), 'mod')
  const exceptions = new Set([`${repo}:scripts/replay-dispatch`])
  assert.equal(kindOf(repo, 'scripts/replay-dispatch', {}, new Set(), exceptions), 'mod')
})

test('the transcript layout spike stays out without excluding the reply mod', () => {
  const repo = 'Malkiz/claude-reply-comments'
  for (const path of ['spikes/transcript-layouts', 'spikes/transcript-layouts/probe']) {
    assert.equal(kindOf(repo, path, {}), 'fixture', path)
    assert.equal(kindOf(repo.toLowerCase(), path, {}), 'fixture', path)
  }
  for (const path of ['.', 'spikes/transcript-layouts-live', 'spikes/other']) {
    assert.equal(kindOf(repo, path, {}), 'mod', path)
  }
  assert.equal(kindOf('another/claude-reply-comments', 'spikes/transcript-layouts', {}), 'mod')
  const exceptions = new Set([`${repo}:spikes/transcript-layouts`])
  assert.equal(kindOf(repo, 'spikes/transcript-layouts', {}, new Set(), exceptions), 'mod')
})

test('acceptance drivers and uninstalled hook sources do not count as separate mods', () => {
  for (const [repo, path, product] of [
    ['CyclopsEyeTeam/cyclops-fresheye', 'acceptance/driver', '.'],
    ['ninondev/cc-coco', 'source', 'plugin'],
    ['ninondev/claude-sama', 'source', 'plugin'],
  ]) {
    assert.equal(kindOf(repo, path, {}), 'fixture')
    assert.equal(kindOf(repo.toLowerCase(), `${path}/hooks`, {}), 'fixture')
    assert.equal(kindOf(repo, product, {}), 'mod')
    assert.equal(kindOf(repo, `${path}-tools`, {}), 'mod')
    assert.equal(kindOf('other/repo', path, {}), 'mod')
    assert.equal(kindOf(repo, path, {}, new Set(), new Set([`${repo}:${path}`])), 'mod')
  }
})

test('benchmark fixtures stay out without excluding usable evaluation mods', () => {
  for (const path of ['lab/bench', 'benchmarks/baseline', 'benchmark/no-trace']) {
    assert.equal(kindOf('a/b', path, { name: 'baseline' }), 'fixture')
  }
  assert.equal(kindOf('a/b', 'eval/judge', { description: 'Benchmark harness, not a plugin to install: scores labelled steps.' }), 'fixture')
  assert.equal(kindOf('a/b', '.', { description: 'Not an installable plugin.' }), 'fixture')
  assert.equal(kindOf('a/b', 'plugins/benchmark-dashboard', { description: 'Displays benchmark results in a pane.' }), 'mod')
  assert.equal(kindOf('a/b', 'eval/assistant', { description: 'Evaluates the current session.' }), 'mod')
  assert.equal(kindOf('a/b', '.', { description: 'Uses a local harness daemon.' }), 'mod')
  assert.equal(kindOf('a/b', '.', { description: 'A session dashboard, not a plugin manager.' }), 'mod')
})

test('reserved-name failures retain the validator reason', () => {
  const result = parseValidateOutput('✘ Found 1 error:\n  ❯ name: Plugin name "claude-example" is reserved.\n✘ Validation failed\n')
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.errors, ['name: Plugin name "claude-example" is reserved.'])
})

test('validator inventory notes and warnings are not validation errors', () => {
  const result = parseValidateOutput('Validating plugin manifest: plugin.json\n✘ Found 1 error:\n  ❯ name: Plugin name is reserved.\n  ❯ types ./types.d.ts declares on $: $.runtime\nValidating hooks: hooks/hooks.json\n  ❯ ./register.ts env reads: HOME\n  ❯ ./register.ts env writes: nothing\n⚠ Found 1 warning:\n  ❯ author: No author information provided\n✘ Validation failed\n')
  assert.deepEqual(result.errors, ['name: Plugin name is reserved.'])
})

test('a scan that lost most of its mods or repos is partial, a small dip is not', () => {
  const many = { repos: 90, mods: Array.from({ length: 30 }, (_, i) => ({ id: `r/${i}:.`, kind: 'mod' })) }
  const few = { repos: 2, mods: many.mods.slice(0, 1) }
  assert.match(looksPartial(many, few), /1 mods where the committed scan has 30/)
  assert.equal(looksPartial(many, { repos: 88, mods: many.mods.slice(0, 27) }), null)
  assert.match(looksPartial(many, { repos: 30, mods: many.mods }), /30 candidate repos where the committed scan has 90/)
  assert.equal(looksPartial({ repos: 0, mods: [] }, few), null)
})

test('validator errors keep paths relative to the scanned repository', async t => {
  const root = mkdtempSync(join(tmpdir(), 'validate-paths-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const checkout = join(root, 'clones', 'owner__repo')
  mkdirSync(join(root, 'bin'), { recursive: true })
  mkdirSync(checkout, { recursive: true })
  writeFileSync(join(root, 'bin', 'claude'), '#!' + process.execPath + `\nconsole.log('✘ Found 1 error:\\n  ❯ modules../register.ts: demo: ${checkout}/plugins/demo/hooks/register.ts: no such file (from ${join(root, 'clones')}/other__repo/x.ts)\\n\\n✘ Validation failed')\nprocess.exit(1)\n`)
  chmodSync(join(root, 'bin', 'claude'), 0o755)
  const path = process.env.PATH
  process.env.PATH = join(root, 'bin') + ':' + path
  t.after(() => { process.env.PATH = path })
  const result = validate('.', checkout, [checkout, join(root, 'clones')])
  assert.deepEqual(await validateAsync('.', checkout, [checkout, join(root, 'clones')]), result, 'the scanner\'s non-blocking call parses the same result')
  assert.equal(result.status, 'failed')
  assert.ok(result.errors.length > 0)
  for (const error of result.errors) assert.ok(!error.includes(root), error)
  assert.match(result.errors.join('\n'), /plugins\/demo\/hooks\/register\.ts: no such file \(from other__repo\/x\.ts\)/)
  assert.equal(relativePaths('/tmp/c/owner__repo', ['/tmp/c/owner__repo']), '.')
})

test('a non-blocking spawn reports what spawnSync reports', async () => {
  const cases = [
    [process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)']],
    ['no-such-validator-binary', []],
    [process.execPath, ['-e', 'setTimeout(() => {}, 5000)']],
  ]
  for (const [command, args] of cases) {
    const sync = spawnSync(command, args, { encoding: 'utf8', timeout: 500 })
    const result = await spawnAsync(command, args, { timeout: 500 })
    assert.deepEqual([result.status, result.signal, result.error?.code], [sync.status, sync.signal, sync.error?.code], command)
    if (!sync.error) assert.deepEqual([result.stdout, result.stderr], [sync.stdout, sync.stderr])
  }
})

test('the change check reads a committed scan larger than the default output buffer', t => {
  const root = mkdtempSync(join(tmpdir(), 'changed-large-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'data'))
  const one = i => ({ id: `o/r${i}:.`, repo: `o/r${i}`, kind: 'mod', name: `m${i}`, description: 'x'.repeat(2000), hooks: [], calls: [], reach: { level: 0 }, sees: [], validate: { status: 'passed' }, archived: false })
  writeFileSync(join(root, 'data/mods.json'), JSON.stringify({ claudeVersion: '1', repos: 800, mods: Array.from({ length: 800 }, (_, i) => one(i)) }))
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'scan')
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./changed.mjs', import.meta.url))], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 1, run.stderr)
  assert.equal(run.stdout.trim(), 'no meaningful change')
  const broken = spawnSync(process.execPath, [fileURLToPath(new URL('./changed.mjs', import.meta.url)), join(root, 'missing.json')], { cwd: root, encoding: 'utf8' })
  assert.equal(broken.status, 2)
})

test('confirmed November moves and copies count their keeper only while it exists', () => {
  const pairs = [
    ['NahumLitvin/prismantis:.', 'NahumLitvin/prismantis:plugin'],
    ['LupusMalusDeviant/desktop-pet:plugins/pet', 'LupusMalusDeviant/mod-box:plugins/pet'],
    ['MichaelDaenzer/claude-mod-session-stats:.', 'MichaelDaenzer/claude-mod-usage-band:session-summary'],
    ['hex/claude-sessions:mods/cs-feed', 'hex/claude-sessions:mods/cs-filter-chat'],
    ['111vandit111/ai-dev-team:plugins/ai-dev-team', '111vandit111/ai-dev-team:plugins/ai-dev-team-office'],
    ['mmacedok/claude-mods:plugins/medidor', 'mmacedok/claude-mods:plugins/funmeter'],
    ['t968rs/operator-straps:plugins/pr-review-watch', 't968rs/operator-straps:plugins/agent-watcher'],
    ['anderson-spider/claude-mods:plugins/chatgpt', 'anderson-spider/claude-mods:plugins/codex'],
    ['anderson-spider/claude-mods:plugins/codex-computer-use', 'anderson-spider/claude-mods:plugins/codex'],
  ]
  const list = readDuplicates('data/duplicates.txt')
  for (const [copy, keeper] of pairs) {
    assert.equal(list.get(copy), keeper, copy)
    const mods = [{ id: copy, kind: 'mod' }, { id: keeper, kind: 'mod' }]
    const result = applyDuplicates(mods, list)
    assert.equal(result[0].kind, 'duplicate', copy)
    assert.equal(result[0].duplicateOf, keeper, copy)
    assert.equal(result[1].kind, 'mod', keeper)
    for (const kind of [null, 'fixture', 'catalog', 'duplicate']) {
      const unavailable = [{ id: copy, kind: 'mod' }]
      if (kind) unavailable.push({ id: keeper, kind })
      assert.equal(applyDuplicates(unavailable, list)[0].kind, 'mod', `${copy}: ${kind}`)
    }
  }
})

test('the crew API spike stays out without excluding installable mods or unrelated spikes', () => {
  const repo = 'PeterTing/claude-mod'
  for (const path of ['spikes/crew', 'spikes/crew/nested']) {
    assert.equal(kindOf(repo, path, {}), 'fixture', path)
    assert.equal(kindOf(repo.toLowerCase(), path, {}), 'fixture', path)
  }
  for (const path of ['.', 'mods/crew', 'mods/zh-reply', 'plugins/crew', 'spikes/crew-live', 'spikes/other']) {
    assert.equal(kindOf(repo, path, {}), 'mod', path)
  }
  assert.equal(kindOf('other/claude-mod', 'spikes/crew', {}), 'mod')
  assert.equal(kindOf(repo, 'spikes/crew', {}, new Set(), new Set([`${repo}:spikes/crew`])), 'mod')
})

test('retained Anderson plugins resolve to Codex after repository discovery follows its rename', () => {
  const oldRepo = 'anderson-spider/claude-mods'
  const currentRepo = 'anderson-spider/spider-claude-mods'
  const at = (repo, path, sourceCommit = 'b89e552c3bdc8a4935a472dfe66a5c3b52c3c063') => ({ id: `${repo}:${path}`, repo, path, kind: 'mod', sourceCommit })
  const copies = ['plugins/chatgpt', 'plugins/codex-computer-use'].map(path => at(oldRepo, path, '392293a851aedd46627aed506a2ddd6dfb3fd8a9'))
  const oldKeeper = at(oldRepo, 'plugins/codex')
  const keeper = at(currentRepo, 'plugins/codex')
  const mods = [...copies, oldKeeper, keeper]
  const renames = renamePairs(mods, new Map([[oldRepo, currentRepo]]), new Set([oldKeeper.id, keeper.id]))
  applyDuplicatesWithRenames(mods, readDuplicates('data/duplicates.txt'), renames)
  assert.equal(renames.get(oldKeeper.id), keeper.id)
  for (const copy of [...copies, oldKeeper]) {
    assert.equal(copy.kind, 'duplicate', copy.id)
    assert.equal(copy.duplicateOf, keeper.id, copy.id)
  }
  assert.equal(keeper.kind, 'mod')
  assert.equal(mods.filter(mod => mod.kind === 'mod').length, 1)
})

test('claudetto release evidence probes are fixtures, not shipped mods', () => {
  const probes = ['probe-141/arm-reorder', 'probe-17-1-lab', 'probe-tui/plug']
  for (const root of ['openspec/changes/release-2-1-319/evidence/tmp/', 'openspec/changes/archive/2026-11-09-release-2-1-319/evidence/tmp/']) for (const repo of ['xsyetopz/dotclaude', 'xsyetopz/claudetto', 'XSYETOPZ/Claudetto']) {
    for (const path of probes) {
      assert.equal(kindOf(repo, root + path, {}), 'fixture')
      assert.equal(kindOf(repo, root + path + '/nested', {}), 'fixture')
      assert.equal(kindOf(repo, root + path + '-released', {}), 'mod')
      assert.equal(kindOf(repo, root + path, {}, new Set(), new Set([`${repo}:${root + path}`])), 'mod')
    }
    for (const path of ['plugins/claudetto', 'plugins/claudetto-openspec', root + 'unrelated']) {
      assert.equal(kindOf(repo, path, {}), 'mod')
    }
  }
  assert.equal(kindOf('other/repo', 'openspec/changes/release-2-1-319/evidence/tmp/' + probes[0], {}), 'mod')
})


test('retirement renames count current keepers and preserve the historical runtime fallback', () => {
  const pairs = [
    ['ucsandman/claude-harness:engine/mods/harness-runtime', 'ucsandman/Agnostic-AI:engine/mods/harness-runtime'],
    ['ucsandman/Agnostic-AI:engine/mods/claude-runtime', 'ucsandman/Agnostic-AI:engine/mods/harness-runtime'],
    ['DiogoHSM/claude-mods:agentes-pixel', 'DiogoHSM/claude-mods:pixel-agents'],
    ['DiogoHSM/claude-mods:polimento-visual', 'DiogoHSM/claude-mods:visual-polish'],
  ]
  const rules = readDuplicates('data/duplicates.txt')
  const keepers = [...new Set(pairs.map(([, keeper]) => keeper))]
  for (const [copy, keeper] of pairs) {
    assert.equal(rules.get(copy), keeper)
    assert.equal(rules.has(keeper), false, 'keepers must be terminal, not stale rename chains')
    for (const kind of [null, 'fixture', 'catalog', 'duplicate', 'builtin']) {
      const records = [{ id: copy, kind: 'mod' }]
      if (kind) records.push({ id: keeper, kind })
      assert.equal(applyDuplicates(records, rules)[0].kind, 'mod')
    }
  }
  const oldCopy = 'ucsandman/claude-harness:engine/mods/claude-runtime'
  const oldKeeper = 'ucsandman/Agnostic-AI:engine/mods/claude-runtime'
  assert.equal(rules.get(oldCopy), oldKeeper)
  const historical = applyDuplicates([oldCopy, oldKeeper].map(id => ({ id, kind: 'mod' })), rules)
  assert.deepEqual(historical.filter(m => m.kind === 'mod').map(m => m.id), [oldKeeper])
  const records = [oldCopy, ...pairs.map(([id]) => id), ...keepers].map(id => ({ id, kind: 'mod' }))
  assert.deepEqual(applyDuplicates(records, rules).filter(m => m.kind === 'mod').map(m => m.id), keepers)
})

test('confirmed aidan copies count their original keepers without excluding unrelated products', () => {
  const pairs = [
    ['aidan-nunn-sys/claude-config:mods/review-watch', 'hamzafer/claude-code-mods:mods/review-watch'],
    ['aidan-nunn-sys/claude-config:mods/secret-box', 'ray-amjad/claude-code-mods:plugins/secret-box'],
  ]
  const rules = readDuplicates('data/duplicates.txt')
  const unrelated = ['agent-radar', 'blast-radius', 'handoff', 'hud', 'mission-control', 'rulebook', 'tps', 'where-am-i', 'xagent']
    .map(name => `aidan-nunn-sys/claude-config:mods/${name}`)
  // A same-named product in another repository is not a confirmed copy.
  unrelated.push('other/mods:review-watch', 'other/mods:secret-box')
  for (const [copy, keeper] of pairs) {
    assert.equal(rules.get(copy), keeper)
    const result = applyDuplicates([copy, keeper, ...unrelated].map(id => ({ id, kind: 'mod' })), rules)
    assert.equal(result[0].kind, 'duplicate')
    assert.equal(result[0].duplicateOf, keeper)
    assert.deepEqual(result.filter(m => m.kind === 'mod').map(m => m.id), [keeper, ...unrelated])
    for (const kind of [null, 'fixture', 'catalog', 'duplicate', 'builtin']) {
      const records = [{ id: copy, kind: 'mod' }]
      if (kind) records.push({ id: keeper, kind })
      assert.equal(applyDuplicates(records, rules)[0].kind, 'mod', `${copy}: ${kind}`)
    }
  }
})

test('a rule change refiles only the committed records it explains', () => {
  const rules = (extra = {}) => ({ kindOf, catalogs: new Set(), exceptions: new Set(), duplicates: new Map(), ...extra })
  const rec = (id, kind = 'mod', extra = {}) => ({ id, repo: id.split(':')[0], path: id.split(':')[1], name: 'n', description: '', kind, ...extra })
  const pair = new Map([['o/a:.', 'o/b:x']])

  let mods = [rec('o/a:.'), rec('o/b:x'), rec('o/c:.')]
  assert.deepEqual(reclassify(mods, rules(), rules()), [])
  assert.deepEqual(reclassify(mods, rules(), rules({ duplicates: pair })), [{ id: 'o/a:.', from: 'mod', to: 'duplicate', duplicateOf: 'o/b:x' }])
  assert.deepEqual(reclassify(mods, rules({ duplicates: pair }), rules({ duplicates: pair })), [])

  // A removed pair counts again; a duplicate the list never named (a renamed repository) stays collapsed.
  mods = [rec('o/a:.', 'duplicate', { duplicateOf: 'o/b:x' }), rec('o/b:x'), rec('o/old:.', 'duplicate', { duplicateOf: 'o/new:.' }), rec('o/new:.')]
  assert.deepEqual(reclassify(mods, rules({ duplicates: pair }), rules()), [{ id: 'o/a:.', from: 'duplicate', to: 'mod' }])
  assert.equal('duplicateOf' in mods[0], false)
  assert.equal(mods[2].kind, 'duplicate')

  // An older pair that never applied is not this change's business.
  mods = [rec('o/a:.'), rec('o/b:x', 'fixture'), rec('o/c:.'), rec('o/d:.')]
  assert.deepEqual(reclassify(mods, rules({ duplicates: pair }), rules({ duplicates: new Map([...pair, ['o/c:.', 'o/d:.']]) })), [{ id: 'o/c:.', from: 'mod', to: 'duplicate', duplicateOf: 'o/d:.' }])

  mods = [rec('cat/r:mods/x'), rec('o/a:.'), rec('cat/r:plain', 'fixture')]
  assert.deepEqual(reclassify(mods, rules(), rules({ catalogs: new Set(['cat/r']) })), [{ id: 'cat/r:mods/x', from: 'mod', to: 'catalog' }], 'a fixture the scan filed from its manifest is left as it is')

  mods = [rec('o/a:bench/x', 'fixture'), rec('o/a:bench/y', 'fixture')]
  assert.deepEqual(reclassify(mods, rules(), rules({ exceptions: new Set(['o/a:bench/x']) })), [{ id: 'o/a:bench/x', from: 'fixture', to: 'mod' }])

  const stricter = rules({ kindOf: (repo, rel, ...rest) => rel.startsWith('archive/') ? 'fixture' : kindOf(repo, rel, ...rest) })
  mods = [rec('o/a:archive/p'), rec('o/a:plugins/p'), rec('o/a:archive/q', 'duplicate', { duplicateOf: 'o/z:q' })]
  assert.deepEqual(reclassify(mods, rules(), stricter), [{ id: 'o/a:archive/p', from: 'mod', to: 'fixture' }, { id: 'o/a:archive/q', from: 'duplicate', to: 'fixture' }])
  assert.equal('duplicateOf' in mods[2], false)

  // A keeper refiled as something that does not count releases its copy, and a person decides which one counts.
  mods = [rec('o/a:.', 'duplicate', { duplicateOf: 'cat/r:b' }), rec('cat/r:b'), rec('o/c:.', 'duplicate', { duplicateOf: 'o/d:.' }), rec('o/d:.')]
  const released = reclassify(mods, rules({ duplicates: new Map([['o/a:.', 'cat/r:b'], ['o/c:.', 'o/d:.']]) }), rules({ catalogs: new Set(['cat/r']), duplicates: new Map([['o/a:.', 'cat/r:b'], ['o/c:.', 'o/d:.'], ['o/d:.', 'o/e:.']]) }))
  assert.deepEqual(released, [{ id: 'o/a:.', from: 'duplicate', to: 'mod', released: true }, { id: 'cat/r:b', from: 'mod', to: 'catalog' }])
  assert.equal(needsReview(8000, 8000, released), true)
  // A keeper that becomes a duplicate itself keeps its copy collapsed, as the scan's list order does.
  mods = [rec('o/c:.', 'duplicate', { duplicateOf: 'o/d:.' }), rec('o/d:.'), rec('o/e:.')]
  assert.deepEqual(reclassify(mods, rules({ duplicates: new Map([['o/c:.', 'o/d:.']]) }), rules({ duplicates: new Map([['o/c:.', 'o/d:.'], ['o/d:.', 'o/e:.']]) })), [{ id: 'o/d:.', from: 'mod', to: 'duplicate', duplicateOf: 'o/e:.' }])

  assert.equal(needsReview(8000, 7995, Array(5).fill({})), false)
  assert.equal(needsReview(8000, 8000, Array(51).fill({})), true)
  assert.equal(needsReview(8000, 7950, Array(50).fill({})), true)
})

test('the reclassify command reads the old rules from a commit and writes only refiled records', t => {
  const root = mkdtempSync(join(tmpdir(), 'reclassify-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'data')); mkdirSync(join(root, 'tools'))
  for (const name of ['kind.mjs', 'dedupe.mjs', 'reclassify.mjs']) writeFileSync(join(root, 'tools', name), readFileSync(new URL(`./${name}`, import.meta.url)))
  const rec = (id, kind = 'mod') => ({ id, repo: id.split(':')[0], path: id.split(':')[1], name: 'n', description: '', kind })
  writeFileSync(join(root, 'data/mods.json'), JSON.stringify({ claudeVersion: '1', repos: 3, mods: [rec('o/a:.'), rec('o/b:x'), rec('o/c:.')] }, null, 2) + '\n')
  writeFileSync(join(root, 'data/duplicates.txt'), '# pairs\n')
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD').stdout.trim()
  const run = () => spawnSync(process.execPath, ['tools/reclassify.mjs', '--base', base, '--result', 'result.txt', '--changes', 'changes.txt'], { cwd: root, encoding: 'utf8' })
  assert.equal(run().status, 0)
  assert.equal(readFileSync(join(root, 'result.txt'), 'utf8'), 'unchanged\n')
  assert.equal(git('status', '--porcelain', 'data').stdout, '')
  writeFileSync(join(root, 'data/duplicates.txt'), '# pairs\no/a:. o/b:x\n')
  const applied = run()
  assert.equal(applied.status, 0, applied.stderr)
  assert.equal(readFileSync(join(root, 'result.txt'), 'utf8'), 'review\n', 'one of three counted mods is far past the share that publishes unread')
  assert.equal(readFileSync(join(root, 'changes.txt'), 'utf8'), '3 to 2 counted mods\no/a:.: mod to duplicate (duplicate of o/b:x)\n')
  const mods = JSON.parse(readFileSync(join(root, 'data/mods.json'), 'utf8')).mods
  assert.deepEqual(mods.map(m => [m.id, m.kind, m.duplicateOf]), [['o/a:.', 'duplicate', 'o/b:x'], ['o/b:x', 'mod', undefined], ['o/c:.', 'mod', undefined]])
  assert.notEqual(spawnSync(process.execPath, ['tools/reclassify.mjs', '--base', 'main'], { cwd: root, encoding: 'utf8' }).status, 0)
})
