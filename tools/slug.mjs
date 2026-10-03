// Badge files and website anchors are named owner--repo--name. Two plugins in one repo can share
// a name; the one closest to the repo root keeps the plain key and the others add their path, so
// no badge or anchor is overwritten and existing badge links stay stable.

const clean = s => s.replace(/[^A-Za-z0-9._-]/g, '-')
export const baseSlug = m => clean(`${m.repo.replace('/', '--')}--${m.name}`)

export function slugs(mods) {
  const groups = new Map()
  for (const m of mods) groups.set(baseSlug(m), [...(groups.get(baseSlug(m)) ?? []), m])
  const out = new Map(), taken = new Set()
  for (const [base, group] of groups) {
    const ordered = [...group].sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : 0) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    ordered.forEach((m, i) => {
      let slug = i === 0 ? base : `${base}--${clean(m.path.replace(/\//g, '-'))}`
      for (let n = 2; taken.has(slug); n++) slug = `${base}--${n}`
      taken.add(slug)
      out.set(m, slug)
    })
  }
  return out
}
