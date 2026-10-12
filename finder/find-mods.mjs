#!/usr/bin/env node
// Searches the Claude Code mods catalogue from the command line and prints JSON, the same answers the
// MCP server gives. The catalogue is downloaded once and cached; only the matching entries are printed.
//
//   node find-mods.mjs search "code review" --without network --limit 5
//   node find-mods.mjs get owner/repo:path

import { parseArgs } from 'node:util'
import { loadSnapshot, buildIndex, search, getMod, InputError } from './search.mjs'

const usage = `usage:
  find-mods.mjs search [words...] [--without network,runs processes] [--max-reach 0-3] [--verified-only]
                       [--include-unverified] [--in-anthropic-directory] [--repo owner/repo] [--limit N] [--cursor C]
  find-mods.mjs get <id>
options: --refresh (download now), --offline (cached copy only), --pretty`

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      without: { type: 'string', multiple: true }, 'max-reach': { type: 'string' }, 'verified-only': { type: 'boolean' },
      'include-unverified': { type: 'boolean' }, 'in-anthropic-directory': { type: 'boolean' }, repo: { type: 'string' },
      limit: { type: 'string' }, cursor: { type: 'string' }, refresh: { type: 'boolean' }, offline: { type: 'boolean' },
      pretty: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  })
} catch (error) {
  console.error(`${error.message}\n${usage}`)
  process.exit(2)
}
const { values: o, positionals: [command, ...rest] } = parsed
if (o.help || !['search', 'get'].includes(command)) {
  console.error(usage)
  process.exit(o.help ? 0 : 2)
}

if (o.offline && o.refresh) {
  console.error(`--offline and --refresh contradict each other\n${usage}`)
  process.exit(2)
}

try {
  const { data, revision } = await loadSnapshot({ refresh: o.refresh ? 'force' : o.offline ? 'never' : 'auto' })
  const index = buildIndex(data, revision)
  const out = command === 'get'
    ? getMod(index, rest.join(' '))
    : search(index, {
      query: rest.join(' '), without: o.without?.flatMap(v => v.split(',')), max_reach: o['max-reach'],
      verified_only: o['verified-only'], include_unverified: o['include-unverified'], in_anthropic_directory: o['in-anthropic-directory'],
      repo: o.repo, limit: o.limit, cursor: o.cursor,
    })
  console.log(JSON.stringify(out, null, o.pretty ? 2 : 0))
} catch (error) {
  console.error(error instanceof InputError ? `${error.message}\n${usage}` : error.message)
  process.exit(error instanceof InputError ? 2 : 1)
}
