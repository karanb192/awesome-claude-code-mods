// Finds candidates pushed since the last complete search through repository search. It has
// its own rate limit and sees new repositories before code search indexes their files. A
// repository joins the candidates only when its tree holds a hooks/hooks.json that lists
// modules, so broad queries cannot fill data/repos.txt with plugins that are not mods.
// Progress lives in data/discovery.json: the start of the last complete search, repositories
// already found not to be mods, repositories left for the next run, and repositories found but
// not yet on main. Scheduled runs carry it between runs through the Actions cache.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { ghSearchPage, createSearchRequest } from './github-search.mjs'

// Ordered from most to least specific: when the check limit is reached, the broad query loses out.
export const RECENT_QUERIES = [
  'topic:claude-code-mod',
  'topic:claude-code-mods',
  'topic:claude-mods',
  'topic:function-hooks',
  'claude mod in:name,description',
  'claude mods in:name,description',
  'topic:claude-code-plugin',
]

export const STATE_PATH = 'data/discovery.json'
const PER_PAGE = 100
const HOUR = 3600 * 1000
const MARGIN_HOURS = 1
const key = repo => repo.toLowerCase()
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const later = (a, b) => (Date.parse(a) || 0) >= (Date.parse(b) || 0) ? a : b

export function readState(path = STATE_PATH) {
  let state = {}
  try { state = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  return { searchedThrough: state.searchedThrough ?? null, checked: state.checked ?? {}, deferred: state.deferred ?? [], pending: state.pending ?? [] }
}

// Combines main's progress with the latest run's. Every part only grows or moves forward, so
// the union never loses work.
export function mergeState(a, b) {
  const checked = { ...a.checked }
  for (const [repo, pushedAt] of Object.entries(b.checked)) checked[repo] = repo in checked ? later(checked[repo], pushedAt) : pushedAt
  const deferred = new Map([...a.deferred, ...b.deferred].map(c => [key(c.repo), c]))
  const pending = new Map([...a.pending, ...b.pending].map(repo => [key(repo), repo]))
  const searchedThrough = a.searchedThrough && b.searchedThrough ? later(a.searchedThrough, b.searchedThrough) : a.searchedThrough ?? b.searchedThrough
  return { searchedThrough, checked, deferred: [...deferred.values()], pending: [...pending.values()] }
}

export function writeState(state, path = STATE_PATH) {
  const checked = Object.fromEntries(Object.entries(state.checked).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(path, JSON.stringify({ ...state, checked }, null, 2) + '\n')
}

// The search starts an hour before the checkpoint, because the index lags behind pushes, and
// never reaches back more than a week; older repositories are the daily code search's job.
export function recentSince(checkpoint, now = Date.now(), { window = 7 * 24 } = {}) {
  const floor = now - window * HOUR
  const last = Date.parse(checkpoint)
  return iso(Number.isFinite(last) ? Math.max(last - MARGIN_HOURS * HOUR, floor) : floor)
}

// Each query covers since..until in time slices small enough for one page of 100 results, split
// in half until they fit. One page cannot shift while it is read, and no slice reaches the
// 1,000-result cap. A slice that cannot be split further, or a page short of its count, makes
// the search incomplete, so the checkpoint stays where it was.
export function searchRecent(since, until, request, { queries = RECENT_QUERIES, log = console.error } = {}) {
  const found = new Map(), incomplete = []
  const add = (query, items) => {
    for (const item of items) {
      if (typeof item?.full_name !== 'string') throw new Error(`invalid search item for ${query}`)
      if (!found.has(key(item.full_name))) found.set(key(item.full_name), { repo: item.full_name, branch: item.default_branch ?? 'HEAD', pushedAt: item.pushed_at ?? null })
    }
  }
  const slice = (q, lo, hi) => {
    const query = `${q} pushed:${iso(lo)}..${iso(hi)}`
    const result = request(query, 1)
    if (!Number.isInteger(result.total_count) || !Array.isArray(result.items)) throw new Error(`invalid search response for ${query}`)
    if (result.total_count <= PER_PAGE) {
      add(query, result.items)
      if (result.items.length < result.total_count) incomplete.push(`${query} returned ${result.items.length} of ${result.total_count} repositories`)
      return
    }
    if (hi - lo < 2000) {
      add(query, result.items)
      incomplete.push(`${query} still matched ${result.total_count} repositories`)
      return
    }
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000
    slice(q, lo, mid)
    slice(q, mid + 1000, hi)
  }
  const lo = Math.floor(Date.parse(since) / 1000) * 1000, hi = Math.floor(Date.parse(until) / 1000) * 1000
  for (const q of queries) slice(q, lo, hi)
  for (const reason of incomplete) log(reason)
  return { repos: [...found.values()], incomplete }
}

const failureText = error => `${error.stderr ?? ''}\n${error.message ?? ''}`
export const rateLimited = error => /rate limit|HTTP 429|abuse detection/i.test(failureText(error))
const unavailable = error => /HTTP (404|409|451)/.test(failureText(error))

export function ghApi(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 64 * 1024 * 1024 }))
}

// raw.githubusercontent.com does not count against the API quota.
export function rawFile(repo, branch, path) {
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
  return execFileSync('curl', ['-fsSL', '--max-time', '30', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })
}

// Same rule as the scanner: a hooks.json inside a folder named hooks, outside node_modules.
// Unreadable trees and hook files count as candidates, so the scanner reports them instead.
// One API call per repository; hook files come from raw.githubusercontent.com.
export function hasHookModules({ repo, branch }, api = ghApi, raw = rawFile) {
  const tree = api(`repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
  if (tree.truncated) return true
  const paths = (tree.tree ?? [])
    .filter(entry => entry.type === 'blob' && /(^|\/)hooks\/hooks\.json$/.test(entry.path) && !/(^|\/)node_modules\//.test(entry.path))
    .map(entry => entry.path)
  return paths.some(path => {
    let text
    try { text = raw(repo, branch, path) } catch { return true }
    try {
      const hooks = JSON.parse(text)
      return Array.isArray(hooks?.modules) && hooks.modules.length > 0
    } catch { return true }
  })
}

// Deferred repositories go first. A repository already found not to be a mod is checked again
// only after a new push. The checkpoint moves to `startedAt` only when every query finished, and
// whatever the limit or the API budget leaves unchecked is deferred, so nothing in the window is lost.
export function findRecent(since, known, {
  state = { searchedThrough: null, checked: {}, deferred: [], pending: [] },
  pause = 3,
  request = createSearchRequest({
    run: (q, page) => ghSearchPage(q, page, execFileSync, { endpoint: 'search/repositories' }),
    pause, label: 'repository search',
  }),
  api = ghApi, raw = rawFile, limit = 200, budget = Infinity, startedAt = new Date().toISOString(), advance = true, log = console.error,
} = {}) {
  const seen = new Set(known.map(key))
  const checked = { ...state.checked }
  let matched = [], complete = true, searchError = null
  try {
    const result = searchRecent(since, startedAt, request, { log })
    matched = result.repos
    if (result.incomplete.length) {
      complete = false
      searchError = `${result.incomplete.length} time slices were incomplete, first ${result.incomplete[0]}.`
    }
  } catch (error) {
    complete = false
    searchError = String(error.message).split('\n')[0]
    log(error.message)
  }
  const latest = new Map(matched.map(candidate => [key(candidate.repo), candidate]))
  const queue = new Map()
  for (const candidate of [...state.deferred.map(c => latest.get(key(c.repo)) ?? c), ...matched]) {
    if (!queue.has(key(candidate.repo))) queue.set(key(candidate.repo), candidate)
  }
  const pending = [...queue.values()].filter(c => !seen.has(key(c.repo)) && !(key(c.repo) in checked && checked[key(c.repo)] === c.pushedAt))
  const allowed = Math.max(0, Math.min(limit, budget))
  const found = [], deferred = []
  let inspected = 0, failed = 0, stopped = null
  for (const candidate of pending) {
    if (stopped || inspected >= allowed) { deferred.push(candidate); continue }
    inspected++
    try {
      if (hasHookModules(candidate, api, raw)) found.push(candidate.repo)
      else checked[key(candidate.repo)] = candidate.pushedAt
    } catch (error) {
      const reason = String(error.stderr || error.message).trim().split('\n').at(-1)
      if (rateLimited(error)) {
        stopped = reason
        deferred.push(candidate)
        log(`stopped checking at ${candidate.repo}: ${reason}`)
      } else if (unavailable(error)) {
        checked[key(candidate.repo)] = candidate.pushedAt
        log(`skipped ${candidate.repo}: ${reason}`)
      } else {
        failed++
        deferred.push(candidate)
        log(`deferred ${candidate.repo}: ${reason}`)
      }
    }
  }
  if (deferred.length && !stopped && inspected >= allowed) log(`checked ${inspected} of ${pending.length} new repositories; ${deferred.length} wait for the next run`)
  const floor = Date.parse(since)
  for (const [repo, pushedAt] of Object.entries(checked)) if (!(Date.parse(pushedAt) >= floor)) delete checked[repo]
  // Without a stored checkpoint, a failed search records the boundary it used, so a later scan
  // cannot move the start of the unsearched window forward.
  const kept = state.searchedThrough ?? iso(Date.parse(since) + MARGIN_HOURS * HOUR)
  return {
    found,
    state: { searchedThrough: complete && advance ? startedAt : kept, checked, deferred, pending: state.pending },
    report: { matched: matched.length, pending: pending.length, inspected, deferred: deferred.length, failed, complete, searchError, stopped },
  }
}

export function describeRecent(since, { found, state, report }) {
  const lines = []
  if (!report.complete) lines.push(`Repository search did not finish, so the checkpoint stays at ${state.searchedThrough ?? 'the last scan'}. ${report.searchError}`)
  lines.push(`Repository search since ${since} matched ${report.matched} repositories; ${report.pending} needed a check, ${report.inspected} were checked, ${report.deferred} wait for the next run and ${report.failed} failed.`)
  if (report.stopped) lines.push(`Checking stopped at the API rate limit. ${report.stopped}`)
  lines.push(found.length ? `Added ${found.join(', ')}.` : 'No candidates were added.')
  return lines
}
