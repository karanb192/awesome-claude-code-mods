import { spawn, spawnSync } from 'node:child_process'
import { parseValidateOutput } from './parse.mjs'

// Validator messages carry absolute paths into the scanner's checkout. Published data keeps them
// relative to the repository, so it never names the machine or directory that ran the scan.
export function relativePaths(text, roots) {
  let out = String(text)
  for (const root of roots.map(r => r.replace(/\/+$/, '')).filter(Boolean)) out = out.split(root + '/').join('').split(root).join('.')
  return out
}

// spawnSync's result shape without blocking, so the scanner can keep several repositories in flight.
// A timeout reports ETIMEDOUT with the kill signal, as spawnSync does.
export function spawnAsync(command, args, { cwd, timeout } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd })
    let stdout = '', stderr = '', error, timedOut = false
    const timer = timeout && setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeout)
    child.stdout.setEncoding('utf8').on('data', d => { stdout += d })
    child.stderr.setEncoding('utf8').on('data', d => { stderr += d })
    child.on('error', e => { error = e })
    child.on('close', (status, signal) => {
      clearTimeout(timer)
      if (timedOut) error = Object.assign(new Error(`spawn ${command} ETIMEDOUT`), { code: 'ETIMEDOUT' })
      resolve({ status: error ? null : status, signal, stdout, stderr, error })
    })
  })
}

export function validate(path, cwd, roots = []) {
  return finish(spawnSync('claude', ['plugin', 'validate', path], { cwd, encoding: 'utf8', timeout: 60000 }), roots)
}

export async function validateAsync(path, cwd, roots = []) {
  return finish(await spawnAsync('claude', ['plugin', 'validate', path], { cwd, timeout: 60000 }), roots)
}

function finish(result, roots) {
  const parsed = parseValidateOutput((result.stdout ?? '') + (result.stderr ?? ''))
  if (result.error || result.signal || (result.status !== 0 && parsed.status !== 'failed')) {
    parsed.status = 'unknown'
    parsed.errors.push(result.error?.code ?? (result.signal ? `Validator terminated by ${result.signal}` : `Validator exited with status ${result.status}`))
  }
  parsed.errors = parsed.errors.map(error => relativePaths(error, roots))
  return parsed
}
