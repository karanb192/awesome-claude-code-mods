// Searches the published catalogue for coding agents. The command line (find-mods.mjs) and the MCP
// server both call this module, so the two routes answer from the same snapshot with the same ranking.
// It reads only the published docs/mods.json, never scan output or GitHub itself, and keeps the file on
// disk so it never enters a model's context.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const REPO = 'karanb192/awesome-claude-code-mods'
const SNAPSHOT = 'docs/mods.json'
// Publications land every few hours; past a week without a successful refresh the cache is too old to serve.
export const REFRESH_AFTER_MS = 6 * 3600e3
export const MAX_STALE_MS = 7 * 86400e3
export const MAX_LIMIT = 25
const DEFAULT_LIMIT = 8
const PER_REPO = 2

export const ACCESS = ['network', 'MCP servers', 'runs processes', 'writes files', 'sets env vars', 'changes config', 'drives Claude',
  'writes the prompt box', 'reads files', 'reads env vars', 'reads settings', 'reads the transcript', 'telemetry']
export const SEES = ['everything', 'every prompt', 'every tool call', 'the system prompt']
const VERIFIED = new Set(['passed', 'warnings'])

export class InputError extends Error {}

export const defaultCacheDir = () => process.env.CLAUDE_MODS_CACHE
  || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'claude-mods')

function readCache(dir) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    return { meta, data: JSON.parse(readFileSync(join(dir, meta.file), 'utf8')) }
  } catch { return null }
}

function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text)
  renameSync(`${path}.tmp`, path)
}

function checkShape(data) {
  if (!data || !Array.isArray(data.mods) || !data.mods.length || typeof data.generated !== 'string'
    || data.mods.some(m => typeof m?.id !== 'string' || typeof m.kind !== 'string')) {
    throw new Error('the downloaded catalogue is not a mods.json snapshot')
  }
  return data
}

async function latestCommit(fetch, api) {
  const res = await fetch(`${api}/repos/${REPO}/commits?path=${SNAPSHOT}&per_page=1`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'claude-mods-finder' }, signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`GitHub API answered ${res.status}`)
  const sha = (await res.json())[0]?.sha
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('GitHub API returned no commit for the snapshot')
  return sha
}

// Returns the catalogue and the revision it came from. The cache is replaced whole: the snapshot is
// written under its content hash and meta.json is renamed over the old one last, so a failed or partial
// download never mixes two revisions. When a refresh fails, the previous snapshot is served marked stale.
export async function loadSnapshot({ cacheDir = defaultCacheDir(), fetch = globalThis.fetch, now = Date.now(), refresh = 'auto',
  raw = 'https://raw.githubusercontent.com', api = 'https://api.github.com' } = {}) {
  const cached = readCache(cacheDir)
  const age = cached ? now - cached.meta.fetchedAt : Infinity
  const result = (entry, extra = {}) => ({ data: entry.data, revision: { ...entry.meta, ...extra } })
  if (cached && (refresh === 'never' || (refresh === 'auto' && age < REFRESH_AFTER_MS))) return result(cached)
  try {
    mkdirSync(cacheDir, { recursive: true })
    const touch = () => {
      const meta = { ...cached.meta, fetchedAt: now }
      writeAtomic(join(cacheDir, 'meta.json'), JSON.stringify(meta))
      return { data: cached.data, revision: meta }
    }
    let commit = null
    try { commit = await latestCommit(fetch, api) } catch {}
    if (commit && cached?.meta.commit === commit) return touch()
    const url = `${raw}/${REPO}/${commit ?? 'main'}/${SNAPSHOT}`
    const headers = { 'user-agent': 'claude-mods-finder' }
    if (!commit && cached?.meta.etag) headers['if-none-match'] = cached.meta.etag
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) })
    if (res.status === 304 && cached) return touch()
    if (!res.ok) throw new Error(`${url} answered ${res.status}`)
    const text = await res.text()
    const data = checkShape(JSON.parse(text))
    const sha256 = createHash('sha256').update(text).digest('hex')
    const meta = { commit, sha256, etag: res.headers.get('etag'), source: url, fetchedAt: now, file: `mods-${sha256.slice(0, 16)}.json` }
    writeAtomic(join(cacheDir, meta.file), text)
    writeAtomic(join(cacheDir, 'meta.json'), JSON.stringify(meta))
    if (cached && cached.meta.file !== meta.file) rmSync(join(cacheDir, cached.meta.file), { force: true })
    return { data, revision: meta }
  } catch (error) {
    if (!cached) throw new Error(`could not download the mods catalogue: ${error.message}`)
    if (age > MAX_STALE_MS) throw new Error(`could not refresh the mods catalogue (${error.message}) and the cached copy is more than 7 days old`)
    return result(cached, { stale: true, refreshError: error.message })
  }
}

const STOP = new Set('a an and any are can do does find for from give have help helps i in is it its me mod mods my of on or plugin plugins show some that the this to which with without what when while where how all has like into about claude code'.split(' '))
const SYNONYMS = {
  review: ['pr', 'pull'], pr: ['review', 'pull'], pull: ['pr', 'review'],
  cost: ['usag', 'token', 'spend', 'quota'], usag: ['cost', 'token', 'quota'], token: ['cost', 'usag'], spend: ['cost', 'usag'], quota: ['usag', 'limit'],
  notif: ['notify', 'alert', 'sound'], notify: ['notif', 'alert'], alert: ['notif', 'notify'], sound: ['audio', 'notif'], audio: ['sound'],
  secur: ['safety', 'guard', 'secret'], safety: ['guard', 'secur', 'block'], guard: ['safety', 'block'],
  dashboard: ['pane', 'meter', 'statu'], monitor: ['meter', 'watch', 'track'], meter: ['monitor'], statusline: ['statu', 'band'],
  memory: ['context', 'remember'], test: ['tdd'], theme: ['color', 'colour'], color: ['theme', 'colour'], game: ['play'],
}

function stem(word) {
  for (const suffix of ['ing', 'ed', 'es', 's', 'e']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length)
  }
  return word
}
// "pull request" and "status line" are one idea each, written several ways.
const raw = text => String(text ?? '').toLowerCase().replace(/\bpull[\s-]+requests?\b/g, ' pr ').replace(/\bstatus[\s-]+lines?\b/g, ' statusline ').split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w))
const words = text => raw(text).map(stem)

const FIELDS = { name: 4, repo: 2, description: 1, access: 1 }

// Builds the searchable view once per snapshot. Community mods and built-ins are searchable; duplicates,
// catalogue copies and fixtures stay reachable by ID so an old or copied ID still resolves.
export function buildIndex(data, revision = {}) {
  const searchable = data.mods.filter(m => m.kind === 'mod' || m.kind === 'builtin')
  const docs = searchable.map(m => {
    const fields = {
      name: new Set(words(m.name)),
      repo: new Set(words(m.repo)),
      description: new Set(words(m.description)),
      access: new Set(words([...(m.reach?.labels ?? []).filter(l => !l.startsWith('other: ')), ...(m.sees ?? []), ...(m.draws ?? []), ...(m.hooks ?? []).map(h => h.event)].join(' '))),
    }
    return { mod: m, fields }
  })
  const df = new Map()
  for (const doc of docs) for (const term of new Set(Object.values(doc.fields).flatMap(f => [...f]))) df.set(term, (df.get(term) ?? 0) + 1)
  const byId = new Map(data.mods.map(m => [m.id, m]))
  const byLowerId = new Map(data.mods.map(m => [m.id.toLowerCase(), m]))
  return { data, revision, docs, df, byId, byLowerId }
}

export function snapshotInfo(index) {
  const { revision, data } = index
  return {
    commit: revision.commit ?? null,
    sha256: revision.sha256 ?? null,
    scanned: data.generated,
    claude_version: data.claudeVersion,
    fetched_at: revision.fetchedAt ? new Date(revision.fetchedAt).toISOString() : null,
    ...(revision.stale ? { stale: true, refresh_error: revision.refreshError } : {}),
  }
}

function list(value, name, allowed) {
  if (value === undefined || value === null || value === '') return []
  const items = (Array.isArray(value) ? value : String(value).split(',')).map(v => String(v).trim()).filter(Boolean)
  for (const item of items) {
    if (!allowed.includes(item)) throw new InputError(`"${item}" is not a ${name} value; use one of: ${allowed.join(', ')}`)
  }
  return items
}

export function normalizeSearch(params = {}) {
  const limit = params.limit === undefined ? DEFAULT_LIMIT : Number(params.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new InputError(`limit must be a whole number from 1 to ${MAX_LIMIT}`)
  const maxReach = params.max_reach === undefined || params.max_reach === null ? null : Number(params.max_reach)
  if (maxReach !== null && ![0, 1, 2, 3].includes(maxReach)) throw new InputError('max_reach must be 0, 1, 2 or 3')
  const cursor = params.cursor ? Number(params.cursor) : 0
  if (!Number.isInteger(cursor) || cursor < 0) throw new InputError('cursor must be a next_cursor value from an earlier result')
  return {
    query: String(params.query ?? '').slice(0, 300),
    without: list(params.without, 'without', [...ACCESS, ...SEES]),
    maxReach,
    verifiedOnly: Boolean(params.verified_only),
    includeUnverified: Boolean(params.include_unverified),
    inDirectory: Boolean(params.in_anthropic_directory),
    repo: params.repo ? String(params.repo).toLowerCase() : null,
    limit,
    cursor,
  }
}

const clip = (text, n) => {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}
const verified = m => VERIFIED.has(m.validate?.status)
const unclassified = m => (m.reach?.labels ?? []).filter(l => l.startsWith('other: ')).map(l => l.slice(7))

function summary(m, matched) {
  const odd = unclassified(m)
  return {
    id: m.id,
    name: m.name,
    kind: m.kind,
    description: clip(m.description, 240),
    access: {
      level: m.reach?.level,
      level_name: m.reach?.name,
      labels: (m.reach?.labels ?? []).filter(l => !l.startsWith('other: ')),
      ...(odd.length ? { unclassified_calls: odd.slice(0, 5) } : {}),
      sees: m.sees ?? [],
      draws: m.draws ?? [],
    },
    validation: { status: m.validate?.status, claude_version: m.validate?.claudeVersion, footprint: verified(m) ? 'validator-reported' : 'unverified' },
    in_anthropic_directory: Boolean(m.directory),
    repo_stars: m.stars ?? null,
    source: m.url,
    ...(matched?.length ? { matched } : {}),
  }
}

function score(index, doc, terms) {
  let total = 0, hit = 0
  const matched = []
  for (const { word, term, alternatives } of terms) {
    let best = 0, where = null
    for (const [candidate, weight, label] of [[term, 1, word], ...alternatives.map(a => [a, 0.5, `${word}~${a}`])]) {
      const df = index.df.get(candidate)
      if (!df) continue
      const idf = Math.log(1 + index.docs.length / df)
      for (const [field, fieldWeight] of Object.entries(FIELDS)) {
        if (doc.fields[field].has(candidate) && weight * fieldWeight * idf > best) { best = weight * fieldWeight * idf; where = `${label} (${field})` }
      }
    }
    if (best) { total += best; hit += where.includes('~') ? 0.5 : 1; matched.push(where) }
  }
  // Coverage dominates: a mod matching every query word outranks one matching a single rare word.
  return { score: total * (hit / terms.length) ** 2, matched }
}

export function search(index, params) {
  const p = normalizeSearch(params)
  const seen = new Set()
  const terms = raw(p.query).map(word => ({ word, term: stem(word) })).filter(t => !seen.has(t.term) && seen.add(t.term))
    .map(t => ({ ...t, alternatives: SYNONYMS[t.term] ?? [] }))
  const accessFilter = p.without.length || p.maxReach !== null
  const keep = m => {
    if (p.repo && m.repo.toLowerCase() !== p.repo) return false
    if (p.inDirectory && !m.directory) return false
    if ((p.verifiedOnly || (accessFilter && !p.includeUnverified)) && !verified(m)) return false
    if (p.maxReach !== null && m.reach.level > p.maxReach) return false
    const has = new Set([...(m.reach?.labels ?? []).filter(l => !l.startsWith('other: ')), ...(m.sees ?? [])])
    return p.without.every(label => !has.has(label))
  }
  let ranked = index.docs.filter(d => keep(d.mod)).map(d => ({ mod: d.mod, ...(terms.length ? score(index, d, terms) : { score: 0, matched: [] }) }))
  if (terms.length) ranked = ranked.filter(r => r.score > 0)
  ranked.sort((a, b) => b.score - a.score || (b.mod.stars ?? 0) - (a.mod.stars ?? 0) || a.mod.id.localeCompare(b.mod.id))
  // One big pack should not fill a page: past two hits per repository, the rest move behind other repositories.
  if (!p.repo) {
    const seen = new Map(), first = [], later = []
    for (const r of ranked) {
      const n = seen.get(r.mod.repo) ?? 0
      seen.set(r.mod.repo, n + 1);
      (n < PER_REPO ? first : later).push(r)
    }
    ranked = [...first, ...later]
  }
  const page = ranked.slice(p.cursor, p.cursor + p.limit)
  const notes = []
  if (accessFilter) notes.push(p.includeUnverified
    ? 'Access filters use the static footprint the validator reported. Unverified results may have an incomplete footprint.'
    : 'Access filters use the static footprint the validator reported; mods without a passing validation are left out. No reported access is not proof the mod never does it at runtime.')
  if (!terms.length && !p.query.trim()) notes.push('No query words, so results are ordered by repository stars, which belong to the repository, not the mod.')
  if (!ranked.length && terms.length) notes.push('Nothing matched. Try fewer or broader words, or drop a filter.')
  return {
    snapshot: snapshotInfo(index),
    total: ranked.length,
    results: page.map(r => summary(r.mod, r.matched)),
    next_cursor: p.cursor + p.limit < ranked.length ? String(p.cursor + p.limit) : null,
    ...(notes.length ? { notes } : {}),
  }
}

const manifestUrl = m => `https://github.com/${m.repo}/blob/${m.sourceCommit ?? m.defaultBranch ?? 'main'}/${m.path === '.' ? '' : m.path + '/'}.claude-plugin/plugin.json`
const atCommit = (m, file, line) => `https://github.com/${m.repo}/blob/${m.sourceCommit ?? m.defaultBranch ?? 'main'}/${file.split('/').map(encodeURIComponent).join('/')}${line ? '#L' + line : ''}`

// What a user would type to install, when the scan saw a marketplace that lists this mod. The scan
// records the marketplace's name, not its entry for the mod, so the plugin name is the manifest's.
function install(m) {
  if (m.directory?.plugin) return { command: `/plugin install ${m.directory.plugin}`, from: "Anthropic's plugin directory" }
  const root = (m.marketplaces ?? []).find(p => p.path === '.claude-plugin/marketplace.json' && p.name && VERIFIED.has(p.status))
  if (!root) return null
  return { commands: [`/plugin marketplace add ${m.repo}`, `/plugin install ${m.name}@${root.name}`], from: "the repository's own marketplace", check: "Confirm the plugin name in the repository's README before installing." }
}

function detail(m) {
  const kindNote = {
    builtin: 'Ships inside Claude Code.',
    catalog: 'A copy inside a repackaged catalogue; not counted as a separate community mod.',
    fixture: 'A test fixture or development-only plugin; not counted as a community mod.',
  }[m.kind]
  return {
    ...summary(m),
    description: clip(m.description, 2000),
    ...(kindNote ? { note: kindNote } : {}),
    repo: m.repo,
    path: m.path,
    author: m.author ?? null,
    license: m.license ?? null,
    homepage: m.homepage ?? null,
    source_commit: m.sourceCommit ?? null,
    source_at_commit: m.sourceCommit ? `https://github.com/${m.repo}/tree/${m.sourceCommit}/${m.path === '.' ? '' : m.path}`.replace(/\/$/, '') : null,
    manifest: manifestUrl(m),
    modules: (m.modules ?? []).slice(0, 20),
    hooks: (m.hooks ?? []).slice(0, 40).map(h => h.event + (Object.keys(h.matcher ?? {}).length ? ' ' + JSON.stringify(h.matcher) : '')),
    calls: (m.calls ?? []).slice(0, 60),
    validation: {
      status: m.validate?.status,
      claude_version: m.validate?.claudeVersion,
      footprint: verified(m) ? 'validator-reported' : 'unverified',
      errors: (m.validate?.errors ?? []).slice(0, 8).map(e => clip(e, 300)),
      ...(m.lastKnownValidate ? { last_known: { status: m.lastKnownValidate.status, claude_version: m.lastKnownValidate.claudeVersion } } : {}),
      meaning: 'The validator reads the source without running it. A pass is not a runtime test or a safety guarantee.',
    },
    marketplaces: (m.marketplaces ?? []).map(p => ({ name: p.name, path: p.path, status: p.status })),
    install: install(m),
    compatibility: {
      runtime: m.compatibility?.runtime ?? null,
      warnings: (m.compatibility?.warnings ?? []).slice(0, 5).map(w => ({
        code: w.code, message: clip(w.message, 300), evidence: (w.evidence ?? []).slice(0, 5).map(e => atCommit(m, e.file, e.line)),
      })),
    },
    pushed_at: m.pushedAt ?? null,
    archived: Boolean(m.archived),
  }
}

// Looks up one entry by ID. A copy resolves to the mod it duplicates; an ID no longer in the snapshot
// (removed, or renamed with its repository) returns suggestions instead of a guess.
export function getMod(index, id) {
  const key = String(id ?? '').trim()
  if (!key) throw new InputError('id is required, for example "owner/repo:path" from a search result')
  const m = index.byId.get(key) ?? index.byLowerId.get(key.toLowerCase())
  const snapshot = snapshotInfo(index)
  if (m?.kind === 'duplicate') {
    const keeper = index.byId.get(m.duplicateOf)
    return { snapshot, id: m.id, status: 'duplicate', duplicate_of: m.duplicateOf, note: 'This ID is a copy of another listed mod; details are for the original.', mod: keeper ? detail(keeper) : null }
  }
  if (m) return { snapshot, mod: detail(m) }
  const inRepo = index.data.mods.filter(x => x.kind !== 'duplicate' && x.repo.toLowerCase() === key.toLowerCase())
  if (inRepo.length) return { snapshot, status: 'repository', note: `${key} is a repository; pick one of its mods by ID.`, ids: inRepo.slice(0, 50).map(x => ({ id: x.id, name: x.name, kind: x.kind })), total: inRepo.length }
  const suggestions = search(index, { query: key.replace(/[:/._-]+/g, ' '), limit: 5 }).results.map(r => ({ id: r.id, name: r.name }))
  return { snapshot, status: 'not_found', id: key, note: 'No entry has this ID in the loaded snapshot. It may have been removed, or its repository renamed.', suggestions }
}
