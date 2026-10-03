import { execFileSync } from 'node:child_process'

function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.ceil(seconds * 1000))
}

export function parseResponse(text) {
  let rest = text.trimStart(), response
  do {
    const boundary = /\r?\n\r?\n/.exec(rest)
    if (!boundary) throw new Error('missing GitHub response headers')
    const lines = rest.slice(0, boundary.index).split(/\r?\n/)
    const status = /^HTTP\/\S+ (\d{3})(?:\s|$)/.exec(lines.shift())
    if (!status) throw new Error('invalid GitHub response status')
    const headers = {}
    for (const line of lines) {
      const colon = line.indexOf(':')
      if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
    }
    rest = rest.slice(boundary.index + boundary[0].length)
    response = { status: Number(status[1]), headers }
  } while (/^HTTP\/\S+ \d{3}/.test(rest))
  return { ...response, body: JSON.parse(rest) }
}

export function ghSearchPage(q, page, exec = execFileSync, { endpoint = 'search/code' } = {}) {
  let out, failure
  try {
    out = exec('gh', ['api', '--include', '-X', 'GET', endpoint, '-f', `q=${q}`, '-f', 'per_page=100', '-f', `page=${page}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    failure = error
    out = error.stdout?.toString()
    if (!out) throw error
  }
  const response = parseResponse(out)
  if (response.status >= 400) {
    throw Object.assign(new Error(response.body?.message ?? `GitHub HTTP ${response.status}`), { status: response.status, headers: response.headers })
  }
  if (failure) throw failure
  return response.body
}

const seconds = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null

export function createSearchRequest({ run = ghSearchPage, wait = sleep, now = Date.now, random = Math.random, log = console.error, attempts = 7, pause = 10, maxWait = 1800, label = 'code search' } = {}) {
  let requests = 0, waited = 0
  return (query, page) => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (requests++) wait(pause)
      try {
        const result = run(query, page)
        if (result.incomplete_results === true) throw Object.assign(new Error('incomplete search results'), { retryable: true })
        return result
      } catch (error) {
        const headers = error.headers ?? {}
        const hint = /try again in (\d+(?:\.\d+)?)s/i.exec(error.message)
        const retryAfter = seconds(headers['retry-after'])
        const reset = seconds(headers['x-ratelimit-reset'])
        const exhausted = headers['x-ratelimit-remaining'] === '0'
        const limited = error.status === 429 || (error.status === 403 && (retryAfter !== null || exhausted || /rate limit|abuse detection|try again in/i.test(error.message)))
        const retryable = error.retryable || limited
        const diagnostic = Object.entries(headers).filter(([key]) => ['retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-resource', 'x-github-request-id'].includes(key)).map(([key, value]) => `${key}=${value}`).join(' ')
        log(`search failed for ${query} page ${page} (attempt ${attempt}/${attempts}, HTTP ${error.status ?? 'n/a'}): ${error.message}${diagnostic ? '; ' + diagnostic : ''}`)
        const fail = reason => new Error(`${label} failed for ${query}: ${reason}; ${error.message}`, { cause: error })
        if (!retryable) throw fail('not retryable')
        if (attempt === attempts) throw fail('retry attempts exhausted')
        const delay = Math.ceil(Math.max(
          Math.min(60 * 2 ** (attempt - 1), 480),
          retryAfter ?? 0,
          exhausted && reset !== null ? Math.max(0, reset - now() / 1000) : 0,
          hint ? Number(hint[1]) : 0,
        )) + 1 + Math.floor(random() * 5)
        if (waited + delay > maxWait) throw fail(`cooldown ${delay}s exceeds remaining retry-wait budget ${maxWait - waited}s`)
        log(`waiting ${delay}s before retry; retry-wait budget ${waited + delay}/${maxWait}s`)
        waited += delay
        wait(delay)
      }
    }
  }
}
