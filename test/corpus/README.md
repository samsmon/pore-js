# Real-book corpus

`gen-fixtures.mjs` output is synthetic — procedurally-generated SVG pages and a
toy EPUB/PDF. It exercises the code paths but never the messy reality of a real
publisher's markup. This corpus is a small set of **real, public-domain /
openly-licensed** books that `pnpm test:corpus` runs the engines against.

- **Not committed.** `scripts/fetch-corpus.mjs` downloads them into `files/`
  (gitignored) and verifies each against the `sha256` pinned in
  [`sources.json`](sources.json).
- **First run:** the pinned hashes are `null`; the script prints the real hash
  for each download — paste them into `sources.json` and commit that.
- **CI:** the fetch is cached by hash; a mismatch fails the job (a source
  changed under us — investigate, then re-pin).

```bash
node scripts/fetch-corpus.mjs      # populate test/corpus/files/
pnpm test:corpus                   # run the engines against them
```

`test:corpus` is **not** part of `pnpm test` — it needs the network and the
downloaded files. When `files/` is empty it reports "skipped".

## What it checks

Because jsdom can't run the text engine's real iframe pagination (see
`docs/architecture.md`), the corpus test covers the layers it _can_:

- `parseEpub` / `loadPdf` don't throw on the real container/OPF/PDF structure
- the manifest is sane (spine length, TOC depth, page count)
- `serializeCfi` → `parseCfi` → `resolveCfiElement` round-trips against the
  parsed spine documents
- `buildSpreads` on a real page-size list
- in-book search builds an index over the real text

Full pagination / rendering stays covered by the browser e2e suite.
