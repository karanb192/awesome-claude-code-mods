import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendSeeds, pendingSeeds, planPublication, reviewSeed } from './seed-publication.mjs'

const mod = (repo, name = 'mod', extra = {}) => ({
  id: `${repo}:${name}`, repo, name, kind: 'mod', sourceCommit: 'a'.repeat(40),
  validate: { status: 'passed', claudeVersion: '2.1.287', errors: [] },
  marketplaces: [], compatibility: { warnings: [] }, ...extra,
})
const inventory = mods => ({ generated: '2026-01-01T00:00:00Z', claudeVersion: '2.1.287', repos: 1, mods, checkedRepos: [...new Set(mods.map(m => m.repo.toLowerCase()))] })
const before = () => inventory([mod('existing/repo')])
const scan = () => inventory([mod('new/repo', 'one'), mod('new/repo', 'two')])
const append = (current = scan(), prior = before(), duplicates) => appendSeeds(prior, current, ['new/repo'], ['existing/repo'], duplicates)
const skippedFor = (result, pattern) => {
  assert.equal(result.inventory, null)
  assert.deepEqual(result.published, [])
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, pattern)
}

test('pending seeds include all unpublished approvals, not only the latest push', () => {
  assert.deepEqual(pendingSeeds(['Existing/Repo', 'new/repo', 'earlier/repo', 'NEW/repo'], before()), ['earlier/repo', 'new/repo'])
  assert.deepEqual(pendingSeeds(['EXISTING/repo'], before()), [])
})

test('publishing all mods from a seed preserves every existing record and full-scan metadata', () => {
  const prior = before(), original = structuredClone(prior)
  const result = append(scan(), prior)
  assert.deepEqual(result.inventory.mods, [...prior.mods, ...scan().mods])
  assert.equal(result.inventory.generated, prior.generated)
  assert.equal(result.inventory.claudeVersion, prior.claudeVersion)
  assert.equal(result.inventory.repos, 2)
  assert.deepEqual(result.repos, ['existing/repo', 'new/repo'])
  assert.deepEqual(prior, original)
  assert.deepEqual(pendingSeeds(['new/repo'], result.inventory), [])
})

test('a retry cannot replace entries already published by a concurrent scan', () => {
  const prior = append().inventory
  assert.throws(() => append(scan(), prior), /already published/)
  assert.throws(() => appendSeeds(before(), scan(), [], []), /No unpublished seeds/)
})

test('an inconsistent scan stops the whole run', () => {
  assert.throws(() => append(inventory([mod('unapproved/repo')])), /Unapproved repository/)
  assert.throws(() => append(inventory([mod('new/repo', 'same'), mod('new/repo', 'same')])), /Duplicate plugin ID/)
  assert.throws(() => append({ ...scan(), claudeVersion: '2.1.288' }), /published validator version/)
})

test('failed, unknown, marketplace and compatibility results keep that seed unpublished', () => {
  for (const status of ['failed', 'unknown']) {
    skippedFor(append(inventory([mod('new/repo', 'x', { validate: { status, claudeVersion: '2.1.287' } })])), /validation needs review/)
    skippedFor(append(inventory([mod('new/repo', 'x', { marketplaces: [{ status }] })])), /marketplace needs review/)
  }
  skippedFor(append(inventory([mod('new/repo', 'x', { compatibility: { warnings: ['review'] } })])), /compatibility needs review/)
  skippedFor(append(inventory([])), /no validating mod plugins/)
  skippedFor(append(inventory([mod('new/repo', 'probe', { kind: 'fixture' })])), /no validating mod plugins/)
  skippedFor(append(inventory([mod('new/repo', 'x', { id: 'existing/repo:mod' })])), /already published/)
  skippedFor(append(inventory([mod('new/repo', 'x', { validate: { status: 'passed', claudeVersion: '2.1.288' } })])), /validator mismatch/)
  assert.equal(reviewSeed(scan().mods, '2.1.287', new Set()), null)
  assert.match(reviewSeed([{ ...scan().mods[0], footprint: { status: 'unavailable' } }], '2.1.287', new Set()), /footprint unavailable/)
})

test('one failing seed does not hold back the others', () => {
  const current = inventory([...scan().mods, mod('bad/repo', 'x', { validate: { status: 'failed', claudeVersion: '2.1.287' } }), mod('gone/repo', 'probe', { kind: 'fixture' })])
  const result = appendSeeds(before(), current, ['new/repo', 'bad/repo', 'gone/repo', 'missing/repo'], ['existing/repo'])
  assert.deepEqual(result.published, ['new/repo'])
  assert.deepEqual(result.inventory.mods.map(m => m.repo), ['existing/repo', 'new/repo', 'new/repo'])
  assert.deepEqual(result.repos, ['existing/repo', 'new/repo'])
  assert.deepEqual(result.skipped.map(s => s.repo).sort(), ['bad/repo', 'gone/repo', 'missing/repo'])
  assert.deepEqual(pendingSeeds(['new/repo', 'bad/repo', 'gone/repo', 'missing/repo'], result.inventory), ['bad/repo', 'gone/repo', 'missing/repo'])
})

test('a reviewed compatibility warning publishes only its exact source and warning records', () => {
  const warning = { code: 'ui-control-characters', message: 'Review UI strings', evidence: [{ file: 'hooks/mod.js', line: 10 }] }
  const entry = mod('new/repo', 'one', { compatibility: { warnings: [warning] } })
  const review = { id: entry.id, sourceCommit: entry.sourceCommit, claudeVersion: '2.1.287', warnings: [warning], reason: 'Hash delimiter only' }
  const publish = (reviews, current = inventory([entry])) => planPublication(before(), current, ['new/repo'], ['new/repo'], ['existing/repo'], undefined, reviews)
  const original = structuredClone(entry)
  const accepted = publish([review])
  assert.deepEqual(accepted.published, ['new/repo'])
  assert.deepEqual(accepted.inventory.mods.at(-1), original)
  assert.deepEqual(entry, original)
  for (const change of [
    { id: 'new/repo:other' }, { sourceCommit: 'b'.repeat(40) }, { sourceCommit: '' },
    { claudeVersion: '2.1.288' }, { reason: ' ' }, { warnings: [] },
    { warnings: [{ ...warning, code: 'another-warning' }] },
    { warnings: [{ ...warning, message: 'Changed warning' }] },
    { warnings: [{ ...warning, evidence: [{ file: 'hooks/mod.js', line: 11 }] }] },
    { warnings: [warning, warning] },
  ]) skippedFor(publish([{ ...review, ...change }]), /compatibility needs review/)
  skippedFor(publish([]), /compatibility needs review/)
  skippedFor(publish([null, 0, 'invalid']), /compatibility needs review/)
  assert.deepEqual(publish([null, review]).published, ['new/repo'])
  skippedFor(publish([review], inventory([entry, mod('new/repo', 'two', { compatibility: entry.compatibility })])), /compatibility needs review/)
})

test('compatibility reviews cannot bypass validation, marketplace, inspection or duplicate holds', () => {
  const warning = { code: 'ui-control-characters', evidence: [{ file: 'hooks/mod.js', line: 10 }] }
  const entry = mod('existing/other', 'mod', { compatibility: { warnings: [warning] } })
  const review = { id: entry.id, sourceCommit: entry.sourceCommit, claudeVersion: '2.1.287', warnings: [warning], reason: 'Hash delimiter only' }
  const publish = current => appendSeeds(before(), current, ['existing/other'], ['existing/repo'], undefined, [review])
  skippedFor(publish(inventory([entry])), /possible duplicate/)
  for (const status of ['failed', 'unknown']) {
    skippedFor(publish(inventory([{ ...entry, validate: { ...entry.validate, status } }])), /validation needs review/)
    skippedFor(publish(inventory([{ ...entry, marketplaces: [{ status }] }])), /marketplace needs review/)
  }
  skippedFor(publish({ ...inventory([entry]), checkedRepos: [] }), /not fully inspected/)
})

test('warnings and fixtures are retained when the seed includes valid counted mods', () => {
  const current = inventory([mod('new/repo', 'real', { validate: { status: 'warnings', claudeVersion: '2.1.287' } }), mod('new/repo', 'probe', { kind: 'fixture' })])
  assert.equal(append(current).inventory.mods.length, 3)
})

test('publication requires evidence that each repository was fully inspected', () => {
  for (const checkedRepos of [undefined, []]) {
    skippedFor(append({ ...scan(), checkedRepos }), /not fully inspected/)
  }
})

test('a seed casing change during a scan cannot trap duplicate removal in a loop', () => {
  const module = new URL('./seed-publication.mjs', import.meta.url).href
  const probe = `
    import { planPublication } from ${JSON.stringify(module)};
    const mod = ${mod.toString()};
    const inventory = ${inventory.toString()};
    const result = planPublication(inventory([mod('same/one')]), inventory([mod('same/Three'), mod('other/repo')]), ['same/Three', 'other/repo'], ['same/three', 'other/repo'], []);
    console.log(JSON.stringify(result));
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 5000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const published = JSON.parse(result.stdout)
  assert.deepEqual(published.published, ['other/repo'])
  assert.equal(published.skipped.length, 1)
  assert.match(published.skipped[0].reason, /possible duplicate/)
})

test('scanner reports partial repositories so passing siblings can publish alone', t => {
  const root = mkdtempSync(join(tmpdir(), 'seed-inspection-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'data'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'data/seeds.txt'), 'owner/partial\nother/good\n')
  const binary = (name, code) => writeFileSync(join(root, 'bin', name), `#!${process.execPath}\n${code}`, { mode: 0o755 })
  binary('claude', `console.log(process.argv.includes('--version') ? '2.1.287' : '  ❯ mod.js hooks: nothing\\n  ❯ mod.js calls: nothing on $\\n✔ Validation passed')`)
  binary('gh', `console.log(JSON.stringify({stars: 0, defaultBranch: 'main'}))`)
  binary('git', `
    const fs = require('node:fs'), path = require('node:path');
    if (process.argv[2] === 'clone') {
      const dir = process.argv.at(-1);
      const plugins = process.argv.at(-2).endsWith('/partial') ? ['good', 'broken'] : ['good'];
      for (const name of plugins) {
        fs.mkdirSync(path.join(dir, name, 'hooks'), {recursive: true});
        fs.mkdirSync(path.join(dir, name, '.claude-plugin'), {recursive: true});
        fs.writeFileSync(path.join(dir, name, '.claude-plugin/plugin.json'), JSON.stringify({name}));
        fs.writeFileSync(path.join(dir, name, 'hooks/hooks.json'), name === 'broken' ? '{' : JSON.stringify({modules: ['mod.js']}));
      }
    } else console.log('a'.repeat(40));
  `)
  const env = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH }
  const script = fileURLToPath(new URL('./scan.mjs', import.meta.url))
  execFileSync(process.execPath, [script, '--repos', 'data/seeds.txt', '--include-checked', '--out', 'scan.json'], { cwd: root, env, stdio: 'pipe' })
  const scanned = JSON.parse(readFileSync(join(root, 'scan.json'), 'utf8'))
  assert.deepEqual(scanned.checkedRepos, ['other/good'])
  const result = appendSeeds(before(), scanned, ['owner/partial', 'other/good'], ['existing/repo'])
  assert.deepEqual(result.published, ['other/good'])
  assert.deepEqual(result.inventory.mods.map(m => m.repo), ['existing/repo', 'other/good'])
  assert.deepEqual(result.skipped.map(s => s.repo), ['owner/partial'])
  assert.match(result.skipped[0].reason, /not fully inspected/)
})

test('only duplicate suspicions involving new entries keep a seed unpublished', () => {
  const prior = inventory([mod('same/one'), mod('same/two')])
  assert.equal(append(scan(), prior).inventory.mods.length, 4)
  skippedFor(appendSeeds(prior, inventory([mod('same/three')]), ['same/three'], []), /possible duplicate/)
  const mixed = appendSeeds(prior, inventory([mod('same/three'), mod('new/repo')]), ['same/three', 'new/repo'], [])
  assert.deepEqual(mixed.published, ['new/repo'])
  assert.deepEqual(mixed.skipped.map(s => s.repo), ['same/three'])
  const duplicates = new Map([['same/three:mod', 'same/one:mod']])
  const result = appendSeeds(prior, inventory([mod('same/three')]), ['same/three'], [], duplicates)
  assert.equal(result.inventory.mods.at(-1).kind, 'duplicate')
})

test('a new seed cannot silently reclassify an existing mod as a duplicate', () => {
  const duplicates = new Map([['existing/repo:mod', 'new/repo:one']])
  skippedFor(append(scan(), before(), duplicates), /reclassifies existing\/repo:mod/)
  const result = appendSeeds(before(), inventory([...scan().mods, mod('other/repo')]), ['new/repo', 'other/repo'], ['existing/repo'], duplicates)
  assert.deepEqual(result.published, ['other/repo'])
  assert.deepEqual(result.inventory.mods[0], before().mods[0])
})

test('unapplied duplicate rules between published entries do not block new seeds', () => {
  const prior = inventory([mod('same/old'), mod('same/current')])
  const original = structuredClone(prior)
  const duplicates = new Map([['same/old:mod', 'same/current:mod']])
  const result = append(scan(), prior, duplicates)
  assert.deepEqual(result.published, ['new/repo'])
  assert.deepEqual(result.skipped, [])
  assert.deepEqual(result.inventory.mods, [...original.mods, ...scan().mods])
  assert.equal(result.inventory.generated, original.generated)
  assert.deepEqual(prior, original)
})

test('pending old duplicate rules cannot hide suspicions involving a new seed', () => {
  const prior = inventory([mod('same/old'), mod('same/current', 'renamed')])
  const duplicates = new Map([['same/old:mod', 'same/current:renamed']])
  const result = appendSeeds(prior, inventory([mod('same/new'), ...scan().mods]), ['same/new', 'new/repo'], [], duplicates)
  assert.deepEqual(result.published, ['new/repo'])
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].repo, 'same/new')
  assert.match(result.skipped[0].reason, /possible duplicate/)
  assert.deepEqual(result.inventory.mods.slice(0, 2), prior.mods)
})

test('new duplicate rules still apply while old inventory classifications are preserved', () => {
  const prior = inventory([mod('same/old'), mod('same/current')])
  const duplicates = new Map([
    ['same/old:mod', 'same/current:mod'],
    ['same/new:mod', 'same/old:mod'],
    ['same/current:mod', 'same/replacement:next'],
  ])
  const result = appendSeeds(prior, inventory([mod('same/new'), mod('same/replacement', 'next'), ...scan().mods]), ['same/new', 'same/replacement', 'new/repo'], [], duplicates)
  assert.deepEqual(result.published, ['new/repo', 'same/new'])
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].repo, 'same/replacement')
  assert.match(result.skipped[0].reason, /reclassifies same\/current:mod/)
  assert.deepEqual(result.inventory.mods.slice(0, 2), prior.mods)
  assert.equal(result.inventory.mods.find(m => m.repo === 'same/new').kind, 'duplicate')
  assert.equal(result.inventory.mods.find(m => m.repo === 'same/new').duplicateOf, 'same/old:mod')
})

test('a contributor merge during a scan does not discard that scan or publish unscanned seeds', () => {
  const latest = before()
  const approved = ['new/repo', 'later/repo']
  const result = planPublication(latest, scan(), ['new/repo'], approved, ['existing/repo'])
  assert.equal(result.inventory.mods.length, 3)
  assert.deepEqual(pendingSeeds(approved, result.inventory), ['later/repo'])
})

test('replaying a completed scan on newer main preserves concurrent catalogue changes', () => {
  const latest = inventory([mod('existing/repo', 'changed', { description: 'new description' }), mod('other/repo')])
  const result = planPublication(latest, scan(), ['new/repo'], ['new/repo'], ['existing/repo', 'other/repo'])
  assert.deepEqual(result.inventory.mods.slice(0, 2), latest.mods)
  assert.equal(result.inventory.repos, 3)
})

test('retries skip seeds published or removed while their scan was running', () => {
  const current = inventory([...scan().mods, mod('later/repo')])
  const result = planPublication(append().inventory, current, ['new/repo', 'later/repo'], ['new/repo', 'later/repo'], ['existing/repo', 'new/repo'])
  assert.deepEqual(result.inventory.mods.slice(0, 3), append().inventory.mods)
  assert.equal(result.inventory.mods.at(-1).repo, 'later/repo')
  assert.equal(planPublication(before(), scan(), ['new/repo'], [], []), null)
  assert.equal(planPublication(append().inventory, scan(), ['new/repo'], ['new/repo'], []), null)
})

for (const concurrentPublication of [false, true]) test(`publication handles a concurrent ${concurrentPublication ? 'catalogue' : 'contributor'} merge without scanning again`, t => {
  const root = mkdtempSync(join(tmpdir(), 'seed-publication-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const remote = join(root, 'remote.git'), checkout = join(root, 'checkout'), bin = join(root, 'bin'), runner = join(root, 'runner')
  for (const dir of [checkout, bin, runner]) mkdirSync(dir)
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const git = (...args) => execFileSync('git', args, { cwd: checkout, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--bare', remote)
  git('init', '-b', 'fixture')
  git('remote', 'add', 'origin', remote)
  cpSync(fileURLToPath(new URL('.', import.meta.url)), join(checkout, 'tools'), { recursive: true })
  // Mod pages take their install hint from the finder's helper.
  cpSync(fileURLToPath(new URL('../finder', import.meta.url)), join(checkout, 'finder'), { recursive: true })
  mkdirSync(join(checkout, 'data'))
  const renderable = (repo, name) => ({ ...mod(repo, name), path: name, description: name, url: `https://github.com/${repo}`, stars: 1, reach: { level: 0, name: 'draws and remembers', labels: [] }, sees: [], hooks: [], calls: [], surfaceModules: [] })
  const publishedBefore = [renderable('existing/repo', 'old'), renderable('existing/repo', 'copy')]
  writeFileSync(join(checkout, 'data/mods.json'), JSON.stringify(inventory(publishedBefore)))
  writeFileSync(join(checkout, 'data/duplicates.txt'), 'existing/repo:copy existing/repo:old\n')
  writeFileSync(join(checkout, 'data/compatibility-reviews.json'), '[]\n')
  writeFileSync(join(checkout, 'data/repos.txt'), 'existing/repo\n')
  writeFileSync(join(checkout, 'data/seeds.txt'), 'existing/repo\nnew/repo\nbroken/repo\n')
  writeFileSync(join(checkout, 'data/topics.json'), JSON.stringify([{ slug: 'prompt-cache', title: 'Prompt cache mods for Claude Code', short: 'Prompt cache', description: 'Cache mods.', patterns: ['^new$'], include: [], exclude: [], related: [] }]))
  writeFileSync(join(checkout, 'README.md'), '<!-- stats:start -->\n<!-- stats:end -->\n')
  writeFileSync(join(checkout, 'catalogue.md'), ['stats', 'scan', 'builtin'].map(name => `<!-- ${name}:start -->\n<!-- ${name}:end -->`).join('\n'))
  execFileSync(process.execPath, ['tools/render.mjs'], { cwd: checkout, env })
  mkdirSync(join(checkout, 'docs/mods/retired--repo--gone'))
  writeFileSync(join(checkout, 'docs/mods/retired--repo--gone/index.html'), 'stale page')
  // One run starts before the access page, topic pages, A to Z pages and directory data existed, so publication covers creating them as well as updating them.
  if (concurrentPublication) for (const path of ['docs/access', 'docs/topics', 'docs/browse', 'docs/directory']) rmSync(join(checkout, path), { recursive: true })
  git('add', '.')
  git('commit', '-m', 'Fixture inventory')
  git('push', 'origin', 'HEAD:main')
  writeFileSync(join(runner, 'seeds.txt'), 'new/repo\nbroken/repo\n')
  writeFileSync(join(runner, 'seed-scan.json'), JSON.stringify(inventory([renderable('new/repo', 'new')])))
  const log = join(root, 'commands.jsonl'), marker = join(root, 'advanced'), pr = join(root, 'pr')
  const prelude = `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([require('node:path').basename(process.argv[1]),...args])+'\\n');const git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8'}).trim();\n`
  writeFileSync(join(bin, 'npm'), prelude + `
if(args.join(' ')==='run render')cp.execFileSync(process.execPath,['tools/render.mjs'],{stdio:'pipe'});
if(args.join(' ')==='run lint')git('rev-parse','--abbrev-ref','@{upstream}');
`, { mode: 0o755 })
  writeFileSync(join(bin, 'gh'), prelude + `
if(args[0]==='api'){
  if(!fs.existsSync(${JSON.stringify(marker)})){
    fs.writeFileSync(${JSON.stringify(marker)},'yes');
    const base=git('--git-dir',${JSON.stringify(remote)},'rev-parse','main');
    const other=${JSON.stringify(join(root, 'contributor'))};
    git('clone','--branch','main',${JSON.stringify(remote)},other);
    fs.appendFileSync(other+'/data/seeds.txt','later/repo\\n');
    if(${concurrentPublication}){
      const data=JSON.parse(fs.readFileSync(other+'/data/mods.json'));
      data.mods.push(...JSON.parse(fs.readFileSync(${JSON.stringify(join(runner, 'seed-scan.json'))})).mods);
      fs.writeFileSync(other+'/data/mods.json',JSON.stringify(data));
      cp.execFileSync(process.execPath,['tools/render.mjs'],{cwd:other});
    }
    git('-C',other,'switch','-c','contributor');git('-C',other,'add','.');git('-C',other,'commit','-m','Next approved seed');git('-C',other,'push','origin','HEAD:main');
  }
  console.log(git('--git-dir',${JSON.stringify(remote)},'rev-parse','main'));
}else if(args[1]==='list'){if(fs.existsSync(${JSON.stringify(pr)}))console.log('1');
}else if(args[1]==='create'){fs.copyFileSync(args[args.indexOf('--body-file')+1],${JSON.stringify(pr)});
}else if(args[1]==='merge'){
  const head=args[args.indexOf('--match-head-commit')+1];
  const base=git('--git-dir',${JSON.stringify(remote)},'rev-parse','main');
  if(git('rev-parse',head+'^')!==base)throw Error('Attempted stale merge');
  if(!args.includes('--squash'))throw Error('Expected squash merge');
  git('--git-dir',${JSON.stringify(remote)},'update-ref','refs/heads/main',head,base);
}else if(args[1]!=='edit'&&args[1]!=='close'){throw Error('Unexpected gh call '+args.join(' '));}
`, { mode: 0o755 })
  execFileSync('bash', ['tools/publish-seeds.sh'], { cwd: checkout, env: { ...env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runner, GITHUB_REPOSITORY: 'example/mods', GITHUB_RUN_ID: '1' }, stdio: 'pipe' })
  const published = JSON.parse(git('--git-dir', remote, 'show', 'main:data/mods.json'))
  assert.deepEqual(published.mods.slice(0, 2), publishedBefore)
  assert.deepEqual(published.mods.map(mod => mod.repo), ['existing/repo', 'existing/repo', 'new/repo'])
  assert.match(git('--git-dir', remote, 'show', 'main:data/seeds.txt'), /later\/repo/)
  assert.equal(JSON.parse(git('--git-dir', remote, 'show', 'main:data/pages.json'))['new--repo--new'].id, 'new/repo:new')
  assert.match(git('--git-dir', remote, 'show', 'main:docs/mods/new--repo--new/index.html'), /<h1>new<\/h1>/)
  assert.match(git('--git-dir', remote, 'show', 'main:docs/sitemap.xml'), /mods\/new--repo--new\//)
  assert.doesNotMatch(git('--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main', 'docs/mods'), /retired--repo--gone/, 'publication commits removed pages')
  assert.match(git('--git-dir', remote, 'show', 'main:docs/browse/n/index.html'), /<a href="\/mods\/new--repo--new\/">/, 'the A to Z pages list the newly published mod')
  assert.ok(JSON.parse(git('--git-dir', remote, 'show', 'main:docs/directory/1.json')).rows.some(row => row.includes('id="new--repo--new"')), 'the directory data carries the newly published mod')
  assert.match(git('--git-dir', remote, 'show', 'main:docs/access/index.html'), /catalogue of 3 counted mods/, 'the access page is published with the new mod')
  assert.match(git('--git-dir', remote, 'show', 'main:docs/topics/prompt-cache/index.html'), /<a class="name" href="\/mods\/new--repo--new\/">/, 'the topic page lists the newly published mod')
  assert.deepEqual(pendingSeeds(['existing/repo', 'new/repo', 'later/repo', 'broken/repo'], published), ['broken/repo', 'later/repo'])
  assert.match(readFileSync(join(runner, 'seed-skipped.md'), 'utf8'), /^- broken\/repo: no validating mod plugins/)
  if (!concurrentPublication) assert.match(readFileSync(pr, 'utf8'), /## Seeds not published\n\n- broken\/repo/)
  assert.equal(readFileSync(join(runner, 'seed-published.txt'), 'utf8'), concurrentPublication ? '' : 'new/repo\n')
  const commands = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(commands.filter(command => command.join(' ') === 'npm run render').length, concurrentPublication ? 1 : 2)
  assert.equal(commands.filter(command => command[0] === 'gh' && command[2] === 'merge').length, concurrentPublication ? 0 : 1)
  assert.ok(!commands.some(command => command.includes('scan')))
  assert.equal(commands.some(command => command[0] === 'gh' && /\/commits\/[0-9a-f]{40}\/pulls$/.test(command[2] ?? '')), !concurrentPublication)
})
