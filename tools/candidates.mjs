import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

export function parseRepos(text) {
  return text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
}

export function readRepos(path) {
  try { return parseRepos(readFileSync(path, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

export function mergeRepos(...lists) {
  const repos = new Map()
  for (const repo of lists.flat()) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`invalid repository: ${repo}`)
    if (!repos.has(repo.toLowerCase())) repos.set(repo.toLowerCase(), repo)
  }
  return [...repos.values()].sort((a, b) => a.localeCompare(b))
}

export function newSeeds(before, after) {
  const known = new Set(before.map(repo => repo.toLowerCase()))
  return mergeRepos(after).filter(repo => !known.has(repo.toLowerCase()))
}

// A seeds-only pull request scans just its new seeds; anything else rescans every candidate.
export function prScanRepos(candidates, seeds, added, seedsOnly) {
  return seedsOnly && added.length ? added : mergeRepos(candidates, seeds)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { base: { type: 'string' }, 'seeds-only': { type: 'boolean', default: false } } })
  if (!values.base || !/^[a-f0-9]{40}$/.test(values.base)) throw new Error('a full PR base commit is required')
  const seeds = readRepos('data/seeds.txt')
  const before = parseRepos(execFileSync('git', ['show', `${values.base}:data/seeds.txt`], { encoding: 'utf8' }))
  const added = newSeeds(before, seeds)
  writeFileSync('data/pr-repos.txt', prScanRepos(readRepos('data/repos.txt'), seeds, added, values['seeds-only']).join('\n') + '\n')
  writeFileSync('data/pr-required.txt', added.join('\n') + '\n')
}
