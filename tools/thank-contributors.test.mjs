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
const fromBot = (plans, author = 'github-actions[bot]') => plans.map(p => ({ issue: String(p.pr), author, body: p.body.replace(/\n/g, ' ') }))
const plan = (extra = {}) => planThanks({ published: ['alice/tools', 'bob/pane', 'owner/own', 'bot/made', 'carol/fixture', 'dave/unknown'], inventory, prs, owner: 'owner', stargazers: new Set(['bob']), thanked: new Set(), asked: new Set(), ...extra })

test('seed commits credit the latest addition, ignoring reorders, case changes and file headers', () => {
  const log = '\0aaa\ndiff --git a/data/seeds.txt b/data/seeds.txt\n--- a/data/seeds.txt\n+++ b/data/seeds.txt\n@@ -0,0 +1 @@\n+Alice/Tools\n\0bbb\n@@ -1 +1,2 @@\n-alice/tools\n+alice/tools\n+bob/pane\n'
  assert.deepEqual([...seedCommits(log)], [['alice/tools', 'aaa'], ['bob/pane', 'bbb']])
  const readded = log + '\0ccc\n@@ -2 +1,0 @@\n-bob/pane\n\0ddd\n@@ -1,0 +2 @@\n+bob/pane\n'
  assert.equal(seedCommits(readded).get('bob/pane'), 'ddd')
  assert.equal(seedCommits(log + '\0ccc\n@@ -2 +1,0 @@\n-bob/pane\n').has('bob/pane'), false)
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
  const { thanked, asked } = readMarkers([...fromBot(plan()), { issue: '3', author: 'someone', body: 'An unrelated comment.' }])
  assert.deepEqual([...thanked], [10, 11, 14])
  assert.deepEqual([...asked], ['alice', 'carol'])
  assert.equal(plan({ thanked, asked }).length, 0)
})

test('a quoted marker from anyone else, or on another PR, is ignored', () => {
  const quoted = fromBot(plan(), 'mallory')
  const moved = fromBot(plan()).map(c => ({ ...c, issue: '99' }))
  const { thanked, asked } = readMarkers([...quoted, ...moved])
  assert.equal(thanked.size + asked.size, 0)
})

test('one PR that added several published seeds gets one comment listing all of them', () => {
  const shared = new Map([['g/one', { number: 20, author: 'g', bot: false }], ['g/two', { number: 20, author: 'g', bot: false }]])
  const mods = [mod('g/one', 'a'), mod('g/two', 'b'), mod('g/two', 'c')]
  const plans = planThanks({ published: ['g/one', 'g/two'], inventory: { mods }, prs: shared, owner: 'owner', stargazers: new Set(), thanked: new Set(), asked: new Set() })
  assert.equal(plans.length, 1)
  assert.match(plans[0].body, /Thanks for submitting g\/one and g\/two\. Their 3 mods are now in the catalogue/)
  assert.equal((plans[0].body.match(/star on this repository/g) ?? []).length, 1)
})

test('the comment links counted mods to their website anchors and escapes link text', () => {
  const body = plan().find(p => p.pr === 14).body
  assert.match(body, /Its mod is now in the catalogue/)
  assert.match(body, /\[real\]\(https:\/\/mods\.aidojo\.si\/#carol--fixture--real\)/)
  assert.doesNotMatch(body, /probe/)
  assert.match(plan()[0].body, /Its 2 mods are now in the catalogue/)
  const odd = mod('x/y', 'a]b')
  assert.match(thanksBody(1, 'x', ['x/y'], [odd], siteAnchors([odd]), false), /\[a\\]b\]\(https:\/\/mods\.aidojo\.si\/#x--y--a-b\)/)
  assert.doesNotMatch(body, /[\u2013\u2014]/)
})
