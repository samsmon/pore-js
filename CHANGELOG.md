# Changelog

## 1.0.0-rc.3 — 2026-11-07

### Highlights

- **Zero-flicker manga page turns via atomic pre-decode swap** — images pre-decode in memory and swap synchronously without white flash or layout jitter.
- **Auto-fit double page manga spread constraints** — strict dual-page spread containment (`max-width: 50%`, `object-fit: contain`) with smooth transitions during layout shifts and sidebar toggles.
- **Editorial brand logo & adaptive favicon suite** — bespoke editorial brand mark, dynamic SVG favicon responding to color scheme, and multi-resolution PNG/ICO suite compliant with `docs/design-language.md`.
- **Clean mobile layout** — streamlined bottom navigation bar removing scrubber clutter, moving Bookmark and Settings actions to the sticky mobile header with touch-optimized target sizing.
- **Multi-episode & multi-volume series support** — bundled Manga Volumes 1–3 fixtures, interactive EndPage next-volume prompt, header episode selector, and desktop bracket hotkeys (`[` / `]`).
- **Locked 1.0 fit scale** — zoom and panning interactions disabled across reading modes to eliminate accidental panel displacement during turns and gestures.

## 1.0.0-rc.2 — 2026-11-07

### Highlights

- **Mobile layout overhaul** — compact top bar, floating bottom bar, bottom sheet drawer for TOC & Settings, touch zones, and safe area insets.
- **Zero-flicker & zero-delay manga page turns** — synchronous prefetch lookup via `loader.getUrl()`, atomic spread replacement.
- **Auto-fit image transitions on sidebar toggle**.
- **Security hardening** — SEC-01 strict allowlist footnote HTML sanitization against Stored XSS.
- **Accessibility fixes**:
  - A11Y-01: RTL scrubber ticks (`insetInlineStart`).
  - A11Y-02: Comic page announcements.
  - A11Y-03: Stable highlight note keys.
- **Performance overhaul**:
  - PERF-01: Partitioned `RuntimeContext` eliminating cascading re-renders.
  - PERF-02: Async mount destroyed guards.
  - PERF-03: PDF `page.cleanup()` memory release.
- **API & DX**:
  - API-01: Subpath exports (`./reader`, `./primitives`, `./gsap`) in `porejs-react`.
  - API-02: Safe `import.meta.url` search worker.
- **Anti-monolith modularization** (`text-style.ts`, `text-tts-coordinator.ts`, `image-zoom.ts`, `image-autonav.ts`).

### Integration DX — `<Book>` (M8 H11)

- **`<Book>`** (`porejs-react`) — the one-call reader: `src` (a `.cbz`/`.epub`/
  `.pdf` URL), `pages` (a list of image URLs), or `file`; plus `meta`
  (`title` / `author` / `volume` / `chapter` / `direction`), `progress` +
  `onProgress`, `onEnd`, `seriesId`, `fetch`. No `<ReaderProvider>`, no
  `ReaderSource` to implement.
- **`createReaderSource(input)`** (`porejs`) — the source builder behind
  `<Book>`, usable without React. `readerSourceKey(input)` for a stable key.
- **`<Reader onEnd>`** — `({ kind, hasNext })` at the end-of-book/chapter card;
  swap `bookId` to load the next chapter.
- **`<Reader settingsKey>` / `<Book seriesId>`** — keep fit / direction / zoom
  across chapters served as separate books.
- **A failed page image now shows a tappable "tap to retry" tile** in the flow
  instead of a silent blank (image / PDF). Retries just that page. The demo's
  blocking error card is fatal-only now.
- `LocalFileSource` options accept `subtitle` / `volume`.

### Release pipeline & deploy (M8 H8–H9)

- **`.github/workflows/release.yml`** — Changesets: a "version packages" PR on
  merge to `main`, `changeset publish` with npm provenance when it merges, then
  a GHCR push of the demo image. Dormant until repo var `RELEASE_ENABLED=true` +
  `NPM_TOKEN` (see `docs/releasing.md`).
- CI `check` now a **node 20 + 22** matrix; a `docker` job builds the demo image
  on every PR.
- **`apps/demo/Dockerfile`** + `nginx.conf` + `docs/deploy.md` — the demo as a
  static nginx image for the homelab.

### Security & a11y (M8 H7)

- **CSP recipe + EPUB trust model** documented (`docs/integration.md §0`) — no
  author JS runs, the reading frame can't navigate your page or hit the network.
- **`docs/accessibility.md`** — keyboard map, ARIA/announcer story, automated
  coverage, the manual gap.
- Demo: **`Esc` closes the open panel and restores focus**; a
  `@media (forced-colors: active)` fallback (system colours under Windows High
  Contrast); axe checks now cover WCAG 2.1 A/AA too.

### Size budgets (M8 H6)

- `size-limit` budgets in CI: `porejs` text engine + sources **18 kB** brotli,
  image engine + sources **12 kB**, all three engines + every source **30 kB**
  (pdf.js code-split out), `porejs-react` **2 kB**. pdf.js (~130 kB) stays a
  lazy chunk — see `docs/integration.md §8`.
- Perf guard-rail tests (`buildSpreads`, search index, CFI) in `pnpm test`.

### Cross-browser (M8 H5)

- **Fixed: PDF pages didn't render on any browser without `OffscreenCanvas`**
  (Playwright's WebKit, older Safari) — `renderToBlob` now falls back to an
  `HTMLCanvasElement`, and to PNG where the canvas can't encode WebP (Safari).
- **Fixed: text selection / footnote taps / highlighting were dead in
  Safari/WebKit** — a sandboxed reading frame without `allow-scripts` gets _no_
  input events in WebKit. The frame's sandbox now has `allow-scripts`; scripts
  are still fully blocked by a new in-frame CSP (`script-src 'none'`) plus
  `rewrite.ts` stripping `<script>` / `on*` / `javascript:` / nested frames.
- e2e now runs on **Chromium + Firefox + WebKit** in CI (matrix job).

### Robustness (M8 H4)

- **Fixed: a corrupt / unreadable book showed a blank reader** — `<Reader>`
  now catches a failing `getManifest()` / `mount()` and surfaces it as the
  error card instead of an unhandled rejection.

### Demo chrome trim

- **Removed the Prev / Next, Download-for-offline and Fullscreen buttons** from
  the reader rail — page turning is keyboard (←/→), edge tap-zones and swipe;
  fullscreen is the browser's own (F11). The offline **download** feature keeps
  its engine support (`CachedSource` + `useDownload`) but no longer has a demo
  UI entry point.
- Highlights / Bookmarks panels now open on the **opposite side from the menu
  rail** so they never cover its buttons.
- `demo-pdf` sample now opens **left-to-right** (was inheriting the image
  engine's `rtl` default).

## v0.10.0-library — 2026-09-06

M7 — library & portability (`docs/m7-plan.md`). Bookmarks, a home shelf of what
you've read, a place to review every annotation, portable export / import, and
`?cfi=` deep links. Additive: new _optional_ source methods, one engine method,
new headless components — nothing removed.

### Engine + packages (L0 / L1)

- **`goToCfi(cfi)`** on `TextEngine` and `ReaderHandle` — the inverse of
  `getCfi()`. Resolves an `epubcfi`-shaped string to the nearest block and
  feeds the normal anchor path; a no-op on image / PDF. `resolvePendingCfi()`
  translates the CFI's element-relative offset to block-relative.
- **`Bookmark`** type + optional **`ReaderSource.loadBookmarks?` /
  `saveBookmarks?`**; `CachedSource` implements both local-first. Exported from
  both packages, alongside `TextHighlightRecord` / `RectHighlightRecord` /
  `NormRect`.
- **`useBookmarks()`** (reader-react) — `add(label?)` / `remove` / `rename` /
  `goTo` / `toggle`, `isBookmarkedHere`. Snapshots `position` + `getCfi()` +
  page / percent; jumps by exact position, keeps the CFI for export. Headless
  **`<BookmarksPanel>`** (`data-pore-bm-*`). `ReaderCtx` gained `bookId` +
  `source`.

### Demo (L2–L5)

- **Library / home shelf.** `useLibrary()` over IndexedDB — a "Continue
  reading" section on the landing with per-book progress, "N min ago", a layout
  glyph, and remove. Sample books resume in place; dropped files are history.
- **Annotations review.** A full-screen overlay from the shelf header —
  highlights + bookmarks grouped by book, collapsible, text filter, jump
  (with an orienting pulse).
- **Export / import.** Versioned `pore.js/annotations` JSON bundle
  (`docs/portability-format.md`), per-book or whole-library. Import validates
  the schema version and merges by id (skip on clash unless overwrite).
  `apps/demo/src/portability.ts` is unit-tested; the demo is now in
  `vitest.workspace.ts`.
- **Share a passage.** "Copy quote" on the selection toolbar (passage +
  chapter + link); the rail link button copies a full `?book=&cfi=` deep link.
  Opening a `?cfi=` link navigates there and plays a ~2s pulse, then strips the
  param.
- Removing a shelf entry frees its offline copy; annotations are kept (they
  reappear if the book is reopened).

### Tests / a11y

- 44 Playwright specs (bookmark round-trip, library resume, review jump + axe
  light/dark, export→import round-trip, `?cfi=` deep link) · 263 unit.

## v0.9.0-editorial — 2026-09-06

M6 — an editorial redesign of the demo (`docs/m6-plan.md`,
`docs/design-language.md`). Quiet, reading-first: warm paper, strong
typography, chrome that recedes. No engine behaviour changed.

### Design language (D0)

- **Warm, accent-less palette.** `@theme` rebuilt on warm neutrals
  (`#faf7f1` / `#17150f`); `--color-accent` removed — active controls fill with
  the ink. One functional colour, `--color-focus`, plus `--color-danger`. Soft
  warm-tinted `--shadow-panel` / `--shadow-popover`. The four reading themes
  (`THEME_COLORS`) warmed to match.
- **Bundled fonts.** Hanken Grotesk (UI) + Literata (display / reading serif),
  self-hosted via `@fontsource-variable` — the Google Fonts CDN link is gone.

### Reader chrome (D1)

- **The menu bar is one collapsible rail** on the left or right edge; it
  collapses to an icon-only strip. **Settings live in the same rail** — the
  _Settings_ button expands its sub-sections inline as a height-animated
  accordion, one open at a time. No modal dialog, no slide-over. New headless
  `Accordion` primitive (`SettingsAccordion`); `SettingsPanelBody` /
  `TextSettingsPanel` / `ImageSettingsPanel` take `layout?: 'tabs' |
'accordion'`.
- Controls: Prev / Next, Theme + Pin as one row above Settings, Fullscreen
  (real Fullscreen API), Download-for-offline, a page-turn-animations toggle.
  lucide SVG icons. `useAutoHide` wakes on real pointer/key/wheel/touch again.
- Only left / right placements remain; the demo dropped the top placement.

### Panels, landing, reading surface (D2–D4)

- Highlights panel + note editor + swatches restyled; the resume toast,
  `.notice` and the OPDS error banner moved onto the ink / `--color-danger`
  tokens.
- **New landing page** — left-aligned serif masthead, a real statement, sample
  cards each with a small inline-SVG layout diagram, and a footer (GitHub, the
  Project A / B story, licence).
- **Reader font menu wired to the bundled faces.**
  `CreateTextEngineOptions.fontFaceCss` (and `<Reader fontFaceCss>`) injects an
  `@font-face` sheet into the reading iframe; Serif → Literata, Sans → Hanken
  Grotesk (graceful fallback when no font is injected). Reading rhythm nudges:
  `hyphens` when justified, `orphans/widows`, `text-wrap: balance` on headings.

### Webtoon width (M6)

- The continuous-vertical strip honours the reader's `maxWidth` — pages are
  centred and capped so a webtoon reads at a comfortable size on a wide screen
  (`create-image-engine.ts` `stripWidth()`).

### Motion, responsive, hardening (D5–D7)

- One `:focus-visible` ring everywhere from `--color-focus`; a global
  `prefers-reduced-motion` block.
- Mobile (`≤ 640px`): the rail overlays instead of docking and starts
  collapsed; the toast sits at the top edge.
- Autoscroll removed from the demo UI (the engine capability stays). Playwright
  suite rewritten for the new chrome + a dark-mode axe scan added — 38 e2e,
  256 unit, all green.

## v0.8.0-comfort — 2026-09-06

M5 — reading-comfort chrome + annotation polish. Menu bar you can place on any
edge and auto-hide; highlight notes and a reusable `<HighlightsPanel>`; PDF
highlights by Shift-drag. Fixed-layout two-page spreads (F3b) were deferred to
a later milestone — the text engine's single-iframe / per-spine-item page model
needs a wider reshape than M5's scope.

- **PDF highlights (M5 F2c)** — **Shift-drag** over a page in the demo PDF to
  highlight a passage: the marquee is intersected with pdf.js's text runs, so
  the highlight snaps to the covered lines and stores the real text. Painted
  back over the right page, listed in the same `<HighlightsPanel>` as EPUB
  highlights (jump = go to page), and persisted through the same
  `ReaderSource.loadHighlights` / `saveHighlights`. `HighlightRecord` is now a
  `text | rect` discriminated union; `createPdfEngine` gains
  `addHighlight` / `removeHighlight` / `updateHighlight` / `listHighlights` and
  `reader:selection` / `reader:highlightschange`; `PdfDoc.textRects(page)` is
  new. Single-page mode only — continuous / zoomed views don't paint the
  overlay (highlights stay saved).
- **Highlight notes & a reusable highlights panel (M5 F2b)** —
  `TextEngine.updateHighlight(id, { color?, note? })` (also on `ReaderHandle`
  and `useReaderSelection()`); `note: ''` clears the note. New headless
  `<HighlightsPanel>` in `porejs-react` — renders the list with
  `data-pore-hl-*` hooks (jump / recolour / note textarea / remove) and calls
  the handle; the demo dropped its hand-rolled markup for it. The selection
  toolbar gained a "highlight + note" action.
- **Menu bar placement & behaviour (M5 G1)** — the demo's menu bar can now sit
  on the top, left or right edge for _every_ engine (not just EPUB), set in
  Settings → Menu bar. A "Behaviour" choice picks "Always visible" (docks a side
  bar, insetting the reader; hides only in fullscreen) or "Auto-hide" (slides
  away when idle, wakes on pointer/keyboard — including pointer moves over the
  sandboxed text iframe, which are now forwarded to the host). Fullscreen always
  forces auto-hide. `menuPosition` / `menuReveal` are gone from
  `TextEngineSettings` (the demo owns bar placement now); `<SettingsPanel>` /
  `<TextSettingsPanel>` gained an `extraTabs` prop.
- **Floating top bar** — the demo's top bar was `position: relative`, so
  auto-hiding it left a dead strip where its layout slot used to be (in the
  shell's colour, not the reader's). It's now an absolute overlay: the reader
  content is always full-height, the bar floats over the top edge when shown.
- **One-click sepia** — the reader has had light / sepia / dark / OLED themes
  all along, but sepia lived in Settings → Theme. On an EPUB the top-bar theme
  button now cycles the reader's own theme (light → sepia → dark, ☀ / ☕ / ☾);
  OLED stays in Settings.
- The progress bar and scrubber use the theme foreground instead of the orange
  accent — white on dark, dark on light. Active toolbar toggles do too (the
  orange fill also failed AA contrast against its white label).
- **Demo landing page** — the demo opens on a landing screen instead of
  auto-loading a sample: "open your own" (drop/pick an EPUB, PDF, CBZ/ZIP or
  image folder — all client-side) and "try every mode" (the seven sample
  fixtures, each labelled with what engine mode it shows). A `?book=<id>`
  deep link still goes straight to the reader; the bar's "Pore.js" wordmark
  is now a "Back to start" button.
- **Smaller demo bundle** — `setPdfWorkerSrc()` lets an app point pdf.js at
  its worker with just a URL, so pdf.js no longer has to be statically
  imported. The demo's main chunk drops from ~960 kB to ~484 kB (308 → 164 kB
  gzipped); pdf.js becomes its own chunk, loaded only when a PDF is opened.
- The demo's "Resumed from p.N" toast auto-dismisses after 15s.

Post-`v0.7.0-annotate` — fixes from running the full Playwright e2e suite to
completion for the first time (it now passes). All of these predate M4:

- **TOC navigation was silently broken** — `TextEngine.goToHref()` (what
  `<TableOfContents>` calls) re-resolved its argument against the current
  chapter's directory, but the TOC hands it an already-archive-absolute path,
  so it double-resolved and matched nothing. Split into `gotoHref`
  (chapter-relative, for in-book links) and `gotoResolvedHref` (the public
  API's actual contract).
- **Settings dialog a11y** — the close button was a DOM child of
  `role="tablist"` (an ARIA violation — only `tab` children allowed); moved it
  to a sibling wrapper. Escape now also returns focus to the control that
  opened the dialog (Radix only does this for a `Dialog.Trigger`, but the demo
  drives it with a controlled `open` prop).
- **Offline "download a book, then reload" was broken** — the demo service
  worker never precached the content-hashed build assets, a `Vary: Origin`
  header hid valid cache hits, and `CachedSource` didn't persist the book
  manifest. Fixed all three; `CachedSource.download()`/`getManifest()` now
  save and fall back to the manifest for genuine offline reads.
- Fixed the e2e suite's own stale selectors (querying chrome buttons by glyph
  text instead of their `aria-label`s) and a couple of brittle test
  assumptions.

## v0.7.0-annotate — 2026-09-05

M4 — precise text ranges, highlights, fixed-layout EPUB, an OPDS source,
text-to-speech — plus post-`v0.6.0-ui` UI polish. See `docs/m4-plan.md`.

- **F6 hardening** — added Playwright coverage for highlight persistence +
  click-to-jump, fixed-layout page-turn, OPDS browse → open, and the TTS
  state machine. Writing the highlight test found a real bug:
  `highlight.ts`'s `offsetOfPoint` only handled a Range boundary point that
  was already a text node, so a whole-block selection made via
  `Range.selectNodeContents()` (element + child-index boundaries, per the DOM
  Range spec) silently failed to highlight. Fixed. Also fixed the
  pre-existing Playwright suite's button selectors, which queried by glyph
  text (`'›'`/`'‹'`/`'⚙'`) instead of the `aria-label`s those buttons
  actually carry — a stale mismatch that had apparently never been caught
  because the suite had never been run end-to-end before this milestone.
- **Text-to-speech (EPUB)** — `TextEngine.ttsPlay/ttsPause/ttsResume/ttsStop/
ttsSetRate/ttsSetVoice/ttsListVoices/ttsState`, backed by a synth-agnostic
  `createTtsController` + `Intl.Segmenter`-based sentence splitting
  (`text/tts.ts`). Speaks sentence by sentence via the browser's
  `SpeechSynthesis`, highlights the currently-spoken sentence (reusing F2's
  highlight renderer under its own name), and auto-turns the page as
  playback moves past what's showing. `reader-react`'s `useTts()` hook; the
  demo adds a 🔊 play bar (play/pause/stop, rate, voice picker, current
  sentence). Browser-verified with real system voices. See `docs/m4-plan.md`
  F5.
- **`OpdsSource`** — a read-only OPDS 1.2 (Atom) catalog client:
  `listCatalog()`/`acquire()`, HTTP Basic or bearer auth. Acquiring an entry
  downloads its acquisition link and wraps the bytes in a `LocalFileSource`,
  reusing its existing EPUB/PDF/CBZ sniffing. The demo adds a 📚 catalog
  browser (URL input, entry list, pagination) against a bundled fixture
  catalog (`/opds/catalog.xml`) — a real external host (e.g. Project
  Gutenberg's) works too if it allows CORS, just isn't the default given a
  portfolio demo shouldn't depend on a third party's uptime/CORS policy.
  OPDS 2.0 is out of scope. See `docs/m4-plan.md` F4.
- **Fixed-layout EPUB** — a `rendition:layout="pre-paginated"` book (previously
  rejected with an error) now renders: one scaled, centred page per spine
  item instead of reflowable text, driven by the page's own `<meta
name="viewport">` size. Kept as a live iframe (not a canvas snapshot) so
  selection/highlighting keep working. New `demo-fixed` synthetic fixture
  (a 4-page kids'-book-style EPUB) in the demo's book picker. Page-spread
  pairing is not included — see `docs/m4-plan.md` F3.
- **Text highlights (EPUB)** — `TextEngine.addHighlight`/`removeHighlight`/
  `listHighlights()`, driven by a debounced `reader:selection` event off the
  sandboxed iframe's own selection. Persisted via new optional
  `ReaderSource.loadHighlights`/`saveHighlights` methods (`CachedSource`
  implements both, mirroring its progress-caching pattern). Rendered with the
  CSS Custom Highlight API where available, a `<mark>` fallback otherwise. The
  demo adds a selection toolbar (color swatches) and a highlights panel
  (list/jump/remove). Fixed a pre-existing bug found while verifying jump-to
  at desktop width: anchor/CFI page resolution didn't account for the reading
  column being centred in a wider window, landing on the wrong page — now
  fixed for resume-position and `getCfi()` too. See `docs/m4-plan.md` F2.
- **Word-level anchor offsets + `epubcfi`-shaped positions** — `anchor.ts`
  now records a real character offset into the resolved block (previously
  hardcoded to `0`) via a word-level `Range` walk, with a whole-block fallback
  when no layout signal is available. New `cfi.ts` module serializes/parses a
  documented, pragmatic CFI-shaped string (`epubcfi(/6/N[idref]!/steps:offset)`
  — element-sibling step numbering, not full IDPF conformance) that round-trips
  through nested inline markup. `TextEngine.getCfi()` exposes it end-to-end
  through `reader-react`'s `<Reader>` handle; the demo adds a 🔗 "Copy position"
  button for EPUBs. See `docs/m4-plan.md` F1.
- **`<ReaderScrubber>`** — a Radix `Slider` bound to the reader position:
  drag / keyboard seek → `goto`, chapter tick marks, a live
  "Ch 3/12 · 47% · N min left" label. `useReaderChapters()` hook. The demo docks
  it at the bottom, auto-hiding with the chrome.
- **End-page / drop-zone restyle** — the end-page gets an accent icon badge, a
  "N chapters · finished" / "Chapter X of Y" subtitle, and a primary
  Restart/Continue button with a fade+scale entrance; the drop-zone is now a
  centred dashed card with an icon and file-type hint.
- **RTL-horizontal EPUBs (Arabic/Hebrew)** confirmed working — no engine change
  needed, since CSS multicol reverses column fill order within an unchanged
  box, so the existing paged translate math already lands on the right page.
  Added `demo-rtl` (synthetic Arabic) fixture + a Playwright spec proving
  direction, multicol, and the key swap.
- **PDF in-book search** — `PdfImageSource` exposes `textContent(page)` /
  `pageCount()`; `createPdfEngine` builds a `SearchController` over the PDF's
  text layer and adds `search()` / `gotoHit()` / `reader:searchresults`, same
  shape as the EPUB engine (page-level jump, not rect-level). The demo's search
  panel now works for PDFs too.
- **Loading skeleton + error tile** — the image engine's `loadInto` now emits
  `reader:loadingstate` (`loading`/`loaded`/`error`) for the _visible_ page, not
  just prefetch; `reader-react` gains `useReaderError()` (last `reader:error` +
  `dismiss`/`retry`, where `retry` re-`goto`s the current page). The demo shows
  a shimmering skeleton tile after a 220 ms delay (no flash on fast loads) and a
  centred "Couldn't load this page" tile with Retry/Dismiss on error.

## v0.6.0-ui — 2026-08-30

UI foundation: Tailwind, a headless Radix component layer, and an injectable
animation seam with a GSAP adapter — none of it reaching the framework-agnostic
core.

### Added — styling & tokens

- **Tailwind v4** in the demo (`@tailwindcss/vite`); `styles.css` is an `@theme`
  token block plus `@layer components` with `@apply`. Class-strategy dark mode
  (`@custom-variant dark`) with a `.dark` palette; `useTheme()` toggle.

### Added — animation seam

- **`ReaderTransitions`** (`transitions.ts`) — `page` / `zoom` / `scrollTo` /
  `cancel` with a `{ axis, dir, reduced }` context. `instantTransitions` is the
  synchronous default (no behaviour change). The text and image engines route
  their translates / zoom / deliberate scroll through it; `<Reader transitions>`
  supplies a custom one. `prefers-reduced-motion` flows through as `ctx.reduced`.
- **`gsapAdapter(gsap)`** (`reader-react`) — eased page slides (~220 ms
  `power2.out`, fade on real turns), eased zoom, eased scroll, `cancel()` that
  kills every touched tween. `gsap` is an **optional peer dependency**.

### Added — headless Radix chrome (`reader-react`)

- **`primitives.tsx`** — `Field` / `SelectField` / `SliderField` (Radix Slider) /
  `SwitchField` (Radix Switch) / `Tabs` (Radix Tabs); every element carries a
  `data-pore-*` hook and takes `className`.
- **`<SettingsPanel>`** is a Radix `Dialog` (focus trap, Esc, overlay) wrapping
  the tab set (`SettingsPanelBody` picks image vs text; `KeybindEditor` is the
  Keybinds tab).
- **`<TableOfContents>`** (bound `<select>` → `goToHref`) and
  **`<FootnotePopover>`** (Radix `Popover`).
- **`useReaderLoading()`** — `true` while any page / spine image is in flight.

### Added — demo shell

- Auto-hiding top bar (idle 2.6 s, slide, wakes on activity / hover / focus,
  pinned while a panel is open); indeterminate top bar during loading; panel /
  search / footnote / toast enter animations — all disabled under reduced
  motion. Safe-area insets, coarse-pointer touch targets, viewport-clamped panel.
- **`<ReaderScrubber>`** — a Radix `Slider` bound to the reader position:
  drag / keyboard seek → `goto`, chapter tick marks, a live
  "Ch 3/12 · 47% · N min left" label. `useReaderChapters()` hook. The demo docks
  it at the bottom, auto-hiding with the chrome.

## v0.5.0-m3 — 2026-08-29

Platform integration, offline, in-book search, vertical text, and an accessible
flow mode. **The engine fundamentals are complete** — UI/animation work starts
next (`docs/ui-foundation-plan.md`).

### Added — a real library server

- **`KavitaSource`** — `ReaderSource` over [Kavita](https://www.kavitareader.com/)'s
  REST API. `bookId` = a Kavita `chapterId`; plugin-key auth exchanged for a JWT
  with one transparent re-auth on 401; `chapter-info` drives the manifest
  (Archive/Image → `image`, Epub, Pdf); pages via `/api/Reader/image`, files via
  `/api/Download/chapter` (`KavitaDownloadForbiddenError` on 403); progress
  round-tripped through `/api/Reader/progress`

### Added — offline

- **`MediaCache`** — IndexedDB blob store (its own DB) for downloaded pages /
  files with LRU whole-book eviction against a byte budget (default 500 MB)
- **`CachedSource` v2** — `getPage` / `getFile` serve the cached blob first;
  `download(bookId, { signal, onProgress })` (resumable), `downloadStatus`
  (`none` / `partial` / `complete`), `removeDownload`. `cache: false` keeps the
  progress-only behaviour.
- `reader-react` `useDownload(bookId)`; demo download button + a dependency-free
  service worker (SWR shell, cache-first fixtures + workers)

### Added — in-book search

- **`search/`** — normalised substring index + snippet/match-range extraction;
  `SearchController` runs queries in a Worker (own bundle entry) with a
  synchronous fallback, latest-query-wins
- Text engine `search(query)` / `gotoHit(hit)` + `reader:searchresults`;
  `reader-react` `useReaderSearch()` (debounced, `next`/`prev`); demo search panel

### Added — vertical & accessible reading

- **Vertical writing mode** (`vertical-rl`) — `TextEngineSettings.verticalText`
  (`auto` | `on` | `off`; `auto` = RTL progression + Japanese language). RTL and
  vertical books swap the horizontal keys; `reader:ready` carries `vertical`.
- **Flow mode** — `TextEngineSettings.flowMode` (`paged` | `flow` | `auto`;
  `auto` follows `forced-colors`). A single scrolling column, no transforms;
  `turn()` scrolls one screen, manual/AT scrolling stays in sync.
- Image page `alt` text gains chapter context; `<ReaderAnnouncer>` — a hidden
  `aria-live` region for chapter/progress announcements
- Playwright + `@axe-core/playwright` coverage for all of the above

## v0.4.0-m2 — 2026-08-29

PDF support and one unified position/chrome model across image, text and PDF.

### Added — PDF

- **`pdf/parse.ts`** — lazy `pdfjs-dist` (legacy build, Node + browser);
  `loadPdf(bytes) → PdfDoc` with `pageCount`, `pageSize`, `outline`
  (bookmarks → `#page=N`), `textContent`, `renderToBlob` (`OffscreenCanvas` →
  webp, `maxDim` memory cap)
- **`PdfImageSource`** — adapts a PDF into an `ImageManifest` + rendered page
  blobs (outline → `chapters[]`, progress proxied); the image engine consumes
  it unchanged
- **`createPdfEngine`** — `createImageEngine` over a `PdfImageSource`, adding
  `reader:toc` from the outline; `<Reader>` mounts it for `manifest.type: 'pdf'`

### Added — unified shell

- **`Locator`** `{ position, page, total, percent, label, chapter? }` — the one
  shape every engine emits in `reader:locationchange`; `ReaderEngine<S,E>`
  interface + `CommonEngineEvents`
- **`reader:progress`** `{ locator, percent, chapterLabel, chapterIndex,
chapterCount, pagesLeftInChapter, minutesLeft }` from every engine;
  `PaceEstimator` (EMA of seconds-per-page) drives `minutesLeft`
- **`chapters(): Chapter[]`** on every engine — `{ id, label, startPage,
startPercent }`; `chapterProgress()` maps page → chapter
- **`LocalFileSource`** opens a dropped `.epub` / `.pdf` (served whole through
  `getFile`), and sniffs OPF `rendition:layout=pre-paginated` → `fixedLayout`
- **`reader-react`** — `useReaderProgress()`, `handle.chapters()`
- Per-book settings persistence (`createSettingsPersistence`, `<Reader
persistSettings>`); `publisherStyles: false` strips author CSS; `dimImages`

### Added — EPUB navigation UX

- **End page**: the last chapter ends on a centred "The End" card (an extra
  page) so progress reaches a true **100%**; `TextEngineSettings.endBehavior`
  (`continuous` | `endpage`) makes every chapter pause on an end-of-chapter card
  with a Continue button. `reader:endpage` event + `useEndPage()`.
- **Menu placement**: `TextEngineSettings.menuPosition` (`top` | `left` |
  `right`) and `menuReveal` (`hover` | `click` | `dblclick`) for side menus;
  engine emits `reader:chrometoggle`, `useChromeVisible()`; demo `Chrome`
  positions/reveals the bar and shows a centred menu on the end page.
- Settings panel gains a **Navigation** tab for the above.

### Fixed — EPUB reader (post-M1 feedback)

- **Book-like layout**: the text engine now centres a capped reading measure
  (~33em, grows with font size) inside a clipped `#pore-viewport` / `#pore-flow`
  wrapper — no more full-width lines or columns bleeding in from adjacent pages;
  1 or 2 columns per page per the setting, dropping to 1 when it won't fit
  (`computeTextLayout`)
- **Input**: the text engine had none — added keyboard (← → ↑ ↓ A/D/H/L,
  Space / Shift+Space, PageUp/Down, Home/End, M), mouse wheel (throttled), and
  left/right/centre click zones, wired on both `root` and the iframe document
  (iframe events don't bubble)

## v0.3.0-m1 — 2026-08-29

EPUB reflowable text engine.

### Added

- **`porejs` — `text/`**
  - `parseEpub` — `container.xml` → OPF (metadata / namespace-agnostic manifest /
    spine) → EPUB3 nav or EPUB2 ncx TOC; `EpubBook.resource()`; path helpers
  - `createTextEngine` — sandboxed `<iframe srcdoc>` (scripts stripped),
    `body` CSS-multicol pagination via `translateX`, `ResizeObserver` reflow
  - `rewrite.ts` — `src` / `href` / CSS `url()` → `blob:` URLs, revoked on teardown
  - `paginate.ts` — `buildBaseStylesheet` (low-specificity typography), page math
  - `anchor.ts` — `generateAnchor` / `resolveAnchor` (exact block → nearest →
    spine-percent); resume lands on the paragraph, resize holds the fraction
  - `TextEngineSettings` — font family/size, line-height, justify, margins,
    columns (1–2), theme (light/sepia/dark/oled), publisher-styles toggle
  - `goToHref` (TOC), footnote / same-doc link interception → `reader:footnote`
  - fixed-layout EPUB detected → `reader:error`, not a crash
- **`porejs-react`**
  - `<Reader>` mounts the image **or** text engine by `manifest.type`;
    `useReaderKind`, `useTableOfContents`, `useFootnote`, generic
    `useReaderSettings<T>`, normalized `location.percent`
  - `<SettingsPanel>` → `<TextSettingsPanel>` (Text / Theme) for EPUBs
- **`apps/demo`** — `demo-book/book.epub` fixture (generated), book picker,
  "Contents…" dropdown, footnote popover; `DemoSource` serves EPUB fixtures

### Cut for M1

CFI, highlights/notes, TTS, fixed-layout EPUB, OPDS, in-book search, vertical-JP
text, RTL column flow, char-level anchor offset, selection/bookmark bridge.

## v0.2.0-m0.5 — 2026-08-29

Completes the image reader.

### Added

- **Layout**: `continuous-horizontal` (axis-generic virtualization, RTL via
  reversed layout slots); `direction: 'vertical'` reads as reverse (RTL-like)
- **Autoscroll** (rAF smooth / stepped), **paged auto-advance** timer, and a
  **next-chapter countdown** (`interceptChapterBoundary` → `reader:autoadvance`,
  cancellable) — all `prefers-reduced-motion` aware
- **`loadingMethod: 'bitmap'`**: `createImageBitmap` → `<canvas>` render for
  paged mode; `ImageBitmap.close()` on eviction; forced to `blob` with `all`
- **Image filters** wired: brightness, greyscale, and a `dim` overlay
- **`LocalFileSource`**: drop a `.cbz`/`.zip` (one-at-a-time inflate) or loose
  images; demo has a drop zone
- **`<SettingsPanel>`** (reader-react): Layout / Image fit / Behavior / Keybinds
  tabs with per-action key capture; new `reader:settingschange` event +
  `useReaderKeymap`
- **`useReaderHistory`**: `url-and-title` mode — `?p=` URL + browser
  back/forward paginate

### Changed

- `continuous.ts` API is axis-generic (`estimateLinearLayout`, `LinearLayout`)
- reader-react settings are single-sourced from the engine via events
- 88 unit tests; Playwright suite covers the new surfaces

## v0.1.0-m0 — 2026-08-28

First milestone: the image engine and a deployable demo. No backend.

### Added

- **`porejs`**
  - `ReaderSource` seam; `DemoSource` (fixture manifests + pages), `CachedSource`
    (local-first progress, offline write queue), `openKvStore` (IndexedDB KV)
  - Image engine (`createImageEngine`): paged single/double with spread pairing,
    `spreadOffset`, and late wide-page discovery; continuous-vertical webtoon
    with virtualization and measure-on-load scroll compensation
  - LTR / RTL; fit modes (width/height/contain/original/smart); zoom + pan
  - Preloading: `window` ring buffer and whole-chapter `all` with a
    `preloadAllMaxMB` byte guard; back-nav LRU; object-URL lifecycle
  - Input: remappable keyboard, tap zones (`tapToTurn`), swipe, wheel
    (`scrollToTurn`), double-tap, Fullscreen API, Wake Lock
  - Last-read checkpoint: `loadProgress` before first paint, debounced save
  - Position model + `clampPagePosition`; typed event emitter
- **`porejs-react`**: `<Reader>`, `ReaderProvider`, `useReader`,
  `useReaderLocation`, `useReaderSettings`, `useResumedFromPage`
- **`apps/demo`**: control bar, progress bar, resume toast, `?book=` URL,
  Playwright e2e suite, Vercel config
- Tooling: pnpm workspace, tsup, Vitest (75 tests), ESLint, Prettier, CI

### Deferred to M0.5

continuous-horizontal · vertical-JP direction · autoscroll · paged auto-advance ·
`bitmap` decode path · full tabbed settings panel · image filters · `url-and-title`
history mode · CBZ via `LocalFileSource`.
