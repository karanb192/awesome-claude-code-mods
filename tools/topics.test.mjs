import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PROSE_SLUGS, TOPICS_PATH, groupOf, listedMembers, matchOf, readTopics, renderTopicPage, topicMembers, topicSummary } from './topics.mjs'

const record = (repo, name, extra = {}) => ({
  id: `${repo}:${extra.path ?? name}`, repo, path: extra.path ?? name, name, kind: 'mod', description: `${name} shows the prompt cache timer.`, stars: 1,
  url: `https://github.com/${repo}`, footprint: { status: 'reported' }, hooks: [], calls: ['$.ui.notice'], sees: [], surfaceModules: [],
  validate: { status: 'passed', claudeVersion: '2.1.302', errors: [] }, marketplaces: [], ...extra,
})
const json = (extra = {}) => JSON.stringify([{ slug: 'prompt-cache', title: 'Prompt cache mods for Claude Code', short: 'Prompt cache', description: 'Mods about the cache.', patterns: ['prompt[ -]cache', 'cache[ -]warm'], include: [], exclude: [], related: [], ...extra }])
const topic = extra => readTopics(json(extra))[0]
const topicFor = slug => readTopics(json({ slug, title: `${slug} mods`, short: slug }))[0]
const entries = mods => mods.map(mod => ({ mod, slug: `${mod.repo.replace('/', '--')}--${mod.name}` }))
const nav = [{ slug: 'prompt-cache', short: 'Prompt cache', title: 'Prompt cache mods for Claude Code' }]
const page = (mods, extra, options) => renderTopicPage(topic(extra), entries(mods), { topics: nav, letters: ['c'], version: '2.1.302', ...options })
const order = (html, names) => names.map(name => html.indexOf(`>${name}</a>`))
const BANNED = /\b(safe|vetted|secure|best|top|recommended|endorsed)\b/i

test('a pattern matches the name or the description, case-insensitive, with a space or a hyphen, and only a counted mod', () => {
  const t = topic()
  assert.equal(matchOf(t, record('o/r', 'x', { description: 'Keeps the Prompt-Cache warm.' })).pattern, 'prompt[ -]cache')
  assert.equal(matchOf(t, record('o/r', 'PROMPT CACHE', { description: '' })).pattern, 'prompt[ -]cache')
  assert.equal(matchOf(t, record('o/r', 'x', { description: 'A prompt\n  cache line.' })).pattern, 'prompt[ -]cache', 'whitespace collapses as the renderer collapses it')
  assert.equal(matchOf(t, record('o/r', 'x', { description: 'promptcache' })), undefined)
  assert.equal(matchOf(t, record('o/r', 'x', { description: 'the cache—warm trick' })), undefined, 'a dash becomes a colon, as on every page')
  for (const kind of ['fixture', 'catalog', 'duplicate', 'builtin']) assert.equal(matchOf(t, record('o/r', 'prompt cache', { kind })), undefined, kind)
})

test('include adds a non-matching id and exclude removes a matching one, ids ignore repository case and keep path case, and a stale id is reported', () => {
  const records = [record('O/R', 'tool', { description: 'No match here.' }), record('o/r', 'cache', { description: 'Cache warm.' }), record('o/r', 'fixture', { kind: 'fixture', description: 'prompt cache' })]
  const { members, hits, stale } = topicMembers(topic({ include: ['o/r:tool', 'o/r:Tool', 'o/r:fixture', 'gone/repo:.'], exclude: ['O/R:cache', 'gone/repo:old'] }), records)
  assert.deepEqual(members.map(mod => mod.id), ['O/R:tool'])
  assert.deepEqual(hits.map(hit => [hit.mod.id, hit.pattern]), [['o/r:cache', 'cache[ -]warm']])
  assert.deepEqual(stale, ['o/r:Tool', 'o/r:fixture', 'gone/repo:.', 'gone/repo:old'])
  const plain = topicMembers(topic(), records)
  assert.deepEqual(plain.members.map(mod => mod.id), ['o/r:cache'])
  assert.deepEqual(plain.stale, [])
})

test('the data file is checked: slugs, prose, patterns and related slugs', () => {
  assert.throws(() => readTopics(json({ patterns: ['prompt[ -cache'] })), /invalid pattern "prompt\[ -cache"/)
  assert.throws(() => readTopics(json({ slug: 'Prompt_Cache' })), /invalid or repeated slug/)
  assert.throws(() => readTopics(JSON.stringify([JSON.parse(json())[0], JSON.parse(json())[0]])), /invalid or repeated slug/)
  assert.throws(() => readTopics(json({ slug: 'guards' })), /has no prose/)
  assert.throws(() => readTopics(json({ related: ['usage-meters'] })), /relates to "usage-meters", which is not another topic/)
  assert.throws(() => readTopics(json({ related: ['prompt-cache'] })), /relates to "prompt-cache"/)
  assert.throws(() => readTopics(json({ title: ' ' })), /needs a title/)
  assert.throws(() => readTopics(json({ include: 'o/r:x' })), /needs include as an array of strings/)
  assert.throws(() => readTopics('{}'), /must be an array/)
  const real = readTopics(readFileSync(new URL(`../${TOPICS_PATH}`, import.meta.url), 'utf8'))
  assert.deepEqual(real.map(t => t.slug).sort(), [...PROSE_SLUGS].sort(), 'every slug in the data file has prose and every prose block has a slug')
  assert.deepEqual(real.map(t => [t.slug, t.related]), [['prompt-cache', ['usage-meters']], ['usage-meters', ['prompt-cache']]], 'the two topics relate to each other')
  for (const t of real) for (const id of [...t.include, ...t.exclude]) assert.match(id, /^[^:]+\/[^:]+:.+$/, `${t.slug} id ${id}`)
})

test('retained records and empty descriptions are not listed, and a failed mod is listed with its status', () => {
  const failed = record('o/r', 'cache-guard', { validate: { status: 'failed', claudeVersion: '2.1.308', errors: ['bad'] } })
  const members = [record('o/r', 'a'), record('o/r', 'b', { validate: { status: 'unknown', errors: ['Not found in this scan.'] } }), record('o/r', 'c', { description: '  ' }), failed]
  assert.deepEqual(listedMembers(members).map(mod => mod.name), ['a', 'cache-guard'])
  const html = page([record('o/r', 'a'), failed])
  assert.match(html, /cache-guard<\/a>[\s\S]*?Fails validation on Claude Code 2\.1\.308\./)
  assert.doesNotMatch(html.split('cache-guard</a>')[0], /Fails validation/)
})

test('groups split at 10 and 100 with name order and id tie-break inside, and unknown stars fall in the lowest group', () => {
  assert.deepEqual([null, undefined, 0, 9, 10, 99, 100, 5000].map(groupOf), [2, 2, 2, 2, 1, 1, 0, 0])
  const mods = [record('z/z', 'beta', { stars: 100 }), record('a/a', 'alpha', { stars: 250 }), record('m/m', 'Gamma', { stars: 10 }), record('m/m', 'delta', { stars: 10 }), record('q/q', 'omega', { stars: null }), record('b/b', 'alpha', { stars: 3 }), record('a/b', 'alpha', { stars: 3 })]
  const html = page(mods)
  assert.deepEqual([...html.matchAll(/<h2 id="group-\d">([^<]+)<\/h2>/g)].map(m => m[1]), ['Repositories with 100 stars or more', 'Repositories with 10 to 99 stars', 'Repositories with under 10 stars'])
  const names = [...html.matchAll(/<a class="name" href="\/mods\/([^/]+)\/">/g)].map(m => m[1])
  assert.deepEqual(names, ['a--a--alpha', 'z--z--beta', 'm--m--delta', 'm--m--Gamma', 'a--b--alpha', 'b--b--alpha', 'q--q--omega'])
  assert.doesNotMatch(html, /\b250\b|5000/, 'no star count is printed')
})

test('a star move inside a group and a push date change give identical HTML; a crossing moves every member of the repository', () => {
  const base = [record('o/r', 'one', { stars: 8 }), record('o/r', 'two', { stars: 8 }), record('o/r', 'three', { stars: 8 }), record('x/y', 'other', { stars: 50 })]
  const first = page(base)
  assert.equal(page(base.map(mod => ({ ...mod, stars: mod.stars + 1, pushedAt: '2026-10-22T00:00:00Z' }))), first)
  const crossed = page(base.map(mod => mod.repo === 'o/r' ? { ...mod, stars: 10 } : mod))
  assert.notEqual(crossed, first)
  const middle = crossed.split('Repositories with 10 to 99 stars')[1].split('Repositories with under 10 stars')[0]
  for (const name of ['one', 'two', 'three', 'other']) assert.ok(middle.includes(`>${name}</a>`), `${name} moved with its repository`)
  assert.doesNotMatch(crossed, /Repositories with under 10 stars/)
  const high = [record('o/r', 'a', { stars: 99 }), record('o/r', 'b', { stars: 99 })]
  const top99 = page(high)
  assert.match(top99, /Repositories with 10 to 99 stars/)
  const top100 = page(high.map(mod => ({ ...mod, stars: 100 })))
  assert.notEqual(top100, top99)
  assert.match(top100, /Repositories with 100 stars or more/)
  assert.doesNotMatch(top100, /10 to 99/)
})

test('the maintainer line appears only for owner karanb192, case-insensitive, and the entry keeps its group name order', () => {
  const mods = [record('Karanb192/cache-tax', 'cache-tax', { stars: 2 }), record('o/r', 'cache-keeper', { stars: 9 }), record('o/r', 'cache-zeta', { stars: 1 })]
  const html = page(mods)
  assert.equal(html.match(/Built by the catalogue maintainer/g).length, 1)
  assert.match(html, /cache-tax<\/a><span class="repo">Karanb192\/cache-tax<\/span><span class="maintainer">Built by the catalogue maintainer<\/span>/)
  const [keeper, tax, zeta] = order(html, ['cache-keeper', 'cache-tax', 'cache-zeta'])
  assert.ok(keeper < tax && tax < zeta, 'name order inside the group, with no special slot')
  assert.doesNotMatch(page([record('o/karanb192', 'x')]), /maintainer/)
})

test('hostile names, descriptions, repositories, calls and install commands are escaped', () => {
  const hostile = record('evil/<repo>', '<img src=x onerror=alert(1)>', { description: 'Closes </script><script>alert(1)</script> & "quotes" and the prompt cache', calls: ['$.zz.<b>'], marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'x', status: 'passed', errors: [] }] })
  const html = page([hostile])
  assert.doesNotMatch(html, /<img src=x|<script>alert|<b>/)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('&lt;/script&gt;') && html.includes('evil/&lt;repo&gt;') && html.includes('$.zz.&lt;b&gt;'))
  assert.ok(html.includes('<code>/plugin install &lt;img src=x onerror=alert(1)&gt; --marketplace evil/&lt;repo&gt;</code>'))
  assert.equal(html.match(/<\/script>/g).length, 1, 'only the JSON-LD block closes a script')
})

test('catalogue prose carries no banned word and no dash, checked before any data is interpolated', () => {
  const sentinel = (n, extra = {}) => record(`zq${n}a/zq${n}b`, `zq${n}c`, { path: `zq${n}d`, description: `zq${n}e`, calls: [`$.zq${n}f.zq${n}g`], hooks: [{ event: `zq${n}h`, matcher: {} }], marketplaces: [{ path: '.claude-plugin/marketplace.json', name: `zq${n}i`, status: 'passed', errors: [] }], ...extra })
  const mods = [
    sentinel(1, { stars: 500 }),
    sentinel(2, { stars: 50, validate: { status: 'failed', claudeVersion: 'zq2j', errors: ['zq2k'] } }),
    sentinel(3, { footprint: { status: 'unavailable' } }),
    sentinel(4, { calls: [], marketplaces: [] }),
    sentinel(5, { name: 'cache-clock', calls: ['$.state.get', '$.process.run', '$.prompt.steer', '$.model.fork'], hooks: [{ event: 'prompt.submit', matcher: {} }] }),
    sentinel(6, { name: 'cache-timer', footprint: { status: 'unavailable' }, hooks: [{ event: 'prompt.submit', matcher: {} }] }),
    sentinel(7, { repo: 'karanb192/zq7', directory: { plugin: 'zq7l' } }),
  ]
  for (const slug of PROSE_SLUGS) {
    const t = topicFor(slug)
    for (const html of [renderTopicPage(t, entries(mods), { topics: [t], letters: ['c'], version: '2.1.302' }), renderTopicPage(t, [], { topics: [t], letters: [], version: '2.1.302' })]) {
      assert.doesNotMatch(html, BANNED, slug)
      assert.doesNotMatch(html, /[–—]/, slug)
    }
  }
  const html = page(mods)
  assert.ok(html.includes('zq1e') && html.includes('/plugin install zq1c --marketplace zq1a/zq1b') && html.includes('$.zq1f.zq1g'), 'the sentinels reached the page')
})

test('author text and marketplace names that contain banned words render as written and escaped', () => {
  const mods = [
    record('charlie947/mod-maker', 'safe-delete', { description: 'The safe, recommended way to find top context eaters & <b>more</b>.', marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'mod-maker', status: 'passed', errors: [] }] }),
  ]
  const html = page(mods)
  assert.ok(html.includes('The safe, recommended way to find top context eaters &amp; &lt;b&gt;more&lt;/b&gt;.'))
  assert.ok(html.includes('<code>/plugin install safe-delete --marketplace charlie947/mod-maker</code>'))
  assert.ok(html.includes('Confirm the plugin name in the repository&#39;s README before installing.') || html.includes("Confirm the plugin name in the repository's README before installing."))
})

test('an empty topic renders with noindex, says so, and leaves the summary count at zero', () => {
  const html = page([])
  assert.match(html, /<meta name="robots" content="noindex">/)
  assert.equal(html.match(/No mods in this topic in the latest scan\./g).length, 2)
  assert.doesNotMatch(html, /Repositories with/)
  assert.doesNotMatch(page([record('o/r', 'a')]), /noindex/)
  assert.equal(topicSummary(topic(), 0), '0 mods that show the cache timer, keep it warm or warn before a cold send.')
  assert.equal(topicSummary(topic(), 1), '1 mod that shows the cache timer, keeps it warm or warns before a cold send.')
  assert.equal(topicSummary(topic(), 263), '263 mods that show the cache timer, keep it warm or warn before a cold send.')
})

test('the page carries its canonical, title, description, breadcrumbs and CollectionPage, and no ItemList or date', () => {
  const html = page([record('o/r', 'a')])
  assert.match(html, /<title>Prompt cache mods for Claude Code \| Awesome Claude Code Mods<\/title>/)
  assert.match(html, /<meta name="description" content="Mods about the cache\.">/)
  assert.match(html, /<link rel="canonical" href="https:\/\/mods\.aidojo\.si\/topics\/prompt-cache\/">/)
  assert.match(html, /<h1>Prompt cache mods for Claude Code<\/h1>/)
  assert.match(html, /<p class="crumbs"><a href="\/">All Claude Code mods<\/a><span aria-hidden="true">\/<\/span><span>Prompt cache<\/span><\/p>/)
  assert.match(html, /<p class="lede">1 mod that shows Claude’s prompt cache timer, keeps the cache warm while you are away, or warns before a message/)
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  assert.deepEqual(ld['@graph'].map(node => node['@type']), ['CollectionPage', 'BreadcrumbList'])
  assert.equal(ld['@graph'][0].isPartOf['@id'], 'https://mods.aidojo.si/#website')
  assert.deepEqual(ld['@graph'][1].itemListElement.map(item => [item.position, item.name, item.item]), [[1, 'Claude Code mods', 'https://mods.aidojo.si/'], [2, 'Prompt cache', 'https://mods.aidojo.si/topics/prompt-cache/']])
  assert.doesNotMatch(html, /ItemList"|dateModified/)
  assert.match(html, /<b aria-current="page">Prompt cache<\/b>/)
  assert.match(html, /<a href="\/browse\/c\/">Browse all mods A to Z<\/a>/)
  assert.match(page([record('o/r', 'a')], {}, { letters: [] }), /<a href="\/#directory">Browse all mods A to Z<\/a>/)
  for (const anchor of ['overview#what-a-mod-can-reach', 'admin#review-what-a-mod-can-do', 'admin#know-which-controls-still-apply']) assert.ok(html.includes(`https://code.claude.com/docs/en/plugins/mods/${anchor}`), anchor)
  assert.ok(html.includes('https://platform.claude.com/docs/en/build-with-claude/prompt-caching#how-prompt-caching-works'))
})

test('related topics link only when they are in the nav', () => {
  const related = { ...topic(), related: ['usage-meters'] }
  const other = { slug: 'usage-meters', short: 'Usage meters', title: 'Context and usage meters for Claude Code' }
  const linked = renderTopicPage(related, entries([record('o/r', 'a')]), { topics: [...nav, other], letters: [], version: '2.1.302' })
  assert.match(linked, /<a href="\/topics\/usage-meters\/">Context and usage meters for Claude Code<\/a>/)
  assert.match(linked, /<a href="\/topics\/usage-meters\/">Usage meters<\/a>/, 'the nav row links it too')
  assert.doesNotMatch(renderTopicPage(related, entries([record('o/r', 'a')]), { topics: nav, letters: [], version: '2.1.302' }), /usage-meters/)
})

test('figures in the prose come from the listed records and are left out when there is nothing to count', () => {
  const mods = [
    record('o/r', 'cache-clock', { calls: ['$.process.run', '$.model.fork'], hooks: [{ event: 'prompt.submit', matcher: {} }] }),
    record('p/r', 'cache-clock', { footprint: { status: 'unavailable' }, hooks: [{ event: 'prompt.submit', matcher: {} }] }),
    record('q/r', 'Cache-Timer', { calls: ['$.zz.unknown'] }),
    record('s/r', 'warmer', { calls: ['$.prompt.submit'] }),
  ]
  const html = page(mods)
  assert.match(html, /Of the 3 mods here named cache-clock or cache-timer, 2 have reported footprints; by classified calls, 1 at L2 and 1 with no classified level\./)
  assert.match(html, /Of the 3 mods here with reported footprints, 2 record a <code>\$\.model<\/code> method or <code>\$\.prompt\.submit<\/code>; a recorded call does not identify a warmer\./)
  assert.match(html, /2 of the 4 mods here record a <code>prompt\.submit<\/code> hook, 1 of them with an incomplete footprint, where coverage is unknown\./)
  const plain = page([record('o/r', 'a', { calls: [] })])
  assert.doesNotMatch(plain, /named cache-clock|prompt\.submit<\/code> hook,|of them with an incomplete/)
  assert.match(plain, /Of the 1 mod here with reported footprints, 0 record a/)
  assert.doesNotMatch(page([record('o/r', 'a', { footprint: { status: 'unavailable' } })]), /here with reported footprints/)
})

test('two renders are identical and input order is ignored', () => {
  const mods = [record('o/r', 'b', { stars: 200 }), record('o/r', 'a', { stars: 200 }), record('x/y', 'c', { stars: 5 })]
  const first = page(mods)
  assert.equal(page(mods), first)
  assert.equal(page([...mods].reverse()), first)
})

test('each entry sits on its own line, so an added member leaves every other entry line unchanged', () => {
  const mods = [record('o/r', 'a'), record('o/r', 'c'), record('x/y', 'z', { stars: 50 })]
  const before = page(mods).split('\n')
  const after = page([...mods, record('o/r', 'b')]).split('\n')
  const entries = lines => lines.filter(line => line.startsWith('<li><a class="name"'))
  assert.equal(entries(before).length, 3)
  assert.equal(entries(after).length, 4)
  for (const line of entries(before)) assert.ok(after.includes(line), line.slice(0, 60))
  assert.equal(entries(after).filter(line => !before.includes(line)).length, 1)
  assert.ok(after.includes('<ul class="topic-list">') && after.includes('</ul></section>'), 'group wrappers sit on their own lines')
})

test('the usage meters prose counts the recorded calls over the reported footprints and reads the file figures', () => {
  const t = topicFor('usage-meters')
  const mods = [
    record('o/r', 'usage-band', { calls: ['$.session.usage', '$.http.fetch', '$.ui.notice'], hooks: [{ event: 'prompt.submit', matcher: {} }] }),
    record('p/r', 'cost-meter', { calls: ['$.session.usage', '$.process.run', '$.model.fork'] }),
    record('q/r', 'context-bar', { footprint: { status: 'unavailable' }, calls: ['$.session.usage'] }),
  ]
  const html = renderTopicPage(t, entries(mods), { topics: [t], letters: ['u'], version: '2.1.302' })
  assert.match(html, /<p class="lede">3 mods that show how full your context window is, how much of your plan’s 5-hour and weekly windows you have used or the session’s estimated cost so far, or warn you before a limit\./)
  assert.match(html, /Of the 2 mods here with reported footprints, 2 record <code>\$\.session\.usage<\/code>, 1 records <code>\$\.http\.fetch<\/code>, 1 records a process call and 1 records a <code>\$\.model<\/code> method or <code>\$\.prompt\.submit<\/code>\./)
  assert.match(html, /1 of the 3 mods here records a <code>prompt\.submit<\/code> hook\./)
  for (const url of ['https://code.claude.com/docs/en/context-window#when-your-context-fills-up', 'https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work', 'https://code.claude.com/docs/en/costs#using-the-usage-command', 'https://platform.claude.com/docs/en/about-claude/pricing', 'https://code.claude.com/docs/en/plugins/mods/api#reach-files-processes-and-the-network']) assert.ok(html.includes(url), url)
  assert.doesNotMatch(renderTopicPage(t, entries([mods[2]]), { topics: [t], letters: [], version: '2.1.302' }), /here with reported footprints/)
  assert.equal(topicSummary(t, 889), '889 mods that show context fill, token use, plan limits or estimated cost, or warn before a limit.')
  assert.equal(topicSummary(t, 1), '1 mod that shows context fill, token use, plan limits or estimated cost, or warns before a limit.')
})
