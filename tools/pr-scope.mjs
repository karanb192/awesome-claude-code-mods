// Decides whether a pull request needs the full PR scan. Every PR runs the nightly workflow so the
// required ci-gate check always reports; only PRs that change these paths pay for the scan job.
// Bot publication PRs start no workflows, so their producing runs report ci-gate through tools/report-gate.sh.

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

// GitHub path filter syntax: `**` crosses folders, `*` does not.
export const SCAN_PATHS = ['tools/**', 'finder/**', 'data/seeds.txt', 'data/duplicates.txt', 'data/catalogs.txt', 'data/fixture-exceptions.txt', 'data/pages.json', 'data/topics.json', 'package.json', 'package-lock.json', '.github/workflows/nightly.yml', '.github/workflows/weekly-retirement.yml', '.github/workflows/publish-seeds.yml']

export function globToRegExp(pattern) {
  if (/[?+[\]!]/.test(pattern)) throw new Error(`Unsupported path pattern: ${pattern}`)
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${pattern.split('**').map(part => part.split('*').map(escape).join('[^/]*')).join('.*')}$`)
}

// files: what the API listed; total: the PR's changed_files. A list cut short by the API's 3,000-file
// cap cannot rule the scan out, so it runs.
export function needsScan(files, total, patterns = SCAN_PATHS) {
  if (files.length < total) return true
  const regexps = patterns.map(globToRegExp)
  return files.some(({ filename, previous_filename }) => [filename, previous_filename].some(path => path && regexps.some(regexp => regexp.test(path))))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GITHUB_REPOSITORY: repo, PR: pr, GITHUB_OUTPUT: output } = process.env
  if (!repo || !pr || !output) throw new Error('GITHUB_REPOSITORY, PR and GITHUB_OUTPUT are required')
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const total = Number(gh('api', `repos/${repo}/pulls/${pr}`, '--jq', '.changed_files'))
  const files = gh('api', '--paginate', `repos/${repo}/pulls/${pr}/files?per_page=100`, '--jq', '.[] | {filename, previous_filename} | @json').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const scan = needsScan(files, total)
  console.log(`${files.length} of ${total} changed files listed; scan ${scan ? 'needed' : 'not needed'}`)
  appendFileSync(output, `scan=${scan}\n`)
}
