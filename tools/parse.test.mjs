import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseValidateOutput, parseHooks, parseCalls } from './parse.mjs'
import { grade, visibility, drawsOn } from './grade.mjs'

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
import { search, shrunk } from './discover.mjs'

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
  assert.deepEqual([...readDuplicates('data/duplicates.txt')], [['galElmalah/claude-queue-plugin:.', 'galElmalah/claude-mods:claude-queue']])
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

test('fixtures never count', () => {
  const after = clone(); after.mods[1].calls = ['$.http.fetch']
  assert.equal(fingerprint(base), fingerprint(after))
})

test('a scan that lost most of its mods or repos is partial, a small dip is not', () => {
  const many = { repos: 90, mods: Array.from({ length: 30 }, (_, i) => ({ id: `r/${i}:.`, kind: 'mod' })) }
  const few = { repos: 2, mods: many.mods.slice(0, 1) }
  assert.match(looksPartial(many, few), /1 mods where the committed scan has 30/)
  assert.equal(looksPartial(many, { repos: 88, mods: many.mods.slice(0, 27) }), null)
  assert.match(looksPartial(many, { repos: 30, mods: many.mods }), /30 candidate repos where the committed scan has 90/)
  assert.equal(looksPartial({ repos: 0, mods: [] }, few), null)
})

test('a candidate list that halves is refused, a first run is not', () => {
  assert.equal(shrunk(92, 2), true)
  assert.equal(shrunk(92, 60), false)
  assert.equal(shrunk(0, 2), false)
})

test('search retries a rate limit with the hinted wait and throws when it never clears', () => {
  let calls = 0
  const limited = () => { calls++; const e = new Error('gh: try again in 0.01s (HTTP 429)'); e.stderr = Buffer.from(e.message); throw e }
  assert.throws(() => search('q', limited, 3, () => {}), /code search failed/)
  assert.equal(calls, 3)
  let n = 0
  const flaky = () => { n++; if (n < 2) { const e = new Error('HTTP 429'); e.stderr = Buffer.from('gh: try again in 0.01s (HTTP 429)'); throw e }; return ['a/b'] }
  assert.deepEqual(search('q', flaky, 3, () => {}), ['a/b'])
  const broken = () => { const e = new Error('gh: HTTP 401 bad credentials'); e.stderr = Buffer.from(e.message); throw e }
  assert.throws(() => search('q', broken, 3, () => {}), /code search failed/)
})
