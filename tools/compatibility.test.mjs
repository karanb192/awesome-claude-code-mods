import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marketplacesFor, uiRewriteReview } from './compatibility.mjs'
import { describeChange, fingerprint } from './changed.mjs'

const ui = [{ event: 'ui.render', matcher: { component: 'AssistantMessage' } }]
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mod-compatibility-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const write = (file, content) => {
    const path = join(dir, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  }
  return { dir, write }
}

test('UI review follows local helpers and records decoded control strings without running code', t => {
  const { dir, write } = fixture(t)
  write('hooks/register.ts', 'import { colour } from "./colour.js"; throw new Error("must not execute");')
  write('hooks/colour.ts', 'import "./register";\nexport const colour = text => `\\x1b[36m${text}\\u001b[0m`;')
  const warnings = uiRewriteReview(dir, dir, ['./register.ts'], ui)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].code, 'ui-control-characters')
  assert.deepEqual(warnings[0].evidence, [{ file: 'hooks/colour.ts', line: 2 }])
  assert.match(warnings[0].message, /does not trace/)
  assert.deepEqual(uiRewriteReview(dir, dir, ['./register.ts'], [{ event: 'turn.start' }]), [])
})

test('comments, regexes, printable text, tabs, newlines and unimported tests do not raise UI warnings', t => {
  const { dir, write } = fixture(t)
  write('hooks/register.ts', String.raw`// colour example "\x1b[31m"
const strip = /\x1b\[[0-9;]*m/g
const text = 'hello\n\tworld'
const literal = '\\x1b[31m'
import type { Colour } from './types'
`)
  write('hooks/types.ts', 'export type Colour = "\\x1b"')
  write('tests/colour.test.ts', 'const expected = "\\x1b[31m"')
  assert.deepEqual(uiRewriteReview(dir, dir, ['./register.ts'], ui), [])
})

test('deep expression trees still report control strings and later imports', t => {
  const { dir, write } = fixture(t)
  write('hooks/register.ts', 'const text = ' + Array(12000).fill('"safe"').join('+') + '+"\\x1b";\nimport "./later";')
  write('hooks/later.ts', 'export const marker = "\\x07"')
  assert.deepEqual(uiRewriteReview(dir, dir, ['./register.ts'], ui)[0].evidence, [
    { file: 'hooks/later.ts', line: 1 }, { file: 'hooks/register.ts', line: 1 },
  ])
})

test('parser exhaustion is explicit and does not hide another module warning', t => {
  const { dir, write } = fixture(t)
  write('hooks/register.ts', 'const text = ' + '('.repeat(12000) + '"text"' + ')'.repeat(12000))
  write('hooks/other.ts', 'const text = "\\x1b"')
  const warnings = uiRewriteReview(dir, dir, ['./register.ts', './other.ts'], ui)
  assert.ok(warnings.some(w => w.code === 'ui-review-incomplete' && w.evidence.some(e => e.file === 'hooks/register.ts')))
  assert.ok(warnings.some(w => w.code === 'ui-control-characters' && w.evidence.some(e => e.file === 'hooks/other.ts')))
})

test('oversized sources are held for review instead of read as clean', t => {
  const { dir, write } = fixture(t)
  write('hooks/register.ts', ' '.repeat(8 * 1024 * 1024 + 1))
  const warnings = uiRewriteReview(dir, dir, ['./register.ts'], ui)
  assert.equal(warnings[0].code, 'ui-review-incomplete')
  assert.match(warnings[0].message, /limit/)
})

test('long import chains are traversed without recursion and stop at the file limit', t => {
  const { dir, write } = fixture(t)
  for (let i = 0; i < 4100; i++) write(`hooks/file${i}.ts`, `import "./file${i + 1}";`)
  write('hooks/file3500.ts', 'export const marker="\\x1b"; import "./file3501";')
  const warnings = uiRewriteReview(dir, dir, ['./file0.ts'], ui)
  assert.ok(warnings.some(w => w.code === 'ui-control-characters' && w.evidence.some(e => e.file === 'hooks/file3500.ts')))
  assert.ok(warnings.some(w => w.code === 'ui-review-incomplete' && /limit/.test(w.message)))
})

test('UI review follows re-exports, require and dynamic literal imports and refuses paths outside the repo', t => {
  const { dir, write } = fixture(t)
  write('repo/hooks/register.ts', 'export * from "./helpers"; require("./more.cjs"); import("./later"); import "../../outside"; import "./link"')
  write('repo/hooks/helpers/index.ts', 'export const c = "\\u{1b}"')
  write('repo/hooks/more.cjs', 'exports.c = "\\u009b"')
  write('repo/hooks/later.ts', 'export const c = "\\x07"')
  write('outside.ts', 'export const c = "\\x1b"')
  symlinkSync(join(dir, 'outside.ts'), join(dir, 'repo/hooks/link.ts'))
  const root = join(dir, 'repo')
  assert.deepEqual(uiRewriteReview(root, root, ['./register.ts'], ui)[0].evidence.map(e => e.file), ['hooks/helpers/index.ts', 'hooks/later.ts', 'hooks/more.cjs'])
})

test('marketplace checks apply only to local entries for the scanned plugin', t => {
  const { dir, write } = fixture(t)
  write('plugins/one/hooks/register.ts', '')
  write('plugins/two/hooks/register.ts', '')
  write('.claude-plugin/marketplace.json', JSON.stringify({ name: 'example', plugins: [{ name: 'one', source: './plugins/one' }] }))
  write('plugins/one/.claude-plugin/marketplace.json', JSON.stringify({ name: 'nested', plugins: [{ name: 'one', source: './' }] }))
  assert.deepEqual(marketplacesFor(dir, join(dir, 'plugins/one')).map(p => p.slice(realpathSync(dir).length + 1)), ['plugins/one/.claude-plugin/marketplace.json', '.claude-plugin/marketplace.json'])
  assert.deepEqual(marketplacesFor(dir, join(dir, 'plugins/two')), [])
})

test('compatibility and marketplace changes trigger a refresh even when plugin validation still passes', () => {
  const before = { claudeVersion: '2.1.287', mods: [{ id: 'example/plugin:.', repo: 'example/plugin', name: 'plugin', kind: 'mod', hooks: [], calls: [], reach: { level: 0 }, validate: { status: 'passed' } }] }
  for (const extra of [{ marketplaces: [{ path: '.claude-plugin/marketplace.json', status: 'failed', errors: ['reserved name'] }] }, { compatibility: { runtime: 'not-tested', warnings: [{ code: 'ui-control-characters', evidence: [] }] } }]) {
    const after = structuredClone(before)
    Object.assign(after.mods[0], extra)
    assert.notEqual(fingerprint(before), fingerprint(after))
    assert.match(describeChange(before, after).join('\n'), /(?:marketplace validation|compatibility review) changed/)
  }
})

test('scanner keeps plugin and marketplace results separate and reports UI source evidence', t => {
  const { dir, write } = fixture(t)
  const repo = 'example/mods', root = 'fixture-repo'
  write('repos.txt', repo + '\n')
  write(`${root}/.claude-plugin/marketplace.json`, JSON.stringify({ name: 'example', plugins: [{ name: 'one', source: './one' }, { name: 'two', source: './two' }] }))
  for (const name of ['one', 'two', 'interrupted']) {
    write(`${root}/${name}/.claude-plugin/plugin.json`, JSON.stringify({ name }))
    write(`${root}/${name}/hooks/hooks.json`, JSON.stringify({ modules: ['./register.ts'] }))
    write(`${root}/${name}/hooks/register.ts`, 'const colour = "\\x1b[36m"')
  }
  const commands = {
    git: `import { cpSync } from 'node:fs';
if (process.argv[2] === 'clone') cpSync(${JSON.stringify(join(dir, root))}, process.argv.at(-1), {recursive: true});
else console.log('a'.repeat(40));`,
    gh: 'console.log(JSON.stringify({stars: 1, defaultBranch: "main"}))',
    claude: `import { appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) console.log('2.1.287 (Claude Code)');
else if (process.argv.at(-1).endsWith('marketplace.json')) {
  appendFileSync(${JSON.stringify(join(dir, 'marketplace-calls'))}, 'called\\n');
  console.log('✘ Found 1 error:\\n  ❯ name: Marketplace name is reserved.\\n✘ Validation failed'); process.exitCode = 1;
} else {
  console.log('  ❯ ./register.ts hooks: ui.render{component=AssistantMessage}\\n  ❯ ./register.ts calls: nothing on $\\n✔ Validation passed');
  if (process.cwd().endsWith('interrupted')) process.exitCode = 2;
}`,
  }
  for (const [name, body] of Object.entries(commands)) {
    const path = write(`bin/${name}`, `#!${process.execPath}\n${body}\n`)
    chmodSync(path, 0o755)
  }
  const out = join(dir, 'mods.json')
  execFileSync(process.execPath, [fileURLToPath(new URL('./scan.mjs', import.meta.url)), '--clones', join(dir, 'clones'), '--repos', join(dir, 'repos.txt'), '--out', out], { cwd: dir, env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH }, stdio: 'pipe' })
  const data = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(data.mods.length, 3)
  assert.equal(readFileSync(join(dir, 'marketplace-calls'), 'utf8'), 'called\n')
  const interrupted = data.mods.find(m => m.name === 'interrupted')
  assert.equal(interrupted.validate.status, 'unknown')
  assert.match(interrupted.validate.errors.join('\n'), /exited with status 2/)
  for (const mod of data.mods.filter(m => m.name !== 'interrupted')) {
    assert.equal(mod.validate.status, 'passed')
    assert.equal(mod.marketplaces[0].status, 'failed')
    assert.equal(mod.marketplaces[0].path, '.claude-plugin/marketplace.json')
    assert.equal(mod.compatibility.runtime, 'not-tested')
    assert.equal(mod.compatibility.warnings[0].evidence[0].file, `${mod.path}/hooks/register.ts`)
    assert.equal(mod.sourceCommit, 'a'.repeat(40))
  }
})
