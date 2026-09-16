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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export function fingerprint(data) {
  const mods = [...data.mods]
    .filter(m => m.kind !== 'fixture')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(m => ({
      id: m.id, kind: m.kind, name: m.name, description: m.description,
      hooks: m.hooks, calls: m.calls, reach: m.reach.level, sees: m.sees,
      validates: m.validate.status, archived: m.archived,
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
  for (const id of b.keys()) if (!a.has(id)) lines.push(`new: ${id}`)
  for (const id of a.keys()) if (!b.has(id)) lines.push(`gone: ${id}`)
  for (const [id, m] of b) {
    const o = a.get(id); if (!o) continue
    if (o.validate.status !== m.validate.status) lines.push(`${id}: validate ${o.validate.status} to ${m.validate.status}`)
    if (o.reach.level !== m.reach.level) lines.push(`${id}: reach L${o.reach.level} to L${m.reach.level}`)
    else if (JSON.stringify(o.calls) !== JSON.stringify(m.calls) || JSON.stringify(o.hooks) !== JSON.stringify(m.hooks)) lines.push(`${id}: footprint changed`)
  }
  return lines
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [oldPath, newPath] = process.argv.slice(2)
  const after = JSON.parse(readFileSync(newPath ?? 'data/mods.json', 'utf8'))
  const before = JSON.parse(oldPath ? readFileSync(oldPath, 'utf8') : execFileSync('git', ['show', 'HEAD:data/mods.json'], { encoding: 'utf8' }))
  const partial = looksPartial(before, after)
  if (partial) {
    console.error(`refusing: ${partial}. Not a change worth a pull request; check the discover and scan logs.`)
    process.exit(2)
  }
  const lines = describeChange(before, after)
  const changed = fingerprint(before) !== fingerprint(after)
  console.log(changed ? lines.join('\n') || 'changed' : 'no meaningful change')
  process.exit(changed ? 0 : 1)
}
