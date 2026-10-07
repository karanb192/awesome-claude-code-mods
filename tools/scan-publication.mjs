import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { mergeRepos, parseRepos, readRepos } from './candidates.mjs'
import { looksPartial } from './changed.mjs'
import { revalidatePublished } from './revalidate-publication.mjs'

const key = repo => repo.toLowerCase()
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const jsonAt = (ref, path) => JSON.parse(git('show', `${ref}:${path}`))
const reposAt = ref => parseRepos(git('show', `${ref}:data/repos.txt`))

export function reconcileScan(before, scanned, latest, beforeRepos, scannedRepos, latestRepos, seeds, revalidate = revalidatePublished) {
  const partial = looksPartial(before, scanned)
  if (partial) throw new Error(partial)
  if (latest.generated > scanned.generated) throw new Error('A newer full scan has been published; run a fresh scan')
  const groups = data => {
    const result = new Map()
    for (const mod of data.mods) {
      const repo = key(mod.repo)
      result.set(repo, [...(result.get(repo) ?? []), mod])
    }
    for (const mods of result.values()) mods.sort((a, b) => a.id.localeCompare(b.id))
    return result
  }
  const old = groups(before), current = groups(latest), fresh = groups(scanned)
  const changed = new Set([...old.keys(), ...current.keys()].filter(repo => JSON.stringify(old.get(repo)) !== JSON.stringify(current.get(repo))))
  const removed = new Set(beforeRepos.map(key).filter(repo => !latestRepos.some(r => key(r) === repo)))
  const mods = [...fresh].filter(([repo]) => !changed.has(repo) && !removed.has(repo)).flatMap(([, records]) => records)
  const concurrent = [...changed].flatMap(repo => current.get(repo) ?? [])
  const outdated = concurrent.filter(mod => mod.validate.claudeVersion !== scanned.claudeVersion)
  const validated = new Map((outdated.length ? revalidate(outdated, scanned.claudeVersion) : []).map(mod => [mod.id, mod]))
  for (const mod of concurrent) {
    const updated = validated.get(mod.id) ?? mod
    if (updated.validate.claudeVersion !== scanned.claudeVersion || updated.sourceCommit !== mod.sourceCommit) throw new Error(`Revalidation did not verify the published revision: ${mod.id}`)
    mods.push(updated)
  }
  // A concurrent retirement can remove the keeper of a duplicate found by the scan.
  const byId = new Map(mods.map(mod => [mod.id, mod]))
  for (const mod of mods) {
    if (mod.kind !== 'duplicate') continue
    const seen = new Set([mod.id])
    let keeper = byId.get(mod.duplicateOf)
    while (keeper?.kind === 'duplicate' && !seen.has(keeper.id)) {
      seen.add(keeper.id)
      keeper = byId.get(keeper.duplicateOf)
    }
    if (!keeper || keeper.kind !== 'mod') throw new Error(`Duplicate keeper changed for ${mod.id}; run a fresh scan`)
  }
  mods.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || a.id.localeCompare(b.id))
  const repos = mergeRepos(latestRepos, scannedRepos.filter(repo => !removed.has(key(repo))), seeds, mods.map(mod => mod.repo))
  return { inventory: { ...scanned, repos: repos.length, mods }, repos }
}

export function assertReusable(base, latest) {
  const inputs = ['tools/scan.mjs', 'tools/parse.mjs', 'tools/validate.mjs', 'tools/compatibility.mjs', 'tools/grade.mjs', 'tools/dedupe.mjs', 'tools/kind.mjs', 'tools/inventory.mjs', 'tools/meta.mjs', 'tools/directory.mjs', 'tools/candidates.mjs', 'tools/discover.mjs', 'tools/recent.mjs', 'tools/github-search.mjs', 'tools/revalidate-publication.mjs', 'package.json', 'package-lock.json', 'data/duplicates.txt', 'data/catalogs.txt', 'data/fixture-exceptions.txt']
  if (git('diff', '--name-only', base, latest, '--', ...inputs)) throw new Error('Scanner inputs changed since this scan; run a fresh scan')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { capture: { type: 'boolean' }, snapshot: { type: 'string' }, ref: { type: 'string' }, cache: { type: 'string' } } })
  if (values.capture) {
    const base = values.ref ? git('merge-base', 'origin/main', values.ref) : git('rev-parse', 'HEAD')
    const scanned = values.ref ? jsonAt(values.ref, 'data/mods.json') : JSON.parse(readFileSync('data/mods.json', 'utf8'))
    const repos = values.ref ? reposAt(values.ref) : readRepos('data/repos.txt')
    const discovery = values.ref ? jsonAt(values.ref, 'data/discovery.json') : JSON.parse(readFileSync('data/discovery.json', 'utf8'))
    writeFileSync(values.snapshot, JSON.stringify({ base, scanned, repos, discovery }))
  } else {
    const saved = JSON.parse(readFileSync(values.snapshot, 'utf8'))
    assertReusable(saved.base, 'HEAD')
    const latest = JSON.parse(readFileSync('data/mods.json', 'utf8'))
    const cache = values.cache && existsSync(values.cache) ? JSON.parse(readFileSync(values.cache, 'utf8')) : {}
    const result = reconcileScan(jsonAt(saved.base, 'data/mods.json'), saved.scanned, latest, reposAt(saved.base), saved.repos, readRepos('data/repos.txt'), readRepos('data/seeds.txt'), (records, version) => revalidatePublished(records, version, cache))
    if (values.cache) writeFileSync(values.cache, JSON.stringify(cache))
    writeFileSync('data/mods.json', JSON.stringify(result.inventory, null, 2) + '\n')
    writeFileSync('data/repos.txt', result.repos.join('\n') + '\n')
    // A merged scan may have advanced discovery after this snapshot was captured.
    if (git('show', `${saved.base}:data/discovery.json`) === git('show', 'HEAD:data/discovery.json')) {
      writeFileSync('data/discovery.json', JSON.stringify(saved.discovery, null, 2) + '\n')
    }
  }
}
