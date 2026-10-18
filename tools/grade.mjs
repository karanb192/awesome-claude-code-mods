// Turns a mod's static footprint into a reach level and plain-language labels.
// A footprint is what a mod can touch, read straight off the validator; it says
// nothing about intent. Levels only order the rows.

// Every member of the mods API in Claude Code 2.1.302, from the type declarations it writes for a mod
// (claude-code/index.d.ts), with the level and label its description supports. tools/api-members.json lists
// the same members, and a test keeps the two equal. A call outside this table is unclassified: either a
// method in a namespace the table covers, or a namespace it does not cover, which could be an API another
// mod adds, a different Claude Code version or a typo. Levels are this catalogue's ordering of what a mod's own code references, not limits on
// what can follow from it.
export const METHODS = {
  'plugin.name': [0, null], 'plugin.root': [0, null],
  'ui.notice': [0, 'draws'], 'ui.invalidate': [0, 'draws'], 'ui.blit': [0, 'draws'], 'ui.resolve': [0, 'draws'], 'ui.log': [0, 'draws'],
  'ui.ask': [0, 'draws'], 'ui.toast': [0, 'draws'], 'ui.notify': [0, 'draws'], 'ui.status': [0, 'draws'], 'ui.open': [0, 'draws'],
  'ui.close': [0, 'draws'], 'ui.panes': [0, 'draws'], 'ui.scroll': [0, 'draws'], 'ui.focus': [0, 'draws'], 'ui.view': [0, 'draws'],
  'ui.copy': [1, 'writes the clipboard'], 'ui.selection': [1, 'reads the selection'],
  'model.complete': [2, 'drives Claude'], 'model.fork': [2, 'drives Claude'], 'model.classify': [2, 'drives Claude'],
  'audio.play': [0, 'plays audio'], 'audio.speak': [0, 'plays audio'],
  'mcp.call': [3, 'MCP servers'], 'mcp.connect': [3, 'MCP servers'],
  'session.messages': [1, 'reads the transcript'], 'session.cwd': [0, null], 'session.root': [0, null], 'session.model': [0, null],
  'session.turns': [0, null], 'session.id': [0, null], 'session.repo': [1, 'reads files'], 'session.surfaces': [0, null], 'session.surface': [0, null],
  'session.usage': [0, null], 'session.version': [0, null], 'session.compact': [2, 'drives Claude'], 'session.send': [2, 'drives Claude'],
  'session.append': [2, 'drives Claude'], 'session.authorize': [1, 'requests an Anthropic credential handle'], 'session.identity': [1, 'reads your sign-in'],
  'turn.abort': [2, 'drives Claude'],
  'prompt.submit': [2, 'drives Claude'], 'prompt.read': [1, 'reads the prompt box'], 'prompt.media': [1, 'reads prompt attachments'],
  'prompt.fill': [1, 'writes the prompt box'], 'prompt.suggest': [1, 'writes the prompt box'], 'prompt.compose': [1, 'reads the system prompt'],
  'tool.list': [0, null], 'tool.call': [2, 'drives Claude'], 'tool.check': [0, null], 'tool.register': [2, 'drives Claude'],
  'command.list': [0, null], 'command.run': [2, 'drives Claude'], 'command.register': [0, null],
  'config.list': [1, 'reads settings'], 'config.set': [2, 'changes config'],
  'telemetry.log': [1, 'telemetry'], 'telemetry.mark': [1, 'telemetry'],
  'agent.spawn': [2, 'drives Claude'], 'agent.list': [0, null], 'agent.register': [2, 'drives Claude'],
  'fs.read': [1, 'reads files'], 'fs.write': [2, 'writes files'], 'fs.list': [1, 'reads files'], 'fs.exists': [1, 'reads files'], 'fs.stat': [1, 'reads files'], 'fs.ancestors': [1, 'reads files'],
  'store.get': [0, 'persists state'], 'store.set': [0, 'persists state'], 'store.delete': [0, 'persists state'], 'store.keys': [0, 'persists state'],
  'state.get': [1, 'reads mod state'], 'state.set': [0, null],
  'clock.now': [0, null], 'clock.sleep': [0, null], 'clock.after': [0, null], 'clock.every': [0, null],
  'http.fetch': [3, 'network'], 'process.run': [2, 'runs processes'], 'process.spawn': [2, 'runs processes'],
  'settings.read': [1, 'reads settings'], 'env.get': [1, 'reads env vars'], 'env.set': [2, 'sets env vars'],
}

// Labels in the order pages and badges list them: widest reach first.
const LABEL_ORDER = ['network', 'MCP servers', 'runs processes', 'writes files', 'sets env vars', 'changes config', 'drives Claude',
  'writes the prompt box', 'writes the clipboard', 'reads files', 'reads env vars', 'reads settings', 'reads the transcript',
  'reads the selection', 'reads the prompt box', 'reads prompt attachments', 'reads the system prompt', 'reads mod state',
  'requests an Anthropic credential handle', 'reads your sign-in', 'telemetry', 'plays audio', 'persists state', 'draws']
const CORE = new Set(Object.keys(METHODS).map(member => member.split('.')[0]))
const member = call => call.startsWith('$.') ? call.slice(2) : call
// Own keys only: a recorded call such as $.constructor must not match an inherited property.
const ruleOf = call => Object.hasOwn(METHODS, member(call)) ? METHODS[member(call)] : undefined
const namespaceOf = call => member(call).split('.')[0]

export const LEVEL_NAMES = ['draws and remembers', 'reads', 'writes or runs', 'network']

export function hasFootprint(mod) {
  if (mod.footprint) return mod.footprint.status === 'reported'
  // Legacy failures do not say whether the validator finished reporting every module.
  const status = mod.validate?.status === 'unknown' ? mod.lastKnownValidate?.status : mod.validate?.status
  return ['passed', 'warnings'].includes(status)
}

// An unclassified call is labelled "other: <call>" and counts as level 1, the form installed copies of
// mod-finder read; calls in a namespace the table does not cover are also listed under `foreign`.
export function grade(calls, complete = true) {
  let level = 0
  const labels = new Set(), foreign = new Set()
  for (const call of calls) {
    const rule = ruleOf(call)
    if (!rule) {
      labels.add(`other: ${call}`)
      level = Math.max(level, 1)
      if (!CORE.has(namespaceOf(call))) foreign.add(call)
      continue
    }
    level = Math.max(level, rule[0])
    if (rule[1]) labels.add(rule[1])
  }
  const order = label => label.startsWith('other: ') ? LABEL_ORDER.length : LABEL_ORDER.indexOf(label)
  return {
    level: complete ? level : null, name: complete ? LEVEL_NAMES[level] : 'unknown',
    labels: [...labels].sort((a, b) => order(a) - order(b)),
    ...(!complete ? { minimumLevel: level } : {}),
    ...(foreign.size ? { foreign: [...foreign] } : {}),
  }
}

// Grades every record again from its recorded calls, so stored levels and labels follow this table whether
// a record was scanned today, retained from an earlier scan or published by seed publication.
export function regrade(records) {
  for (const record of records) if (Array.isArray(record.calls)) record.reach = grade(record.calls, hasFootprint(record))
  return records
}

// The level and labels of the calls the table grades, apart from the ones it does not. The stored level counts
// an ungraded call as 1, which is neither a ceiling nor a floor, so pages state them apart: `unclassified`
// holds methods in namespaces the table covers, `foreign` calls in namespaces it does not.
export function classified(calls) {
  const known = calls.filter(call => ruleOf(call))
  const { level, name, labels } = grade(known)
  const unknown = calls.filter(call => !ruleOf(call))
  return { level, name, labels, graded: known.length, unclassified: unknown.filter(call => CORE.has(namespaceOf(call))), foreign: unknown.filter(call => !CORE.has(namespaceOf(call))) }
}

// What the mod observes, from the events it hooks.
export function visibility(hooks) {
  const sees = new Set()
  for (const { event, matcher } of hooks) {
    if (event === '*') sees.add('everything')
    else if (event === 'tool.call') sees.add(matcher.tool ? `${matcher.tool} calls` : 'every tool call')
    else if (event === 'prompt.submit') sees.add('every prompt')
    else if (event === 'prompt.context' || event === 'prompt.section') sees.add('the system prompt')
    else if (event === 'session.compact') sees.add('compaction')
    else if (event === 'agent.spawn') sees.add('subagent spawns')
    else if (event === 'skill.prompt') sees.add(matcher.skill ? `the ${matcher.skill} skill` : 'every skill')
    else if (event.startsWith('classic.')) sees.add('classic hooks')
  }
  return [...sees]
}

export function drawsOn(hooks) {
  return hooks.filter(h => h.event === 'ui.render').map(h => h.matcher.component ?? 'any component')
}
