#!/usr/bin/env node
// Finds every GitHub repository that might contain a Claude Mod: two code
// searches plus data/seeds.txt (repos the search index has not caught up with).
// Writes data/repos.txt, one owner/repo per line. Needs `gh` logged in, or
// GH_TOKEN in the environment.
//
//   node tools/discover.mjs                         # code search; fails without writing when it cannot finish
//   node tools/discover.mjs --recent                # also repository search; reads and updates data/discovery.json
//   node tools/discover.mjs --recent --restore <file>  # also merge progress saved by an earlier run
//   node tools/discover.mjs --skip-code-search      # known candidates and seeds only
//   node tools/discover.mjs --keep-on-failure       # a failed code search keeps the known candidates instead of failing
//   node tools/discover.mjs --recent --check-limit 2000  # check more new repos than the default 200
//   node tools/discover.mjs --recent --search-pause 0     # no pause between search requests (defaults 10 s for code, 3 s for repositories)
//   node tools/discover.mjs --note <file>           # write what discovery did, for the scan pull request

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { readRepos, mergeRepos } from './candidates.mjs'
import { createSearchRequest } from './github-search.mjs'
import { findRecent, recentSince, readState, writeState, mergeState, describeRecent } from './recent.mjs'

const QUERIES = [
  'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS',
  '"modules" filename:hooks.json path:hooks',
]

const PER_PAGE = 100
const MAX_RESULTS = 1000
const MAX_FILE_BYTES = 384 * 1024

// File-size partitions bypass GitHub's per-query cap; inconsistent snapshots fail instead of losing candidates.
export function search(q, request = createSearchRequest()) {
  const page = (query, n) => {
    const result = request(query, n)
    if (!Number.isInteger(result.total_count) || result.total_count < 0 || result.incomplete_results !== false || !Array.isArray(result.items)) {
      throw new Error(`invalid search response for ${query}`)
    }
    return result
  }
  const unstable = message => {
    const error = new Error(message)
    error.unstable = true
    throw error
  }
  const collect = (query, first) => {
    const items = [...first.items]
    for (let n = 2; n <= Math.ceil(first.total_count / PER_PAGE); n++) {
      const next = page(query, n)
      if (next.total_count !== first.total_count) unstable(`search count changed while paging ${query}`)
      items.push(...next.items)
    }
    const files = new Set(items.map(item => {
      if (!item.repository?.full_name || typeof item.path !== 'string') throw new Error(`invalid search item for ${query}`)
      return `${item.repository.full_name.toLowerCase()}:${item.path}`
    }))
    if (files.size !== first.total_count || items.length !== first.total_count) unstable(`partial pagination for ${query}: got ${files.size} of ${first.total_count} files`)
    return items
  }
  const partition = (lo, hi) => {
    const query = `${q} size:${lo}..${hi}`
    const first = page(query, 1)
    if (first.total_count <= MAX_RESULTS) {
      try { return collect(query, first) } catch (error) {
        if (!error.unstable || lo === hi) throw error
        console.error(`${error.message}; splitting into smaller searches`)
      }
    }
    if (lo === hi) throw new Error(`search still capped at file size ${lo} for ${q}; refusing partial discovery`)
    const mid = Math.floor((lo + hi) / 2)
    const items = [...partition(lo, mid), ...partition(mid + 1, hi)]
    return items
  }
  const first = page(q, 1)
  if (first.total_count <= MAX_RESULTS) {
    try { return collect(q, first).map(item => item.repository.full_name) } catch (error) {
      if (!error.unstable) throw error
      console.error(`${error.message}; splitting into smaller searches`)
    }
  }
  const items = partition(0, MAX_FILE_BYTES - 1)
  // Check the tail too, so a future increase in GitHub's file-size limit cannot lose results silently.
  const tailQuery = `${q} size:>=${MAX_FILE_BYTES}`
  const tail = page(tailQuery, 1)
  if (tail.total_count > MAX_RESULTS) throw new Error(`search capped beyond supported file-size range for ${q}`)
  items.push(...collect(tailQuery, tail))
  // Independent queries do not share an index snapshot. Each leaf must be complete; parent totals can move meanwhile.
  if (items.length !== first.total_count) console.error(`search index changed during ${q}: initial ${first.total_count} files, complete partitions returned ${items.length}`)
  return items.map(item => item.repository.full_name)
}

function lastScan() {
  try { return JSON.parse(readFileSync('data/mods.json', 'utf8')).generated } catch { return null }
}

// The scanner fetches metadata in GraphQL batches; keep some REST calls back for its per-repo fallback.
const SCAN_RESERVE = 100
function apiBudget() {
  try {
    const remaining = Number(execFileSync('gh', ['api', 'rate_limit', '--jq', '.resources.core.remaining'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    return Number.isFinite(remaining) ? Math.max(0, remaining - SCAN_RESERVE) : Infinity
  } catch { return Infinity }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({ options: {
    'skip-code-search': { type: 'boolean', default: false },
    'keep-on-failure': { type: 'boolean', default: false },
    recent: { type: 'boolean', default: false },
    since: { type: 'string' },
    restore: { type: 'string' },
    'check-limit': { type: 'string', default: '200' },
    'search-pause': { type: 'string' },
    note: { type: 'string' },
  } })
  const limit = Number(args['check-limit'])
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`--check-limit must be a whole number, got ${args['check-limit']}`)
  const pause = args['search-pause'] === undefined ? undefined : Number(args['search-pause'])
  if (pause !== undefined && !(pause >= 0)) throw new Error(`--search-pause must be a number of seconds, got ${args['search-pause']}`)
  const seeds = readRepos('data/seeds.txt')
  const previous = readRepos('data/repos.txt')
  const notes = []
  const firstLine = error => String(error.message).split('\n')[0]
  let discovered = []
  if (args['skip-code-search']) notes.push('Code search was skipped; this run covers known candidates and seeds.')
  else {
    try {
      const request = createSearchRequest(pause === undefined ? {} : { pause })
      discovered = QUERIES.flatMap(q => search(q, request))
    } catch (error) {
      if (!args['keep-on-failure']) throw error
      console.error(`${error.message}\nkeeping the known candidates and seeds`)
      notes.push(`Code search did not finish, so discovery kept the known candidates and seeds. ${firstLine(error)}`)
    }
  }
  if (args.recent) {
    const state = args.restore ? mergeState(readState(), readState(args.restore)) : readState()
    // Repos an earlier run found, by either search, stay candidates until a scan PR puts them on main.
    const onMain = new Set(mergeRepos(previous, seeds).map(repo => repo.toLowerCase()))
    const carried = state.pending.filter(repo => !onMain.has(repo.toLowerCase()))
    discovered.push(...carried)
    const since = args.since ?? recentSince(state.searchedThrough ?? lastScan())
    const result = findRecent(since, mergeRepos(previous, seeds, discovered), { state, limit, pause, budget: apiBudget(), advance: !args.since })
    discovered.push(...result.found)
    writeState({ ...result.state, pending: mergeRepos(discovered).filter(repo => !onMain.has(repo.toLowerCase())) })
    notes.push(...describeRecent(since, result))
    if (carried.length) notes.push(`Carried over from earlier runs: ${carried.join(', ')}.`)
  }
  mkdirSync('data', { recursive: true })
  const repos = mergeRepos(previous, seeds, discovered)
  writeFileSync('data/repos.txt', repos.join('\n') + '\n')
  if (args.note) writeFileSync(args.note, notes.map(line => line + '\n').join(''))
  console.log(`${repos.length} candidate repos (${seeds.length} seeds)`)
  for (const line of notes) console.log(line)
}
