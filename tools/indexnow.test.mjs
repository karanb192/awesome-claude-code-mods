import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { KEY, batches, payload, sitemapUrls, urlsForPaths } from './indexnow.mjs'

test('changed page files map to their public URLs, and other files are ignored', () => {
  assert.deepEqual(urlsForPaths([
    'docs/mods/a--b--c/index.html',
    'docs/index.html',
    'docs/mods/gone--repo--tool/index.html',
    'docs/site.css',
    'docs/sitemap.xml',
    'docs/mods.json',
    'docs/mods/a--b--c/extra.txt',
  ]), ['https://mods.aidojo.si/', 'https://mods.aidojo.si/mods/a--b--c/', 'https://mods.aidojo.si/mods/gone--repo--tool/'])
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
