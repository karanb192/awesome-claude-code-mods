import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseResponse, ghSearchPage, createSearchRequest } from './github-search.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const result = { total_count: 0, incomplete_results: false, items: [] }
const failure = (status, headers = {}, message = 'limited') => Object.assign(new Error(message), { status, headers })
const request = options => createSearchRequest({ wait: () => {}, random: () => 0, log: () => {}, ...options })

test('gh response parsing preserves normalized headers and follows intermediate responses', () => {
  const parsed = parseResponse('HTTP/2.0 200 OK\r\nX-RateLimit-Remaining: 9\r\n\r\n' + JSON.stringify(result))
  assert.equal(parsed.headers['x-ratelimit-remaining'], '9')
  assert.deepEqual(parsed.body, result)
  assert.equal(parseResponse('HTTP/1.1 100 Continue\n\nHTTP/2.0 429 Too Many Requests\nRetry-After: 20\n\n{}').status, 429)
  assert.throws(() => parseResponse('{}'), /missing.*headers/)
  assert.throws(() => parseResponse('HTTP/2.0 200 OK\n\nnot-json'), SyntaxError)
})

test('gh adapter requests headers and retains them when gh exits nonzero', () => {
  assert.deepEqual(ghSearchPage('flag', 2, (binary, args, options) => {
    assert.equal(binary, 'gh')
    assert.ok(args.includes('--include'))
    assert.ok(args.includes('page=2'))
    assert.equal(options.timeout, 60000)
    return 'HTTP/2.0 200 OK\n\n' + JSON.stringify(result)
  }), result)
  ghSearchPage('topic:mods', 1, (binary, args) => {
    assert.ok(args.includes('search/repositories'))
    assert.ok(!args.includes('search/code'))
    return 'HTTP/2.0 200 OK\n\n' + JSON.stringify(result)
  }, { endpoint: 'search/repositories' })
  assert.throws(() => ghSearchPage('flag', 1, () => {
    throw Object.assign(new Error('gh failed'), { stdout: 'HTTP/2.0 429 Too Many Requests\nRetry-After: 190\n\n{"message":"slow down"}' })
  }), error => error.status === 429 && error.headers['retry-after'] === '190' && error.message === 'slow down')
  assert.throws(() => ghSearchPage('flag', 1, () => { throw new Error('timeout') }), /timeout/)
})

test('repeated throttling backs off exponentially, keeps pacing, and recovers', () => {
  const waits = []
  let calls = 0
  const run = request({ wait: n => waits.push(n), run: () => { if (++calls < 5) throw failure(429); return result } })
  assert.deepEqual(run('flag', 1), result)
  assert.deepEqual(waits, [61, 10, 121, 10, 241, 10, 481, 10])
})

test('server cooldowns, fractional hints and exhausted quota resets override shorter backoff', () => {
  for (const [error, expected] of [
    [failure(429, { 'retry-after': '187.3' }), 189],
    [failure(429, {}, 'try again in 243.2s'), 245],
    [failure(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1400' }), 401],
    [failure(403, { 'retry-after': '190' }), 191],
    [failure(403, {}, 'You have exceeded a secondary rate limit'), 61],
  ]) {
    const waits = []
    let calls = 0
    const run = request({ now: () => 1000000, wait: n => waits.push(n), run: () => { if (++calls === 1) throw error; return result } })
    run('flag', 1)
    assert.deepEqual(waits, [expected, 10])
  }
})

test('authentication and permission errors stop immediately', () => {
  for (const error of [failure(401, {}, 'Bad credentials'), failure(403, { 'x-ratelimit-remaining': '9' }, 'Resource not accessible by integration')]) {
    let calls = 0
    const run = request({ run: () => { calls++; throw error }, wait: () => assert.fail('must not wait') })
    assert.throws(() => run('flag', 1), /not retryable/)
    assert.equal(calls, 1)
  }
})

test('retry budget is shared across queries and never shortens a server cooldown', () => {
  let calls = 0
  const waits = []
  const run = request({ maxWait: 100, wait: n => waits.push(n), run: () => { if (++calls % 2) throw failure(429); return result } })
  run('first', 1)
  assert.throws(() => run('second', 1), /remaining retry-wait budget 39s/)
  assert.equal(calls, 3)
  assert.deepEqual(waits, [61, 10, 10])
  assert.throws(() => request({ run: () => { throw failure(429, { 'retry-after': '1800' }) }, wait: () => assert.fail('must not wait') })('flag', 1), /budget/)
})

test('attempt limit stops persistent failures and diagnostics only include selected headers', () => {
  let calls = 0
  const logs = []
  const run = request({ attempts: 2, log: line => logs.push(line), run: () => {
    calls++
    throw failure(429, { 'x-github-request-id': 'request-id', 'x-ratelimit-resource': 'code_search', 'x-unrelated': 'excluded' })
  } })
  assert.throws(() => run('flag', 3), /retry attempts exhausted/)
  assert.equal(calls, 2)
  assert.match(logs.join('\n'), /page 3.*HTTP 429.*x-github-request-id=request-id/)
  assert.ok(!logs.join('\n').includes('excluded'))
})

test('CLI failure leaves the existing candidate list unchanged', t => {
  const root = mkdtempSync(join(tmpdir(), 'discovery-limit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'data'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'data/repos.txt'), 'existing/mod\n')
  writeFileSync(join(root, 'data/seeds.txt'), 'new/mod\n')
  const gh = join(root, 'bin/gh')
  writeFileSync(gh, '#!' + process.execPath + '\nconsole.log(\'HTTP/2.0 429 Too Many Requests\\nRetry-After: 1801\\n\\n{"message":"slow down"}\');process.exit(1)\n')
  chmodSync(gh, 0o755)
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./discover.mjs', import.meta.url))], {
    cwd: root, env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH }, encoding: 'utf8', timeout: 5000,
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /remaining retry-wait budget/)
  assert.equal(readFileSync(join(root, 'data/repos.txt'), 'utf8'), 'existing/mod\n')
})
