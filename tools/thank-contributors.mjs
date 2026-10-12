// After a seed publication merges, thanks the people whose seed PRs it published. Each PR gets one
// comment; the star request goes only to authors who have not starred and were never asked before.
// The hidden marker records both facts, so later runs read them back from the repository's comments.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readRepos } from './candidates.mjs'
import { siteAnchors } from './slug.mjs'

const SITE = 'https://mods.aidojo.si/'
const MARKER = /<!-- publication-thanks pr=(\d+) author=([\w-]+)( star-asked)? -->/
const key = value => value.toLowerCase()

// The commit that first added each seed line, from `git log --reverse --format=%x00%H -p -U0 -- data/seeds.txt`.
export function seedCommits(log) {
  const added = new Map()
  for (const entry of log.split('\0').slice(1)) {
    const [sha, ...lines] = entry.split('\n')
    for (const line of lines) {
      if (!/^\+[^+]/.test(line)) continue
      const repo = key(line.slice(1).trim())
      if (repo && !added.has(repo)) added.set(repo, sha.trim())
    }
  }
  return added
}

export function readMarkers(bodies) {
  const thanked = new Set(), asked = new Set()
  for (const body of bodies) {
    const match = MARKER.exec(body ?? '')
    if (!match) continue
    thanked.add(Number(match[1]))
    if (match[3]) asked.add(key(match[2]))
  }
  return { thanked, asked }
}

export function thanksBody(pr, author, repo, mods, anchors, askStar) {
  const label = name => String(name).replace(/[[\]\\]/g, '\\$&')
  return [
    `<!-- publication-thanks pr=${pr} author=${author}${askStar ? ' star-asked' : ''} -->`,
    `Thanks for submitting ${repo}. ${mods.length === 1 ? 'Its mod is' : `Its ${mods.length} mods are`} now in the catalogue, with the access the scan recorded:`,
    '',
    ...mods.map(mod => `- [${label(mod.name)}](${SITE}#${anchors.get(mod)})`),
    ...(askStar ? ['', 'If the catalogue is useful to you, a star on this repository helps other people find it.'] : []),
  ].join('\n') + '\n'
}

// One comment per contributor PR that added a published seed. Skips the owner, bots, PRs already
// thanked and seeds whose PR cannot be found; asks for a star at most once per author.
export function planThanks({ published, inventory, prs, owner, stargazers, thanked, asked }) {
  const anchors = siteAnchors(inventory.mods)
  const askedNow = new Set(asked)
  const plans = []
  for (const repo of published) {
    const pr = prs.get(key(repo))
    if (!pr || pr.bot || key(pr.author) === key(owner) || thanked.has(pr.number)) continue
    const mods = inventory.mods.filter(mod => mod.kind === 'mod' && key(mod.repo) === key(repo))
    if (!mods.length) continue
    const askStar = !stargazers.has(key(pr.author)) && !askedNow.has(key(pr.author))
    if (askStar) askedNow.add(key(pr.author))
    plans.push({ pr: pr.number, body: thanksBody(pr.number, pr.author, repo, mods, anchors, askStar) })
  }
  return plans
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { published: { type: 'string' }, 'dry-run': { type: 'boolean' } } })
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository || !values.published) throw new Error('GITHUB_REPOSITORY and --published are required')
  const published = readRepos(values.published)
  if (!published.length) process.exit(0)
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const lines = text => text.split('\n').filter(Boolean)
  const commits = seedCommits(execFileSync('git', ['log', '--reverse', '--format=%x00%H', '-p', '-U0', 'origin/main', '--', 'data/seeds.txt'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  const prs = new Map()
  for (const repo of published) {
    const sha = commits.get(key(repo))
    if (!sha) continue
    const [found] = JSON.parse(gh('api', `repos/${repository}/commits/${sha}/pulls`))
      .filter(pr => pr.merged_at && pr.base.ref === 'main')
    if (found) prs.set(key(repo), { number: found.number, author: found.user.login, bot: found.user.type === 'Bot' })
  }
  const stargazers = new Set(lines(gh('api', '--paginate', `repos/${repository}/stargazers?per_page=100`, '--jq', '.[].login')).map(key))
  const { thanked, asked } = readMarkers(lines(gh('api', '--paginate', `repos/${repository}/issues/comments?per_page=100`, '--jq', '.[].body | select(contains("publication-thanks")) | gsub("\\n"; " ")')))
  const inventory = JSON.parse(readFileSync('data/mods.json', 'utf8'))
  const dir = mkdtempSync(join(tmpdir(), 'thanks-'))
  for (const { pr, body } of planThanks({ published, inventory, prs, owner: repository.split('/')[0], stargazers, thanked, asked })) {
    if (values['dry-run']) { console.log(`would thank #${pr}\n${body}`); continue }
    const file = join(dir, `${pr}.md`)
    writeFileSync(file, body)
    gh('pr', 'comment', String(pr), '--repo', repository, '--body-file', file)
    console.log(`thanked #${pr}`)
  }
}
