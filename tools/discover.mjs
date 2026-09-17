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

const PER_PAGE = 100
const MAX_PAGES = 10

// Code search returns at most 1000 results, 100 a page. The pages are fetched one at a
// time with a pause between them: a burst of page requests trips the secondary limit
// even when the ten-a-minute budget has room (438 results, five pages, and a fresh run
// still got a 429 on its first attempt). A page that is rate-limited is retried after at
// least a minute per attempt, or the hint when that is longer, since the hint is often
// a few seconds while the window lasts a minute or more. A search that still fails
// after the retries throws: an empty result here is not "no mods", it is "no answer".
export function search(q, run = ghSearchPage, attempts = 4, wait = sleep, pause = 10) {
  const found = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) wait(pause)
    const items = retry(() => run(q, page), q, attempts, wait)
    found.push(...items)
    if (items.length < PER_PAGE) break
  }
  return found
}

function retry(fn, q, attempts, wait) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      return fn()
    } catch (e) {
      last = e
      const msg = e.stderr?.toString().trim() || e.message
      const hinted = /try again in (\d+(?:\.\d+)?)s/.exec(msg)
      const limited = hinted || /HTTP (403|429)/.test(msg)
      console.error(`search failed for ${q} (attempt ${i} of ${attempts}): ${msg}`)
      if (!limited || i === attempts) break
      wait(Math.max(hinted ? Number(hinted[1]) + 2 : 0, 60 * i))
    }
  }
  throw new Error(`code search failed for ${q}: ${last?.stderr?.toString().trim() || last?.message}`)
}

function ghSearchPage(q, page) {
  const out = execFileSync('gh', ['api', '-X', 'GET', 'search/code', '-f', `q=${q}`, '-f', `per_page=${PER_PAGE}`, '-f', `page=${page}`,
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
