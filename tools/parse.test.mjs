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
