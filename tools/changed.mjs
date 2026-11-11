#!/usr/bin/env node
// Decides whether a fresh scan is worth a pull request. Compares the scan in
// the working tree against the last committed one on the fields that matter:
// which mods exist, what they hook and call, whether they validate, and the
// Claude Code version. Stars and timestamps move every night and do not count.
// Exit 0 when something meaningful changed, 1 when nothing did, 2 when the
// scan looks partial and must not be merged.
//
//   node tools/changed.mjs            # compares data/mods.json to git HEAD
//   node tools/changed.mjs old new    # compares two files
//   --title FILE --summary FILE       # also write the scan pull request's title and opening lines

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { suspectDuplicates } from './dedupe.mjs'
import { hasFootprint } from './grade.mjs'

export function fingerprint(data) {
  const mods = [...data.mods]
    .filter(m => m.kind !== 'fixture')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(m => ({
      id: m.id, kind: m.kind, name: m.name, description: m.description,
      hooks: m.hooks, calls: m.calls, reach: hasFootprint(m) ? { level: m.reach.level, labels: m.reach.labels } : null, sees: m.sees,
      footprint: hasFootprint(m),
      validates: m.validate.status, archived: m.archived,
      marketplaces: m.marketplaces ?? [], compatibility: m.compatibility ?? null, directory: m.directory ?? null,
    }))
  return JSON.stringify({ claudeVersion: data.claudeVersion, mods })
}

// A scan that lost more than a third of the mods overnight is a scan that
// failed halfway (a rate-limited search, a clone that timed out), not a
// change in the world. Returns the reason, or null when the scan looks whole.
export function looksPartial(before, after) {
  const count = d => d.mods.filter(m => m.kind === 'mod').length
  const b = count(before), a = count(after)
  if (b >= 5 && a < Math.ceil(b * 2 / 3)) return `scan looks partial: ${a} mods where the committed scan has ${b}`
  const rb = before.repos ?? 0, ra = after.repos ?? 0
  if (rb >= 5 && ra < Math.ceil(rb / 2)) return `scan looks partial: ${ra} candidate repos where the committed scan has ${rb}`
  return null
}

export function describeChange(before, after) {
  const a = new Map(before.mods.filter(m => m.kind !== 'fixture').map(m => [m.id, m]))
  const b = new Map(after.mods.filter(m => m.kind !== 'fixture').map(m => [m.id, m]))
  const lines = []
  if (before.claudeVersion !== after.claudeVersion) lines.push(`Claude Code ${before.claudeVersion} to ${after.claudeVersion}`)
  const dup = m => m.kind === 'duplicate' ? ` (duplicate of ${m.duplicateOf})` : m.kind === 'catalog' ? ' (catalog, not counted)' : ''
  for (const [id, m] of b) if (!a.has(id)) lines.push(`new: ${id}${dup(m)}`)
  for (const id of a.keys()) if (!b.has(id)) lines.push(`gone: ${id}`)
  for (const [id, m] of b) {
    const o = a.get(id); if (!o) continue
    if (o.kind !== m.kind) lines.push(`${id}: ${o.kind} to ${m.kind}${dup(m)}`)
    if (o.validate.status !== m.validate.status) lines.push(`${id}: validate ${o.validate.status} to ${m.validate.status}`)
    if (JSON.stringify(o.marketplaces ?? []) !== JSON.stringify(m.marketplaces ?? [])) lines.push(`${id}: marketplace validation changed`)
    if (JSON.stringify(o.compatibility ?? null) !== JSON.stringify(m.compatibility ?? null)) lines.push(`${id}: compatibility review changed`)
    if (JSON.stringify(o.directory ?? null) !== JSON.stringify(m.directory ?? null)) lines.push(`${id}: ${m.directory ? 'now listed in' : 'no longer listed in'} Anthropic's directory`)
    const reach = mod => hasFootprint(mod) ? `L${mod.reach.level}` : 'unknown'
    if (reach(o) !== reach(m)) lines.push(`${id}: reach ${reach(o)} to ${reach(m)}`)
    else if (hasFootprint(o) && hasFootprint(m) && JSON.stringify(o.reach.labels) !== JSON.stringify(m.reach.labels) && JSON.stringify(o.calls) === JSON.stringify(m.calls)) lines.push(`${id}: access labels changed`)
    else if (JSON.stringify(o.calls) !== JSON.stringify(m.calls) || JSON.stringify(o.hooks) !== JSON.stringify(m.hooks)) lines.push(`${id}: footprint changed`)
  }
  for (const pair of suspectDuplicates(after.mods)) lines.push(`possible duplicate: ${pair.join(' and ')} share an owner and a name; if they are one mod, add the pair to data/duplicates.txt`)
  return lines
}

// The scan pull request's title and opening lines: how the counted total moved, and the few
// changes that need a person's call before the list below them is worth reading. A record that is
// gone, a mod that moved inside its repository and now counts beside its retained old path (or
// lost its fixture filing in the move), and a same-owner same-name pair this scan introduced.
export function summarize(before, after) {
  const counted = data => data.mods.filter(m => m.kind === 'mod').length
  const n = value => value.toLocaleString('en-US')
  const old = new Map(before.mods.map(m => [m.id, m]))
  const now = new Map(after.mods.map(m => [m.id, m]))
  const added = after.mods.filter(m => !old.has(m.id)), gone = before.mods.filter(m => !now.has(m.id))
  const missing = m => (m.validate?.errors ?? []).some(error => error.startsWith('Not found in this scan'))
  const decisions = gone.map(m => `gone: ${m.id} (${m.kind}) is no longer in the inventory`)
  const moved = new Set()
  for (const fresh of added) {
    if (fresh.kind !== 'mod') continue
    for (const left of after.mods) {
      if (left.id === fresh.id || !missing(left) || left.name !== fresh.name || left.repo.toLowerCase() !== fresh.repo.toLowerCase()) continue
      moved.add(left.id).add(fresh.id)
      decisions.push(left.kind === 'mod'
        ? `counted twice: ${left.id} moved to ${fresh.id}; add the pair to data/duplicates.txt`
        : `filing lost in a move: ${left.id} is a ${left.kind}, but its new path ${fresh.id} counts as a mod`)
    }
  }
  const known = new Set(suspectDuplicates(before.mods).map(group => group.join(' ')))
  for (const group of suspectDuplicates(after.mods)) {
    if (known.has(group.join(' ')) || group.every(id => moved.has(id))) continue
    decisions.push(`possible duplicate: ${group.join(' and ')} share an owner and a name; if they are one mod, add the pair to data/duplicates.txt`)
  }
  const was = counted(before), is = counted(after)
  const title = was === is ? `Scan: ${n(is)} mods, footprints refreshed` : `Scan: ${n(was)} to ${n(is)} mods (${n(added.length)} new, ${n(gone.length)} gone)`
  const reclassified = after.mods.filter(m => old.has(m.id) && old.get(m.id).kind !== m.kind).length
  const lines = [
    `**${was === is ? `${n(is)} counted mods, unchanged` : `${n(was)} to ${n(is)} counted mods`}.** ${n(added.length)} new records (${n(added.filter(m => m.kind === 'mod').length)} counted), ${n(gone.length)} gone, ${n(reclassified)} reclassified.`,
    '',
    '## Needs a decision',
    ...(decisions.length ? decisions.map(line => `- ${line}`) : ['Nothing. No record is gone, moved inside its repository or newly suspected as a copy.']),
  ]
  return { title, lines, decisions }
}

// Exit 1 means "nothing changed" to the workflow, so a crash must not end with it.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('uncaughtException', error => { console.error(error); process.exit(2) })
  const { values: options, positionals: [oldPath, newPath] } = parseArgs({ allowPositionals: true, options: { title: { type: 'string' }, summary: { type: 'string' } } })
  const after = JSON.parse(readFileSync(newPath ?? 'data/mods.json', 'utf8'))
  const before = JSON.parse(oldPath ? readFileSync(oldPath, 'utf8') : execFileSync('git', ['show', 'HEAD:data/mods.json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }))
  const partial = looksPartial(before, after)
  if (partial) {
    console.error(`refusing: ${partial}. Not a change worth a pull request; check the discover and scan logs.`)
    process.exit(2)
  }
  const lines = describeChange(before, after)
  const summary = summarize(before, after)
  if (options.title) writeFileSync(options.title, summary.title + '\n')
  if (options.summary) writeFileSync(options.summary, summary.lines.join('\n') + '\n')
  const changed = fingerprint(before) !== fingerprint(after)
  console.log(changed ? lines.join('\n') || 'changed' : 'no meaningful change')
  process.exit(changed ? 0 : 1)
}
