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
import { applyDuplicates, suspectDuplicates, readDuplicates } from './dedupe.mjs'
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
  assert.equal(kindOf('a/b', 'plugins/clip', { name: 'clip' }), 'mod')
  assert.equal(kindOf('a/b', '.', { name: 'x', description: 'A test fixture, not a product mod' }), 'fixture')
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
