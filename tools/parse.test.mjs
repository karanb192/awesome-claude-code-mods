import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseValidateOutput, parseHooks, parseCalls } from './parse.mjs'
import { grade, visibility, drawsOn } from './grade.mjs'
import { validate, relativePaths } from './validate.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
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
  assert.deepEqual(describeChange(base, broken), ['a/b:.: validate passed to failed'])
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
  assert.equal(kindOf('a/b', 'skills/builder/assets/probe-mod', { name: 'probe-mod', description: '[probe] Loaded headlessly by the builder. Not a mod to install.' }), 'fixture')
  assert.equal(kindOf('a/b', 'plugins/clip', { name: 'clip', description: 'A mod to install from the marketplace.' }), 'mod')
  assert.equal(kindOf('a/b', 'upstreams/claude-code/mods/telemetry', { name: 'telemetry' }), 'fixture')
  assert.equal(kindOf('a/b', 'vendor/mods/telemetry', { name: 'telemetry' }), 'mirror')
  assert.equal(kindOf('cat/templates', 'components/mods/games/tetris', { name: 'tetris' }, catalogs), 'catalog')
  assert.equal(kindOf('cat/templates', 'tests/fixtures/x', { name: 'x' }, catalogs), 'fixture')
  assert.equal(kindOf('a/b', 'plugins/x', { name: 'x' }, catalogs), 'mod')
  assert.deepEqual([...readCatalogs('data/catalogs.txt')], ['davila7/claude-code-templates'])
  assert.deepEqual([...readCatalogs('data/no-such-file.txt')], [])
  const after = clone()
  after.mods.push({ ...clone().mods[0], id: 'cat/templates:mods/x', repo: 'cat/templates', kind: 'catalog' })
  assert.deepEqual(describeChange(base, after), ['new: cat/templates:mods/x (catalog, not counted)'])
})

test('fixtures never count', () => {
  const after = clone(); after.mods[1].calls = ['$.http.fetch']
  assert.equal(fingerprint(base), fingerprint(after))
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

test('validator errors keep paths relative to the scanned repository', t => {
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
  assert.equal(result.status, 'failed')
  assert.ok(result.errors.length > 0)
  for (const error of result.errors) assert.ok(!error.includes(root), error)
  assert.match(result.errors.join('\n'), /plugins\/demo\/hooks\/register\.ts: no such file \(from other__repo\/x\.ts\)/)
  assert.equal(relativePaths('/tmp/c/owner__repo', ['/tmp/c/owner__repo']), '.')
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
