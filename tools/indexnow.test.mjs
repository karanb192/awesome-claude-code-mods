import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KEY, batches, payload, sitemapUrls, urlsForPaths } from './indexnow.mjs'

test('changed page files map to their public URLs, and other files are ignored', () => {
  assert.deepEqual(urlsForPaths([
    'docs/mods/a--b--c/index.html',
    'docs/index.html',
    'docs/access/index.html',
    'docs/browse/c/index.html',
    'docs/directory/1.json',
    'docs/mods/gone--repo--tool/index.html',
    'docs/site.css',
    'docs/sitemap.xml',
    'docs/mods.json',
    'docs/mods/a--b--c/extra.txt',
    'docs/topics/prompt-cache/index.html',
    'docs/topics/prompt-cache/extra.txt',
  ]), ['https://mods.aidojo.si/', 'https://mods.aidojo.si/access/', 'https://mods.aidojo.si/browse/c/', 'https://mods.aidojo.si/mods/a--b--c/', 'https://mods.aidojo.si/mods/gone--repo--tool/', 'https://mods.aidojo.si/topics/prompt-cache/'])
})

test('the workflow sends topic pages when they change on main', () => {
  const workflow = readFileSync(new URL('../.github/workflows/indexnow.yml', import.meta.url), 'utf8')
  assert.match(workflow, /paths: \[[^\]]*"docs\/topics\/\*\*"[^\]]*\]/)
})

test('the sitemap gives every listed URL', () => {
  const xml = '<urlset><url><loc>https://mods.aidojo.si/</loc></url><url><loc>https://mods.aidojo.si/mods/x--y--z/</loc></url></urlset>'
  assert.deepEqual(sitemapUrls(xml), ['https://mods.aidojo.si/', 'https://mods.aidojo.si/mods/x--y--z/'])
})

test('requests stay within the 10,000 URL limit', () => {
  const urls = Array.from({ length: 25001 }, (_, i) => `u${i}`)
  assert.deepEqual(batches(urls).map(batch => batch.length), [10000, 10000, 5001])
  assert.deepEqual(batches([]), [])
})

test('the published key file holds the key the requests send', () => {
  assert.match(KEY, /^[a-f0-9]{32}$/)
  assert.equal(readFileSync(`docs/${KEY}.txt`, 'utf8').trim(), KEY)
  assert.deepEqual(payload(['https://mods.aidojo.si/']), { host: 'mods.aidojo.si', key: KEY, keyLocation: `https://mods.aidojo.si/${KEY}.txt`, urlList: ['https://mods.aidojo.si/'] })
})

for (const [name, folder, url] of [['access page', 'docs/access', 'https://mods.aidojo.si/access/'], ['topic page', 'docs/topics/prompt-cache', 'https://mods.aidojo.si/topics/prompt-cache/']]) test(`the ${name} is sent when it is added, changed or deleted`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' }).trim()
  const commit = message => { git('add', '-A'); git('commit', '-q', '--allow-empty', '-m', message); return git('rev-parse', 'HEAD') }
  git('init', '-q')
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(join(dir, 'docs/site.css'), 'body{}')
  const empty = commit('base')
  writeFileSync(join(dir, folder, 'index.html'), 'first')
  const added = commit('add')
  writeFileSync(join(dir, folder, 'index.html'), 'second')
  const changed = commit('change')
  rmSync(join(dir, folder), { recursive: true })
  const deleted = commit('delete')
  const script = fileURLToPath(new URL('./indexnow.mjs', import.meta.url))
  const sent = (base, head) => execFileSync(process.execPath, [script, '--base', base, '--head', head, '--dry-run'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').slice(1)
  for (const [base, head] of [[empty, added], [added, changed], [changed, deleted]]) assert.deepEqual(sent(base, head), [url])
})
