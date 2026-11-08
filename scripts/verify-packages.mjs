#!/usr/bin/env node
/**
 * Pre-publish sanity for `porejs` + `porejs-react`. Run after `pnpm build`.
 *
 *   node scripts/verify-packages.mjs
 *
 * Checks:
 *  - reader-react ships no CSS (it is headless by contract)
 *  - each tarball has no *.map / .tsbuildinfo / test files
 *  - the built `VERSION` string matches package.json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

// 1. no CSS in porejs-react/dist
const reactDist = join(root, 'packages/reader-react/dist');
const reactFiles = await walk(reactDist).catch(() => {
  problems.push('packages/reader-react/dist missing — run `pnpm build` first');
  return [];
});
for (const f of reactFiles) {
  if (f.endsWith('.css')) problems.push(`porejs-react ships CSS: ${f.slice(root.length + 1)}`);
}

// 2. clean tarballs + 3. VERSION matches
for (const pkg of ['reader-core', 'reader-react']) {
  const dir = join(root, 'packages', pkg);
  const { version, name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

  const listing =
    process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm.cmd pack --dry-run --json'], {
          cwd: dir,
          encoding: 'utf8',
        })
      : execFileSync('npm', ['pack', '--dry-run', '--json'], {
          cwd: dir,
          encoding: 'utf8',
        });
  const files = JSON.parse(listing)[0].files.map((f) => f.path);
  for (const f of files) {
    if (/\.map$|\.tsbuildinfo$|\.test\.|tsconfig|tsup\.config/.test(f)) {
      problems.push(`${name} tarball contains ${f}`);
    }
  }
  if (!files.some((f) => /README/i.test(f))) problems.push(`${name} tarball has no README`);
  if (!files.some((f) => /LICENSE/i.test(f))) problems.push(`${name} tarball has no LICENSE`);

  if (pkg === 'reader-core') {
    const idx = readFileSync(join(dir, 'dist/index.js'), 'utf8');
    const m = idx.match(/VERSION\s*=\s*(?:typeof[^?]*\?\s*)?["']([^"']+)["']/);
    if (m && m[1] !== version && !idx.includes(`"${version}"`) && !idx.includes(`'${version}'`)) {
      problems.push(`porejs built VERSION does not contain ${version} (build stale?)`);
    }
  }
}

if (problems.length) {
  console.error('✗ package verification failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ porejs + porejs-react packages look publishable');
