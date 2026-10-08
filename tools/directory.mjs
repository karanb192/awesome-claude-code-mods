// Which mods Anthropic's plugin directory lists. The directory is a built-in marketplace with no
// search command, but `claude plugin list --available --json` prints its whole catalogue, with the
// repository and subdirectory each entry installs from. A mod is listed when an entry installs
// from the mod's repository and path.

import { execFileSync } from 'node:child_process'

export const MARKETPLACE = 'anthropic-plugin-directory'

const repoOf = url => {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[#?].*)?$/i.exec(String(url ?? ''))
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null
}
const dirOf = path => String(path ?? '').replace(/^\.?\/+|\/+$/g, '').replace(/^\.$/, '')

// The directory's entries as { plugin, repo, path }; `path` is '' for a plugin at the repository root.
export function parseDirectory(raw) {
  const available = JSON.parse(raw).available
  if (!Array.isArray(available)) throw new Error('claude plugin list --available --json has no "available" list')
  const entries = []
  for (const entry of available) {
    if (entry.marketplaceName !== MARKETPLACE || !entry.source || typeof entry.source === 'string') continue
    const { url, repo, path } = entry.source
    const slug = repoOf(url ?? (repo && `https://github.com/${repo}`))
    if (slug) entries.push({ plugin: entry.pluginId ?? `${entry.name}@${MARKETPLACE}`, repo: slug, path: dirOf(path) })
  }
  // An empty directory is a failed refresh, not a catalogue that dropped every mod.
  if (!entries.length) throw new Error(`no ${MARKETPLACE} entries found`)
  return entries
}

export function readDirectory(run = execFileSync) {
  // Refreshing is best effort: the cached catalogue is still usable when the network is not.
  try { run('claude', ['plugin', 'marketplace', 'update', MARKETPLACE], { stdio: 'ignore' }) } catch {}
  return parseDirectory(run('claude', ['plugin', 'list', '--available', '--json'], { encoding: 'utf8', maxBuffer: 1 << 28 }))
}

// The entry listing this mod, as { plugin }, or null.
export function listing(mod, entries) {
  const path = dirOf(mod.path)
  const repo = String(mod.repo).toLowerCase()
  const hit = entries.find(e => e.repo === repo && e.path === path)
  return hit ? { plugin: hit.plugin } : null
}

// Sets mod.directory on every mod. Without a fresh catalogue (null) each mod keeps what it had.
export function applyDirectory(mods, entries, previous = new Map()) {
  for (const mod of mods) mod.directory = entries ? listing(mod, entries) : previous.get(mod.id) ?? null
  return mods
}
