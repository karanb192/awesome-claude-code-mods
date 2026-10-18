import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { METHODS, grade, classified, regrade } from './grade.mjs'
import { fingerprint, describeChange } from './changed.mjs'

const members = JSON.parse(readFileSync(new URL('./api-members.json', import.meta.url), 'utf8'))

test('the table grades exactly the members Claude Code declares, and nothing else', () => {
  assert.equal(members.claudeCode, '2.1.302')
  assert.deepEqual(Object.keys(METHODS).sort(), [...members.methods, ...members.properties].sort())
  assert.equal(members.methods.length, 83)
  for (const property of members.properties) assert.deepEqual(METHODS[property], [0, null])
  assert.ok(!Object.keys(METHODS).some(key => /^(terminal|desktop|mobile|vscode)\./.test(key)), 'surface element constructors are not API calls')
})

test('methods the old rules missed or misgraded take the grade their declaration supports', () => {
  const at = call => { const { level, labels } = grade([call]); return [level, labels] }
  assert.deepEqual(at('$.process.spawn'), [2, ['runs processes']])
  assert.deepEqual(at('$.session.send'), [2, ['drives Claude']])
  assert.deepEqual(at('$.session.append'), [2, ['drives Claude']])
  assert.deepEqual(at('$.agent.register'), [2, ['drives Claude']])
  assert.deepEqual(at('$.mcp.connect'), [3, ['MCP servers']])
  assert.deepEqual(at('$.state.get'), [1, ['reads mod state']])
  assert.deepEqual(at('$.state.set'), [0, []])
  assert.deepEqual(at('$.prompt.read'), [1, ['reads the prompt box']])
  assert.deepEqual(at('$.prompt.media'), [1, ['reads prompt attachments']])
  assert.deepEqual(at('$.prompt.compose'), [1, ['reads the system prompt']])
  assert.deepEqual(at('$.ui.copy'), [1, ['writes the clipboard']])
  assert.deepEqual(at('$.ui.selection'), [1, ['reads the selection']])
  assert.deepEqual(at('$.session.repo'), [1, ['reads files']])
  assert.deepEqual(at('$.config.list'), [1, ['reads settings']])
  assert.deepEqual(at('$.session.authorize'), [1, ['requests an Anthropic credential handle']])
  assert.deepEqual(at('$.session.identity'), [1, ['reads your sign-in']])
  assert.deepEqual(at('$.tool.list'), [0, []])
  assert.deepEqual(at('$.tool.check'), [0, []])
})

test('a call the table does not know is unclassified, with no catch-all, and other namespaces are listed apart', () => {
  for (const call of ['$.session.newThing', '$.ui.render', '$.config.fresh', '$.fs.readFile', '$.prompt.steer']) {
    assert.deepEqual(grade([call]), { level: 1, name: 'reads', labels: [`other: ${call}`] }, call)
  }
  assert.deepEqual(grade(['$.mods.hello', '$.ui.open', '$.mods.hello']), { level: 1, name: 'reads', labels: ['draws', 'other: $.mods.hello'], foreign: ['$.mods.hello'] })
  assert.deepEqual(classified(['$.mods.hello', '$.prompt.steer', '$.fs.read']), { level: 1, name: 'reads', labels: ['reads files'], graded: 1, unclassified: ['$.prompt.steer'], foreign: ['$.mods.hello'] })
  assert.deepEqual(grade(['$.http.fetch', '$.mods.x'], false), { level: null, name: 'unknown', labels: ['network', 'other: $.mods.x'], minimumLevel: 3, foreign: ['$.mods.x'] })
})

test('regrading follows the table for scanned, retained and incomplete records and touches nothing else', () => {
  const kept = { id: 'a/b:x', calls: ['$.process.spawn'], reach: { level: 1, name: 'reads', labels: ['other: $.process.spawn'] },
    validate: { status: 'unknown', claudeVersion: '2.1.290', errors: ['Not found in this scan; retained pending weekly retirement review.'] },
    lastKnownValidate: { status: 'passed', claudeVersion: '2.1.290', errors: [] }, pushedAt: '2026-10-01T00:00:00Z' }
  const partial = { id: 'c/d:y', calls: ['$.http.fetch'], footprint: { status: 'unavailable' }, reach: { level: 3, name: 'network', labels: ['network'] }, validate: { status: 'failed', errors: ['x'] } }
  const before = structuredClone([kept, partial])
  regrade([kept, partial])
  assert.deepEqual(kept.reach, { level: 2, name: 'writes or runs', labels: ['runs processes'] })
  assert.deepEqual(partial.reach, { level: null, name: 'unknown', labels: ['network'], minimumLevel: 3 })
  for (const [i, record] of [kept, partial].entries()) assert.deepEqual({ ...record, reach: null }, { ...before[i], reach: null })
  assert.deepEqual(regrade(structuredClone([kept, partial])), [kept, partial], 'regrading twice gives the same result')
})

test('a grading change that only relabels a mod still counts as a change', () => {
  const record = level => ({ id: 'a/b:x', repo: 'a/b', kind: 'mod', name: 'x', description: 'd', hooks: [], calls: ['$.session.authorize'], sees: [], validate: { status: 'passed' }, archived: false,
    reach: { level, name: 'reads', labels: [level === 1 ? 'reads the transcript' : 'requests an Anthropic credential handle'] } })
  const before = { claudeVersion: '2.1.302', mods: [record(1)] }
  const after = { claudeVersion: '2.1.302', mods: [{ ...record(1), reach: { level: 1, name: 'reads', labels: ['requests an Anthropic credential handle'] } }] }
  assert.notEqual(fingerprint(before), fingerprint(after))
  assert.deepEqual(describeChange(before, after), ['a/b:x: access labels changed'])
})

test('a call named after an inherited object property is unclassified, never graded', () => {
  for (const call of ['$.constructor', '$.toString', '$.__proto__', '$.hasOwnProperty']) {
    const reach = grade([call, '$.http.fetch'])
    assert.equal(reach.level, 3, call)
    assert.ok(reach.labels.includes(`other: ${call}`), call)
    assert.ok(Number.isInteger(grade([call]).level), call)
  }
  assert.deepEqual(classified(['$.constructor']), { level: 0, name: 'draws and remembers', labels: [], graded: 0, unclassified: [], foreign: ['$.constructor'] })
})
