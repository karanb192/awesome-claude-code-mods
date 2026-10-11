#!/usr/bin/env node
// Clones every repo in data/repos.txt, finds each plugin whose hooks.json names
// a module, runs `claude plugin validate` on it and records the footprint the
// validator prints, and marks the ones Anthropic's plugin directory lists. Writes data/mods.json. Nothing here executes mod code.
// Repositories are scanned several at a time; each checkout is deleted once read unless --clones names a folder to keep.
// With --cache, a repository whose default branch has not moved since a scan with the same validator and
// checkout reader (tools/inspect.mjs and its imports) reuses that scan's findings instead of being cloned again.
//
//   node tools/scan.mjs [--clones DIR] [--repos FILE] [--out FILE] [--concurrency N] [--cache FILE]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnAsync } from './validate.mjs'
import { clone, inspect, findingsKey } from './inspect.mjs'
import { grade, visibility, drawsOn } from './grade.mjs'
import { readDuplicates, applyDuplicatesWithRenames, suspectDuplicates, renamePairs } from './dedupe.mjs'
import { kindOf, readCatalogs, readFixtureExceptions } from './kind.mjs'
import { parseArgs } from 'node:util'
import { readRepos, mergeRepos } from './candidates.mjs'
import { reconcile, checkRequired } from './inventory.mjs'
import { metaBatch } from './meta.mjs'
import { readDirectory, applyDirectory } from './directory.mjs'

const { values: args } = parseArgs({ options: {
  clones: { type: 'string' }, repos: { type: 'string' }, out: { type: 'string' },
  required: { type: 'string' }, retire: { type: 'boolean', default: false },
  'include-checked': { type: 'boolean', default: false }, concurrency: { type: 'string' }, cache: { type: 'string' },
} })
const CLONES = args.clones ?? mkdtempSync(join(tmpdir(), 'acm-clones-'))
const REPOS = args.repos ?? 'data/repos.txt'
const OUT = args.out ?? 'data/mods.json'
const KEEP_CLONES = Boolean(args.clones)
const CONCURRENCY = Number(args.concurrency ?? process.env.SCAN_CONCURRENCY ?? 16)
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) throw new Error(`invalid concurrency: ${CONCURRENCY}`)

const claudeVersion = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(' ')[0]
if (!existsSync(REPOS)) throw new Error(`candidate list not found: ${REPOS}`)
const repos = mergeRepos(readRepos(REPOS))
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).mods : []
if (!Array.isArray(previous)) throw new Error(`invalid previous inventory: ${OUT}`)
const checkedRepos = new Map()
const catalogs = readCatalogs()
const fixtureExceptions = readFixtureExceptions()
mkdirSync(CLONES, { recursive: true })

function meta(repo) {
  try {
    const j = JSON.parse(execFileSync('gh', ['api', `repos/${repo}`, '--jq',
      '{fullName:.full_name,stars:.stargazers_count,pushedAt:.pushed_at,createdAt:.created_at,license:(.license.spdx_id // null),description:.description,defaultBranch:.default_branch,archived:.archived}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    return j
  } catch { return { stars: null } }
}

const metas = metaBatch(repos)
const currentName = new Map()

// Findings read from a checkout are cached under its commit, the validator and the checkout reader's code;
// metadata, classification lists and reach labels are applied fresh on every run.
const CACHE_KEY = findingsKey(claudeVersion)
const cached = args.cache && existsSync(args.cache) ? JSON.parse(readFileSync(args.cache, 'utf8')) : null
const reusable = cached?.key === CACHE_KEY ? cached.repos : {}
const findings = {}
let downloadedKb = 0, reused = 0
// A crashed or timed-out validator reports `unknown`; such findings are retried on the next scan, never reused.
// `unsettled` also covers an unknown plugin that duplicate filtering dropped before it reached the findings.
const settled = found => !found.unsettled && found.plugins.every(p => p.validate.status !== 'unknown' && p.marketplaces.every(m => m.status !== 'unknown'))

async function scanRepo(repo) {
  const key = repo.toLowerCase(), batch = metas.get(key), hit = reusable[key]
  if (hit && batch?.headOid && hit.revision === batch.headOid && settled(hit)) {
    reused++
    return records(repo, hit, batch)
  }
  let found = null
  try {
    const dir = await clone(repo, CLONES)
    if (dir) found = await inspect(repo, dir, CLONES, claudeVersion)
  } finally {
    const size = await spawnAsync('du', ['-sk', join(CLONES, repo.replace('/', '__'))])
    downloadedKb += Number(size.stdout.split('\t')[0]) || 0
    if (!KEEP_CLONES) rmSync(join(CLONES, repo.replace('/', '__')), { recursive: true, force: true })
  }
  if (!found) return []
  const fresh = records(repo, found, batch ?? meta(repo))
  for (const mod of fresh) console.log(`${mod.validate.status.padEnd(8)} L${mod.reach.level} ${mod.id}`)
  return fresh
}

function records(repo, found, m) {
  const key = repo.toLowerCase()
  if (settled(found)) findings[key] = found
  if (m.fullName) currentName.set(key, m.fullName)
  if (found.complete) checkedRepos.set(key, found.revision)
  return found.plugins.map(p => ({
    id: `${repo}:${p.rel}`, repo, path: p.rel, sourceCommit: found.revision,
    name: p.manifestName ?? p.rel.split('/').pop(),
    description: p.manifestDescription ?? m.description ?? '',
    author: p.author,
    homepage: p.manifestHomepage ?? `https://github.com/${repo}`,
    url: p.rel === '.' ? `https://github.com/${repo}` : `https://github.com/${repo}/tree/${m.defaultBranch ?? 'main'}/${p.rel}`,
    kind: kindOf(repo, p.rel, { name: p.manifestName, description: p.manifestDescription }, catalogs, fixtureExceptions),
    hasManifest: p.hasManifest,
    modules: p.modules,
    hooks: p.hooks,
    calls: p.calls,
    surfaceModules: p.surfaceModules,
    validate: p.validate,
    marketplaces: p.marketplaces,
    compatibility: { runtime: 'not-tested', warnings: p.warnings },
    reach: grade(p.calls),
    sees: visibility(p.hooks),
    draws: [...new Set(drawsOn(p.hooks))],
    stars: m.stars ?? null,
    pushedAt: m.pushedAt ?? null,
    createdAt: m.createdAt ?? null,
    license: m.license ?? null,
    archived: m.archived ?? false,
    defaultBranch: m.defaultBranch ?? 'main',
  }))
}

// Results land by repository index, so the inventory comes out in the same order as a one-at-a-time scan.
const started = Date.now()
const byRepo = new Array(repos.length)
let next = 0
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, repos.length) }, async () => {
  while (next < repos.length) {
    const i = next++
    byRepo[i] = await scanRepo(repos[i])
  }
}))
let mods = byRepo.flat()
console.log(`scanned ${repos.length} repos in ${Math.round((Date.now() - started) / 1000)}s, ${CONCURRENCY} at a time; ${reused} unchanged since a cached scan; checkouts held ${Math.round(downloadedKb / 1024)} MB`)
if (args.cache) {
  mkdirSync(dirname(args.cache), { recursive: true })
  writeFileSync(args.cache, JSON.stringify({ key: CACHE_KEY, repos: findings }))
}
const checkedInOrder = repos.map(repo => repo.toLowerCase()).filter(key => checkedRepos.has(key)).map(key => [key, checkedRepos.get(key)])
checkedRepos.clear()
for (const [key, revision] of checkedInOrder) checkedRepos.set(key, revision)

if (args.required) checkRequired(readRepos(args.required), mods, checkedRepos)
const freshIds = new Set(mods.map(mod => mod.id))
const inventory = reconcile(previous, mods, checkedRepos, args.retire)
mods = inventory.mods
if (args.retire) {
  const seeded = new Set(readRepos('data/seeds.txt').map(repo => repo.toLowerCase()))
  const populated = new Set(mods.map(mod => mod.repo.toLowerCase()))
  const removed = repos.filter(repo => checkedRepos.has(repo.toLowerCase()) && !populated.has(repo.toLowerCase()) && !seeded.has(repo.toLowerCase()))
  writeFileSync(REPOS, repos.filter(repo => !removed.includes(repo)).join('\n') + '\n')
  writeFileSync('data/retirements.json', JSON.stringify({
    checkedAt: new Date().toISOString(), plugins: inventory.retired,
    repos: removed.map(repo => ({ repo, revision: checkedRepos.get(repo.toLowerCase()), reason: 'no hook modules in a fresh checkout' })),
  }, null, 2) + '\n')
}
const renames = renamePairs(mods, currentName, freshIds)
applyDuplicatesWithRenames(mods, readDuplicates(), renames)
for (const [old, current] of renames) console.log(`renamed  ${old} is ${current}`)
for (const pair of suspectDuplicates(mods)) console.log(`possible duplicate: ${pair.join(' and ')} share an owner and a name; if they are one mod, add the pair to data/duplicates.txt`)
// Which mods Anthropic's plugin directory lists. A failed read leaves each mod's earlier answer.
let directory = null
try { directory = readDirectory() } catch (error) { console.error(`directory not read, keeping earlier listings: ${error.message}`) }
applyDirectory(mods, directory, new Map(previous.map(mod => [mod.id, mod.directory ?? null])))
mods.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || a.id.localeCompare(b.id))
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), claudeVersion, repos: readRepos(REPOS).length, mods,
  ...(args['include-checked'] ? { checkedRepos: [...checkedRepos.keys()] } : {}),
}, null, 2) + '\n')
const real = mods.filter(x => x.kind === 'mod')
console.log(`\n${mods.length} plugins with hook modules in ${repos.length} repos; ${real.length} are mods (rest: builtin, mirror, fixture, duplicate, catalog). Written to ${OUT}`)
