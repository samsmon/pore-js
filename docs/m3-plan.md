# Pore.js — M3 Plan (integration, offline, search)

**Goal:** the reader talks to a real library server (Kavita), works fully
offline, searches inside books, handles vertical-JP text, and has a screen-reader
flow mode. This is the last "fundamentals" milestone before UI polish.

**Why Kavita:** the maintainer runs Kavita on a homelab, so `KavitaSource` is a
source Pore.js can be dogfooded against for real — it replaces the never-built
`WhiteArchiveSource` mock. Kavita has a stable REST API + OPDS; we still test
against recorded response shapes (no live server in CI).

**Design:** [`reader-engine-design.md`](reader-engine-design.md) §4, §7, §9, §10,
§14 · builds on `v0.4.0-m2`. Target tag: `v0.5.0-m3`.

---

## I1 — `KavitaSource` · M ✅

- [x] `KavitaSource(baseUrl, { apiKey, pluginName?, fetch? })` implements
      `ReaderSource`. `bookId` = Kavita `chapterId` (the unit Kavita's reader
      addresses — a book chapter or a manga chapter).
- [x] Auth: `POST /api/Plugin/authenticate?apiKey=&pluginName=pore-js` → JWT;
      `Authorization: Bearer` on every call; one transparent re-auth on 401 then
      `KavitaAuthError`. Key stays out of query strings **except** the image
      endpoint, which requires `apiKey=` (documented Kavita contract).
- [x] Manifest: `GET /api/Reader/chapter-info` → `seriesFormat`
      (Image/Archive → `image` with `pages` synthetic page list; Epub → `epub`;
      Pdf → `pdf`); title from chapter-info; ids cached for progress
- [x] `getPage(id, n)` → `GET /api/Reader/image?chapterId=&page=&apiKey=`
- [x] `getFile(id)` → `GET /api/Download/chapter?chapterId=`; 403 →
      `KavitaDownloadForbiddenError` (account needs the Download role)
- [x] Progress: `GET /api/Reader/progress` → `{ type:'page' }` `Position`;
      `POST /api/Reader/progress` `{ pageNum, chapterId, seriesId, volumeId,
libraryId }` — `pageNum` derived from page / scroll / anchor positions
- [x] Retry/backoff on 429 + 5xx, `AbortSignal` passthrough
- [x] Vitest (10, fake `fetch` with recorded shapes): manifest per format, image
      fetch (key + bearer), progress round-trip, scroll→pageNum, 401 refresh,
      403 download, bad-key `KavitaAuthError`
- [x] **No live integration** in CI — homelab server isn't reachable there

**Done when:** `new KavitaSource(url, { apiKey })` opens a manga chapter and a
book against a mock of Kavita's API; the maintainer points it at the real
homelab instance. ✅ done 2026-08-29
_(demo "Connect to Kavita" input field → deferred to the UI milestone; the
source is usable programmatically now)_

---

## I2 — offline: full page/file caching + `CachedSource` v2 · L ✅

- [x] `MediaCache` — blob store (its own IndexedDB DB) keyed `blob:<bookId>:<slot>`
      (`slot` = page index or `"file"`) + `meta:<bookId>` bookkeeping
      (`{ slots, bytes, at, pageCount }`); LRU whole-book eviction against a
      byte budget (default 500 MB, `budgetBytes` tunes it)
- [x] `CachedSource` v2 — `getPage` / `getFile` serve the cached blob first;
      `download(bookId, { signal, onProgress })` pulls every page (image) or the
      file (epub/pdf), resumable; `downloadStatus` / `downloadState`
      (`none` / `partial` / `complete`), `removeDownload`. `cache: false` keeps
      the old progress-only behaviour.
- [x] Read path: cache-first, source fallback (populate happens via `download`,
      not silently on every read — keeps the budget predictable)
- [x] Demo service worker (`public/sw.js`, no Workbox): SWR for the app shell,
      cache-first for `/fixtures/**` + the pdf.js worker; registered in prod only
- [x] `reader-react` `useDownload(bookId)` hook; demo chrome shows a
      ⬇ / progress / ✓ offline button
- [x] Vitest: `MediaCache` (4 — bytes, no double-count, LRU eviction w/ injected
      clock, removeBook) + `CachedSource` offline (4 — full download + serve,
      resume partial, text file blob, budget eviction)
- [x] Browser-verified: downloaded demo-manga → 12 page blobs + meta in
      `pore-media`; button reads "✓ offline"; pages serve without the source

**Done when:** download a book, kill the network, read it start to finish. ✅ done
2026-08-29

---

## I3 — in-book search · L ✅

- [x] `search/` module: `buildSearchIndex` / `querySearchIndex` — normalised
      (lowercase, whitespace-collapsed) substring scan with snippet + match
      range. Book-sized text is small enough that a scan beats a hand-rolled
      inverted index on correctness; revisit only if a title is huge.
- [x] `SearchController` — owns the index, runs queries in a Worker
      (`new Worker(new URL('./search-worker.js', import.meta.url))`, its own
      tsup entry) with a synchronous fallback; latest-query-wins
- [x] Text engine: builds sections from each spine doc's `textContent` (lazily,
      on first `search()`); `engine.search(query)` + `engine.gotoHit(hit)`
      (maps `hit.start` → block element → page); `reader:searchresults` event
- [x] `reader-react` `useReaderSearch()` — debounced, cancellable, `next`/`prev`;
      demo gets a 🔍 panel with highlighted snippets (`<mark>`)
- [x] PDF search — landed post-M3: `PdfImageSource.textContent(n)` +
      `createPdfEngine` builds a `SearchController` over per-page text,
      `gotoHit` → `goto(page)` (page-level, not rect-level — good enough to
      jump to the right page). Image / CBZ have no text (correctly skipped).
- [x] Vitest (13): `querySearchIndex` (5 — order, snippet range, whitespace,
      min length, limit), `SearchController` (3 — sync, latest-wins, worker
      plumbing), text-engine `search` + `gotoHit` integration
- [x] Browser-verified: "consequat" in the demo EPUB → 76 hits, worker chunk
      loads, clicking hit #41 jumps to "A Complication · 85%"

**Done when:** search "consequat" in the demo EPUB, jump between hits. ✅ done
2026-08-29

---

## I4 — vertical-JP text · M ✅

- [x] `computeTextLayout({ vertical })` drops multicol; `#pore-flow` gets
      `writing-mode: vertical-rl` and is pinned to the viewport's right edge
      (`justify-content: flex-end`). A page is one viewport-width slice, so
      paging forward is `translateX(+page·pageStep)` — the mirror of horizontal.
- [x] `TextEngineSettings.verticalText: 'auto' | 'on' | 'off'`; `auto` = RTL page
      progression + Japanese `dc:language`. `reader:ready` now carries
      `vertical`.
- [x] Input: RTL / vertical books swap the horizontal keys (ArrowLeft = forward);
      wheel takes the dominant axis; click zones already reversed for RTL. This
      path also fixes keyboard direction for plain RTL-horizontal EPUBs.
- [x] Anchor resume + search `gotoHit` fall back to percent-of-spine in vertical
      mode (block-rect → page math doesn't apply)
- [x] `demo-vertical` fixture — synthetic Japanese, `page-progression-direction`
      `rtl`, `lang="ja"`; demo book list + a "Vertical text" setting in the Nav tab
- [x] Vitest (3): `computeTextLayout` vertical (pageStep, no multicol),
      `buildBaseStylesheet` vertical CSS, engine auto-detect + swapped keys
- [x] Browser-verified: reads top-to-bottom right-to-left, `translateX` steps
      `0 → +1240 → …`, progress + chapter tracking correct, no LTR regression

**Done when:** a vertical Japanese EPUB reads top-to-bottom, right-to-left. ✅
done 2026-08-29

**RTL-horizontal (Arabic/Hebrew) — closed post-M3:** confirmed it needed no new
code — `direction: rtl` in `buildBaseStylesheet` + the I4 key/click swap were
already sufficient, since CSS multicol reverses column _fill order_ within an
unchanged box, so the existing `translateX(-page·pageStep)` chunking still lands
on the right page. Added `demo-rtl` (synthetic Arabic, `page-progression-direction:
rtl`, `lang="ar"`, no vertical) + a Playwright spec (multicol direction, key
swap, `-pageStep` translate) to prove it. Browser-verified: justified RTL
paragraphs, ArrowLeft → `translateX(-576px)`.

---

## I5 — a11y flow mode · M ✅

- [x] Text engine flow mode: `#pore-viewport` becomes a vertical scroller,
      `#pore-flow` a single static column (no transform, `column-width:auto`,
      `writing-mode:horizontal-tb`). `turn()` scrolls one screen; a debounced
      scroll listener keeps `page` / progress in sync with manual / AT scrolling.
- [x] `TextEngineSettings.flowMode: 'paged' | 'flow' | 'auto'`; `auto` →
      `flow` under `@media (forced-colors: active)`. `reader:ready` carries
      `flow`. Anchor resume + search `gotoHit` use `scrollIntoView` /
      spine-percent in flow mode.
- [x] Image engine: page `alt` text is now `"<chapter> — page N of M"` (was
      `"page N"`); continuous-vertical is the linear a11y reading path
- [x] `reader-react` `<ReaderAnnouncer>` — a visually-hidden `aria-live=polite`
      region announcing chapter + progress changes (debounced); wired into the demo
- [x] Demo: "Reading mode" select in the Nav tab
- [x] Vitest (2): flow-mode stylesheet (scroller, no multicol/transform),
      engine reports `flow` + navigates + toggles back to paged
- [x] Browser-verified: flow mode scrolls by screen, progress tracks manual
      scroll, announcer fires, paged mode unaffected
- [ ] Playwright + axe keyboard traversal → **I6**

**Done when:** a screen-reader user can read a book linearly. ✅ done 2026-08-29

---

## I6 — hardening + release · S ✅

- [x] Playwright: vertical-JP RTL turn, flow-mode scroller, in-book search jump,
      download → `context.setOffline(true)` → reload → keep reading, plus an
      `@axe-core/playwright` no-critical-violations gate. Kavita flow is covered
      by the 10 `kavita-source` vitest cases (a live server isn't reachable in CI).
- [x] Perf: `SearchController.destroy()` terminates the worker (called from the
      text engine's `destroy`); the search index is built once, lazily;
      `MediaCache` LRU eviction is unit-tested against the budget; `createPdfEngine`
      disposes its `PdfDoc`
- [x] CHANGELOG `v0.5.0-m3`; README status ("fundamentals complete"); all plan
      checkboxes
- [x] Tag `v0.5.0-m3` → **UI foundation next** (`docs/ui-foundation-plan.md`)

**Done: M3 complete, engine fundamentals done.** 2026-08-29

---

## Dependency graph

```
I1 ─┐
I2 ─┼─→ I6
I3 ─┤
I4 ─┤
I5 ─┘
```

I1–I5 are largely independent; I2 (SW) and I3 (search) both touch the demo app
last. I6 gates the milestone.

## After M3

`docs/ui-foundation-plan.md` (Radix + Tailwind + GSAP). Then M4+: CFI,
highlights/notes, TTS, OPDS.
