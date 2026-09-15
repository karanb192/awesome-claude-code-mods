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

function search(q) {
  try {
    const out = execFileSync('gh', ['api', '-X', 'GET', 'search/code', '-f', `q=${q}`, '-f', 'per_page=100', '--paginate',
      '--jq', '.items[].repository.full_name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return out.split('\n').filter(Boolean)
  } catch (e) {
    console.error(`search failed for ${q}: ${e.stderr?.toString().trim() || e.message}`)
    return []
  }
}

const seeds = (() => { try { return readFileSync('data/seeds.txt', 'utf8').split('\n') } catch { return [] } })()
  .map(l => l.trim()).filter(l => l && !l.startsWith('#'))

const found = new Set(seeds)
for (const q of QUERIES) for (const r of search(q)) found.add(r)

mkdirSync('data', { recursive: true })
const repos = [...found].sort((a, b) => a.localeCompare(b))
writeFileSync('data/repos.txt', repos.join('\n') + '\n')
console.log(`${repos.length} candidate repos (${seeds.length} seeds)`)
