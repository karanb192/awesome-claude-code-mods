import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, cpSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const renderer = fileURLToPath(new URL('./render.mjs', import.meta.url))
// Render grades from recorded calls, so each fixture level comes from a call that produces it.
const LEVEL_CALLS = [[], ['$.fs.read'], ['$.process.run'], ['$.http.fetch']]
const mod = (i, status = 'passed', kind = 'mod') => ({
  id: `example/mods:plugins/mod-${i}`, repo: 'example/mods', path: `plugins/mod-${i}`, name: `mod-${i}`, kind,
  description: `Example mod ${i}`, url: 'https://example.com', stars: i,
  reach: { level: i % 4, labels: [] }, sees: [], hooks: [], calls: LEVEL_CALLS[i % 4], surfaceModules: [],
  validate: { status, errors: status === 'failed' ? ['name: Plugin name is reserved.'] : [] },
})

function fixture(t, mods) {
  const dir = mkdtempSync(join(tmpdir(), 'mods-render-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'data'))
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify({ generated: '2026-01-01T00:00:00Z', claudeVersion: '2.1.287', repos: 1, mods }))
  writeFileSync(join(dir, 'README.md'), 'Curated picks stay here.\n<!-- stats:start -->\n<!-- stats:end -->\n')
  writeFileSync(join(dir, 'catalogue.md'), ['stats', 'scan', 'builtin'].map(name => `<!-- ${name}:start -->\n<!-- ${name}:end -->`).join('\n'))
  return dir
}

const render = dir => execFileSync(process.execPath, [renderer], { cwd: dir, stdio: 'pipe' })
const modPage = (dir, slug) => readFileSync(join(dir, 'docs/mods', slug, 'index.html'), 'utf8')
const tree = folder => Object.fromEntries(readdirSync(folder, { recursive: true }).sort().map(path => [path, existsSync(join(folder, path, 'index.html')) ? readFileSync(join(folder, path, 'index.html'), 'utf8') : null]))

// Mod pages use root-relative asset paths, so they are checked through a server that answers like GitHub Pages.
// hold: a promise the directory parts wait for, to test what happens while the full list is still loading.
function serve(t, root, { hold } = {}) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }
  const server = createServer((req, res) => {
    let file = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (existsSync(join(file, 'index.html'))) file = join(file, 'index.html')
    if (!existsSync(file) || !extname(file)) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(readFileSync(join(root, '404.html'))) }
    const send = () => { res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file)) }
    if (hold && file.includes('/directory/')) hold.then(send)
    else send()
  }).listen(0)
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

test('finder copies the exact install command and reports clipboard failures', async t => {
  const dir = fixture(t, [mod(0)])
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const tab = await browser.newPage()
  await tab.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: text => new Promise(resolve => {
        window.copiedCommand = text
        window.finishCopy = resolve
      }),
    } })
  })
  const url = `${serve(t, join(dir, 'docs'))}/`
  await tab.goto(url)
  await tab.waitForSelector('#t[data-loaded]')
  await tab.locator('.finder summary').click()
  const button = tab.getByRole('button', { name: 'Copy install command' })
  await button.focus()
  await tab.keyboard.press('Enter')
  assert.equal(await button.isDisabled(), true)
  assert.equal(await tab.evaluate(() => window.copiedCommand), '/plugin install mod-finder --marketplace karanb192/awesome-claude-code-mods')
  await tab.evaluate(() => window.finishCopy())
  assert.equal(await tab.locator('#finder-copy-status').textContent(), 'Copied.')
  assert.equal(await button.isEnabled(), true)
  await tab.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Permission denied') } })
  await button.click()
  assert.equal(await tab.locator('#finder-copy-status').textContent(), 'Copy failed. Select the command and copy it manually.')
  await tab.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined }) })
  await button.click()
  assert.equal(await tab.locator('#finder-copy-status').textContent(), 'Copy failed. Select the command and copy it manually.')
  assert.equal(await button.isEnabled(), true)
  await tab.getByRole('searchbox').fill('no match')
  assert.equal(await tab.locator('#empty').isVisible(), true)
  const noScript = await browser.newPage({ javaScriptEnabled: false })
  await noScript.goto(url)
  await noScript.locator('.finder summary').click()
  assert.equal(await noScript.locator('#finder-copy').isVisible(), false)
  assert.equal(await noScript.locator('#finder-command').isVisible(), true)
})

test('two plugins with one name in one repo get separate badges and anchors', t => {
  const near = { ...mod(2), path: 'clip', name: 'clip' }
  const deep = { ...mod(0), path: 'plugins/more/clip', name: 'clip' }
  const dir = fixture(t, [deep, near])
  render(dir)
  const catalogue = readFileSync(join(dir, 'catalogue.md'), 'utf8')
  const page = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  assert.match(readFileSync(join(dir, 'badges/example--mods--clip-reach.svg'), 'utf8'), /L2/)
  assert.match(readFileSync(join(dir, 'badges/example--mods--clip--plugins-more-clip-reach.svg'), 'utf8'), /L0/)
  assert.match(catalogue, /badges\/example--mods--clip-reach\.svg/)
  assert.match(catalogue, /badges\/example--mods--clip--plugins-more-clip-reach\.svg/)
  const ids = [...page.matchAll(/<tr id="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('example--mods--clip') && ids.includes('example--mods--clip--plugins-more-clip'))
})

test('generated descriptions preserve literal replacement tokens', t => {
  const description = "Literal $& and $` and $' and $$ stay in the description."
  const dir = fixture(t, [{ ...mod(0), description }])
  render(dir)
  const catalogue = readFileSync(join(dir, 'catalogue.md'), 'utf8')
  assert.ok(catalogue.includes(description))
  for (const marker of ['stats', 'scan', 'builtin']) {
    assert.equal(catalogue.split(`<!-- ${marker}:start -->`).length - 1, 1)
    assert.equal(catalogue.split(`<!-- ${marker}:end -->`).length - 1, 1)
  }
  render(dir)
  assert.equal(readFileSync(join(dir, 'catalogue.md'), 'utf8'), catalogue)
})

test('repeat scans refresh the README count and catalogue without duplicating tables', t => {
  const dir = fixture(t, [mod(0)])
  render(dir)
  const data = JSON.parse(readFileSync(join(dir, 'data/mods.json'), 'utf8'))
  data.generated = '2026-02-02T00:00:00Z'
  data.mods.push(mod(1), mod(2, 'passed', 'builtin'))
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data))
  render(dir)
  const readme = readFileSync(join(dir, 'README.md'), 'utf8')
  const catalogue = readFileSync(join(dir, 'catalogue.md'), 'utf8')
  assert.match(readme, /Curated picks stay here/)
  assert.match(readme, /\*\*2 mods\*\*.*2026-02-02/)
  assert.doesNotMatch(readme, /mod-0|mod-1|mod-2/)
  assert.match(catalogue, /\*\*2 mods\*\*/)
  assert.equal((catalogue.match(/\[mod-1\]/g) ?? []).length, 1)
  assert.match(catalogue, /<!-- builtin:start -->[\s\S]*\[mod-2\]/)
  render(dir)
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), readme)
  assert.equal(readFileSync(join(dir, 'catalogue.md'), 'utf8'), catalogue)
})

test('render preserves failures, distinguishes unknown results and removes excluded badges', t => {
  const dir = fixture(t, [mod(0), mod(1, 'warnings'), mod(2, 'failed'), mod(3, 'unknown'), mod(4, 'passed', 'fixture')])
  for (const folder of ['badges', 'docs/badges']) {
    mkdirSync(join(dir, folder), { recursive: true })
    writeFileSync(join(dir, folder, 'example--mods--mod-4-reach.svg'), 'old badge')
    writeFileSync(join(dir, folder, 'custom.svg'), 'keep')
  }
  render(dir)
  const readme = readFileSync(join(dir, 'README.md'), 'utf8')
  const catalogue = readFileSync(join(dir, 'catalogue.md'), 'utf8')
  const page = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  assert.match(readme, /\*\*4 mods\*\*/)
  assert.match(catalogue, /fails on 2\.1\.287/)
  assert.match(catalogue, /not verified/)
  assert.doesNotMatch(catalogue, /mod-4/)
  assert.doesNotMatch(readme, /mod-0|fails on|run host processes/)
  assert.match(modPage(dir, 'example--mods--mod-2'), /Plugin name is reserved/)
  assert.match(page, /not a runtime compatibility test/)
  for (const folder of ['badges', 'docs/badges']) {
    assert.equal(existsSync(join(dir, folder, 'example--mods--mod-4-reach.svg')), false)
    assert.equal(existsSync(join(dir, folder, 'custom.svg')), true)
    assert.match(readFileSync(join(dir, folder, 'example--mods--mod-1-validates.svg'), 'utf8'), /#788c5d/)
    assert.match(readFileSync(join(dir, folder, 'example--mods--mod-2-validates.svg'), 'utf8'), /fails on 2\.1\.287/)
    const unknown = readFileSync(join(dir, folder, 'example--mods--mod-3-validates.svg'), 'utf8')
    assert.match(unknown, /not verified/)
    assert.doesNotMatch(unknown, /#788c5d/)
  }
})

test('unavailable footprints render as unknown in every export and never enter the L0 filter', async t => {
  const unavailable = { status: 'unavailable' }
  const empty = { ...mod(1, 'failed'), footprint: unavailable, calls: [], reach: { level: null, labels: [] }, sourceCommit: 'a'.repeat(40) }
  const partial = { ...mod(2, 'failed'), calls: ['$.http.fetch'], reach: { level: 3, labels: ['network'] } }
  const passedMissing = { ...mod(3), footprint: unavailable, calls: [], reach: { level: null, labels: [] } }
  const completeFailed = { ...mod(4, 'failed'), footprint: { status: 'reported' }, reach: { level: 3, labels: ['network'] }, calls: ['$.http.fetch'] }
  const dir = fixture(t, [mod(0), empty, partial, passedMissing, completeFailed])
  const original = readFileSync(join(dir, 'data/mods.json'), 'utf8')
  render(dir)
  assert.equal(readFileSync(join(dir, 'data/mods.json'), 'utf8'), original)
  const snapshot = JSON.parse(readFileSync(join(dir, 'docs/mods.json'), 'utf8'))
  for (const i of [1, 2, 3]) {
    assert.equal(snapshot.mods[i].reach.level, null)
    assert.equal(snapshot.mods[i].footprint.status, 'unavailable')
    for (const folder of ['badges', 'docs/badges']) {
      const badge = readFileSync(join(dir, folder, `example--mods--mod-${i}-reach.svg`), 'utf8')
      assert.match(badge, /unknown access/)
      assert.doesNotMatch(badge, /L0|Lnull|undefined|draws only/)
    }
  }
  assert.equal(snapshot.mods[1].sourceCommit, empty.sourceCommit)
  assert.deepEqual(snapshot.mods[1].validate, empty.validate)
  assert.deepEqual(snapshot.mods[2].calls, ['$.http.fetch'])
  assert.equal(snapshot.mods[2].reach.minimumLevel, 3)
  assert.equal(snapshot.mods[4].reach.level, 3)
  assert.match(readFileSync(join(dir, 'catalogue.md'), 'utf8'), /Unknown access: 3/)
  assert.match(readFileSync(join(dir, 'catalogue.md'), 'utf8'), /unknown; incomplete footprint/)
  assert.match(readFileSync(join(dir, 'docs/llms.txt'), 'utf8'), /Unknown access: 3/)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://**/*', route => route.abort())
  await page.goto(`${serve(t, join(dir, 'docs'))}/`)
  await page.waitForSelector('#t[data-loaded]')
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('.lv[data-level="0"]').click()
    assert.deepEqual(await page.locator('#t tbody tr:visible').evaluateAll(rows => rows.map(row => row.id)), ['example--mods--mod-0'])
    await page.locator('.lv[data-level="unknown"]').click()
    assert.equal(await page.locator('#t tbody tr:visible').count(), 3)
    assert.equal(await page.locator('#example--mods--mod-1 .track .on').count(), 0)
    assert.match(await page.locator('#example--mods--mod-1 .reach').innerText(), /unknown access\nfails on/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.locator('.lv.all').click()
  }
  const record = modPage(dir, 'example--mods--mod-1')
  assert.match(record, /<dt>Footprint<\/dt><dd>Unavailable or incomplete/)
  assert.match(record, /<dt>API calls<\/dt><dd><code>not reported<\/code>/)
  assert.match(record, /Unknown access<\/span>/)
  const counts = await page.locator('.strip-legend .legend-count').allTextContents()
  assert.equal(counts.reduce((sum, text) => sum + parseInt(text), 0), 5)
  for (let i = 0; i < 2; i++) {
    await page.locator('button[data-k="level"]').click()
    const sorted = await page.locator('#t tbody tr').evaluateAll(rows => rows.map(row => row.dataset.level))
    assert.deepEqual(sorted.slice(-3), ['unknown', 'unknown', 'unknown'])
  }
})

test('compatibility warnings stay distinct from validation failures and link to scanned source', async t => {
  const reviewed = {
    ...mod(0), sourceCommit: 'a'.repeat(40),
    marketplaces: [{ path: '.claude-plugin/marketplace.json', name: '<market>', status: 'failed', errors: ['name: reserved <name>'] }],
    compatibility: { runtime: 'not-tested', warnings: [{ message: 'Review <text> control strings.', evidence: [{ file: 'plugins/mod-0/hooks/colour.ts', line: 12 }] }] },
  }
  const dir = fixture(t, [reviewed, { ...mod(1), marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'unknown', status: 'unknown', errors: [] }] }])
  render(dir)
  const page = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  const record = modPage(dir, 'example--mods--mod-0')
  const catalogue = readFileSync(join(dir, 'catalogue.md'), 'utf8')
  assert.match(catalogue, /2\.1\.287; marketplace fails; review UI rewrite/)
  assert.match(catalogue, /marketplace not verified/)
  assert.doesNotMatch(catalogue, /fails on 2\.1\.287/)
  assert.match(record, /&lt;market&gt;/)
  assert.match(record, /Review &lt;text&gt; control strings/)
  assert.match(record, new RegExp(`blob/${'a'.repeat(40)}/plugins/mod-0/hooks/colour.ts#L12`))
  assert.match(page, /does not prove those strings reach a text rewrite/)
  assert.match(readFileSync(join(dir, 'badges/example--mods--mod-0-validates.svg'), 'utf8'), /#c96442/)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const tab = await browser.newPage()
  await tab.route('https://**/*', route => route.abort())
  await tab.goto(`${serve(t, join(dir, 'docs'))}/`)
  await tab.waitForSelector('#t[data-loaded]')
  const row = tab.locator('#example--mods--mod-0')
  for (const width of [390, 1440]) {
    await tab.setViewportSize({ width, height: 900 })
    assert.equal(await row.locator('.compatibility').isVisible(), true)
    assert.match(await row.locator('.compatibility').innerText(), /marketplace fails; review UI rewrite/)
    assert.equal(await row.locator('.bad').count(), 0)
  }
  await tab.goto(`${serve(t, join(dir, 'docs'))}/mods/example--mods--mod-0/`)
  const source = tab.getByRole('link', { name: 'plugins/mod-0/hooks/colour.ts:12' })
  assert.equal(await source.isVisible(), true)
  assert.equal(await source.getAttribute('href'), `https://github.com/example/mods/blob/${'a'.repeat(40)}/plugins/mod-0/hooks/colour.ts#L12`)
  assert.match(await tab.locator('dl').innerText(), /Marketplace failed/)
  assert.match(await tab.locator('dl').innerText(), /Validation on 2.1.287\nPassed/)
  assert.match(await tab.locator('.compatibility').innerText(), /marketplace fails; review UI rewrite/)
})

test('incomplete UI review is labelled separately on the catalogue, badge and mod page', async t => {
  const entry = { ...mod(0), sourceCommit: 'a'.repeat(40), compatibility: { warnings: [{
    code: 'ui-review-incomplete', message: 'UI source review incomplete: source byte limit reached.',
    evidence: [{ file: 'hooks/large.ts', line: 1 }],
  }] } }
  const dir = fixture(t, [entry])
  render(dir)
  for (const file of ['catalogue.md', 'badges/example--mods--mod-0-validates.svg', 'docs/mods/example--mods--mod-0/index.html']) {
    const text = readFileSync(join(dir, file), 'utf8')
    assert.match(text, /UI review incomplete/)
    assert.doesNotMatch(text, /UI rewrite review|review UI rewrite/)
  }
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const tab = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await tab.goto(`${serve(t, join(dir, 'docs'))}/mods/example--mods--mod-0/`)
  assert.match(await tab.locator('dl').innerText(), /UI review incomplete/)
  assert.equal(await tab.getByRole('link', { name: 'hooks/large.ts:1' }).getAttribute('href'), `https://github.com/example/mods/blob/${'a'.repeat(40)}/hooks/large.ts#L1`)
})

test('scoreboard stays within desktop and mobile viewports as the scan grows', async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://**/*', route => route.abort())
  for (const count of [72, 364, 1000]) {
    const dir = fixture(t, Array.from({ length: count }, (_, i) => ({ ...mod(i), compatibility: { warnings: [{ message: 'Review control strings in UI source.', evidence: [{ file: 'hooks/colour.ts', line: 12 }] }] } })))
    render(dir)
    await page.goto(`${serve(t, join(dir, 'docs'))}/`)
    await page.waitForSelector('#t[data-loaded]')
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const sizes = await page.evaluate(() => {
        const strip = document.querySelector('.strip').getBoundingClientRect()
        const segments = [...document.querySelectorAll('.seg')].map(el => el.getBoundingClientRect())
        return {
          document: document.documentElement.scrollWidth,
          equalWidths: Math.max(...segments.map(r => r.width)) - Math.min(...segments.map(r => r.width)) < 1,
          contained: segments.every(r => r.left >= strip.left - 1 && r.right <= strip.right + 1 && r.top >= strip.top - 1 && r.bottom <= strip.bottom + 1 && r.width >= 3 && r.height >= 16),
        }
      })
      assert.ok(sizes.document <= width, `${count} mods at ${width}px: document is ${sizes.document}px`)
      assert.ok(sizes.contained, `${count} mods at ${width}px: reach segments escape their strip`)
      assert.ok(sizes.equalWidths, `${count} mods at ${width}px: segments have unequal widths`)
      assert.equal(await page.locator('#t tbody tr').first().locator('.compatibility').isVisible(), true)
    }
    await page.locator('.lv[data-level="3"]').click()
    assert.equal(await page.locator('#t tbody tr:visible').count(), Math.floor(count / 4))
    await page.locator('.lv[data-level="3"]').click()
    await page.locator('#q').fill('Example mod 0')
    assert.equal(await page.locator('#t tbody tr:visible').count(), 1)
  }
})

test('catalogue combines filters and recovers from an empty result', async t => {
  const dir = fixture(t, [...Array.from({ length: 8 }, (_, i) => mod(i)), mod(8, 'passed', 'builtin')])
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://**/*', route => route.abort())
  await page.goto(`${serve(t, join(dir, 'docs'))}/`)
  await page.waitForSelector('#t[data-loaded]')
  const rows = page.locator('#t tbody tr:visible')

  assert.equal(await rows.count(), 8)
  assert.equal(await page.locator('#empty').isVisible(), false)
  await page.locator('.lv[data-level="3"]').click()
  assert.equal(await rows.count(), 2)
  assert.equal(await page.locator('.lv[data-level="3"]').getAttribute('aria-pressed'), 'true')
  await page.locator('#q').fill('Example mod 0')
  assert.equal(await rows.count(), 0)
  assert.equal(await page.locator('#empty').isVisible(), true)
  assert.match(await page.locator('#n').textContent(), /0 of 8 mods/)

  await page.locator('#reset').click()
  assert.equal(await page.locator('#q').inputValue(), '')
  assert.equal(await rows.count(), 8)
  assert.equal(await page.locator('.lv:not(.all)[aria-pressed="true"]').count(), 0)
  assert.equal(await page.locator('.lv.all').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('#empty').isVisible(), false)
  assert.match(await page.locator('#n').textContent(), /8 mods/)
  await page.locator('#q').fill('eXaMpLe MoD 3')
  assert.equal(await rows.count(), 1)
  assert.match(await page.locator('#n').textContent(), /1 of 8 mods/)
  await page.locator('#clear-search').click()
  assert.equal(await rows.count(), 8)
  assert.equal(await page.locator('#q').inputValue(), '')
  assert.equal(await page.locator('#q').evaluate(el => el === document.activeElement), true)
  await page.locator('#q').fill('EXAMPLE/MODS')
  assert.equal(await rows.count(), 8)
})

test('catalogue keeps search usable while browsing and refining results on desktop and mobile', async t => {
  const mods = Array.from({ length: 64 }, (_, i) => mod(i))
  mods[0] = { ...mods[0], repo: 'zenbu-labs/terminal-browser', name: 'terminal-browser' }
  const dir = fixture(t, mods)
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://**/*', route => route.abort())

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`${serve(t, join(dir, 'docs'))}/`)
    await page.waitForSelector('#t[data-loaded]')
    const search = page.locator('#q')
    const rows = page.locator('#t tbody tr:visible')

    assert.equal(await page.locator('#directory .catalog-search #q').count(), 1)
    assert.equal(await page.locator('#directory .catalog-search #n').count(), 1)
    assert.equal(await page.locator('.hero #q, .featured').count(), 0)
    assert.equal(await page.locator('#directory').evaluate(directory =>
      ['about', 'method'].every(id => directory.compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING)), true)

    const browse = width < 760 ? page.locator('.skip') : page.locator('nav a[href="#directory"]')
    await browse.focus()
    await browse.click()
    assert.equal(await search.evaluate(el => el === document.activeElement), true)
    assert.ok(Math.abs(await page.locator('#directory').evaluate(el => el.getBoundingClientRect().top)) < 1, 'Collection navigation leaves a strip of the hero visible')
    await search.fill('Example mod')
    assert.equal(await rows.count(), 64)

    await page.locator('#example--mods--mod-40').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    const scrolled = await page.evaluate(() => {
      const bar = document.querySelector('.catalog-search').getBoundingClientRect()
      const field = document.getElementById('q').getBoundingClientRect()
      const first = document.querySelector('#t tbody tr:not([hidden])').getBoundingClientRect()
      return {
        browsingRows: first.bottom < bar.top,
        barVisible: bar.top >= 0 && bar.bottom <= innerHeight,
        fieldVisible: field.top >= bar.top && field.bottom <= bar.bottom,
        width: document.documentElement.scrollWidth,
      }
    })
    assert.equal(scrolled.browsingRows, true, `${width}px: fixture did not scroll into the results`)
    assert.equal(scrolled.barVisible && scrolled.fieldVisible, true, `${width}px: search disappeared while browsing`)
    assert.ok(scrolled.width <= width, `${width}px: search bar causes horizontal overflow`)

    await page.keyboard.type(' 1')
    assert.equal(await search.inputValue(), 'Example mod 1')
    assert.equal(await rows.count(), 11)
    assert.match(await page.locator('#n').textContent(), /11 of 64 mods/)
    assert.equal(await search.evaluate(el => el === document.activeElement), true)
    const refined = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bar = document.querySelector('.catalog-search').getBoundingClientRect()
      const first = document.querySelector('#t tbody tr:not([hidden])').getBoundingClientRect()
      return { barTop: bar.top, barBottom: bar.bottom, firstTop: first.top, viewport: innerHeight }
    })
    assert.ok(refined.barTop >= 0 && refined.firstTop >= refined.barBottom - 1 && refined.firstTop < refined.viewport,
      `${width}px: refined results shifted out of view after layout: ${JSON.stringify(refined)}`)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
})

test('section links align their destinations and focus the selected section', async t => {
  const dir = fixture(t, Array.from({ length: 12 }, (_, i) => mod(i)))
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://**/*', route => route.abort())

  for (const { width, height, colorScheme } of [
    { width: 390, height: 844, colorScheme: 'light' },
    { width: 1440, height: 844, colorScheme: 'light' },
    { width: 2048, height: 1144, colorScheme: 'light' },
    { width: 2048, height: 1144, colorScheme: 'dark' },
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme })
    await page.goto(`${serve(t, join(dir, 'docs'))}/`)
    await page.waitForSelector('#t[data-loaded]')
    const aboutLink = page.locator('nav a[href="#about"]')
    if (await aboutLink.isVisible()) {
      await aboutLink.click()
      assert.equal(new URL(page.url()).hash, '#about')
      assert.ok(Math.abs(await page.locator('#about').evaluate(el => el.getBoundingClientRect().top)) < 1,
        `${width}×${height} ${colorScheme}: About navigation leaves a strip of the collection visible`)
      assert.equal(await page.locator('#about h2').evaluate(el => el === document.activeElement), true)
    }

    await page.locator('.filter-heading a[href="#method"]').click()
    assert.equal(new URL(page.url()).hash, '#method')
    assert.equal(await page.locator('#method h2').evaluate(el => el === document.activeElement), true)
    const position = await page.locator('#method').evaluate(el => {
      const top = el.getBoundingClientRect().top
      const remaining = document.documentElement.scrollHeight - innerHeight - scrollY
      return { top, remaining }
    })
    assert.ok(Math.abs(position.top) < 1 || (position.top >= 0 && Math.abs(position.remaining) < 1),
      `${width}px: access details should reach the viewport top or the end of the document`)
  }
})

test('sorting retains filters and reach links reveal their target consistently', async t => {
  const dir = fixture(t, Array.from({ length: 12 }, (_, i) => mod(i)))
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://**/*', route => route.abort())
  await page.goto(`${serve(t, join(dir, 'docs'))}/`)
  await page.waitForSelector('#t[data-loaded]')
  const stars = () => page.locator('#t tbody tr:visible').evaluateAll(rows => rows.map(row => Number(row.dataset.stars)))

  await page.locator('.lv[data-level="3"]').click()
  await page.locator('#t th button[data-k="stars"]').click()
  assert.deepEqual(await stars(), [3, 7, 11])
  await page.locator('#t th button[data-k="stars"]').click()
  assert.deepEqual(await stars(), [11, 7, 3])
  await page.locator('#q').fill('no matching mod')
  assert.equal(await page.locator('#t tbody tr:visible').count(), 0)

  await page.locator('.seg[href="#example--mods--mod-0"]').click()
  assert.equal(await page.locator('#example--mods--mod-0').isVisible(), true)
  assert.equal(await page.locator('#q').inputValue(), '')
  assert.equal(await page.locator('#empty').isVisible(), false)
  const visible = await page.locator('#t tbody tr:visible').count()
  assert.equal(Number((await page.locator('#n').textContent()).match(/\d+/)[0]), visible)
  assert.equal(new URL(page.url()).hash, '#example--mods--mod-0')
  assert.deepEqual(errors, [])
})

test('system theme changes update colours without resetting catalogue search', async t => {
  const dir = fixture(t, Array.from({ length: 12 }, (_, i) => mod(i)))
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' })
  await page.route('https://**/*', route => route.abort())
  await page.goto(`${serve(t, join(dir, 'docs'))}/`)
  await page.waitForSelector('#t[data-loaded]')
  await page.locator('#q').fill('Example mod 1')
  let navigations = 0
  page.on('framenavigated', () => navigations++)
  const states = []

  for (const colorScheme of ['light', 'dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    const state = await page.evaluate(() => {
      const body = getComputedStyle(document.body)
      const search = document.getElementById('q')
      const themeColors = [...document.querySelectorAll('meta[name="theme-color"]')]
        .filter(meta => meta.media && matchMedia(meta.media).matches)
        .map(meta => meta.content)
      return {
        background: body.backgroundColor,
        text: body.color,
        query: search.value,
        rows: [...document.querySelectorAll('#t tbody tr:not([hidden])')].map(row => row.id),
        count: document.getElementById('n').textContent,
        focused: document.activeElement === search,
        fits: document.documentElement.scrollWidth <= innerWidth,
        themeColors,
        validThemeColors: themeColors.every(color => CSS.supports('color', color)),
      }
    })
    assert.equal(state.query, 'Example mod 1')
    assert.equal(state.rows.length, 3)
    assert.match(state.count, /3 of 12 mods/)
    assert.equal(state.focused, true, `${colorScheme}: theme change moved search focus`)
    assert.equal(state.fits, true, `${colorScheme}: page overflows the mobile viewport`)
    assert.equal(state.themeColors.length, 1, `${colorScheme}: expected one matching theme-colour meta tag`)
    assert.equal(state.validThemeColors, true)
    states.push(state)
  }

  assert.notEqual(states[0].background, states[1].background)
  assert.notEqual(states[0].text, states[1].text)
  assert.notDeepEqual(states[0].themeColors, states[1].themeColors)
  assert.deepEqual(states[0].rows, states[1].rows)
  assert.deepEqual(states[0], states[2])
  assert.equal(navigations, 0)
})

test('landing metadata and browse links use the published catalogue', async t => {
  const dir = fixture(t, [mod(0)])
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://**/*', route => route.abort())
  await page.goto(`${serve(t, join(dir, 'docs'))}/`)
  await page.waitForSelector('#t[data-loaded]')

  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://mods.aidojo.si/')
  assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), 'https://mods.aidojo.si/')
  assert.equal(await page.locator('h1').count(), 1)
  const missingTargets = await page.locator('a[href^="#"]').evaluateAll(links => links
    .map(link => link.getAttribute('href').slice(1))
    .filter(id => id && !document.getElementById(decodeURIComponent(id))))
  assert.deepEqual(missingTargets, [])
  assert.equal(await page.locator('#q').getAttribute('type'), 'search')
  assert.ok(await page.locator('#q').getAttribute('aria-label') || await page.locator('label[for="q"]').count())
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.getByRole('columnheader', { name: 'What it does', exact: true }).count(), 1)
})

test('the site ships its crawl and agent files with the catalogue facts', t => {
  const dir = fixture(t, [mod(0), mod(1), mod(2), mod(3)])
  render(dir)
  const page = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  assert.match(page, /<title>Awesome Claude Code Mods \| 4 mods and what each can access<\/title>/)
  assert.match(page, /<meta name="description" content="4 Claude Code mods, with what each one can access before you install it\. Context and usage meters, prompt cache warmers, status lines, guards and more, with install hints\.">/)
  assert.match(page, /<meta property="og:description" content="4 Claude Code mods, with what each one can access before you install it\./)
  assert.match(page, /<h1 id="title">Awesome<br><span>Claude Code Mods<\/span><\/h1>/)
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  const dataset = ld['@graph'].find(node => node['@type'] === 'Dataset')
  assert.equal(dataset.distribution[0].contentUrl, 'https://mods.aidojo.si/mods.json')
  assert.equal(dataset.distribution[1].contentUrl, 'https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/catalogue.md')
  assert.ok(ld['@graph'].every(node => !('dateModified' in node)), 'the full-scan date is not a publication timestamp')
  const sitemap = readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8')
  assert.match(sitemap, /<loc>https:\/\/mods\.aidojo\.si\/<\/loc>/)
  assert.doesNotMatch(sitemap, /<lastmod>/, 'seed publication can change the page without changing the full-scan date')
  assert.match(readFileSync(join(dir, 'docs/robots.txt'), 'utf8'), /^User-agent: \*\nAllow: \/\n\nSitemap: https:\/\/mods\.aidojo\.si\/sitemap\.xml\n$/)
  const llms = readFileSync(join(dir, 'docs/llms.txt'), 'utf8')
  assert.ok(llms.includes(`[catalogue.md](${dataset.distribution[1].contentUrl})`))
  assert.match(llms, /^# Awesome Claude Code Mods\n\n> 4 Claude Code mods, with what each one can access before you install it\./)
  assert.match(llms, /Last scanned 2026-01-01 on Claude Code 2\.1\.287/)
  assert.match(llms, /L3 Uses the network: 1, Unknown access: 0\./)
  assert.match(llms, /^- \[mod-3\]\(https:\/\/example\.com\): Example mod 3$/m)
  assert.ok(llms.indexOf('[mod-3]') < llms.indexOf('[mod-0]'), 'most starred first')
})

test('a mod listed in Anthropic\'s directory is marked in the catalogue and on the site, and can be filtered', async t => {
  const listed = { ...mod(1), directory: { plugin: 'mod-1@anthropic-plugin-directory' } }
  const dir = fixture(t, [listed, mod(2)])
  render(dir)
  const catalogue = readFileSync(join(dir, 'catalogue.md'), 'utf8')
  const page = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  assert.match(catalogue, /\| listed /)
  assert.match(catalogue, /1 are also listed in Anthropic's plugin directory/)
  assert.equal(page.match(/class="listed"/g).length, 1)
  assert.match(page, /mod-1@anthropic-plugin-directory/)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const tab = await browser.newPage()
  await tab.goto(`${serve(t, join(dir, 'docs'))}/`)
  await tab.waitForSelector('#t[data-loaded]')
  await tab.click('.listed-filter')
  assert.equal(await tab.locator('#t tbody tr:not([hidden])').count(), 1)
  assert.equal(await tab.locator('.listed-filter').getAttribute('aria-pressed'), 'true')
  await tab.click('#reset')
  assert.equal(await tab.locator('#t tbody tr:not([hidden])').count(), 2)
})

test('every mod gets a page linked from its row, and the sitemap lists only indexable pages', t => {
  const empty = { ...mod(3), description: '' }
  const dir = fixture(t, [mod(0), mod(1, 'failed'), mod(2, 'unknown'), empty, mod(4, 'passed', 'builtin')])
  render(dir)
  const home = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  for (const i of [0, 1, 2, 3, 4]) {
    assert.match(home, new RegExp(`<a class="mod-name" href="mods/example--mods--mod-${i}/">mod-${i}</a>`))
    assert.match(modPage(dir, `example--mods--mod-${i}`), new RegExp(`<a href="/#example--mods--mod-${i}">All Claude Code mods</a>`))
  }
  assert.doesNotMatch(home, /<details><summary>Access/, 'the full record lives on the page')
  const sitemap = readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8')
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]), ['https://mods.aidojo.si/', 'https://mods.aidojo.si/access/', 'https://mods.aidojo.si/browse/m/', ...[0, 1, 4].map(i => `https://mods.aidojo.si/mods/example--mods--mod-${i}/`)])
  assert.match(modPage(dir, 'example--mods--mod-2'), /<meta name="robots" content="noindex">/)
  assert.match(modPage(dir, 'example--mods--mod-3'), /<meta name="robots" content="noindex">/)
  assert.doesNotMatch(modPage(dir, 'example--mods--mod-1'), /noindex/)
  assert.match(modPage(dir, 'example--mods--mod-0'), /<a href="\/mods\/example--mods--mod-1\/">mod-1<\/a>/, 'pages link to other mods from the same repository')
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'data/pages.json'), 'utf8'))).length, 5)
  assert.ok(existsSync(join(dir, 'docs/404.html')) && existsSync(join(dir, 'docs/site.css')))
  for (const i of [0, 1, 4]) assert.match(modPage(dir, `example--mods--mod-${i}`), /<a href="\/access\/">What a mod can access and how the scan works<\/a>/)
  assert.match(home, /<a class="text-link" href="access\/">What can a mod access\?/)
  assert.match(readFileSync(join(dir, 'docs/llms.txt'), 'utf8'), /\]\(https:\/\/mods\.aidojo\.si\/access\/\)/)
  const access = readFileSync(join(dir, 'docs/access/index.html'), 'utf8')
  render(dir)
  assert.equal(readFileSync(join(dir, 'docs/access/index.html'), 'utf8'), access, 'a second render changes nothing')
})

test('a rescan that only moves stars and dates leaves every page and the registry untouched', t => {
  const dir = fixture(t, [mod(0), mod(1), mod(2, 'passed', 'builtin')])
  render(dir)
  const pages = tree(join(dir, 'docs/mods')), registry = readFileSync(join(dir, 'data/pages.json'), 'utf8'), sitemap = readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8')
  render(dir)
  assert.deepEqual(tree(join(dir, 'docs/mods')), pages)
  const data = JSON.parse(readFileSync(join(dir, 'data/mods.json'), 'utf8'))
  data.generated = '2026-03-03T00:00:00Z'
  data.mods = data.mods.reverse().map(m => ({ ...m, stars: m.stars + 1000, pushedAt: '2026-03-02T00:00:00Z' }))
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data))
  render(dir)
  assert.deepEqual(tree(join(dir, 'docs/mods')), pages)
  assert.equal(readFileSync(join(dir, 'data/pages.json'), 'utf8'), registry)
  assert.equal(readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8'), sitemap)
})

test('retired mods lose their page, renamed ones leave a redirect, and their paths stay reserved', t => {
  const dir = fixture(t, [mod(0), mod(1), mod(2)])
  render(dir)
  mkdirSync(join(dir, 'docs/mods/stray-folder'))
  const data = JSON.parse(readFileSync(join(dir, 'data/mods.json'), 'utf8'))
  const renamed = { ...mod(2), id: 'example/renamed:plugins/mod-2', repo: 'example/renamed' }
  data.mods = [mod(0), renamed, { ...mod(2), kind: 'duplicate', duplicateOf: renamed.id }]
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data))
  render(dir)
  assert.equal(existsSync(join(dir, 'docs/mods/example--mods--mod-1')), false)
  assert.equal(existsSync(join(dir, 'docs/mods/stray-folder')), false)
  assert.match(modPage(dir, 'example--mods--mod-2'), /url=\/mods\/example--renamed--mod-2\//)
  assert.match(modPage(dir, 'example--renamed--mod-2'), /<h1>mod-2<\/h1>/)
  const registry = JSON.parse(readFileSync(join(dir, 'data/pages.json'), 'utf8'))
  assert.equal(registry['example--mods--mod-1'].id, 'example/mods:plugins/mod-1')
  assert.equal(registry['example--mods--mod-2'].to, 'example--renamed--mod-2')
  assert.doesNotMatch(readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8'), /mod-1\/|example--mods--mod-2/)
  data.mods = [mod(0), renamed]
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data))
  render(dir)
  assert.match(modPage(dir, 'example--mods--mod-2'), /url=\/mods\/example--renamed--mod-2\//, 'the redirect survives retirement of the old record')
})

test('mod pages and the access page load every asset over HTTP, fit a phone, need no script, and removed mods get a 404', async t => {
  const hostile = { ...mod(1), name: 'x<b>bold</b>', description: 'Closes </script> early & "quotes" stay text.' }
  const dir = fixture(t, [mod(0), hostile])
  render(dir)
  cpSync(fileURLToPath(new URL('../docs/fonts', import.meta.url)), join(dir, 'docs/fonts'), { recursive: true })
  cpSync(fileURLToPath(new URL('../docs/favicon.svg', import.meta.url)), join(dir, 'docs/favicon.svg'))
  const slug = Object.entries(JSON.parse(readFileSync(join(dir, 'data/pages.json'), 'utf8'))).find(([, entry]) => entry.id === hostile.id)[0]
  const base = serve(t, join(dir, 'docs'))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  for (const { width, colorScheme } of [{ width: 390, colorScheme: 'light' }, { width: 1440, colorScheme: 'dark' }]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, javaScriptEnabled: false })
    const failed = []
    page.on('requestfailed', request => failed.push(request.url()))
    page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`) })
    await page.goto(`${base}/access/`)
    await page.waitForLoadState('networkidle')
    assert.equal(await page.locator('h1').innerText(), 'What can a Claude Code mod access?')
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://mods.aidojo.si/access/')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.goto(`${base}/mods/${slug}/`)
    await page.waitForLoadState('networkidle')
    assert.deepEqual(failed, [])
    assert.equal(await page.locator('h1').innerText(), 'x<b>bold</b>')
    assert.equal(await page.locator('.lede').innerText(), hostile.description)
    assert.equal(await page.evaluate(() => document.fonts.check('16px "Hanken Grotesk"')), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)')
    await page.close()
  }
  const gone = await browser.newPage()
  const response = await gone.goto(`${base}/mods/example--mods--retired/`)
  assert.equal(response.status(), 404)
  assert.equal(await gone.locator('h1').innerText(), 'No page here.')
  assert.equal(await gone.locator('form[action="/"] input[name="q"]').count(), 1)
})

test('the homepage carries the first rows, loads the rest, and keeps deep links and search working', async t => {
  const many = Array.from({ length: 130 }, (_, i) => ({ ...mod(i), stars: 1000 - i }))
  const dir = fixture(t, many)
  render(dir)
  const home = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  assert.equal(home.match(/<tr id="example--mods--mod-/g).length, 100, 'the page ships the 100 most-starred rows')
  assert.doesNotMatch(home, /class="seg /, 'the access strip comes from the directory parts')
  assert.match(home, /data-parts="1"/)
  const directory = JSON.parse(readFileSync(join(dir, 'docs/directory/1.json'), 'utf8'))
  assert.equal(directory.rows.length, 130)
  assert.match(directory.strip, /class="seg l/)
  const base = serve(t, join(dir, 'docs'))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(`${base}/#example--mods--mod-129`)
  await page.waitForSelector('#t[data-loaded]')
  assert.equal(await page.locator('#t tbody tr').count(), 130)
  assert.equal(await page.evaluate(() => document.activeElement.closest('tr')?.id), 'example--mods--mod-129', 'a link to a row beyond the first 100 still lands on it')
  assert.equal(await page.locator('.seg').count(), 130)
  await page.fill('#q', 'mod-12')
  assert.equal(await page.locator('#n').textContent(), '11 of 130 mods')
  rmSync(join(dir, 'docs/directory'), { recursive: true })
  const offline = await browser.newPage()
  await offline.goto(`${base}/`)
  await offline.waitForSelector('#t[data-loaded]')
  assert.equal(await offline.locator('#load-note').isVisible(), true, 'a failed load says so and points to the A to Z pages')
  assert.equal(await offline.locator('#t tbody tr').count(), 100)
  const noScript = await browser.newPage({ javaScriptEnabled: false })
  await noScript.goto(`${base}/`)
  assert.equal(await noScript.locator('.browse a[href="/browse/m/"]').count(), 1)
})

test('A to Z pages link every mod page without stars, and a star-only rescan leaves them untouched', async t => {
  const hostile = { ...mod(2), name: '<b>x</b>', description: 'Closes </li> & "quotes".' }
  const dir = fixture(t, [mod(0), mod(1, 'unknown'), hostile, { ...mod(3), name: '9lives' }, mod(4, 'passed', 'builtin')])
  render(dir)
  assert.deepEqual(readdirSync(join(dir, 'docs/browse')).sort(), ['0-9', 'm', 'other'])
  const m = readFileSync(join(dir, 'docs/browse/m/index.html'), 'utf8')
  for (const i of [0, 1, 4]) assert.match(m, new RegExp(`<a href="/mods/example--mods--mod-${i}/">mod-${i}</a>`))
  assert.match(m, /<link rel="canonical" href="https:\/\/mods\.aidojo\.si\/browse\/m\/">/)
  assert.match(m, /built into Claude Code/)
  const other = readFileSync(join(dir, 'docs/browse/other/index.html'), 'utf8')
  assert.ok(other.includes('&lt;b&gt;x&lt;/b&gt;') && other.includes('Closes &lt;/li&gt; &amp; &quot;quotes&quot;.'))
  assert.doesNotMatch(m, /stars|★/i)
  const before = tree(join(dir, 'docs/browse'))
  const data = JSON.parse(readFileSync(join(dir, 'data/mods.json'), 'utf8'))
  data.mods = data.mods.reverse().map(x => ({ ...x, stars: x.stars + 1000, pushedAt: '2026-03-02T00:00:00Z' }))
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data))
  render(dir)
  assert.deepEqual(tree(join(dir, 'docs/browse')), before)
  data.mods = data.mods.filter(x => x.name !== '9lives')
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data))
  render(dir)
  assert.equal(existsSync(join(dir, 'docs/browse/0-9')), false, 'an emptied letter loses its page')
  cpSync(fileURLToPath(new URL('../docs/fonts', import.meta.url)), join(dir, 'docs/fonts'), { recursive: true })
  cpSync(fileURLToPath(new URL('../docs/favicon.svg', import.meta.url)), join(dir, 'docs/favicon.svg'))
  const base = serve(t, join(dir, 'docs'))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, javaScriptEnabled: false })
  const failed = []
  page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`) })
  await page.goto(`${base}/browse/m/`)
  await page.waitForLoadState('networkidle')
  assert.deepEqual(failed, [])
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await page.locator('.browse a').first().isVisible(), true, 'the first letter stays visible on a phone')
})

test('render refuses a homepage over the page ceiling', t => {
  const heavy = Array.from({ length: 100 }, (_, i) => ({ ...mod(i), description: 'x'.repeat(11000) }))
  const dir = fixture(t, heavy)
  assert.throws(() => render(dir), /docs\/index\.html is \d+ bytes, over the 1000000 byte page ceiling/)
})

test('searching, sorting and focus made while the full list loads survive it', async t => {
  const many = Array.from({ length: 130 }, (_, i) => ({ ...mod(i), stars: 1000 - i }))
  const dir = fixture(t, many)
  render(dir)
  let release
  const base = serve(t, join(dir, 'docs'), { hold: new Promise(resolve => { release = resolve }) })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(`${base}/?q=mod-1`)
  assert.equal(await page.locator('#n').textContent(), '11 of the first 100 mods, loading the rest', 'a URL search applies at once and says it is partial')
  await page.fill('#q', 'mod-129')
  assert.equal(await page.locator('#n').textContent(), '0 of the first 100 mods, loading the rest')
  assert.equal(await page.locator('#empty').isVisible(), false, 'no empty result is claimed before the list loads')
  await page.fill('#q', 'mod-12')
  await page.locator('#t th button[data-k="name"]').click()
  await page.locator('#example--mods--mod-12 .mod-name').focus()
  assert.equal(await page.evaluate(() => document.activeElement.closest('tr')?.id), 'example--mods--mod-12')
  release()
  await page.waitForSelector('#t[data-loaded]')
  assert.equal(await page.inputValue('#q'), 'mod-12', 'the URL search does not replace what was typed')
  assert.equal(await page.locator('#n').textContent(), '11 of 130 mods')
  assert.equal(await page.locator('#t th[aria-sort]').getAttribute('aria-sort'), 'ascending')
  const names = await page.locator('#t tbody tr').evaluateAll(rows => rows.map(row => row.dataset.name))
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'the chosen sort is applied to the loaded rows')
  assert.equal(await page.evaluate(() => document.activeElement.closest('tr')?.id), 'example--mods--mod-12', 'focus stays on the same row')
})

test('the homepage links only letters that have a page, and unusual initials fall under other', t => {
  const zulu = { ...mod(1, 'unknown'), name: 'zulu', id: 'example/mods:plugins/zulu', path: 'plugins/zulu' }
  const dir = fixture(t, [mod(0), zulu, { ...mod(2), name: 'İstanbul' }])
  writeFileSync(join(dir, 'data/pages.json'), JSON.stringify({ 'example--mods--zulu': { id: zulu.id, to: 'example--mods--mod-0' } }))
  render(dir)
  assert.match(modPage(dir, 'example--mods--zulu'), /url=\/mods\/example--mods--mod-0\//, 'the retained record redirects')
  assert.deepEqual(readdirSync(join(dir, 'docs/browse')).sort(), ['m', 'other'])
  const home = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  assert.deepEqual([...home.matchAll(/href="\/browse\/([^/]+)\/"/g)].map(m => m[1]), ['m', 'other'])
  assert.match(readFileSync(join(dir, 'docs/browse/other/index.html'), 'utf8'), />İstanbul</)
})

test('a hash arrival does not undo what the reader did while the list loaded, and focus keeps its exact link', async t => {
  const many = Array.from({ length: 130 }, (_, i) => ({ ...mod(i), stars: 1000 - i }))
  const dir = fixture(t, many)
  render(dir)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  let release
  const page = await browser.newPage()
  await page.goto(`${serve(t, join(dir, 'docs'), { hold: new Promise(resolve => { release = resolve }) })}/#example--mods--mod-129`)
  await page.fill('#q', 'mod-7')
  release()
  await page.waitForSelector('#t[data-loaded]')
  assert.equal(await page.inputValue('#q'), 'mod-7', 'the pending jump to the hash row does not clear the search')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'q', 'focus stays in the search box')
  let releaseSecond
  const second = await browser.newPage()
  await second.goto(`${serve(t, join(dir, 'docs'), { hold: new Promise(resolve => { releaseSecond = resolve }) })}/`)
  await second.locator('#example--mods--mod-5 .repo').focus()
  releaseSecond()
  await second.waitForSelector('#t[data-loaded]')
  assert.equal(await second.evaluate(() => document.activeElement.classList.contains('repo') && document.activeElement.closest('tr').id), 'example--mods--mod-5', 'the repository link keeps focus, not the mod name')
})

test('section and built-in arrivals land after the full list loads, and a failed load explains itself', async t => {
  const many = [...Array.from({ length: 130 }, (_, i) => ({ ...mod(i), stars: 1000 - i })), { ...mod(131, 'passed', 'builtin'), name: 'builtin-one' }]
  const dir = fixture(t, many)
  render(dir)
  const base = serve(t, join(dir, 'docs'))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const builtin = readFileSync(join(dir, 'docs/index.html'), 'utf8').match(/<details class="builtins"[\s\S]*?<tr id="([^"]+)"/)[1]
  let page
  for (const [hash, check] of [['about', '#about'], [builtin, `[id="${builtin}"]`]]) {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(`${base}/#${hash}`)
    await page.waitForSelector('#t[data-loaded]')
    const { top, bottom } = await page.locator(check).evaluate(el => el.getBoundingClientRect().toJSON())
    assert.ok(top >= 0 && bottom <= 900, `${hash} is in view after the list loads`)
  }
  assert.equal(await page.locator('#built-in-mods').evaluate(el => el.open), true, 'a built-in arrival opens its section')
  rmSync(join(dir, 'docs/directory'), { recursive: true })
  const failed = await browser.newPage()
  await failed.goto(`${base}/?q=mod-129`)
  await failed.waitForSelector('#t[data-loaded]')
  assert.equal(await failed.locator('#n').textContent(), '0 of 100 mods', 'counts cover the rows that loaded')
  assert.match(await failed.locator('#empty').innerText(), /The full list did not load/)
  assert.equal(await failed.locator('#strip-note').isVisible(), true)
  assert.match(readFileSync(join(dir, 'docs/index.html'), 'utf8'), /<noscript><p class="notice">The marks need JavaScript\./)
})

test('a hash navigation made while the list loads lands after an earlier search, and large lists load in parts under the ceiling', async t => {
  const many = Array.from({ length: 130 }, (_, i) => ({ ...mod(i), stars: 1000 - i, description: `Example mod ${i} ${'x'.repeat(4000)}` }))
  const dir = fixture(t, many)
  render(dir)
  const parts = readdirSync(join(dir, 'docs/directory')).sort()
  assert.ok(parts.length > 1, 'a large list is split into parts')
  for (const part of parts) assert.ok(readFileSync(join(dir, 'docs/directory', part)).length <= 1_000_000, `${part} stays under the ceiling`)
  assert.equal(parts.flatMap(part => JSON.parse(readFileSync(join(dir, 'docs/directory', part), 'utf8')).rows).length, 130)
  let release
  const base = serve(t, join(dir, 'docs'), { hold: new Promise(resolve => { release = resolve }) })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(`${base}/`)
  await page.fill('#q', 'mod-12')
  await page.evaluate(() => { location.hash = 'example--mods--mod-129' })
  release()
  await page.waitForSelector('#t[data-loaded]')
  assert.equal(await page.locator('#t tbody tr').count(), 130)
  assert.equal(await page.locator('.seg').count(), 130)
  assert.equal(await page.evaluate(() => document.activeElement.closest('tr')?.id), 'example--mods--mod-129', 'the later hash navigation wins over the earlier search')
})

test('parts from another publication are refused, and section links and newer hashes win over restored focus', async t => {
  const many = Array.from({ length: 130 }, (_, i) => ({ ...mod(i), stars: 1000 - i }))
  const dir = fixture(t, many)
  render(dir)
  const stale = readFileSync(join(dir, 'docs/directory/1.json'), 'utf8')
  const data = JSON.parse(readFileSync(join(dir, 'data/mods.json'), 'utf8'))
  data.mods.push({ ...mod(200), stars: 1 })
  writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data))
  render(dir)
  assert.notEqual(readFileSync(join(dir, 'docs/directory/1.json'), 'utf8'), stale)
  writeFileSync(join(dir, 'docs/directory/1.json'), stale)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const mixed = await browser.newPage()
  await mixed.goto(`${serve(t, join(dir, 'docs'))}/`)
  await mixed.waitForSelector('#t[data-loaded]')
  assert.equal(await mixed.locator('#load-note').isVisible(), true, 'a part from an older publication is not mixed in')
  assert.equal(await mixed.locator('#t tbody tr').count(), 100)
  render(dir)
  let release
  const section = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await section.goto(`${serve(t, join(dir, 'docs'), { hold: new Promise(resolve => { release = resolve }) })}/#example--mods--mod-129`)
  await section.locator('nav a[href="#about"]').click()
  release()
  await section.waitForSelector('#t[data-loaded]')
  assert.equal(await section.evaluate(() => document.activeElement.closest('#about') !== null), true, 'a section link clicked while loading supersedes the mod hash')
  const { top } = await section.locator('#about').evaluate(el => el.getBoundingClientRect().toJSON())
  assert.ok(top >= 0 && top < 900)
  let releaseFocus
  const focus = await browser.newPage()
  await focus.goto(`${serve(t, join(dir, 'docs'), { hold: new Promise(resolve => { releaseFocus = resolve }) })}/`)
  await focus.locator('#example--mods--mod-5 .repo').focus()
  await focus.evaluate(() => { location.hash = 'example--mods--mod-129' })
  releaseFocus()
  await focus.waitForSelector('#t[data-loaded]')
  assert.equal(await focus.evaluate(() => document.activeElement.closest('tr')?.id), 'example--mods--mod-129', 'a newer hash navigation wins over restoring older focus')
})

const TOPIC = { slug: 'prompt-cache', title: 'Prompt cache mods for Claude Code', short: 'Prompt cache', description: 'Cache mods.', patterns: ['cache'], include: [], exclude: [], related: [] }
const withTopics = (dir, topics = [TOPIC]) => writeFileSync(join(dir, 'data/topics.json'), JSON.stringify(topics))
const topicPage = dir => readFileSync(join(dir, 'docs/topics/prompt-cache/index.html'), 'utf8')

test('topic pages list their members, are linked from the homepage, A to Z pages, llms.txt and member pages, and leave when their slug does', t => {
  const member = { ...mod(1), description: 'Shows the cache timer.' }
  const failed = { ...mod(5, 'failed'), description: 'A cache guard.' }
  const retained = { ...mod(2, 'unknown'), description: 'cache' }
  const blank = { ...mod(3), description: '' }
  const dir = fixture(t, [mod(0), member, retained, blank, mod(4, 'passed', 'builtin'), failed])
  withTopics(dir)
  render(dir)
  const page = topicPage(dir)
  assert.match(page, /<a class="name" href="\/mods\/example--mods--mod-1\/">mod-1<\/a>/)
  assert.match(page, /<a class="name" href="\/mods\/example--mods--mod-5\/">mod-5<\/a>[\s\S]*Fails validation on Claude Code 2\.1\.287\./)
  assert.doesNotMatch(page, /mod-0<\/a>|mod-2<\/a>|mod-3<\/a>|mod-4<\/a>|noindex/)
  assert.match(page, /<p class="lede">2 mods that show/)
  const home = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  assert.match(home, /<div class="browse topics" role="navigation" aria-label="Browse mods by topic"><span>Browse by topic<\/span><a href="\/topics\/prompt-cache\/">Prompt cache<\/a><\/div>/)
  assert.match(readFileSync(join(dir, 'docs/browse/m/index.html'), 'utf8'), /<a href="\/topics\/prompt-cache\/">Prompt cache<\/a>/)
  assert.match(readFileSync(join(dir, 'docs/llms.txt'), 'utf8'), /## Topics\n\n- \[Prompt cache mods for Claude Code\]\(https:\/\/mods\.aidojo\.si\/topics\/prompt-cache\/\): 2 mods that show the cache timer, keep it warm or warn before a cold send\.\n/)
  const sitemap = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace('https://mods.aidojo.si/', '/'))
  assert.deepEqual(sitemap(readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8')), ['/', '/access/', '/topics/prompt-cache/', '/browse/m/', '/mods/example--mods--mod-0/', '/mods/example--mods--mod-1/', '/mods/example--mods--mod-4/', '/mods/example--mods--mod-5/'])
  for (const i of [1, 5]) assert.match(modPage(dir, `example--mods--mod-${i}`), /<p class="topics-line">Listed under <a href="\/topics\/prompt-cache\/">Prompt cache mods for Claude Code<\/a>\.<\/p>/)
  for (const i of [0, 2, 3, 4]) assert.doesNotMatch(modPage(dir, `example--mods--mod-${i}`), /topics-line/)
  const pages = tree(join(dir, 'docs/mods'))
  render(dir)
  assert.equal(topicPage(dir), page, 'a second render changes nothing')
  assert.deepEqual(tree(join(dir, 'docs/mods')), pages)
  withTopics(dir, [{ ...TOPIC, patterns: ['no such word'] }])
  render(dir)
  assert.match(topicPage(dir), /<meta name="robots" content="noindex">[\s\S]*No mods in this topic in the latest scan\./)
  assert.doesNotMatch(readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8'), /topics/)
  assert.doesNotMatch(readFileSync(join(dir, 'docs/index.html'), 'utf8') + readFileSync(join(dir, 'docs/llms.txt'), 'utf8') + readFileSync(join(dir, 'docs/browse/m/index.html'), 'utf8'), /topics/)
  assert.doesNotMatch(modPage(dir, 'example--mods--mod-1'), /topics-line/)
  withTopics(dir, [{ ...TOPIC, exclude: ['Example/mods:plugins/mod-1', 'gone/repo:.'] }])
  const output = execFileSync(process.execPath, [renderer], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.doesNotMatch(topicPage(dir), /mod-1<\/a>/, 'an excluded id leaves the page, whatever the repository case')
  assert.match(topicPage(dir), /mod-5<\/a>/)
  assert.ok(output.includes('rendered '), 'a stale id does not stop the render')
  rmSync(join(dir, 'data/topics.json'))
  render(dir)
  assert.equal(existsSync(join(dir, 'docs/topics/prompt-cache')), false, 'a slug that left the file loses its folder')
  assert.doesNotMatch(readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8'), /topics/)
})

test('a rescan inside the star groups changes no topic page, a crossing changes only the topic page, and a description edit changes the pages that repeat it', t => {
  const m = (i, repo, stars, description) => ({ ...mod(i), id: `${repo}:plugins/mod-${i}`, repo, stars, description })
  const mods = [m(1, 'example/mods', 8, 'cache a'), m(2, 'example/mods', 8, 'cache b'), m(3, 'example/mods', 8, 'cache c'), m(4, 'other/repo', 50, 'cache d'), m(5, 'other/repo', 50, 'plain'), { ...m(6, 'z/z', 1, 'plain'), name: 'zeta' }]
  const dir = fixture(t, mods)
  withTopics(dir)
  render(dir)
  const snapshot = () => ({ topics: tree(join(dir, 'docs/topics')), mods: tree(join(dir, 'docs/mods')), browse: tree(join(dir, 'docs/browse')), registry: readFileSync(join(dir, 'data/pages.json'), 'utf8'), sitemap: readFileSync(join(dir, 'docs/sitemap.xml'), 'utf8') })
  const baseline = snapshot()
  assert.match(baseline.topics['prompt-cache'], /Repositories with 10 to 99 stars[\s\S]*mod-4<\/a>[\s\S]*Repositories with under 10 stars[\s\S]*mod-1<\/a>[\s\S]*mod-2<\/a>[\s\S]*mod-3<\/a>/)
  const data = JSON.parse(readFileSync(join(dir, 'data/mods.json'), 'utf8'))
  const write = mods => { data.mods = mods; data.generated = '2026-03-03T00:00:00Z'; writeFileSync(join(dir, 'data/mods.json'), JSON.stringify(data)) }
  write(data.mods.reverse().map(x => ({ ...x, stars: x.stars + 1, pushedAt: '2026-03-02T00:00:00Z' })))
  render(dir)
  assert.deepEqual(snapshot(), baseline, 'one star more inside every group and a new push date change nothing')
  write(data.mods.map(x => x.repo === 'example/mods' ? { ...x, stars: 10 } : x))
  render(dir)
  const crossed = snapshot()
  assert.deepEqual({ ...crossed, topics: null }, { ...baseline, topics: null }, 'a crossing changes no mod page, A to Z page, registry entry or sitemap line')
  assert.notEqual(crossed.topics['prompt-cache'], baseline.topics['prompt-cache'])
  const middle = crossed.topics['prompt-cache'].split('Repositories with 10 to 99 stars')[1]
  for (const i of [1, 2, 3, 4]) assert.ok(middle.includes(`mod-${i}</a>`), `mod-${i} is in the middle group`)
  assert.doesNotMatch(crossed.topics['prompt-cache'], /Repositories with under 10 stars/)
  write(data.mods.map(x => x.name === 'mod-1' ? { ...x, description: 'cache a, edited' } : x))
  render(dir)
  const edited = snapshot()
  const changed = Object.keys(crossed.mods).filter(path => crossed.mods[path] !== edited.mods[path])
  assert.deepEqual(changed.sort(), ['example--mods--mod-1', 'example--mods--mod-2', 'example--mods--mod-3'], 'the member and the pages that repeat its description')
  assert.deepEqual(Object.keys(crossed.browse).filter(path => crossed.browse[path] !== edited.browse[path]), ['m'])
  assert.notEqual(edited.topics['prompt-cache'], crossed.topics['prompt-cache'])
  assert.equal(edited.registry, crossed.registry)
  assert.equal(edited.sitemap, crossed.sitemap)
})

test('render refuses a topic page over the page ceiling', t => {
  const heavy = Array.from({ length: 2500 }, (_, i) => ({ ...mod(i), id: `example/mods:plugins/mod-${i}`, path: `plugins/mod-${i}`, description: `cache ${'x'.repeat(400)}`, marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'mods', status: 'passed', errors: [] }] }))
  const dir = fixture(t, heavy)
  withTopics(dir)
  assert.throws(() => render(dir), /docs\/topics\/prompt-cache\/index\.html is \d+ bytes, over the 1000000 byte page ceiling/)
})

test('the topic page loads every asset over HTTP, fits a phone and needs no script', async t => {
  const hostile = { ...mod(2), name: '<b>x</b>', description: 'cache </li> & "quotes".' }
  const dir = fixture(t, [mod(0), { ...mod(1), description: 'cache timer' }, hostile])
  withTopics(dir)
  render(dir)
  cpSync(fileURLToPath(new URL('../docs/fonts', import.meta.url)), join(dir, 'docs/fonts'), { recursive: true })
  cpSync(fileURLToPath(new URL('../docs/favicon.svg', import.meta.url)), join(dir, 'docs/favicon.svg'))
  const base = serve(t, join(dir, 'docs'))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  for (const { width, colorScheme } of [{ width: 390, colorScheme: 'light' }, { width: 1440, colorScheme: 'dark' }]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, javaScriptEnabled: false })
    const failed = []
    page.on('requestfailed', request => failed.push(request.url()))
    page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`) })
    await page.goto(`${base}/topics/prompt-cache/`)
    await page.waitForLoadState('networkidle')
    assert.deepEqual(failed, [])
    assert.equal(await page.locator('h1').innerText(), 'Prompt cache mods for Claude Code')
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://mods.aidojo.si/topics/prompt-cache/')
    assert.equal(await page.locator('.topic-list .name').nth(0).innerText(), '<b>x</b>')
    assert.equal(await page.locator('.topic-list .what').nth(0).innerText(), 'cache </li> & "quotes".')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => document.fonts.check('16px "Hanken Grotesk"')), true)
    assert.equal(await page.locator('.browse.topics b').isVisible(), true)
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)')
    await page.close()
  }
})
