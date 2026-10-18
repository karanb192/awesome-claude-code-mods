import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
const MAX_FILE_BYTES = 8 * 1024 * 1024, MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_FILES = 4096, MAX_NODES = 1000000
const inside = (root, file) => {
  const path = relative(root, file)
  return path !== '..' && !path.startsWith('../') && !isAbsolute(path)
}

export function uiRewriteReview(repoRoot, pluginRoot, modules, hooks) {
  if (!hooks.some(h => h.event === 'ui.render' || h.event === '*')) return []
  const boundary = realpathSync(repoRoot)
  const plugin = realpathSync(pluginRoot)
  const seen = new Set(), evidence = [], incomplete = []
  const pending = modules.filter(m => typeof m === 'string').map(m => resolve(plugin, 'hooks', m))
  let bytes = 0, nodes = 0
  const failed = (file, reason) => incomplete.push({
    code: 'ui-review-incomplete',
    message: `UI source review incomplete: ${reason}. Review this source before relying on its compatibility results.`,
    evidence: [{ file: relative(boundary, file), line: 1 }],
  })
  function sourceFile(path) {
    const candidates = [path]
    if (!extname(path)) candidates.push(...extensions.flatMap(ext => [path + ext, join(path, 'index' + ext)]))
    if (/\.[cm]?jsx?$/.test(path)) candidates.push(path.replace(/\.[cm]?jsx?$/, '.ts'), path.replace(/\.[cm]?jsx?$/, '.tsx'))
    for (const candidate of candidates) {
      if (!inside(boundary, resolve(candidate))) continue
      try {
        const real = realpathSync(candidate)
        if (inside(boundary, real) && statSync(real).isFile() && extensions.includes(extname(real)) && !real.endsWith('.d.ts')) return real
      } catch {}
    }
    return null
  }
  while (pending.length) {
    const file = sourceFile(pending.pop())
    if (!file || seen.has(file)) continue
    if (seen.size >= MAX_FILES || nodes >= MAX_NODES) {
      failed(file, 'source traversal limit reached')
      break
    }
    seen.add(file)
    let source
    try {
      const size = statSync(file).size
      if (size > MAX_FILE_BYTES || bytes + size > MAX_TOTAL_BYTES) {
        failed(file, 'source byte limit reached')
        continue
      }
      bytes += size
      source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    } catch {
      failed(file, 'source could not be read or parsed')
      continue
    }
    const imports = []
    const stack = [source]
    while (stack.length) {
      if (++nodes > MAX_NODES) {
        failed(file, 'source traversal limit reached')
        break
      }
      const node = stack.pop()
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        if (controls.test(node.text)) evidence.push({ file: relative(boundary, file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 })
      }
      if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) || (ts.isExportDeclaration(node) && !node.isTypeOnly)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text)
      }
      ts.forEachChild(node, child => { stack.push(child) })
    }
    for (const specifier of imports) if (specifier.startsWith('.')) pending.push(resolve(dirname(file), specifier))
  }
  const locations = [...new Map(evidence.map(e => [`${e.file}:${e.line}`, e])).values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return [...(locations.length ? [{
    code: 'ui-control-characters',
    message: 'UI hook source contains control-character strings. Review any values passed to next() as rewritten props.text; the scanner does not trace whether these strings reach that call.',
    evidence: locations,
  }] : []), ...incomplete.sort((a, b) => a.evidence[0].file.localeCompare(b.evidence[0].file))]
}

export function marketplacesFor(repoRoot, pluginRoot) {
  const boundary = realpathSync(repoRoot), plugin = realpathSync(pluginRoot)
  const paths = []
  for (let dir = plugin; inside(boundary, dir); dir = dirname(dir)) {
    const path = join(dir, '.claude-plugin/marketplace.json')
    if (existsSync(path) && inside(boundary, realpathSync(path))) {
      try {
        const manifest = JSON.parse(readFileSync(path, 'utf8'))
        if (manifest.plugins?.some(p => typeof p.source === 'string' && p.source.startsWith('./') && resolve(dir, p.source) === plugin)) paths.push(path)
      } catch {}
    }
    if (dir === boundary) break
  }
  return paths
}
