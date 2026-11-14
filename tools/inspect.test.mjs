import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspect } from './inspect.mjs'
import { declaredHooksFiles } from './hooks-files.mjs'

test('plugin.json hooks paths resolve inside the plugin root; inline objects, escaping paths and other plugins\' hooks/hooks.json are left out', () => {
  assert.deepEqual(declaredHooksFiles({ hooks: './hooks.json' }, '/r'), ['hooks.json'])
  assert.deepEqual(declaredHooksFiles({ hooks: ['./a.json', { PostToolUse: [] }, './b/../c.json', 'd.json', './a.json'] }, '/r'), ['a.json', 'c.json', 'd.json'])
  assert.deepEqual(declaredHooksFiles({ hooks: { modules: ['./register.ts'] } }, '/r'), [])
  assert.deepEqual(declaredHooksFiles({ hooks: ['./../outside.json', '/elsewhere/h.json', '/r/in/h.json', '', '.'] }, '/r'), ['in/h.json'])
  assert.deepEqual(declaredHooksFiles({ hooks: ['./hooks/hooks.json', './inner/hooks/hooks.json', './hooks/claude/hooks.json'] }, '/r/p'), ['hooks/claude/hooks.json'])
  for (const manifest of [null, [], 'x', {}, { hooks: 3 }]) assert.deepEqual(declaredHooksFiles(manifest, '/r'), [])
})

// One checkout holding every layout, inspected with a stand-in validator that prints the
// .validator-output file of the plugin it is asked about.
function checkout(t, files, links = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'inspect-test-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'clones', 'o__repo')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  for (const [path, target] of Object.entries(links)) symlinkSync(target, join(dir, path))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture')
  mkdirSync(join(root, 'bin'))
  const claude = join(root, 'bin', 'claude')
  writeFileSync(claude, `#!${process.execPath}\nconst fs = require('node:fs');\ntry { process.stdout.write(fs.readFileSync('.validator-output', 'utf8')) } catch { console.log('✔ Validation passed') }\n`)
  chmodSync(claude, 0o755)
  const path = process.env.PATH
  process.env.PATH = `${join(root, 'bin')}:${path}`
  t.after(() => { process.env.PATH = path })
  return { dir, clones: join(root, 'clones') }
}
const reported = (module, hooks = 'session.start') => `  ❯ ${module} hooks: ${hooks}\n  ❯ ${module} calls: $.fs.read\n✔ Validation passed\n`
const manifest = (name, hooks) => JSON.stringify(hooks === undefined ? { name } : { name, hooks })

test('a scan finds the hooks files a plugin.json declares, as Claude Code loads them, and keeps hooks/hooks.json plugins as before', async t => {
  const { dir, clones } = checkout(t, {
    // Today's layout: found exactly as before.
    'standard/.claude-plugin/plugin.json': manifest('standard'),
    'standard/hooks/hooks.json': { modules: ['./register.ts'] },
    'standard/.validator-output': reported('./register.ts'),
    // "hooks": "./hooks.json", with a module path relative to that file and a UI hook to review.
    'journal/.claude-plugin/plugin.json': manifest('journal', './hooks.json'),
    'journal/hooks.json': { modules: ['./hooks/register.tsx'] },
    'journal/hooks/register.tsx': 'export const bell = "\\u0007"',
    'journal/.validator-output': reported('./hooks/register.tsx', 'ui.render{component=Spinner}'),
    // An array mixing a settings hooks file, an inline object and the mod's own file.
    'mixed/.claude-plugin/plugin.json': manifest('mixed', ['./settings.json', { PostToolUse: [] }, './mod/hooks.json']),
    'mixed/settings.json': { hooks: { PreToolUse: [] } },
    'mixed/mod/hooks.json': { modules: ['./register.ts'] },
    'mixed/.validator-output': reported('./register.ts'),
    // A module path that leaves the hooks file's folder.
    'outside-folder/.claude-plugin/plugin.json': manifest('outside-folder', './hooks/claude-code.json'),
    'outside-folder/hooks/claude-code.json': { modules: ['../mods/cockpit/register.tsx'] },
    'outside-folder/.validator-output': reported('../mods/cockpit/register.tsx'),
    // Not mods: modules in an inline object, a path out of the plugin, a symlinked file, a missing file.
    'inline/.claude-plugin/plugin.json': manifest('inline', { modules: ['./register.ts'] }),
    'escape/.claude-plugin/plugin.json': manifest('escape', './../escape-target.json'),
    'escape-target.json': { modules: ['./register.ts'] },
    'linked/.claude-plugin/plugin.json': manifest('linked', './link.json'),
    'linked/real/hooks.json': { modules: ['./register.ts'] },
    'missing/.claude-plugin/plugin.json': manifest('missing', './nope.json'),
    // A hooks/hooks.json stays with the plugin two folders up, even when an outer manifest names it.
    'outer/.claude-plugin/plugin.json': manifest('outer', './inner/hooks/hooks.json'),
    'outer/inner/hooks/hooks.json': { modules: ['./register.ts'] },
    'outer/inner/.validator-output': reported('./register.ts'),
    // Vendored plugins stay out.
    'node_modules/pkg/.claude-plugin/plugin.json': manifest('pkg', './hooks.json'),
    'node_modules/pkg/hooks.json': { modules: ['./register.ts'] },
  }, { 'linked/link.json': 'real/hooks.json' })
  const found = await inspect('o/repo', dir, clones, '2.1.325')
  assert.equal(found.complete, true)
  assert.deepEqual(found.plugins.map(p => [p.rel, p.manifestName, p.modules, p.footprint.status]).sort(), [
    ['journal', 'journal', ['./hooks/register.tsx'], 'reported'],
    ['mixed', 'mixed', ['./register.ts'], 'reported'],
    ['outer/inner', null, ['./register.ts'], 'reported'],
    ['outside-folder', 'outside-folder', ['../mods/cockpit/register.tsx'], 'reported'],
    ['standard', 'standard', ['./register.ts'], 'reported'],
  ])
  const journal = found.plugins.find(p => p.rel === 'journal')
  assert.deepEqual(journal.warnings.map(w => [w.code, w.evidence.map(e => e.file)]), [['ui-control-characters', ['journal/hooks/register.tsx']]])
  assert.deepEqual(journal.calls, ['$.fs.read'])
})

test('a malformed declared hooks file leaves the inspection incomplete, and a plugin naming modules in two files records both', async t => {
  const { dir, clones } = checkout(t, {
    'broken/.claude-plugin/plugin.json': manifest('broken', './hooks.json'),
    'broken/hooks.json': '{',
    'twice/.claude-plugin/plugin.json': manifest('twice', './extra/hooks.json'),
    'twice/hooks/hooks.json': { modules: ['./a.ts'] },
    'twice/extra/hooks.json': { modules: ['./b.ts'] },
    'twice/.validator-output': `  ❯ ./a.ts hooks: session.start\n  ❯ ./a.ts calls: nothing on $\n  ❯ ./b.ts hooks: session.start\n  ❯ ./b.ts calls: nothing on $\n✘ Found 1 error:\n  ❯ modules: The plugin names one hooks module per plugin\n✘ Validation failed\n`,
  })
  const found = await inspect('o/repo', dir, clones, '2.1.325')
  assert.equal(found.complete, false)
  assert.deepEqual(found.plugins.map(p => [p.rel, p.modules, p.footprint.status, p.validate.status]), [['twice', ['./a.ts', './b.ts'], 'reported', 'failed']])
})
