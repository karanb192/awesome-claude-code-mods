// What a plugin with a hooks module is: a mod that counts, or something the scan records
// but keeps out of the table. Fixtures are test material by path or by their own
// description; mirrors copy Anthropic's built-ins; a catalogue repackages other authors'
// mods and is named once instead of once per copy.

import { readFileSync } from 'node:fs'

const NOT_A_MOD = [/\/tests?\//, /\/fixtures?\//, /\/probes?\//, /\/examples?\//, /\/upstreams?\//, /\/docs?\//, /\/templates?\//, /\/canary\//]

export function readCatalogs(path = 'data/catalogs.txt') {
  let text; try { text = readFileSync(path, 'utf8') } catch { return new Set() }
  return new Set(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))
}

export function kindOf(repo, rel, manifest, catalogs = new Set()) {
  if (repo === 'anthropics/claude-code') return 'builtin'
  if (NOT_A_MOD.some(re => re.test('/' + rel + '/'))) return 'fixture'
  if (/not a product mod|measurement instrument|test fixture/i.test(manifest?.description ?? '')) return 'fixture'
  if (catalogs.has(repo)) return 'catalog'
  if (/\/mods\/(diff|sec-default|telemetry)$/.test('/' + rel) || ['diff', 'sec-default', 'telemetry'].includes(manifest?.name) && rel.includes('mods/')) return 'mirror'
  return 'mod'
}
