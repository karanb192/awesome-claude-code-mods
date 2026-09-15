// Parses `claude plugin validate` output into hooks, $ calls and surface modules.
// The validator prints one "hooks:" and one "calls:" line per module; the calls
// line may annotate helpers as "$.x.y (via a, b)", which is stripped here.

const LINE = /^\s*❯\s+(\S+)\s+(hooks|calls|surface modules):\s*(.*)$/

export function parseValidateOutput(text) {
  const modules = new Map()
  for (const raw of text.split('\n')) {
    const m = raw.match(LINE)
    if (!m) continue
    const [, file, kind, rest] = m
    const mod = modules.get(file) ?? { file, hooks: [], calls: [], surfaceModules: [] }
    if (kind === 'hooks') mod.hooks = parseHooks(rest)
    else if (kind === 'calls') mod.calls = parseCalls(rest)
    else mod.surfaceModules = rest.split(',').map(s => s.trim()).filter(Boolean)
    modules.set(file, mod)
  }
  const status = /✔ Validation passed with warnings/.test(text) ? 'warnings'
    : /✔ Validation passed/.test(text) ? 'passed'
    : /✘ Validation failed/.test(text) ? 'failed'
    : 'unknown'
  const errors = [...text.matchAll(/^\s*❯\s+(?!.*(?:hooks|calls|surface modules):)(.+)$/gm)]
    .map(m => m[1].trim())
    .filter(line => !line.startsWith('author:'))
  return { status, errors, modules: [...modules.values()] }
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
