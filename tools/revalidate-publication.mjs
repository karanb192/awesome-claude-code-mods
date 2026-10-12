import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { validate } from './validate.mjs'
import { grade, visibility, drawsOn } from './grade.mjs'
import { marketplacesFor, uiRewriteReview } from './compatibility.mjs'

function ensureVersion(version) {
  let current
  try { current = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(' ')[0] } catch {}
  if (current !== version) {
    execFileSync('bash', ['-c', 'set -euo pipefail; curl -fsSL https://claude.ai/install.sh | bash -s -- "$1"', 'install-validator', version], { stdio: 'inherit' })
    process.env.PATH = `${join(homedir(), '.local/bin')}:${process.env.PATH}`
    current = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(' ')[0]
  }
  if (current !== version) throw new Error(`Expected Claude ${version}, got ${current}`)
}

function checkout(repo, revision, dir) {
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git(['init', '-q'])
  git(['fetch', '-q', '--depth', '1', `https://github.com/${repo}`, revision])
  git(['checkout', '-q', '--detach', 'FETCH_HEAD'])
}

export function revalidatePublished(records, version, cache = {}, deps = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid scan validator version')
  const runValidate = deps.validate ?? validate
  const checkouts = new Map()
  const marketResults = new Map()
  let ready = false
  try {
    return records.map(record => {
      const cacheKey = JSON.stringify([version, record])
      if (cache[cacheKey]) return structuredClone(cache[cacheKey])
      if (!/^[\w.-]+\/[\w.-]+$/.test(record.repo) || !/^[a-f0-9]{40}$/.test(record.sourceCommit)) throw new Error(`Missing pinned source for ${record.id}`)
      if (!ready) { (deps.ensureVersion ?? ensureVersion)(version); ready = true }
      const source = `${record.repo.toLowerCase()}:${record.sourceCommit}`
      if (!checkouts.has(source)) {
        const dir = mkdtempSync(join(tmpdir(), 'scan-revalidate-'))
        checkouts.set(source, dir)
        const getSource = deps.checkout ?? checkout
        getSource(record.repo, record.sourceCommit, dir)
      }
      const dir = realpathSync(checkouts.get(source))
      const inside = path => {
        const candidate = resolve(dir, path)
        const rel = relative(dir, candidate)
        if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Path outside repository: ${record.id}`)
        const real = realpathSync(candidate), realRel = relative(dir, real)
        if (realRel === '..' || realRel.startsWith('../') || isAbsolute(realRel)) throw new Error(`Symlink outside repository: ${record.id}`)
        return real
      }
      const plugin = inside(record.path)
      const manifest = join(plugin, '.claude-plugin/plugin.json')
      if (existsSync(manifest)) inside(relative(dir, manifest))
      const parsed = runValidate(existsSync(manifest) ? '.claude-plugin/plugin.json' : '.', plugin, [dir])
      if (parsed.status === 'unknown') throw new Error(`Revalidation incomplete: ${record.id}`)
      const hooks = parsed.modules.flatMap(module => module.hooks)
      const calls = [...new Set(parsed.modules.flatMap(module => module.calls))].sort()
      const marketplaces = marketplacesFor(dir, plugin).map(path => {
        if (!marketResults.has(path)) marketResults.set(path, runValidate(path, dir, [dir]))
        const result = marketResults.get(path)
        if (result.status === 'unknown') throw new Error(`Marketplace revalidation incomplete: ${record.id}`)
        return { path: relative(dir, path), name: JSON.parse(readFileSync(path, 'utf8')).name ?? null, status: result.status, errors: result.errors }
      })
      const updated = { ...record, hooks, calls, surfaceModules: [...new Set(parsed.modules.flatMap(module => module.surfaceModules))],
        validate: { status: parsed.status, claudeVersion: version, errors: parsed.errors }, marketplaces,
        compatibility: { runtime: 'not-tested', warnings: uiRewriteReview(dir, plugin, record.modules ?? [], hooks) },
        reach: grade(calls), sees: visibility(hooks), draws: [...new Set(drawsOn(hooks))] }
      if (record.validate.status === 'unknown' && record.lastKnownValidate) {
        updated.lastKnownValidate = updated.validate
        updated.validate = { ...record.validate, claudeVersion: version }
      } else delete updated.lastKnownValidate
      cache[cacheKey] = updated
      return structuredClone(updated)
    })
  } finally {
    for (const dir of checkouts.values()) rmSync(dir, { recursive: true, force: true })
  }
}
