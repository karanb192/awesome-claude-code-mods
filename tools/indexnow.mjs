// Tells IndexNow (Amazon, Bing, Naver, Seznam.cz, Yandex, Yep; not Google) which pages changed, so a new or removed page is
// recrawled within hours instead of waiting for the sitemap. The key file docs/<KEY>.txt proves the
// site owns the key; it is public by design.
//
//   node tools/indexnow.mjs --base <sha> --head <sha>   pages changed between two commits
//   node tools/indexnow.mjs --all [--base <sha>]        every URL in docs/sitemap.xml, plus pages changed since base
//   add --dry-run to print the URLs without sending them

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const site = 'https://mods.aidojo.si/'
export const KEY = '70e762a8c306a4cfd45110e471061e09'
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const BATCH = 10000

// Removed pages are included: a 404 on recrawl is how a search engine learns a mod was retired.
export function urlsForPaths(paths) {
  const urls = new Set()
  for (const path of paths) {
    if (path === 'docs/index.html') urls.add(site)
    if (path === 'docs/access/index.html') urls.add(`${site}access/`)
    const topic = path.match(/^docs\/topics\/([^/]+)\/index\.html$/)
    if (topic) urls.add(`${site}topics/${topic[1]}/`)
    const browse = path.match(/^docs\/browse\/([^/]+)\/index\.html$/)
    if (browse) urls.add(`${site}browse/${browse[1]}/`)
    const page = path.match(/^docs\/mods\/([^/]+)\/index\.html$/)
    if (page) urls.add(`${site}mods/${page[1]}/`)
  }
  return [...urls].sort()
}

export const sitemapUrls = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])

export function batches(urls, size = BATCH) {
  const out = []
  for (let i = 0; i < urls.length; i += size) out.push(urls.slice(i, i + size))
  return out
}

export const payload = urlList => ({ host: new URL(site).host, key: KEY, keyLocation: `${site}${KEY}.txt`, urlList })

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' }, all: { type: 'boolean' }, 'dry-run': { type: 'boolean' } } })
  const changed = values.base ? urlsForPaths(execFileSync('git', ['diff', '--name-only', '--no-renames', values.base, values.head ?? 'HEAD', '--', 'docs/index.html', 'docs/access', 'docs/topics', 'docs/browse', 'docs/mods'], { encoding: 'utf8' }).split('\n').filter(Boolean)) : []
  // --all with a base also sends removed pages, which the sitemap no longer lists.
  const urls = values.all ? [...new Set([...sitemapUrls(readFileSync('docs/sitemap.xml', 'utf8')), ...changed])].sort() : changed
  console.log(`${urls.length} URLs`)
  if (values['dry-run']) for (const url of urls) console.log(url)
  else for (const urlList of batches(urls)) {
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload(urlList)) })
    // 200 and 202 both mean accepted; 202 means the key is still being verified.
    if (response.status !== 200 && response.status !== 202) throw new Error(`IndexNow returned ${response.status}: ${await response.text()}`)
    console.log(`sent ${urlList.length}, status ${response.status}`)
  }
}
