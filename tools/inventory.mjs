import { hasFootprint, truncatedFootprint } from './grade.mjs'

// Files whose change can alter what a scan records. A completed scan is reused on newer main only
// while these are unchanged. The scanner's per-repository cache is keyed more narrowly, on tools/inspect.mjs
// and its imports.
export const SCANNER_INPUTS = ['tools/scan.mjs', 'tools/inspect.mjs', 'tools/parse.mjs', 'tools/validate.mjs', 'tools/compatibility.mjs', 'tools/grade.mjs', 'tools/dedupe.mjs', 'tools/kind.mjs', 'tools/inventory.mjs', 'tools/meta.mjs', 'tools/directory.mjs', 'tools/candidates.mjs', 'tools/discover.mjs', 'tools/recent.mjs', 'tools/github-search.mjs', 'tools/revalidate-publication.mjs', 'package.json', 'package-lock.json', 'data/duplicates.txt', 'data/catalogs.txt', 'data/fixture-exceptions.txt']

export function reconcile(previous, current, checkedRepos, retire = false) {
  const ids = new Set(current.map(mod => mod.id))
  const kept = [...current], retired = []
  for (const mod of previous) {
    if (ids.has(mod.id)) continue
    const revision = checkedRepos.get(mod.repo.toLowerCase())
    if (retire && revision) {
      retired.push({ id: mod.id, repo: mod.repo, revision, reason: 'hook module no longer present in a fresh checkout' })
      continue
    }
    kept.push({
      ...mod,
      lastKnownValidate: mod.lastKnownValidate ?? mod.validate,
      validate: {
        status: 'unknown', claudeVersion: mod.validate.claudeVersion,
        errors: [revision ? 'Not found in this scan; retained pending weekly retirement review.' : 'Repository could not be scanned; showing the last known footprint.'],
      },
    })
  }
  return { mods: kept, retired }
}

// Why a newly submitted seed cannot be accepted, or null when it can. A footprint the validator shortened is
// accepted and listed as unknown access; one it did not report at all still needs a maintainer.
export function seedProblem(repo, mods, checkedRepos) {
  const records = mods.filter(mod => mod.repo.toLowerCase() === repo.toLowerCase())
  if (!checkedRepos.has(repo.toLowerCase())) {
    return records.length ? 'was not fully inspected (a malformed hooks.json or an incomplete UI source review; see the scan log)'
      : 'did not clone or could not be inspected (see the scan log)'
  }
  const matches = records.filter(mod => mod.kind === 'mod')
  if (!matches.length) return 'cloned, but contains no plugin with a hooks module that counts as a mod (test fixtures and catalogue copies do not count)'
  const failed = matches.find(mod => !['passed', 'warnings'].includes(mod.validate.status))
  if (failed) return `cloned, but ${failed.id} did not pass claude plugin validate (status: ${failed.validate.status})`
  const silent = matches.find(mod => !hasFootprint(mod) && !truncatedFootprint(mod))
  if (silent) return `cloned and validated, but the validator did not report hooks and calls for every module of ${silent.id}`
  return null
}

export function checkRequired(repos, mods, checkedRepos) {
  const problems = repos.map(repo => [repo, seedProblem(repo, mods, checkedRepos)]).filter(([, problem]) => problem)
  if (problems.length) throw new Error(problems.map(([repo, problem]) => `new seed ${repo} ${problem}`).join('\n'))
  return repos.flatMap(repo => mods.filter(mod => mod.repo.toLowerCase() === repo.toLowerCase() && mod.kind === 'mod' && truncatedFootprint(mod)).map(mod => mod.id))
}
