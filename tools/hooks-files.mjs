// Which hooks files make a plugin a mod. Claude Code reads hooks/hooks.json under the plugin root and
// merges every hooks file that plugin.json's `hooks` field names, a path or an array of paths and
// inline objects (https://code.claude.com/docs/en/plugins/manifest-reference#hooks). A file names a
// mod when its `modules` key is a non-empty array of paths relative to that file. An inline object is
// an event map, so a `modules` key there is ignored as an unknown event. Declared paths follow what
// `claude plugin validate` reads: a string, relative to the plugin root or absolute, that stays inside
// it and names a regular file reached through no symlink. A path without the "./" prefix, with a ".."
// segment or without the .json extension is still read, and validation fails on it.

import { lstatSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'

export const DEFAULT_HOOKS_FILE = 'hooks/hooks.json'

// The hooks files plugin.json declares, relative to the plugin root (an absolute posix path) and
// normalized, in order and without repeats. A hooks/hooks.json is left out: the plugin's own is its
// default, and one deeper down belongs to the plugin two folders above it, as scans have always filed it.
export function declaredHooksFiles(manifest, root) {
  const entries = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? [manifest.hooks].flat() : []
  const files = []
  for (const entry of entries) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const path = posix.relative(root, posix.resolve(root, entry))
    if (!path || path === '..' || path.startsWith('../') || posix.isAbsolute(path) || /(^|\/)hooks\/hooks\.json$/.test(path)) continue
    if (!files.includes(path)) files.push(path)
  }
  return files
}

// The `modules` array of a parsed hooks file, or null when the scanner cannot judge the file: not an
// object, or `modules` present but not an array.
export function hooksModules(hooks) {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks) || ('modules' in hooks && !Array.isArray(hooks.modules))) return null
  return Array.isArray(hooks.modules) ? hooks.modules : []
}

function regularFile(root, rel) {
  let at = root, st
  for (const part of rel.split('/')) {
    at = join(at, part)
    try { st = lstatSync(at) } catch { return false }
    if (st.isSymbolicLink()) return false
  }
  return Boolean(st?.isFile())
}

// Absolute paths of the hooks files Claude Code loads for the plugin at `root`, default first.
export function pluginHooksFiles(root, manifest) {
  return [DEFAULT_HOOKS_FILE, ...declaredHooksFiles(manifest, root)].filter(rel => regularFile(root, rel)).map(rel => join(root, rel))
}

// Module paths are relative to the hooks file that names them; the UI source review takes them absolute.
export function moduleSources(hooksFile, modules) {
  return modules.map(module => typeof module === 'string' ? resolve(dirname(hooksFile), module) : module)
}
