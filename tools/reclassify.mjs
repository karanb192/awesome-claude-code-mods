#!/usr/bin/env node
// Re-applies the classification rules to the committed inventory after one of them changes on
// main, without cloning anything: tools/kind.mjs, data/catalogs.txt, data/fixture-exceptions.txt
// and data/duplicates.txt. A scan applies the same rules to fresh checkouts; this covers the hours
// between a rule merging and the next scan being merged, when the count would still be the old one.
// It changes only what the rule change explains. A record is refiled only when the old rules
// reproduce its committed kind, because the inventory keeps a plugin's name and description with
// repository fallbacks, not the manifest fields the scan filed it from. Duplicate pairs are read as
// written: a pair that names a repository's earlier name waits for the next scan.
//
//   node tools/reclassify.mjs --base <commit> [--result FILE] [--changes FILE]
//
// --result receives `unchanged`, `changed`, or `review` when the change is too large to publish unread
// or leaves a copy without the mod it duplicated.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { applyDuplicates, readDuplicates } from './dedupe.mjs'
import * as kind from './kind.mjs'

// More than this many refiled records, or a counted total that moves by more than this share, is
// more likely a rule that matches too much than a correction.
const REVIEW_RECORDS = 50, REVIEW_SHARE = 0.005

export function reclassify(mods, before, after) {
  const filed = (rules, m) => rules.kindOf(m.repo, m.path, { name: m.name, description: m.description }, rules.catalogs, rules.exceptions)
  const was = new Map(mods.map(m => [m.id, { kind: m.kind, duplicateOf: m.duplicateOf }]))
  for (const m of mods) {
    if (m.kind === 'duplicate' && before.duplicates.get(m.id) === m.duplicateOf && after.duplicates.get(m.id) !== m.duplicateOf) {
      m.kind = 'mod'; delete m.duplicateOf
    }
    const old = filed(before, m), now = filed(after, m)
    if (old === (m.kind === 'duplicate' ? 'mod' : m.kind) && now !== old) { m.kind = now; delete m.duplicateOf }
  }
  applyDuplicates(mods, new Map([...after.duplicates].filter(([copy, keeper]) => before.duplicates.get(copy) !== keeper)))
  // A copy counts again once the mod it was collapsed onto is refiled as something that does not
  // count, as it would in a scan. Which of the two should count is then a person's call.
  const byId = new Map(mods.map(m => [m.id, m])), released = new Set()
  for (const m of mods) {
    const keeper = m.kind === 'duplicate' ? byId.get(m.duplicateOf) : null
    if (!keeper || was.get(keeper.id).kind !== 'mod' || ['mod', 'duplicate'].includes(keeper.kind)) continue
    m.kind = filed(after, m); delete m.duplicateOf; released.add(m.id)
  }
  return mods.filter(m => was.get(m.id).kind !== m.kind || was.get(m.id).duplicateOf !== m.duplicateOf)
    .map(m => ({ id: m.id, from: was.get(m.id).kind, to: m.kind, ...(m.duplicateOf ? { duplicateOf: m.duplicateOf } : {}), ...(released.has(m.id) ? { released: true } : {}) }))
}

export function needsReview(countedBefore, countedAfter, changes) {
  return changes.length > REVIEW_RECORDS || Math.abs(countedAfter - countedBefore) > countedBefore * REVIEW_SHARE || changes.some(change => change.released)
}

const rulesIn = (module, dir) => ({
  kindOf: module.kindOf,
  catalogs: module.readCatalogs(join(dir, 'catalogs.txt')),
  exceptions: module.readFixtureExceptions(join(dir, 'fixture-exceptions.txt')),
  duplicates: readDuplicates(join(dir, 'duplicates.txt')),
})

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { base: { type: 'string' }, result: { type: 'string' }, changes: { type: 'string' } } })
  if (!values.base || !/^[a-f0-9]{40}$/.test(values.base)) throw new Error('a full base commit is required')
  const show = path => { try { return execFileSync('git', ['show', `${values.base}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' } }
  const old = mkdtempSync(join(tmpdir(), 'rules-base-'))
  let changes, was, is
  try {
    for (const name of ['catalogs.txt', 'fixture-exceptions.txt', 'duplicates.txt']) writeFileSync(join(old, name), show(`data/${name}`))
    writeFileSync(join(old, 'kind.mjs'), show('tools/kind.mjs'))
    const before = rulesIn(await import(pathToFileURL(join(old, 'kind.mjs'))), old)
    const data = JSON.parse(readFileSync('data/mods.json', 'utf8'))
    const counted = () => data.mods.filter(m => m.kind === 'mod').length
    was = counted()
    changes = reclassify(data.mods, before, rulesIn(kind, 'data'))
    is = counted()
    if (changes.length) writeFileSync('data/mods.json', JSON.stringify(data, null, 2) + '\n')
  } finally { rmSync(old, { recursive: true, force: true }) }
  const lines = changes.map(c => `${c.id}: ${c.from} to ${c.to}${c.duplicateOf ? ` (duplicate of ${c.duplicateOf})` : ''}${c.released ? ' (the mod it duplicated no longer counts)' : ''}`)
  const result = !changes.length ? 'unchanged' : needsReview(was, is, changes) ? 'review' : 'changed'
  console.log(changes.length ? `${was} to ${is} counted mods\n${lines.join('\n')}` : 'no record is refiled')
  if (values.result) writeFileSync(values.result, result + '\n')
  if (values.changes) writeFileSync(values.changes, [`${was.toLocaleString('en-US')} to ${is.toLocaleString('en-US')} counted mods`, ...lines].join('\n') + '\n')
}
