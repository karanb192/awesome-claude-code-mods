#!/usr/bin/env node
// Which mods in data/mods.json are also listed in Anthropic's plugin directory?
// Usage: node tools/directory-overlap.mjs [--json] [avail.json]
// Without a file argument it runs `claude plugin list --available --json`.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
const raw = file
  ? readFileSync(file, 'utf8')
  : execFileSync('claude', ['plugin', 'list', '--available', '--json'], { encoding: 'utf8', maxBuffer: 1 << 28 });
const available = JSON.parse(raw).available;
const mods = JSON.parse(readFileSync(new URL('../data/mods.json', import.meta.url), 'utf8')).mods;

const repoOf = (url) => {
  const m = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?(?:[#?].*)?$/i.exec(url || '');
  return m && `${m[1]}/${m[2]}`.toLowerCase();
};
const norm = (p) => (p || '').replace(/^\.?\/+|\/+$/g, '');

// directory entries by repo; path '' means the whole repo
const byRepo = new Map();
for (const e of available) {
  const s = e.source;
  const repo = typeof s === 'string' ? null : repoOf(s.url ?? (s.repo && `https://github.com/${s.repo}`));
  if (!repo) continue;
  if (!byRepo.has(repo)) byRepo.set(repo, []);
  byRepo.get(repo).push({ id: e.pluginId, path: norm(s.path) });
}

const hits = [];
for (const m of mods) {
  const entries = byRepo.get(m.repo.toLowerCase());
  if (!entries) continue;
  const mp = norm(m.path);
  for (const e of entries) {
    // exact: same subdirectory; repo-level: directory lists the repo root and the mod lives in it
    const match = e.path === mp ? 'exact' : e.path === '' ? 'repo-root' : null;
    if (match) hits.push({ mod: m.id, kind: m.kind, directory: e.id, match });
  }
}

if (asJson) console.log(JSON.stringify(hits, null, 2));
else {
  for (const h of hits) console.log(`${h.match.padEnd(9)} ${h.kind.padEnd(8)} ${h.mod}  ->  ${h.directory}`);
  const n = (f) => new Set(hits.filter(f).map((h) => h.mod)).size;
  console.error(`\n${available.length} directory entries, ${mods.length} mods in this repo`);
  console.error(`${n(() => true)} mods listed in the directory (${n((h) => h.match === 'exact')} exact path, ${n((h) => h.match === 'repo-root')} repo-root entry)`);
}
