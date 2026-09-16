#!/usr/bin/env node
// Clones every repo in data/repos.txt, finds each plugin whose hooks.json names
// a module, runs `claude plugin validate` on it and records the footprint the
// validator prints. Writes data/mods.json. Nothing here executes mod code.
//
//   node tools/scan.mjs [--clones DIR] [--repos FILE] [--out FILE]

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { parseValidateOutput } from './parse.mjs'
import { grade, visibility, drawsOn } from './grade.mjs'
import { readDuplicates, applyDuplicates, suspectDuplicates } from './dedupe.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean))
const CLONES = args.clones ?? join(tmpdir(), 'acm-clones')
const REPOS = args.repos ?? 'data/repos.txt'
const OUT = args.out ?? 'data/mods.json'
const SKIP_DIRS = new Set(['node_modules', '.git'])
const NOT_A_MOD = [/\/tests?\//, /\/fixtures?\//, /\/probes?\//, /\/examples?\//, /\/upstreams?\//, /\/docs?\//, /\/templates?\//, /\/canary\//]

const claudeVersion = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(' ')[0]
const repos = readFileSync(REPOS, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
mkdirSync(CLONES, { recursive: true })

function clone(repo) {
  const dir = join(CLONES, repo.replace('/', '__'))
  if (existsSync(dir)) return dir
  const r = spawnSync('git', ['clone', '-q', '--depth', '1', `https://github.com/${repo}`, dir], { encoding: 'utf8' })
  if (r.status !== 0) { console.error(`clone failed: ${repo}: ${r.stderr.trim()}`); return null }
  return dir
}

function* hooksFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) yield* hooksFiles(p)
    else if (name === 'hooks.json' && dirname(p).endsWith('/hooks')) yield p
  }
}

function meta(repo) {
  try {
    const j = JSON.parse(execFileSync('gh', ['api', `repos/${repo}`, '--jq',
      '{stars:.stargazers_count,pushedAt:.pushed_at,createdAt:.created_at,license:(.license.spdx_id // null),description:.description,defaultBranch:.default_branch,archived:.archived}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    return j
  } catch { return { stars: null } }
}

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

function kindOf(repo, rel, manifest) {
  if (repo === 'anthropics/claude-code') return 'builtin'
  if (NOT_A_MOD.some(re => re.test('/' + rel + '/'))) return 'fixture'
  if (/not a product mod|measurement instrument|test fixture/i.test(manifest?.description ?? '')) return 'fixture'
  if (/\/mods\/(diff|sec-default|telemetry)$/.test('/' + rel) || ['diff', 'sec-default', 'telemetry'].includes(manifest?.name) && rel.includes('mods/')) return 'mirror'
  return 'mod'
}

const mods = []
const seen = new Set()
for (const repo of repos) {
  const dir = clone(repo)
  if (!dir) continue
  const m = meta(repo)
  for (const hooksPath of hooksFiles(dir)) {
    const hooks = readJson(hooksPath)
    if (!hooks || !Array.isArray(hooks.modules) || hooks.modules.length === 0) continue
    const root = dirname(dirname(hooksPath))
    const rel = relative(dir, root) || '.'
    const manifestPath = join(root, '.claude-plugin', 'plugin.json')
    const manifest = readJson(manifestPath)
    const id = `${repo}:${rel}`
    if (seen.has(id)) continue
    seen.add(id)
    const v = spawnSync('claude', ['plugin', 'validate', existsSync(manifestPath) ? '.claude-plugin/plugin.json' : '.'],
      { cwd: root, encoding: 'utf8', timeout: 60000 })
    const parsed = parseValidateOutput((v.stdout ?? '') + (v.stderr ?? ''))
    const allHooks = parsed.modules.flatMap(x => x.hooks)
    const allCalls = [...new Set(parsed.modules.flatMap(x => x.calls))].sort()
    const reach = grade(allCalls)
    const dupKey = `${repo}:${manifest?.name}:${JSON.stringify(allHooks)}:${allCalls.join()}`
    if (seen.has(dupKey)) { console.log(`skip     duplicate ${id}`); continue }
    seen.add(dupKey)
    mods.push({
      id, repo, path: rel,
      name: manifest?.name ?? rel.split('/').pop(),
      description: manifest?.description ?? m.description ?? '',
      author: manifest?.author?.name ?? null,
      homepage: manifest?.homepage ?? `https://github.com/${repo}`,
      url: rel === '.' ? `https://github.com/${repo}` : `https://github.com/${repo}/tree/${m.defaultBranch ?? 'main'}/${rel}`,
      kind: kindOf(repo, rel, manifest),
      hasManifest: existsSync(manifestPath),
      modules: hooks.modules,
      hooks: allHooks,
      calls: allCalls,
      surfaceModules: [...new Set(parsed.modules.flatMap(x => x.surfaceModules))],
      validate: { status: parsed.status, claudeVersion, errors: parsed.errors },
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
}

applyDuplicates(mods, readDuplicates())
for (const pair of suspectDuplicates(mods)) console.log(`possible duplicate: ${pair.join(' and ')} share an owner and a name; if they are one mod, add the pair to data/duplicates.txt`)
mods.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || a.id.localeCompare(b.id))
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), claudeVersion, repos: repos.length, mods }, null, 2) + '\n')
const real = mods.filter(x => x.kind === 'mod')
console.log(`\n${mods.length} plugins with hook modules in ${repos.length} repos; ${real.length} are mods (rest: builtin, mirror, fixture, duplicate). Written to ${OUT}`)
