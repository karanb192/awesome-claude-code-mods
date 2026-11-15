import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { SCAN_PATHS, globToRegExp, needsScan } from './pr-scope.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const nightly = read('.github/workflows/nightly.yml')
const job = name => {
  const start = nightly.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `no ${name} job`)
  const next = nightly.slice(start + 1).search(/\n  [\w-]+:\n/)
  return nightly.slice(start + 1, next < 0 ? undefined : start + 1 + next + 1)
}

test('paths follow GitHub filter rules: ** crosses folders, * does not, dots are literal', () => {
  for (const pattern of SCAN_PATHS) globToRegExp(pattern)
  assert.ok(globToRegExp('tools/**').test('tools/a/b.mjs'))
  assert.ok(!globToRegExp('tools/*').test('tools/a/b.mjs'))
  assert.ok(globToRegExp('tools/*').test('tools/b.mjs'))
  assert.ok(!globToRegExp('package.json').test('packageXjson'))
  assert.throws(() => globToRegExp('!docs/**'), /Unsupported/)
})

test('the scan runs for tooling, seeds and rule lists, and not for README or website-only changes', () => {
  assert.equal(needsScan(['README.md'], 1), false)
  assert.equal(needsScan(['README.md', 'docs/index.html', 'contributing.md', '.github/ISSUE_TEMPLATE/x.yml'], 4), false)
  assert.equal(needsScan(['data/seeds.txt'], 1), true)
  assert.equal(needsScan(['README.md', 'tools/kind.mjs'], 2), true)
  assert.equal(needsScan(['finder/.claude-plugin/plugin.json'], 1), true)
  assert.equal(needsScan(['.github/workflows/nightly.yml'], 1), true)
  assert.equal(needsScan(['data/mods.json'], 1), false)
})

test('a file list cut short by the API cap runs the scan', () => {
  assert.equal(needsScan(['README.md'], 3500), true)
})

test('every pull request runs the workflow, and the scan job waits for the scope decision', () => {
  const trigger = nightly.slice(nightly.indexOf('\n  pull_request:\n'), nightly.indexOf('\npermissions:'))
  assert.doesNotMatch(trigger, /paths/)
  assert.match(job('changes'), /run: node tools\/pr-scope\.mjs/)
  assert.match(job('scan'), /needs: changes\n    if: github\.event_name == 'pull_request' && needs\.changes\.outputs\.scan == 'true'/)
})

test('ci-gate runs even after failures or cancellation, and passes only for a passed or unneeded scan', () => {
  const gate = job('ci-gate')
  assert.match(gate, /needs: \[changes, scan\]\n    if: always\(\) && github\.event_name == 'pull_request'/)
  const script = /run: \|\n((?: {10}.*\n)+)/.exec(gate)[1].replace(/^ {10}/gm, '')
  const pass = (CHANGES, NEEDED, SCAN) => spawnSync('bash', ['-c', script], { env: { ...process.env, CHANGES, NEEDED, SCAN } }).status === 0
  assert.equal(pass('success', 'true', 'success'), true)
  assert.equal(pass('success', 'false', 'skipped'), true)
  assert.equal(pass('success', 'true', 'failure'), false)
  assert.equal(pass('success', 'true', 'cancelled'), false)
  assert.equal(pass('success', 'true', 'skipped'), false)
  assert.equal(pass('success', 'false', 'success'), false)
  assert.equal(pass('failure', '', 'skipped'), false)
  assert.equal(pass('cancelled', '', 'skipped'), false)
})

test('bot publication runs report ci-gate on the commit they pushed, after their checks and before any merge', () => {
  assert.match(read('tools/report-gate.sh'), /-f context=ci-gate /)
  assert.match(nightly, /\n  ci-gate:\n/)
  for (const [path, sha] of [['tools/publish-seeds.sh', 'seed_head'], ['tools/apply-rules.sh', 'head'], ['tools/publish-scan.sh', 'remote_head']]) {
    const script = read(path)
    const report = script.indexOf(`bash tools/report-gate.sh "$${sha}"`)
    assert.ok(report > 0, path)
    for (const before of ['npm test', 'npm run test:render', 'npm run lint', 'git push']) assert.ok(script.indexOf(before) < report, `${path}: ${before}`)
    for (const after of ['gh pr create', 'gh pr merge']) if (script.includes(after)) assert.ok(script.indexOf(after) > report, `${path}: ${after}`)
  }
  const weekly = read('.github/workflows/weekly-retirement.yml')
  assert.ok(weekly.indexOf('bash tools/report-gate.sh "$HEAD_SHA"') > weekly.indexOf('peter-evans/create-pull-request'))
  assert.match(weekly, /HEAD_SHA: \$\{\{ steps\.proposal\.outputs\.pull-request-head-sha \}\}/)
})

test('every job that runs a publication script may write commit statuses', () => {
  for (const name of ['refresh', 'discover']) assert.match(job(name), /statuses: write/, name)
  for (const path of ['publish-seeds.yml', 'apply-rules.yml', 'weekly-retirement.yml']) assert.match(read(`.github/workflows/${path}`), /statuses: write/, path)
})
