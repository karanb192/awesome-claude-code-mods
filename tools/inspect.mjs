// Reads what a scan records from one repository's checkout: each plugin whose hooks file names a module
// (hooks/hooks.json or one its plugin.json declares, see hooks-files.mjs),
// its manifest fields, validator and marketplace results and UI compatibility warnings. These findings
// depend only on the checkout's commit, the validator, this module with its local imports and the npm
// packages those import, so the scanner's cache is keyed on exactly those (see findingsKey).

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { validateAsync, spawnAsync } from './validate.mjs'
import { footprintStatus } from './parse.mjs'
import { uiRewriteReview, marketplacesFor } from './compatibility.mjs'
import { hooksModules, moduleSources, pluginHooksFiles } from './hooks-files.mjs'

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

// The npm packages those modules import, with their dependencies, as package-lock.json pins them; the
// TypeScript parser behind the UI compatibility warnings is one.
export function findingsPackages(modules = findingsModules(), lockText = readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) {
  const lock = JSON.parse(lockText).packages
  const pending = modules.flatMap(file => [...readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').matchAll(/^import\s[^\n]*?from '([^.'][^']*)'/gm)].map(([, spec]) => spec))
    .filter(spec => !spec.startsWith('node:'))
    .map(spec => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'))
  const pinned = {}
  while (pending.length) {
    const name = pending.pop()
    if (pinned[name]) continue
    const entry = lock[`node_modules/${name}`]
    if (!entry) throw new Error(`package-lock.json does not pin ${name}, which the checkout reader imports`)
    pinned[name] = `${entry.version} ${entry.integrity ?? ''}`
    pending.push(...Object.keys(entry.dependencies ?? {}))
  }
  return Object.fromEntries(Object.entries(pinned).sort(([a], [b]) => a.localeCompare(b)))
}

export function findingsKey(claudeVersion, lockText) {
  const hash = createHash('sha256')
  const modules = findingsModules()
  for (const path of modules) hash.update(`${path}\0${readFileSync(new URL(`../${path}`, import.meta.url))}\0`)
  hash.update(JSON.stringify(findingsPackages(modules, lockText)))
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

// Every hooks/hooks.json and every plugin manifest, in walk order.
function* pluginFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    // lstat, not stat: a repo that symlinks a plugin folder back to its own root would
    // otherwise be walked until the path length runs out.
    let st; try { st = lstatSync(p) } catch { continue }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) yield* pluginFiles(p)
    else if (name === 'hooks.json' && dirname(p).endsWith('/hooks')) yield { root: dirname(dirname(p)), hooks: p }
    else if (name === 'plugin.json' && dirname(p).endsWith('/.claude-plugin')) yield { root: dirname(dirname(p)) }
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
  const found = [...pluginFiles(dir)]
  // Plugins with a hooks/hooks.json go first, in walk order, since the first of two duplicates is the one kept.
  for (const root of new Set([...found.filter(f => f.hooks), ...found].map(f => f.root))) {
    const manifestPath = join(root, '.claude-plugin', 'plugin.json')
    const manifest = readJson(manifestPath)
    const named = []
    for (const hooksPath of pluginHooksFiles(root, manifest)) {
      const modules = hooksModules(readJson(hooksPath))
      if (!modules) {
        complete = false
        console.error(`cannot inspect malformed hooks: ${repo}:${relative(dir, hooksPath)}`)
        continue
      }
      if (modules.length) named.push({ hooksPath, modules })
    }
    if (!named.length) continue
    const modules = named.length === 1 ? named[0].modules : named.flatMap(n => n.modules)
    const rel = relative(dir, root) || '.'
    const id = `${repo}:${rel}`
    if (seen.has(id)) continue
    seen.add(id)
    const parsed = await validateAsync(existsSync(manifestPath) ? '.claude-plugin/plugin.json' : '.', root, roots)
    if (parsed.status === 'unknown') unsettled = true
    const allHooks = parsed.modules.flatMap(x => x.hooks)
    const allCalls = [...new Set(parsed.modules.flatMap(x => x.calls))].sort()
    const footprint = footprintStatus(parsed, modules)
    const dupKey = `${repo}:${manifest?.name}:${JSON.stringify(allHooks)}:${allCalls.join()}`
    if (footprint.status === 'reported') {
      if (seen.has(dupKey)) { console.log(`skip     duplicate ${id}`); continue }
      seen.add(dupKey)
    }
    const marketplaces = []
    for (const path of marketplacesFor(dir, root)) {
      if (!marketplaceResults.has(path)) {
        const result = await validateAsync(path, dir, roots)
        marketplaceResults.set(path, { path: relative(dir, path), name: readJson(path)?.name ?? null, status: result.status, errors: result.errors })
      }
      marketplaces.push(marketplaceResults.get(path))
    }
    const warnings = uiRewriteReview(dir, root, named.flatMap(n => moduleSources(n.hooksPath, n.modules)), allHooks)
    if (warnings.some(w => w.code === 'ui-review-incomplete')) { complete = false; unsettled = true }
    plugins.push({
      rel,
      manifestName: manifest?.name ?? null,
      manifestDescription: manifest?.description ?? null,
      author: manifest?.author?.name ?? null,
      manifestHomepage: manifest?.homepage ?? null,
      hasManifest: existsSync(manifestPath),
      modules,
      footprint,
      hooks: allHooks,
      calls: allCalls,
      surfaceModules: [...new Set(parsed.modules.flatMap(x => x.surfaceModules))],
      validate: { status: parsed.status, claudeVersion, errors: parsed.errors },
      marketplaces,
      warnings,
    })
  }
  return unsettled ? { revision, complete, plugins, unsettled } : { revision, complete, plugins }
}
