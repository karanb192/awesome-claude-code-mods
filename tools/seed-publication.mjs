import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { mergeRepos, readRepos } from './candidates.mjs'
import { applyDuplicates, readDuplicates, suspectDuplicates } from './dedupe.mjs'

const ACCEPTED = ['passed', 'warnings']
const key = repo => repo.toLowerCase()

export function pendingSeeds(seeds, inventory) {
  const published = new Set(inventory.mods.map(mod => key(mod.repo)))
  return mergeRepos(seeds).filter(repo => !published.has(key(repo)))
}

// Why one repository cannot publish automatically, or null when every record qualifies.
export function reviewSeed(mods, claudeVersion, publishedIds) {
  if (!mods.some(mod => mod.kind === 'mod')) return 'no validating mod plugins found; the repository may have failed to clone'
  for (const mod of mods) {
    if (publishedIds.has(mod.id)) return `plugin ID already published: ${mod.id}`
    if (mod.validate.claudeVersion !== claudeVersion) return `validator mismatch: ${mod.id}`
    if (mod.kind !== 'mod') continue
    if (!ACCEPTED.includes(mod.validate.status)) return `validation needs review: ${mod.id}`
    if ((mod.marketplaces ?? []).some(market => !ACCEPTED.includes(market.status))) return `marketplace needs review: ${mod.id}`
    if (mod.compatibility?.warnings?.length) return `compatibility needs review: ${mod.id}`
  }
  return null
}

// Publishes every seed whose records qualify and reports the rest, so one broken seed does
// not hold back the batch. Only inconsistencies in the scan itself stop the whole run.
export function appendSeeds(before, scanned, seeds, candidates, duplicates = new Map()) {
  const wanted = mergeRepos(seeds)
  const wantedKeys = new Set(wanted.map(key))
  if (!wanted.length) throw new Error('No unpublished seeds')
  if (before.claudeVersion !== scanned.claudeVersion) throw new Error('Use the published validator version for seed additions')
  if (before.mods.some(mod => wantedKeys.has(key(mod.repo)))) throw new Error('Seed already published; restart from current main')
  const ids = new Set()
  for (const mod of scanned.mods) {
    if (!wantedKeys.has(key(mod.repo))) throw new Error(`Unapproved repository: ${mod.repo}`)
    if (ids.has(mod.id)) throw new Error(`Duplicate plugin ID: ${mod.id}`)
    ids.add(mod.id)
  }
  const publishedIds = new Set(before.mods.map(mod => mod.id))
  const checked = new Set((scanned.checkedRepos ?? []).map(key))
  const skipped = []
  let accepted = wanted.filter(repo => {
    const records = scanned.mods.filter(mod => key(mod.repo) === key(repo))
    const reason = reviewSeed(records, before.claudeVersion, publishedIds)
      ?? (checked.has(key(repo)) ? null : 'repository was not fully inspected; retry or repair malformed hooks')
    if (reason) skipped.push({ repo, reason })
    return !reason
  })
  for (;;) {
    const acceptedKeys = new Set(accepted.map(key))
    const added = scanned.mods.filter(mod => acceptedKeys.has(key(mod.repo)))
    const mods = structuredClone([...before.mods, ...added])
    applyDuplicates(mods, duplicates)
    const repoOf = id => mods.find(mod => mod.id === id)?.repo
    const drop = new Map()
    before.mods.forEach((mod, i) => {
      if (JSON.stringify(mods[i]) !== JSON.stringify(mod)) drop.set(repoOf(mods[i].duplicateOf), `reclassifies ${mod.id} as a duplicate; manual review required`)
    })
    const addedIds = new Set(added.map(mod => mod.id))
    for (const pair of suspectDuplicates(mods)) {
      for (const id of pair) if (addedIds.has(id)) drop.set(repoOf(id), `possible duplicate: ${pair.join(' and ')} share an owner and a name`)
    }
    for (const [repo, reason] of drop) {
      if (!repo || !acceptedKeys.has(key(repo))) throw new Error('Seed changes an existing duplicate decision; manual review required')
      skipped.push({ repo, reason })
    }
    if (drop.size) {
      const droppedKeys = new Set([...drop.keys()].map(key))
      accepted = accepted.filter(repo => !droppedKeys.has(key(repo)))
      continue
    }
    if (!accepted.length) return { inventory: null, repos: null, published: [], skipped }
    const repos = mergeRepos(candidates, accepted)
    // Keep the full-scan timestamp: existing entries were not rescanned.
    return { inventory: { ...before, repos: repos.length, mods }, repos, published: accepted, skipped }
  }
}

export function planPublication(before, scanned, requested, approved, candidates, duplicates) {
  const requestedKeys = new Set(mergeRepos(requested).map(key))
  if (scanned.mods.some(mod => !requestedKeys.has(key(mod.repo)))) throw new Error('Scan includes a repository that was not requested')
  const pending = pendingSeeds(approved, before).filter(repo => requestedKeys.has(key(repo)))
  if (!pending.length) return null
  const selected = new Set(pending.map(key))
  return appendSeeds(before, { ...scanned, mods: scanned.mods.filter(mod => selected.has(key(mod.repo))) }, pending, candidates, duplicates)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { prepare: { type: 'boolean' }, repos: { type: 'string' }, scan: { type: 'string' }, result: { type: 'string' }, skipped: { type: 'string' } } })
  const inventory = JSON.parse(readFileSync('data/mods.json', 'utf8'))
  if (values.prepare) {
    const pending = pendingSeeds(readRepos('data/seeds.txt'), inventory)
    if (!/^\d+\.\d+\.\d+$/.test(inventory.claudeVersion)) throw new Error('Invalid published validator version')
    writeFileSync(values.repos, pending.join('\n') + (pending.length ? '\n' : ''))
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending.length > 0}\nversion=${inventory.claudeVersion}\n`)
    console.log(`${pending.length} unpublished seed repositories`)
  } else {
    const result = planPublication(inventory, JSON.parse(readFileSync(values.scan, 'utf8')), readRepos(values.repos), readRepos('data/seeds.txt'), readRepos('data/repos.txt'), readDuplicates())
    if (result?.inventory) {
      writeFileSync('data/mods.json', JSON.stringify(result.inventory, null, 2) + '\n')
      writeFileSync('data/repos.txt', result.repos.join('\n') + '\n')
    }
    for (const { repo, reason } of result?.skipped ?? []) console.log(`not published: ${repo}: ${reason}`)
    if (values.result) writeFileSync(values.result, result?.inventory ? 'added\n' : 'unchanged\n')
    if (values.skipped) writeFileSync(values.skipped, (result?.skipped ?? []).map(({ repo, reason }) => `- ${repo}: ${reason}\n`).join(''))
  }
}
