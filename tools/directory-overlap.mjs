#!/usr/bin/env node
// Lists the mods in data/mods.json that Anthropic's plugin directory also lists, by reading the
// directory fresh. The scan records the same answer as `directory` on each mod.
//   node tools/directory-overlap.mjs [--json] [catalogue.json]
// catalogue.json is saved `claude plugin list --available --json` output; without it the CLI is run.
import { readFileSync } from 'node:fs'
import { parseDirectory, readDirectory, listing } from './directory.mjs'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const entries = file ? parseDirectory(readFileSync(file, 'utf8')) : readDirectory()
const mods = JSON.parse(readFileSync(new URL('../data/mods.json', import.meta.url), 'utf8')).mods
const hits = mods.flatMap(mod => { const found = listing(mod, entries); return found ? [{ mod: mod.id, kind: mod.kind, directory: found.plugin }] : [] })

if (args.includes('--json')) console.log(JSON.stringify(hits, null, 2))
else {
  for (const h of hits) console.log(`${h.kind.padEnd(8)} ${h.mod}  ->  ${h.directory}`)
  console.error(`\n${entries.length} directory entries, ${mods.length} mods; ${hits.length} listed`)
}
