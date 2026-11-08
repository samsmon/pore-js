#!/usr/bin/env node
/**
 * Fetch the real-book corpus for `pnpm test:corpus` into `test/corpus/files/`
 * (gitignored). Verifies each download against the sha256 pinned in
 * `test/corpus/sources.json`; on the first fetch (sha256: null) it prints the
 * hash so you can pin it.
 *
 *   node scripts/fetch-corpus.mjs            # fetch missing / changed
 *   node scripts/fetch-corpus.mjs --force    # re-fetch everything
 *
 * All sources are public-domain / openly licensed. See test/corpus/README.md.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test/corpus/files');
const force = process.argv.includes('--force');

const { books } = JSON.parse(await readFile(join(root, 'test/corpus/sources.json'), 'utf8'));
await mkdir(dir, { recursive: true });

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
let unpinned = 0;
let failed = 0;

for (const book of books) {
  const ext = book.kind === 'pdf' ? 'pdf' : 'epub';
  const dest = join(dir, `${book.id}.${ext}`);
  const have = await stat(dest).catch(() => null);

  if (have && !force && book.sha256) {
    const digest = sha(await readFile(dest));
    if (digest === book.sha256) {
      console.log(`ok    ${book.id}`);
      continue;
    }
    console.log(`stale ${book.id} — re-fetching`);
  }

  process.stdout.write(`get   ${book.id} … `);
  try {
    const res = await fetch(book.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const digest = sha(buf);
    if (book.sha256 && digest !== book.sha256) {
      console.log(`SHA MISMATCH\n  expected ${book.sha256}\n  got      ${digest}`);
      failed++;
      continue;
    }
    await writeFile(dest, buf);
    console.log(`${(buf.length / 1024).toFixed(0)} kB  sha256=${digest}`);
    if (!book.sha256) unpinned++;
  } catch (err) {
    console.log(`FAILED (${err.message})`);
    failed++;
  }
}

if (unpinned) {
  console.log(
    `\n${unpinned} book(s) have no pinned sha256 — copy the printed hashes into test/corpus/sources.json.`,
  );
}
if (failed) {
  console.error(`\n${failed} download(s) failed.`);
  process.exit(1);
}
