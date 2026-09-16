// A mod its author has moved or copied to another repo shows up twice in a scan. The pairs
// that are one mod are recorded by hand in data/duplicates.txt; the scanner applies that
// list and flags same-owner same-name candidates for review, but never collapses on its own,
// because owner plus manifest name is not a durable identity and a wrong match hides a mod.

import { readFileSync } from 'node:fs'

export function readDuplicates(path = 'data/duplicates.txt') {
  let text; try { text = readFileSync(path, 'utf8') } catch { return new Map() }
  return new Map(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/)))
}

// Marks each listed copy as `duplicate` with a pointer, but only while the copy that counts is
// still in the scan as a mod: once a successor disappears, the superseded copy counts again.
export function applyDuplicates(mods, list) {
  const byId = new Map(mods.map(m => [m.id, m]))
  for (const [dup, keeper] of list) {
    const m = byId.get(dup), k = byId.get(keeper)
    if (!m || m.kind !== 'mod' || !k || k.kind !== 'mod') continue
    m.kind = 'duplicate'; m.duplicateOf = keeper
  }
  return mods
}

// Pairs of counted mods that share a repo owner and a manifest name and are not on the list.
export function suspectDuplicates(mods) {
  const groups = new Map()
  for (const m of mods) {
    if (m.kind !== 'mod') continue
    const key = `${m.repo.split('/')[0]}:${m.name}`
    groups.set(key, [...(groups.get(key) ?? []), m.id])
  }
  return [...groups.values()].filter(g => g.length > 1).map(g => g.sort())
}
