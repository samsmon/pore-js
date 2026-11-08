# Pore.js — M2 Plan (PDF + unified shell)

**Goal:** read PDF by wrapping pdf.js and reusing the image engine's navigation
shell; unify image/text/PDF behind one `Locator` position model and one
`ReaderEngine` interface; `LocalFileSource` accepts any supported file.

**Design:** [`reader-engine-design.md`](reader-engine-design.md) §5, §8, §9, §14 ·
builds on `v0.3.0-m1`. Target tag: `v0.4.0-m2`.

Sequential, one commit per task. Deps: **pdf.js** (`pdfjs-dist`, lazy chunk).

---

## C0 — carry-over cleanup (M0.5 / M1 slivers) · S ✅

- [x] **Per-book settings persistence** — `reader-react/settings-store.ts`:
      localStorage, global prefs + per-book layout layer (spec §11.3);
      `<Reader persistSettings>` seeds on mount, saves on change (`1a5460a`)
- [x] **`publisherStyles: false`** — `rewrite.ts` `stripAuthorCss` removes
      `<style>` / `<link rel=stylesheet>` / inline `style=`; engine re-renders
      the spine on toggle
- [x] **Dark-theme image dim** — `dimImages` setting → `filter: invert() hue-rotate()`
      on iframe images when the theme is dark
- [ ] **Char-level anchor `offset`** — _still deferred_: block-level anchor
      already resumes to the right paragraph; sub-paragraph precision needs a
      caret/Range walk that jsdom can't test. Low payoff, revisit if it bites.
- [ ] **Bundled reading fonts** — _needs asset files_: `fontFamily` switches the
      CSS stack (serif/sans/slab work today); OpenDyslexic needs a bundled woff2
      the maintainer adds. Folds into the UI milestone's asset pass.

**Done when:** the deferred M1 slivers are closed. ✅ (2 remain, both blocked on
non-code inputs) 2026-08-29

---

## D1 — `Locator` + unified `ReaderEngine` interface · M ✅

- [x] `Locator` = `{ position, page, total, percent, label, chapter? }` in
      `reader-core/src/reader-engine.ts` — the one shape every engine emits in
      `reader:locationchange`
- [x] `ReaderEngine<S, E>` interface + `CommonEngineEvents`
- [x] Image + text `reader:locationchange` payloads normalised to `Locator`
      (image gains `total`/`percent`; text drops `totalPages`/`spine`, label uses
      the chapter name, `chapter` = spine idref)
- [x] `reader-react` `ReaderLocation = Locator`; `<Reader>` locationchange
      handler is typed, no `as {…}` cast
- [x] Vitest: image `reader:locationchange` carries `{page,total,percent}`
      (`create-image-engine.test`); browser-verified both formats

**Done when:** one position model. ✅ done 2026-08-29
_(`Position` stays the engine-native precise anchor; `Locator` wraps it for the
shell — no separate `toLocator`/`fromLocator` needed)_

---

## D2 — PDF parsing + page metadata · M ✅

- [x] `packages/reader-core/src/pdf/parse.ts` — lazy
      `import('pdfjs-dist/legacy/build/pdf.mjs')` (legacy build runs in Node +
      browsers); `pdfjs-dist` external in tsup
- [x] `loadPdf(bytes) → PdfDoc`: `pageCount`, `pageSize(n)`, `outline` (bookmarks
      resolved to `#page=N`), `textContent(n)`, `destroy()`
- [x] `renderToBlob(n, {scale, maxDim})` → `OffscreenCanvas` → webp `Blob` for
      the image engine (browser only; `maxDim` caps big-page memory)
- [x] Vitest (3, pdf-lib fixture): page count + size, per-page text, empty outline

**Done when:** a PDF parses to pages + outline + text. ✅ done 2026-08-29
_(scrubber thumbnail strip → D5/UI)_

---

## D3 — PDF engine = image engine + pdf.js renderer · M ✅

- [x] `PdfImageSource` — adapts a PDF (via `inner.getFile`) into an
      `ImageManifest` + `renderToBlob` page images; outline → `chapters[]`;
      progress proxied. **The image engine reads it unchanged** — composition,
      not a fork.
- [x] `createPdfEngine(options)` = `createImageEngine` over a `PdfImageSource`,
      wrapping `on` to add `reader:toc` from the outline; `destroy` disposes the
      `PdfDoc`
- [x] `<Reader>` mounts it for `manifest.type === 'pdf'`; demo wires the pdf.js
      worker (`GlobalWorkerOptions.workerSrc`) and a `demo-pdf` fixture
- [x] Vitest (4, jsdom, mocked `loadPdf`): manifest + chapters, page render,
      progress proxy, engine mount + `reader:toc`
- [x] Browser-verified: 9-page A4 PDF renders crisply, paged nav / fit / zoom
      all work

**Done when:** `<Reader bookId>` opens a PDF and navigates like manga. ✅ done 2026-08-29
_(pdf.js text layer for selection/search → D5 / M3)_

---

## D4 — `LocalFileSource` any-file + fixed-layout EPUB · S ✅

- [x] `LocalFileSource` detects `.pdf` → `type: 'pdf'` manifest, `.epub` →
      `type: 'epub'`; both served whole through `getFile` (previously only
      `.cbz` / loose images)
- [x] Fixed-layout EPUB: OPF `rendition:layout="pre-paginated"` sniffed → public
      `fixedLayout` flag; demo shows a "reflow view (beta)" notice. Full
      spine-to-image rendering stays deferred (design doc §12) — low demand,
      folds into a later pass.
- [x] Demo drop zone copy + `.notice` toast
- [x] Vitest (4): dropped `.pdf` → pdf manifest + `getFile` bytes; `.epub` →
      epub manifest; pre-paginated flagged; reflowable not flagged

**Done when:** drop any supported file and it opens. ✅ done 2026-08-29

---

## D5 — shared chrome data (design doc §9) · M ✅

- [x] Every engine emits `reader:progress { locator, percent, chapterLabel,
chapterIndex, chapterCount, pagesLeftInChapter, minutesLeft }` alongside
      `reader:locationchange`
- [x] `minutesLeft`: shared `PaceEstimator` — an EMA of wall-clock seconds per
      page, seeded per format (image 8s, text 30s), eased toward the reader's
      real pace; `pagesLeft × spp / 60`
- [x] Chapter model unified: `chapters(): Chapter[]` on every engine —
      `{ id, label, startPage, startPercent }`. Image ← `manifest.chapters`;
      text ← one entry per spine item (label from the TOC); PDF ← outline
      (through the image path). `chapterProgress()` maps a page → current chapter + pages remaining.
- [x] `reader-react` `useReaderProgress()` hook + `handle.chapters()`
- [x] Vitest (9): `chapterProgress` boundaries, `PaceEstimator` EMA + clamps +
      rounding, image engine emits `reader:progress`
- [x] Demo chrome renders "· Ch 2/3 · N min left"; demo-manga fixture gains
      three chapters to exercise it

**Done when:** the shell can render "Ch 4 of 12 · 18 min left" for any book. ✅ done 2026-08-29

---

## D6 — hardening + release · S ✅

- [x] Playwright specs added: PDF open + turn + fit + cross-format switch;
      chaptered progress line (run in CI — local box has no browser binaries)
- [x] Perf: `createPdfEngine.destroy()` disposes the `PdfDoc` (pdf.js worker
      teardown via `task.destroy()`); `maxDim` caps render memory; the
      image engine's existing abort path covers in-flight page renders
- [x] CHANGELOG `v0.4.0-m2`; README status section; m2-plan checkboxes
- [x] Tag `v0.4.0-m2`

_Deferred: canvas pool (single OffscreenCanvas per render is fine at demo
scale), scrubber thumbnails (UI milestone)._

---

## Dependency graph

```
D1 ─→ D2 ─→ D3 ─→ D4 ─→ D5 ─→ D6
   D1 also unblocks D5
```

## Cut for M2

WhiteArchiveSource, offline page caching + SW, in-book search, vertical-JP,
a11y flow mode — all **M3**. CFI, highlights, TTS, OPDS — M4+.
