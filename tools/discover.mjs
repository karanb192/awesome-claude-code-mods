#!/usr/bin/env node
// Finds every GitHub repository that might contain a Claude Mod: two code
// searches plus data/seeds.txt (repos the search index has not caught up with).
// Writes data/repos.txt, one owner/repo per line. Needs `gh` logged in, or
// GH_TOKEN in the environment.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const QUERIES = [
  'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS',
  '"modules" filename:hooks.json path:hooks',
]

function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.ceil(seconds * 1000))
}

// The code search API rate-limits hard (10 requests a minute, plus a secondary
// limit) and says how long to wait. A search that still fails after the retries
// throws: an empty result here is not "no mods", it is "no answer".
export function search(q, run = ghSearch, attempts = 4, wait = sleep) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      return run(q)
    } catch (e) {
      last = e
      const msg = e.stderr?.toString().trim() || e.message
      const hinted = /try again in (\d+(?:\.\d+)?)s/.exec(msg)
      const limited = hinted || /HTTP (403|429)/.test(msg)
      console.error(`search failed for ${q} (attempt ${i} of ${attempts}): ${msg}`)
      if (!limited || i === attempts) break
      wait(hinted ? Number(hinted[1]) + 2 : 30 * i)
    }
  }
  throw new Error(`code search failed for ${q}: ${last?.stderr?.toString().trim() || last?.message}`)
}

function ghSearch(q) {
  const out = execFileSync('gh', ['api', '-X', 'GET', 'search/code', '-f', `q=${q}`, '-f', 'per_page=100', '--paginate',
    '--jq', '.items[].repository.full_name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return out.split('\n').filter(Boolean)
}

// A candidate list that shrinks by more than half overnight is a broken
// search, not a vanished ecosystem. Refuse to write it.
export function shrunk(previousCount, foundCount) {
  return previousCount >= 5 && foundCount < Math.ceil(previousCount / 2)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = (() => { try { return readFileSync('data/seeds.txt', 'utf8').split('\n') } catch { return [] } })()
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const previous = (() => { try { return readFileSync('data/repos.txt', 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).length } catch { return 0 } })()

  const found = new Set(seeds)
  for (const q of QUERIES) for (const r of search(q)) found.add(r)

  if (shrunk(previous, found.size)) {
    console.error(`discover found ${found.size} candidate repos, the committed list has ${previous}; refusing to overwrite data/repos.txt`)
    process.exit(1)
  }
  mkdirSync('data', { recursive: true })
  const repos = [...found].sort((a, b) => a.localeCompare(b))
  writeFileSync('data/repos.txt', repos.join('\n') + '\n')
  console.log(`${repos.length} candidate repos (${seeds.length} seeds)`)
}
