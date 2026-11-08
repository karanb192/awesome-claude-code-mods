// What a user would type to install a mod, when the scan saw a marketplace that lists it. Shared by the
// finder and the website's mod pages; it lives in finder/ because the installed plugin ships only this folder.
// It names the repository rather than the marketplace, because dozens of unrelated marketplaces share names
// like claude-mods. The scan records the manifest's plugin name, not the marketplace entry's.
const VERIFIED = new Set(['passed', 'warnings'])

export function install(m) {
  if (m.directory?.plugin) return { command: `/plugin install ${m.directory.plugin}`, from: "Anthropic's plugin directory" }
  const root = (m.marketplaces ?? []).find(p => p.path === '.claude-plugin/marketplace.json' && VERIFIED.has(p.status))
  if (!root) return null
  return { command: `/plugin install ${m.name} --marketplace ${m.repo}`, from: "the repository's own marketplace", check: "Confirm the plugin name in the repository's README before installing." }
}
