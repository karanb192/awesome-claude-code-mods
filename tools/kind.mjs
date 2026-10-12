// What a plugin with a hooks module is: a mod that counts, or something the scan records
// but keeps out of the table. Fixtures are test material by path or by their own
// description; mirrors copy Anthropic's built-ins; a catalogue repackages other authors'
// mods and is named once instead of once per copy.

import { readFileSync } from 'node:fs'

const NOT_A_MOD = [/\/tests?\//, /\/fixtures?\//, /\/probes?\//, /\/examples?\//, /\/upstreams?\//, /\/docs?\//, /\/templates?\//, /\/canary\//, /\/bench(?:marks?)?\//, /\/stubs?\//]
// This course keeps exercises and deliberate failures outside conventional fixture folders; final/ contains finished mods.
const COURSE_FIXTURES = new Map([
  ['kurushiba/claude-mods', /^(?:02-first-mod\/broken|03-events|04-test-pilot|05-ui\/broken|08-testing\/errors|09-distribution)(?:\/|$)/],
])

const readList = path => {
  let text; try { text = readFileSync(path, 'utf8') } catch { return new Set() }
  return new Set(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))
}
export const readCatalogs = (path = 'data/catalogs.txt') => readList(path)
export const readFixtureExceptions = (path = 'data/fixture-exceptions.txt') => readList(path)

export function kindOf(repo, rel, manifest, catalogs = new Set(), exceptions = new Set()) {
  if (repo === 'anthropics/claude-code') return 'builtin'
  if (!exceptions.has(`${repo}:${rel}`) && (NOT_A_MOD.some(re => re.test('/' + rel + '/')) || COURSE_FIXTURES.get(repo.toLowerCase())?.test(rel))) return 'fixture'
  if (/not a product mod|not a (?:plugin|mod) to install|not an? installable plugin|measurement instrument|test fixture|^\s*(?:for )?development only\b/i.test(manifest?.description ?? '')) return 'fixture'
  if (catalogs.has(repo)) return 'catalog'
  if (/\/mods\/(diff|sec-default|telemetry)$/.test('/' + rel) || ['diff', 'sec-default', 'telemetry'].includes(manifest?.name) && rel.includes('mods/')) return 'mirror'
  return 'mod'
}
