import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planThanks, readMarkers, seedCommits, thanksBody } from './thank-contributors.mjs'
import { siteAnchors } from './slug.mjs'

const mod = (repo, name, extra = {}) => ({ id: `${repo}:${name}`, repo, name, path: name, kind: 'mod', ...extra })
const inventory = { mods: [mod('alice/tools', 'meter'), mod('alice/tools', 'guard'), mod('bob/pane', 'pane'), mod('owner/own', 'own'), mod('bot/made', 'made'), mod('carol/fixture', 'probe', { kind: 'fixture' }), mod('carol/fixture', 'real')] }
const prs = new Map([
  ['alice/tools', { number: 10, author: 'Alice', bot: false }],
  ['bob/pane', { number: 11, author: 'bob', bot: false }],
  ['owner/own', { number: 12, author: 'Owner', bot: false }],
  ['bot/made', { number: 13, author: 'renovate[bot]', bot: true }],
  ['carol/fixture', { number: 14, author: 'carol', bot: false }],
])
const plan = (extra = {}) => planThanks({ published: ['alice/tools', 'bob/pane', 'owner/own', 'bot/made', 'carol/fixture', 'dave/unknown'], inventory, prs, owner: 'owner', stargazers: new Set(['bob']), thanked: new Set(), asked: new Set(), ...extra })

test('seed commits map each repository to the commit that first added it, ignoring case and file headers', () => {
  const log = '\0aaa\ndiff --git a/data/seeds.txt b/data/seeds.txt\n+++ b/data/seeds.txt\n@@ -0,0 +1 @@\n+Alice/Tools\n\0bbb\n@@ -1 +1,2 @@\n-alice/tools\n+alice/tools\n+bob/pane\n'
  assert.deepEqual([...seedCommits(log)], [['alice/tools', 'aaa'], ['bob/pane', 'bbb']])
})

test('contributors are thanked once per PR, never the owner, bots or unknown seeds', () => {
  const plans = plan()
  assert.deepEqual(plans.map(p => p.pr), [10, 11, 14])
  assert.equal(plan({ thanked: new Set([10, 11, 14]) }).length, 0)
})

test('the star request goes only to authors who have not starred and were never asked', () => {
  const [alice, bob] = plan()
  assert.match(alice.body, /a star on this repository/)
  assert.match(alice.body, /<!-- publication-thanks pr=10 author=Alice star-asked -->/)
  assert.doesNotMatch(bob.body, /star on this repository/)
  assert.doesNotMatch(plan({ asked: new Set(['alice']) })[0].body, /star on this repository/)
  const twice = planThanks({ published: ['alice/tools', 'bob/pane'], inventory, prs: new Map([...prs, ['bob/pane', { number: 11, author: 'alice', bot: false }]]), owner: 'owner', stargazers: new Set(), thanked: new Set(), asked: new Set() })
  assert.deepEqual(twice.map(p => /star on this repository/.test(p.body)), [true, false])
})

test('markers written by one run are read back by the next', () => {
  const bodies = plan().map(p => p.body.replace(/\n/g, ' '))
  const { thanked, asked } = readMarkers([...bodies, 'An unrelated comment.'])
  assert.deepEqual([...thanked], [10, 11, 14])
  assert.deepEqual([...asked], ['alice', 'carol'])
  assert.equal(plan({ thanked, asked }).length, 0)
})

test('the comment links counted mods to their website anchors and escapes link text', () => {
  const body = plan().find(p => p.pr === 14).body
  assert.match(body, /Its mod is now in the catalogue/)
  assert.match(body, /\[real\]\(https:\/\/mods\.aidojo\.si\/#carol--fixture--real\)/)
  assert.doesNotMatch(body, /probe/)
  assert.match(plan()[0].body, /Its 2 mods are now in the catalogue/)
  const odd = mod('x/y', 'a]b')
  assert.match(thanksBody(1, 'x', 'x/y', [odd], siteAnchors([odd]), false), /\[a\\]b\]\(https:\/\/mods\.aidojo\.si\/#x--y--a-b\)/)
  assert.doesNotMatch(body, /[\u2013\u2014]/)
})
