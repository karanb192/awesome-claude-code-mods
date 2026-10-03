// Repository metadata for the scanner in GraphQL batches: one request per 50 repositories
// instead of one REST call each, which keeps a full scan well inside the Actions token's hourly
// quota. Repositories missing from a batch fall back to the scanner's REST call.

import { execFileSync } from 'node:child_process'

const FIELDS = 'stargazerCount pushedAt createdAt description isArchived licenseInfo { spdxId } defaultBranchRef { name }'

export function metaQuery(repos) {
  return 'query { ' + repos.map((repo, i) => {
    const [owner, name] = repo.split('/')
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${FIELDS} }`
  }).join(' ') + ' }'
}

export function toMeta(node) {
  if (!node) return null
  return {
    stars: node.stargazerCount ?? null, pushedAt: node.pushedAt ?? null, createdAt: node.createdAt ?? null,
    license: node.licenseInfo?.spdxId ?? null, description: node.description ?? null,
    defaultBranch: node.defaultBranchRef?.name ?? null, archived: node.isArchived ?? false,
  }
}

// gh exits nonzero when any repository in the batch is missing, but still prints the others.
export function ghGraphql(query, exec = execFileSync) {
  let out
  try {
    out = exec('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    out = error.stdout?.toString()
    if (!out) throw error
  }
  return JSON.parse(out).data ?? null
}

export function metaBatch(repos, { run = ghGraphql, size = 50, log = console.error } = {}) {
  const metas = new Map()
  for (let i = 0; i < repos.length; i += size) {
    const chunk = repos.slice(i, i + size)
    let data
    try { data = run(metaQuery(chunk)) } catch (error) {
      log(`metadata batch ${i / size + 1} failed; falling back to one request per repository: ${String(error.message).split('\n')[0]}`)
      continue
    }
    chunk.forEach((repo, j) => {
      const meta = toMeta(data?.[`r${j}`])
      if (meta) metas.set(repo.toLowerCase(), meta)
    })
  }
  return metas
}
