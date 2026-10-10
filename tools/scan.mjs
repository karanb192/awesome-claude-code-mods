#!/usr/bin/env node
// Clones every repo in data/repos.txt, finds each plugin whose hooks.json names
// a module, runs `claude plugin validate` on it and records the footprint the
// validator prints, and marks the ones Anthropic's plugin directory lists. Writes data/mods.json. Nothing here executes mod code.
// Repositories are scanned several at a time; each checkout is deleted once read unless --clones names a folder to keep.
//
//   node tools/scan.mjs [--clones DIR] [--repos FILE] [--out FILE] [--concurrency N]

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { validateAsync, spawnAsync } from './validate.mjs'
import { uiRewriteReview, marketplacesFor } from './compatibility.mjs'
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
  'include-checked': { type: 'boolean', default: false }, concurrency: { type: 'string' },
} })
const CLONES = args.clones ?? mkdtempSync(join(tmpdir(), 'acm-clones-'))
const REPOS = args.repos ?? 'data/repos.txt'
const OUT = args.out ?? 'data/mods.json'
const KEEP_CLONES = Boolean(args.clones)
const CONCURRENCY = Number(args.concurrency ?? process.env.SCAN_CONCURRENCY ?? 16)
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) throw new Error(`invalid concurrency: ${CONCURRENCY}`)
const SKIP_DIRS = new Set(['node_modules', '.git'])

const claudeVersion = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(' ')[0]
if (!existsSync(REPOS)) throw new Error(`candidate list not found: ${REPOS}`)
const repos = mergeRepos(readRepos(REPOS))
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).mods : []
if (!Array.isArray(previous)) throw new Error(`invalid previous inventory: ${OUT}`)
const checkedRepos = new Map()
const catalogs = readCatalogs()
const fixtureExceptions = readFixtureExceptions()
mkdirSync(CLONES, { recursive: true })

async function clone(repo) {
  const dir = join(CLONES, repo.replace('/', '__'))
  if (existsSync(dir)) throw new Error(`refusing cached checkout ${dir}; use a fresh clones directory`)
  const r = await spawnAsync('git', ['clone', '-q', '--depth', '1', `https://github.com/${repo}`, dir])
  if (r.status !== 0) { console.error(`clone failed: ${repo}: ${r.stderr.trim()}`); return null }
  // A repository with no commits yet clones fine but has no HEAD; treat it like a failed clone, not evidence of removal.
  if ((await spawnAsync('git', ['-C', dir, 'rev-parse', '--verify', '-q', 'HEAD'])).status !== 0) { console.error(`clone is empty: ${repo}`); return null }
  return realpathSync(dir)
}

function* hooksFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    // lstat, not stat: a repo that symlinks a plugin folder back to its own root would
    // otherwise be walked until the path length runs out.
    let st; try { st = lstatSync(p) } catch { continue }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) yield* hooksFiles(p)
    else if (name === 'hooks.json' && dirname(p).endsWith('/hooks')) yield p
  }
}

function meta(repo) {
  try {
    const j = JSON.parse(execFileSync('gh', ['api', `repos/${repo}`, '--jq',
      '{fullName:.full_name,stars:.stargazers_count,pushedAt:.pushed_at,createdAt:.created_at,license:(.license.spdx_id // null),description:.description,defaultBranch:.default_branch,archived:.archived}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    return j
  } catch { return { stars: null } }
}

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

const metas = metaBatch(repos)
const currentName = new Map()

let downloadedKb = 0
async function scanRepo(repo) {
  try {
    const dir = await clone(repo)
    return dir ? await inspect(repo, dir) : []
  } finally {
    const size = await spawnAsync('du', ['-sk', join(CLONES, repo.replace('/', '__'))])
    downloadedKb += Number(size.stdout.split('\t')[0]) || 0
    if (!KEEP_CLONES) rmSync(join(CLONES, repo.replace('/', '__')), { recursive: true, force: true })
  }
}

async function inspect(repo, dir) {
  const found = []
  const seen = new Set()
  const marketplaceResults = new Map()
  const revision = (await spawnAsync('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim()
  // Longest first: the checkout itself, then the clones folder, both as given and as resolved.
  const roots = [dir, join(CLONES, repo.replace('/', '__')), realpathSync(CLONES), CLONES]
  let complete = true
  const m = metas.get(repo.toLowerCase()) ?? meta(repo)
  if (m.fullName) currentName.set(repo.toLowerCase(), m.fullName)
  for (const hooksPath of hooksFiles(dir)) {
    const hooks = readJson(hooksPath)
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks) || ('modules' in hooks && !Array.isArray(hooks.modules))) {
      complete = false
      console.error(`cannot inspect malformed hooks: ${repo}:${relative(dir, hooksPath)}`)
      continue
    }
    if (!hooks || !Array.isArray(hooks.modules) || hooks.modules.length === 0) continue
    const root = dirname(dirname(hooksPath))
    const rel = relative(dir, root) || '.'
    const manifestPath = join(root, '.claude-plugin', 'plugin.json')
    const manifest = readJson(manifestPath)
    const id = `${repo}:${rel}`
    if (seen.has(id)) continue
    seen.add(id)
    const parsed = await validateAsync(existsSync(manifestPath) ? '.claude-plugin/plugin.json' : '.', root, roots)
    const allHooks = parsed.modules.flatMap(x => x.hooks)
    const allCalls = [...new Set(parsed.modules.flatMap(x => x.calls))].sort()
    const reach = grade(allCalls)
    const dupKey = `${repo}:${manifest?.name}:${JSON.stringify(allHooks)}:${allCalls.join()}`
    if (seen.has(dupKey)) { console.log(`skip     duplicate ${id}`); continue }
    seen.add(dupKey)
    const marketplaces = []
    for (const path of marketplacesFor(dir, root)) {
      if (!marketplaceResults.has(path)) {
        const result = await validateAsync(path, dir, roots)
        marketplaceResults.set(path, { path: relative(dir, path), name: readJson(path)?.name ?? null, status: result.status, errors: result.errors })
      }
      marketplaces.push(marketplaceResults.get(path))
    }
    found.push({
      id, repo, path: rel, sourceCommit: revision,
      name: manifest?.name ?? rel.split('/').pop(),
      description: manifest?.description ?? m.description ?? '',
      author: manifest?.author?.name ?? null,
      homepage: manifest?.homepage ?? `https://github.com/${repo}`,
      url: rel === '.' ? `https://github.com/${repo}` : `https://github.com/${repo}/tree/${m.defaultBranch ?? 'main'}/${rel}`,
      kind: kindOf(repo, rel, manifest, catalogs, fixtureExceptions),
      hasManifest: existsSync(manifestPath),
      modules: hooks.modules,
      hooks: allHooks,
      calls: allCalls,
      surfaceModules: [...new Set(parsed.modules.flatMap(x => x.surfaceModules))],
      validate: { status: parsed.status, claudeVersion, errors: parsed.errors },
      marketplaces,
      compatibility: { runtime: 'not-tested', warnings: uiRewriteReview(dir, root, hooks.modules, allHooks) },
      reach,
      sees: visibility(allHooks),
      draws: [...new Set(drawsOn(allHooks))],
      stars: m.stars ?? null,
      pushedAt: m.pushedAt ?? null,
      createdAt: m.createdAt ?? null,
      license: m.license ?? null,
      archived: m.archived ?? false,
      defaultBranch: m.defaultBranch ?? 'main',
    })
    console.log(`${parsed.status.padEnd(8)} L${reach.level} ${id}`)
  }
  if (complete) checkedRepos.set(repo.toLowerCase(), revision)
  return found
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
console.log(`scanned ${repos.length} repos in ${Math.round((Date.now() - started) / 1000)}s, ${CONCURRENCY} at a time; checkouts held ${Math.round(downloadedKb / 1024)} MB`)
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
