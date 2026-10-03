import { spawnSync } from 'node:child_process'
import { parseValidateOutput } from './parse.mjs'

// Validator messages carry absolute paths into the scanner's checkout. Published data keeps them
// relative to the repository, so it never names the machine or directory that ran the scan.
export function relativePaths(text, roots) {
  let out = String(text)
  for (const root of roots.map(r => r.replace(/\/+$/, '')).filter(Boolean)) out = out.split(root + '/').join('').split(root).join('.')
  return out
}

export function validate(path, cwd, roots = []) {
  const result = spawnSync('claude', ['plugin', 'validate', path], { cwd, encoding: 'utf8', timeout: 60000 })
  const parsed = parseValidateOutput((result.stdout ?? '') + (result.stderr ?? ''))
  if (result.error || result.signal || (result.status !== 0 && parsed.status !== 'failed')) {
    parsed.status = 'unknown'
    parsed.errors.push(result.error?.code ?? (result.signal ? `Validator terminated by ${result.signal}` : `Validator exited with status ${result.status}`))
  }
  parsed.errors = parsed.errors.map(error => relativePaths(error, roots))
  return parsed
}
