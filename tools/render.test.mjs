import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const renderer = fileURLToPath(new URL('./render.mjs', import.meta.url))
const mod = (i, status = 'passed', kind = 'mod') => ({
  repo: 'example/mods', path: `plugins/mod-${i}`, name: `mod-${i}`, kind,
  description: `Example mod ${i}`, url: 'https://example.com', stars: i,
  reach: { level: i % 4, labels: [] }, sees: [], hooks: [], calls: [], surfaceModules: [],
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
  assert.match(page, /Plugin name is reserved/)
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

test('compatibility warnings stay distinct from validation failures and link to scanned source', async t => {
  const reviewed = {
    ...mod(0), sourceCommit: 'a'.repeat(40),
    marketplaces: [{ path: '.claude-plugin/marketplace.json', name: '<market>', status: 'failed', errors: ['name: reserved <name>'] }],
    compatibility: { runtime: 'not-tested', warnings: [{ message: 'Review <text> control strings.', evidence: [{ file: 'plugins/mod-0/hooks/colour.ts', line: 12 }] }] },
  }
  const dir = fixture(t, [reviewed, { ...mod(1), marketplaces: [{ path: '.claude-plugin/marketplace.json', name: 'unknown', status: 'unknown', errors: [] }] }])
  render(dir)
  const page = readFileSync(join(dir, 'docs/index.html'), 'utf8')
  const catalogue = readFileSync(join(dir, 'catalogue.md'), 'utf8')
  assert.match(catalogue, /2\.1\.287; marketplace fails; review UI rewrite/)
  assert.match(catalogue, /marketplace not verified/)
  assert.doesNotMatch(catalogue, /fails on 2\.1\.287/)
  assert.match(page, /&lt;market&gt;/)
  assert.match(page, /Review &lt;text&gt; control strings/)
  assert.match(page, new RegExp(`blob/${'a'.repeat(40)}/plugins/mod-0/hooks/colour.ts#L12`))
  assert.match(page, /does not prove those strings reach a text rewrite/)
  assert.match(readFileSync(join(dir, 'badges/example--mods--mod-0-validates.svg'), 'utf8'), /#c96442/)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const tab = await browser.newPage()
  await tab.route('https://**/*', route => route.abort())
  await tab.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
  const row = tab.locator('#example--mods--mod-0')
  for (const width of [390, 1440]) {
    await tab.setViewportSize({ width, height: 900 })
    assert.equal(await row.locator('.compatibility').isVisible(), true)
    assert.match(await row.locator('.compatibility').innerText(), /marketplace fails; review UI rewrite/)
    assert.equal(await row.locator('.bad').count(), 0)
  }
  await row.locator('summary').click()
  const source = row.getByRole('link', { name: 'plugins/mod-0/hooks/colour.ts:12' })
  assert.equal(await source.isVisible(), true)
  assert.equal(await source.getAttribute('href'), `https://github.com/example/mods/blob/${'a'.repeat(40)}/plugins/mod-0/hooks/colour.ts#L12`)
  assert.match(await row.locator('dl').innerText(), /Marketplace failed/)
  assert.match(await row.locator('dl').innerText(), /Validation on 2.1.287\nPassed/)
})

test('scoreboard stays within desktop and mobile viewports as the scan grows', async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://**/*', route => route.abort())
  for (const count of [72, 364, 1000]) {
    const dir = fixture(t, Array.from({ length: count }, (_, i) => ({ ...mod(i), compatibility: { warnings: [{ message: 'Review control strings in UI source.', evidence: [{ file: 'hooks/colour.ts', line: 12 }] }] } })))
    render(dir)
    await page.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
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
  await page.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
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
    await page.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
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
    await page.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
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
  await page.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
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
  await page.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
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
  await page.goto(pathToFileURL(join(dir, 'docs/index.html')).href)

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
  assert.match(page, /<title>Awesome Claude Code Mods \| 4 Claude Code mods, scanned<\/title>/)
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
  assert.match(llms, /^# Awesome Claude Code Mods\n\n> A community list of 4 Claude Code mods/)
  assert.match(llms, /Last scanned 2026-01-01 on Claude Code 2\.1\.287/)
  assert.match(llms, /L3 Uses the network: 1\./)
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
  await tab.goto(pathToFileURL(join(dir, 'docs/index.html')).href)
  await tab.click('.listed-filter')
  assert.equal(await tab.locator('#t tbody tr:not([hidden])').count(), 1)
  assert.equal(await tab.locator('.listed-filter').getAttribute('aria-pressed'), 'true')
  await tab.click('#reset')
  assert.equal(await tab.locator('#t tbody tr:not([hidden])').count(), 2)
})
