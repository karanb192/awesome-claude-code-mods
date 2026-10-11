// Reads what a scan records from one repository's checkout: each plugin whose hooks.json names a module,
// its manifest fields, validator and marketplace results and UI compatibility warnings. These findings
// depend only on the checkout's commit, the validator and this module with its imports, so the
// scanner's cache is keyed on exactly those (see findingsKey).

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { validateAsync, spawnAsync } from './validate.mjs'
import { uiRewriteReview, marketplacesFor } from './compatibility.mjs'

const SKIP_DIRS = new Set(['node_modules', '.git'])

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

// This module and every local module it imports, so a change to any of them retires cached findings.
export function findingsModules(entry = 'tools/inspect.mjs') {
  const pending = [entry], loaded = new Set()
  while (pending.length) {
    const file = pending.pop()
    if (loaded.has(file)) continue
    loaded.add(file)
    for (const [, path] of readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').matchAll(/from '\.\/([\w.-]+\.mjs)'/g)) pending.push(`tools/${path}`)
  }
  return [...loaded].sort()
}

export function findingsKey(claudeVersion) {
  const hash = createHash('sha256')
  for (const path of findingsModules()) hash.update(`${path}\0${readFileSync(new URL(`../${path}`, import.meta.url))}\0`)
  return `${claudeVersion}:${hash.digest('hex')}`
}

export async function clone(repo, clones) {
  const dir = join(clones, repo.replace('/', '__'))
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

export async function inspect(repo, dir, clones, claudeVersion) {
  const plugins = []
  const seen = new Set()
  const marketplaceResults = new Map()
  const revision = (await spawnAsync('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim()
  // Longest first: the checkout itself, then the clones folder, both as given and as resolved.
  const roots = [dir, join(clones, repo.replace('/', '__')), realpathSync(clones), clones]
  let complete = true, unsettled = false
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
    if (parsed.status === 'unknown') unsettled = true
    const allHooks = parsed.modules.flatMap(x => x.hooks)
    const allCalls = [...new Set(parsed.modules.flatMap(x => x.calls))].sort()
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
    plugins.push({
      rel,
      manifestName: manifest?.name ?? null,
      manifestDescription: manifest?.description ?? null,
      author: manifest?.author?.name ?? null,
      manifestHomepage: manifest?.homepage ?? null,
      hasManifest: existsSync(manifestPath),
      modules: hooks.modules,
      hooks: allHooks,
      calls: allCalls,
      surfaceModules: [...new Set(parsed.modules.flatMap(x => x.surfaceModules))],
      validate: { status: parsed.status, claudeVersion, errors: parsed.errors },
      marketplaces,
      warnings: uiRewriteReview(dir, root, hooks.modules, allHooks),
    })
  }
  return unsettled ? { revision, complete, plugins, unsettled } : { revision, complete, plugins }
}
