// A mod moved or copied by its author, or copied by someone else, can appear twice. Confirmed
// pairs are recorded by hand in data/duplicates.txt; the scanner applies that
// list and flags same-owner same-name candidates for review. It collapses on its own only a
// repository GitHub reports under a new name, because owner plus manifest name is not a
// durable identity and a wrong match hides a mod.

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

// A renamed repository still clones under its old name, so a scan that lists both names finds
// every plugin twice. Pairs each plugin under the old name with the same path under the name
// GitHub now reports, only when that copy came from this scan: a retained record of a failed
// clone must not hide a fresh one. Repository names match without case; plugin paths do not.
export function renamePairs(mods, currentName, freshIds) {
  const at = (repo, path) => `${repo.toLowerCase()}:${path}`
  const byPlace = new Map(mods.filter(m => freshIds.has(m.id)).map(m => [at(m.repo, m.path), m]))
  const pairs = new Map()
  for (const m of mods) {
    const now = currentName.get(m.repo.toLowerCase())
    if (!now || now.toLowerCase() === m.repo.toLowerCase()) continue
    const keeper = byPlace.get(at(now, m.path))
    if (keeper && keeper !== m) pairs.set(m.id, keeper.id)
  }
  return pairs
}

// Renames come first, and a hand-written pair that names an old repository name is read as the
// current name, so a rename followed by a listed move still leaves exactly one copy counted.
export function applyDuplicatesWithRenames(mods, list, renames) {
  applyDuplicates(mods, renames)
  const current = id => renames.get(id) ?? id
  applyDuplicates(mods, new Map([...list].map(([copy, keeper]) => [current(copy), current(keeper)]).filter(([copy, keeper]) => copy !== keeper)))
  return mods
}
