// After a seed publication merges, thanks the people whose seed PRs it published. Each PR gets one
// comment; the star request goes only to authors who have not starred and were never asked before.
// The hidden marker records both facts, so later runs read them back from the repository's comments.

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readRepos } from './candidates.mjs'
import { siteAnchors } from './slug.mjs'
import { idOf, readRegistry } from './pages.mjs'

const SITE = 'https://mods.aidojo.si/'
const BOT = 'github-actions[bot]'
const MARKER = /<!-- publication-thanks pr=(\d+) author=([\w-]+)( star-asked)? -->/
const key = value => value.toLowerCase()

// The commit that most recently brought each seed line into the file, from
// `git log --reverse --first-parent -m --format=%x00%H -p -U0 <ref> -- data/seeds.txt`.
// A line removed and added in one commit (a reorder or case change) keeps its earlier commit.
export function seedCommits(log) {
  const present = new Map()
  for (const entry of log.split('\0').slice(1)) {
    const [sha, ...lines] = entry.split('\n')
    const changed = sign => new Set(lines.filter(line => line.startsWith(sign) && !line.startsWith(sign.repeat(3))).map(line => key(line.slice(1).trim())).filter(Boolean))
    const added = changed('+'), removed = changed('-')
    for (const repo of removed) if (!added.has(repo)) present.delete(repo)
    for (const repo of added) if (!present.has(repo)) present.set(repo, sha.trim())
  }
  return present
}

// Only comments by the workflow or the repository owner count, and only for the PR they were posted
// on, so a quoted marker in someone else's comment cannot suppress a thank-you or a star request.
export function readMarkers(comments, owner) {
  const thanked = new Set(), asked = new Set()
  for (const { issue, author, body } of comments) {
    const match = MARKER.exec(body ?? '')
    if (!match || (author !== BOT && key(author ?? '') !== key(owner ?? '')) || Number(match[1]) !== Number(issue)) continue
    thanked.add(Number(match[1]))
    if (match[3]) asked.add(key(match[2]))
  }
  return { thanked, asked }
}

const list = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

// linkOf: each mod's page on the website.
export function thanksBody(pr, author, repos, mods, linkOf, askStar) {
  const label = name => String(name).replace(/[[\]\\]/g, '\\$&')
  return [
    `<!-- publication-thanks pr=${pr} author=${author}${askStar ? ' star-asked' : ''} -->`,
    `Thanks for submitting ${list(repos)}. ${mods.length === 1 ? 'Its mod is' : `${repos.length === 1 ? 'Its' : 'Their'} ${mods.length} mods are`} now in the catalogue, with the access the scan recorded:`,
    '',
    ...mods.map(mod => `- [${label(mod.name)}](${linkOf(mod)})`),
    '',
    `${mods.length === 1 ? 'The page has' : 'Each page has'} a README badge you can copy, which links back to it.`,
    ...(askStar ? ['', 'If the catalogue is useful to you, a star on this repository helps other people find it.'] : []),
  ].join('\n') + '\n'
}

// One comment per contributor PR, covering every seed it added that this run published. Skips the
// owner, bots, PRs already thanked and seeds whose PR cannot be found; asks for a star at most once per author.
// pages: data/pages.json. A mod without a page there, such as one published before pages existed, links to
// its row on the homepage instead.
export function planThanks({ published, inventory, prs, owner, stargazers, thanked, asked, pages = {} }) {
  const anchors = siteAnchors(inventory.mods)
  const pageOf = new Map(Object.entries(pages).filter(([, entry]) => !entry.to).map(([slug, entry]) => [entry.id, slug]))
  const linkOf = mod => pageOf.has(idOf(mod)) ? `${SITE}mods/${pageOf.get(idOf(mod))}/` : `${SITE}#${anchors.get(mod)}`
  const byPr = new Map()
  for (const repo of published) {
    const pr = prs.get(key(repo))
    if (!pr || pr.bot || key(pr.author) === key(owner) || thanked.has(pr.number)) continue
    const mods = inventory.mods.filter(mod => mod.kind === 'mod' && key(mod.repo) === key(repo))
    if (!mods.length) continue
    const group = byPr.get(pr.number) ?? { pr, repos: [], mods: [] }
    group.repos.push(repo)
    group.mods.push(...mods)
    byPr.set(pr.number, group)
  }
  const askedNow = new Set(asked)
  return [...byPr.values()].map(({ pr, repos, mods }) => {
    const askStar = !stargazers.has(key(pr.author)) && !askedNow.has(key(pr.author))
    if (askStar) askedNow.add(key(pr.author))
    return { pr: pr.number, body: thanksBody(pr.number, pr.author, repos, mods, linkOf, askStar) }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { published: { type: 'string' }, ref: { type: 'string' }, 'dry-run': { type: 'boolean' } } })
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository || !values.published || !values.ref) throw new Error('GITHUB_REPOSITORY, --published and --ref are required')
  const published = readRepos(values.published)
  if (!published.length) process.exit(0)
  const deadline = Date.now() + 240_000
  const run = (command, args) => {
    const left = deadline - Date.now()
    if (left <= 0) throw new Error('Thanks step ran out of time')
    return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: Math.min(60_000, left) })
  }
  const gh = (...args) => run('gh', args)
  const lines = text => text.split('\n').filter(Boolean)
  // The publication commit, not the working tree: branch cleanup after the merge can leave it stale.
  const inventory = JSON.parse(run('git', ['show', `${values.ref}:data/mods.json`]))
  const pages = readRegistry(run('git', ['show', `${values.ref}:data/pages.json`]))
  const commits = seedCommits(run('git', ['log', '--reverse', '--first-parent', '-m', '--format=%x00%H', '-p', '-U0', values.ref, '--', 'data/seeds.txt']))
  const prs = new Map()
  for (const repo of published) {
    const sha = commits.get(key(repo))
    if (!sha) continue
    const [found] = JSON.parse(gh('api', `repos/${repository}/commits/${sha}/pulls`))
      .filter(pr => pr.merged_at && pr.base.ref === 'main')
    if (found) prs.set(key(repo), { number: found.number, author: found.user.login, bot: found.user.type === 'Bot' })
  }
  const stargazers = new Set(lines(gh('api', '--paginate', `repos/${repository}/stargazers?per_page=100`, '--jq', '.[].login')).map(key))
  const comments = lines(gh('api', '--paginate', `repos/${repository}/issues/comments?per_page=100`, '--jq', '.[] | select(.body | contains("publication-thanks")) | [(.issue_url | split("/") | last), .user.login, (.body | gsub("\\n"; " "))] | @tsv'))
    .map(line => { const [issue, author, ...body] = line.split('\t'); return { issue, author, body: body.join('\t') } })
  const { thanked, asked } = readMarkers(comments, repository.split('/')[0])
  const dir = mkdtempSync(join(tmpdir(), 'thanks-'))
  for (const { pr, body } of planThanks({ published, inventory, prs, owner: repository.split('/')[0], stargazers, thanked, asked, pages })) {
    if (values['dry-run']) { console.log(`would thank #${pr}\n${body}`); continue }
    const file = join(dir, `${pr}.md`)
    writeFileSync(file, body)
    gh('pr', 'comment', String(pr), '--repo', repository, '--body-file', file)
    console.log(`thanked #${pr}`)
  }
}
