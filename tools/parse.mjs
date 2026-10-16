// Parses `claude plugin validate` output into hooks, $ calls and surface modules.
// The validator prints one "hooks:" and one "calls:" line per module; the calls
// line may annotate helpers as "$.x.y (via a, b)", which is stripped here.

import { posix } from 'node:path'

const LINE = /^\s*❯\s+(\S+)\s+(hooks|calls|surface modules):\s*(.*)$/

export function parseValidateOutput(text) {
  const modules = new Map()
  for (const raw of text.split('\n')) {
    const m = raw.match(LINE)
    if (!m) continue
    const [, file, kind, rest] = m
    const mod = modules.get(file) ?? { file, hooks: [], calls: [], surfaceModules: [], reported: [] }
    if (kind === 'hooks') {
      mod.hooks = parseHooks(rest)
      if (rest.trim()) mod.reported.push('hooks')
    } else if (kind === 'calls') {
      mod.calls = parseCalls(rest)
      if (mod.calls.length || /^nothing on \$\s*$/.test(rest.trim())) mod.reported.push('calls')
    } else mod.surfaceModules = rest.split(',').map(s => s.trim()).filter(Boolean)
    modules.set(file, mod)
  }
  const status = /✔ Validation passed with warnings/.test(text) ? 'warnings'
    : /✔ Validation passed/.test(text) ? 'passed'
    : /✘ Validation failed/.test(text) ? 'failed'
    : 'unknown'
  const errors = []
  let inErrors = false
  for (const line of text.split('\n')) {
    if (/^✘ Found \d+ errors?:/.test(line)) inErrors = true
    else if (/^(?:⚠|✔|✘|Validating)/.test(line)) inErrors = false
    else if (inErrors) {
      const error = line.match(/^\s*❯\s+(.+)$/)
      if (error && !/^types .+ declares on \$:/.test(error[1])) errors.push(error[1].trim())
    }
  }
  return { status, errors, modules: [...modules.values()] }
}

export function footprintStatus(parsed, declared) {
  const complete = Array.isArray(declared) && declared.length > 0 && declared.every(file =>
    typeof file === 'string' && parsed.modules.some(mod => typeof mod.file === 'string'
      && posix.normalize(mod.file) === posix.normalize(file)
      && mod.reported?.includes('hooks') && mod.reported?.includes('calls')))
  return { status: complete ? 'reported' : 'unavailable' }
}

// "session.start, tool.call{tool=Bash}, ui.render{component=Pane, surface=terminal}"
export function parseHooks(s) {
  const out = []
  for (const m of s.matchAll(/([\w.*-]+)(\{[^}]*\})?/g)) {
    const event = m[1]
    if (!event || event === 'nothing') continue
    const matcher = {}
    if (m[2]) for (const kv of m[2].slice(1, -1).split(',')) {
      const [k, v] = kv.split('=').map(x => x.trim())
      if (k) matcher[k] = v
    }
    out.push({ event, matcher })
  }
  return out
}

// "$.clock.after (via reveal, throwNow), $.store.get, nothing on $"
export function parseCalls(s) {
  if (/^nothing on \$/.test(s.trim())) return []
  return [...s.matchAll(/\$\.[\w.]+/g)].map(m => m[0])
}
