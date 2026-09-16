// One author shipping the same mod from two repos (a standalone repo and a monorepo copy, say)
// is one mod, not two. Entries that share a repo owner and a manifest name collapse onto the
// copy pushed most recently, since that is where the author's current code lives; the others
// stay in the data as `duplicate` with a pointer, so the change gate can show what collapsed.

export function collapseDuplicates(mods) {
  const groups = new Map()
  for (const m of mods) {
    if (m.kind !== 'mod') continue
    const key = `${m.repo.split('/')[0]}:${m.name}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '') || (b.stars ?? -1) - (a.stars ?? -1) || a.id.localeCompare(b.id))
    const [keeper, ...rest] = group
    for (const m of rest) { m.kind = 'duplicate'; m.duplicateOf = keeper.id }
  }
  return mods
}
