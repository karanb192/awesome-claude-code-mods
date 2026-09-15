// Turns a mod's static footprint into a reach level and plain-language labels.
// A footprint is what a mod can touch, read straight off the validator; it says
// nothing about intent. Levels only order the rows.

const RULES = [
  [/^\$\.http\.fetch$/, 3, 'network'],
  [/^\$\.mcp\.call$/, 3, 'MCP servers'],
  [/^\$\.process\.run$/, 2, 'runs processes'],
  [/^\$\.fs\.write$/, 2, 'writes files'],
  [/^\$\.env\.set$/, 2, 'sets env vars'],
  [/^\$\.config\.set$/, 2, 'changes config'],
  [/^\$\.(model\.\w+|agent\.spawn|prompt\.submit|tool\.call|command\.run|turn\.abort|session\.compact|tool\.register)$/, 2, 'drives Claude'],
  [/^\$\.prompt\.(fill|suggest)$/, 1, 'writes the prompt box'],
  [/^\$\.fs\.(read|readFile|list|stat|exists|ancestors)$/, 1, 'reads files'],
  [/^\$\.env\.get$/, 1, 'reads env vars'],
  [/^\$\.settings\.read$/, 1, 'reads settings'],
  [/^\$\.session\.(messages|authorize)$/, 1, 'reads the transcript'],
  [/^\$\.telemetry\.\w+$/, 1, 'telemetry'],
  [/^\$\.audio\.\w+$/, 0, 'plays audio'],
  [/^\$\.store\.\w+$/, 0, 'persists state'],
  [/^\$\.ui\.\w+$/, 0, 'draws'],
  [/^\$\.agent\.list$/, 0, null],
  [/^\$\.(clock|command|plugin|session|config)\.\w+$/, 0, null],
]

export const LEVEL_NAMES = ['draws and remembers', 'reads', 'writes or runs', 'network']

export function grade(calls) {
  let level = 0
  const labels = new Set()
  for (const call of calls) {
    const rule = RULES.find(([re]) => re.test(call))
    if (!rule) { labels.add(`other: ${call}`); level = Math.max(level, 1); continue }
    level = Math.max(level, rule[1])
    if (rule[2]) labels.add(rule[2])
  }
  const order = l => RULES.findIndex(r => r[2] === l)
  return { level, name: LEVEL_NAMES[level], labels: [...labels].sort((a, b) => order(a) - order(b)) }
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
