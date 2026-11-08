# Architecture

How the engine works inside — for someone modifying `reader-core` /
`reader-react`. For _consuming_ the packages, see [`integration.md`](integration.md).
For the original rationale and the source seam, see
[`reader-engine-design.md`](reader-engine-design.md); for the image engine in
depth, [`image-engine-spec.md`](image-engine-spec.md).

---

## 1. The shape

```
                        ┌───────────────── apps/demo ─────────────────┐
                        │  App.tsx        view state, source wiring    │
                        │  Chrome.tsx     the reader chrome            │
                        │  styles.css     ALL styling (Tailwind v4)    │
                        └───────────────────┬─────────────────────────┘
                                            │ porejs-react (headless)
        ┌───────────────────────────────────┴───────────────────────────────┐
        │  <ReaderProvider source>   <Reader bookId>   hooks   headless UI   │
        └───────────────────────────────────┬───────────────────────────────┘
                                            │ porejs (no React)
        ┌───────────────────────────────────┴───────────────────────────────┐
        │  ReaderSource ──► Manifest / pages / Position / highlights         │
        │  createImageEngine · createTextEngine · createPdfEngine           │
        │  position model · settings · search · offline cache               │
        └───────────────────────────────────────────────────────────────────┘
```

`<Reader>` reads the manifest, picks an engine by `manifest.type` (`epub` →
text, `pdf` → PDF, else image), mounts it imperatively into a host `<div>`,
subscribes every `reader:*` event to React state, and exposes a `ReaderHandle`.
React never renders inside the engine's DOM.

### Entry points

- **`porejs`** (`src/index.ts`) — the curated, SemVer-covered surface
  (`docs/stability.md`). `src/public-api.test.ts` pins the runtime export list;
  changing it is an API change + a changeset.
- **`porejs/internal`** (`src/internal/index.ts`) — layout math, anchor /
  pagination internals, the store/emitter, the low-level search index, TTS
  controller internals. Re-exports from the same modules; tsup hoists the
  shared code into a chunk so `internal.js` adds ~1 KB, not a duplicate bundle.
  Not covered by SemVer.
- **`dist/search-worker.js`** — its own tsup entry, loaded by the search
  controller via `new Worker(new URL('./search-worker.js', import.meta.url),
{ type: 'module' })`; it imports the shared search-index chunk as a sibling.
- `VERSION` is injected from `package.json` by tsup `define`
  (`__POREJS_VERSION__`).

---

## 2. The engine contract & event model

Every engine implements `mount / turn / goto / setSettings / on / destroy`
(`ReaderEngine` in `reader-engine.ts`). Events (via a tiny typed `Emitter`):

**Common** — `reader:ready`, `reader:resumed`, `reader:locationchange`,
`reader:progress`, `reader:loadingstate`, `reader:chrometoggle`, `reader:toc`,
`reader:end`, `reader:start`, `reader:error`.

**Image adds** — `reader:layoutchange`, `reader:settingschange`,
`reader:zoomchange`, `reader:autoscroll`, `reader:autoadvance`.

**Text adds** — `reader:searchresults`, `reader:selection`,
`reader:highlightschange`, `reader:ttsstate`, `reader:footnote`,
`reader:endpage`.

**PDF** — the image set + `reader:toc`, `reader:searchresults`,
`reader:selection`, `reader:highlightschange` (it wraps the image engine and
adds an `on` that routes the extra events to its own listener sets).

Subscribing to an unknown event name is harmless (registers into a set that
never fires) — which is why `reader-react` can subscribe `reader:selection`
etc. unconditionally.

---

## 3. Position & Locator

`Position` (round-trips through the source, must stay JSON-stable):

```ts
| { type: 'page';   value: number; total: number }             // image, PDF
| { type: 'anchor'; spine; block; offset; percent }            // reflowable text
| { type: 'scroll'; value: number; total: number; page? }      // continuous
```

`Locator` is the richer read-model derived each location change: `{ position,
page, total, percent, label, chapter? }`. `ReaderProgress` adds the
chapter/pace line ("Ch 4 of 12 · 18 min left") via `PaceEstimator` (rolling
seconds-per-page average).

The **anchor** position is block-ordinal + flattened-text-offset — it survives
viewport resizes and font changes because it re-resolves against the laid-out
document, not a pixel offset. `resolveAnchor` falls back to whole-block
resolution when there's no layout signal (jsdom, drifted document).

---

## 4. Text engine (`text/create-text-engine.ts`, ~1300 lines)

The hard part. EPUB is parsed (`text/epub/parse.ts`, `fflate` for the zip) into
a spine of XHTML resources. Each spine item is rendered into a **sandboxed
`<iframe srcdoc>`** after `rewriteResources` inlines images/CSS as blob URLs,
(optionally) strips author CSS, drops `<script>` / `on*` handlers /
`javascript:` URLs / nested frames, and injects a strict
`Content-Security-Policy` meta (`default-src 'none'; script-src 'none'; …`).

- **No author scripts run.** The CSP `script-src 'none'` is the real guarantee;
  `rewrite.ts` is defence in depth. The sandbox is
  `allow-same-origin allow-scripts` — `allow-scripts` is there _only_ because
  **WebKit/Safari delivers no pointer/selection events to a sandboxed frame
  without it**; the CSP still blocks every script. No `allow-top-navigation`,
  `allow-forms`, `allow-popups`, `allow-modals`, `allow-downloads`.

- **Pagination** — CSS multi-column: the content flows into `#pore-flow` inside
  `#pore-viewport`; turning a page is a `translateX` by one column step.
  `paginate.ts` has the column math; `spinePageCount` = `scrollWidth / pageStep`.
- **Vertical / RTL** — writing-mode + direction on the flow; the same translate
  logic on the other axis.
- **Flow mode** — an accessible single-column scroll instead of pagination
  (screen-reader friendly).
- **Resume** — `anchor.ts` generates/resolves the anchor position; done before
  first paint.
- **CFI** — `cfi.ts` — a documented **"epubcfi-shaped"** serialization
  (`epubcfi(/6/N[idref]!/steps:offset)`), element-sibling steps only, not full
  IDPF conformance. Used for portable positions and highlight interchange.
  `getCfi()` serializes the current position; **`goToCfi(cfi)`** is the inverse
  — `parseCfi` → a `pendingCfi`, and `resolvePendingCfi()` (run in
  `renderSpine`'s finish, or synchronously when the target spine is already
  current) resolves the element via `resolveCfiElement`, walks up to the
  nearest block, translates the element-relative offset to block-relative, and
  hands a `pendingAnchor` to the normal resume path. No-op on image/PDF.
- **Highlights** — `highlight.ts` turns a selection `Range` into a
  block-ordinal `HighlightRange`; painted with the CSS Custom Highlight API
  (`CSS.highlights.set` + `::highlight()`), `<mark>` + `Range.surroundContents`
  fallback. `HighlightRecord` is a `text | rect` union (rect = PDF).
- **Fixed-layout** — `rendition:layout="pre-paginated"`: one scaled page per
  spine item, no columns; `fixedLayoutScale` fits the `<meta viewport>` size to
  the window; `applyFixedLayoutTransform` sets a `translate() scale()` on the
  flow. **Single page only** — two-page spreads (F3b) are deferred.
- **TTS** — `tts.ts` — a synth-agnostic controller (`Intl.Segmenter` sentences,
  injected `SpeechSynthesis`-shaped API), sentence highlight sync + auto
  page-turn.
- **Theme** — `THEME_COLORS` (light/sepia/dark/oled) is injected into the
  iframe as `#pore-base-style`. **This palette must move in step with the demo
  shell's `@theme` tokens.**

**jsdom caveats:** `iframe.contentDocument` is unreliable after the initial
mount tick; `Range.getBoundingClientRect()` throws. Tests cover the pure logic
(paginate math, anchor/CFI round-trips against fake documents); real rendering
is proven by browser verification.

---

## 5. Image engine (`image/create-image-engine.ts`, ~900 lines)

Manga / comics / any page-image book. See `image-engine-spec.md` for the full
spec.

- **Layouts** — paged single, paged double (spread pairing in `spreads.ts` with
  `spreadOffset` and late wide-page discovery), continuous vertical, continuous
  horizontal.
- **Continuous** — virtualized (`continuous.ts`): only pages in the viewport ±
  overscan are mounted; `estimateLinearLayout` predicts offsets, corrected as
  real pages measure.
- **Preload** — a `window` ring buffer (`prefetch.ts`) or a whole-chapter `all`
  mode with a byte guard. Loading strategy: `native` `<img>`, `blob` URL, or
  `bitmap` (decode to canvas).
- **Input** — `input.ts` — remappable keymap, tap zones, swipe, wheel; plus
  autoscroll and paged auto-advance with a next-chapter countdown.
- **Zoom/pan** — transform on the viewport, routed through the transitions seam.
- On `mount()` it does `container.replaceChildren(root)` — anything else
  appended to the container before mount is wiped (the PDF highlight overlay
  works around this by attaching on `reader:ready`).

---

## 6. PDF engine (`pdf/`)

`parse.ts` wraps pdf.js (lazy `import()`, worker set via `setPdfWorkerSrc`).
`PdfImageSource` adapts a PDF into an `ImageManifest` + webp page blobs so the
**image engine renders it unchanged**. `createPdfEngine` wraps the image engine
and adds: the document outline as `reader:toc`, full-text search over the
per-page text layer, and **rect highlights** — `pdf-highlights.ts` hangs a
transparent overlay over the page `<img>`, a Shift+drag marquee is intersected
with `PdfDoc.textRects(page)` (pdf.js text runs) and snapped to line rows.
Single-page mode only.

---

## 7. Sources & offline

- `CachedSource(inner)` — local-first manifests + resume + `MediaCache` (whole
  books downloaded to a `KvStore` over IndexedDB, `offline/idb.ts`). Implements
  `loadHighlights`/`saveHighlights` **and `loadBookmarks`/`saveBookmarks`**
  locally (`#bmKey`). Mirrors the `saveProgress` pattern.
- **Bookmarks** are a per-book collection like highlights — `Bookmark`
  (`source/types.ts`) is `{ id, position, cfi?, page, percent, label, text?,
createdAt }`. No engine involvement: `reader-react`'s `useBookmarks()` sits
  over the handle (`getCfi` / `goto` / `goToCfi`) + the source's optional
  methods.
- **Portability** (demo): `apps/demo/src/portability.ts` — a versioned
  `pore.js/annotations` JSON bundle (`docs/portability-format.md`),
  merge-by-id. The demo's `useLibrary()` (a `KvStore` shelf) and
  `<AnnotationsReview>` are demo-level, not core — a non-caching source can't
  enumerate "every book".
- The demo service worker (`apps/demo/public/sw.js`) precaches the app shell
  (parses `index.html` for the hashed `/assets/*`) and does
  stale-while-revalidate + cache-first with `ignoreVary`.

---

## 8. Search

`search/` — an inverted index built from `SearchSection[]` (one per spine item
/ PDF page). `SearchController` runs it in a Worker (`workerFactory`), falling
back to synchronous. Results are `SearchHit` with a section index + snippet;
`gotoHit` jumps the engine there.

---

## 9. `reader-react`

`reader.tsx` is the whole runtime: it owns the engine ref, subscribes every
event to `useState`, builds the `ReaderHandle` (`useMemo`), and exposes
everything through a context consumed by the `useReader*` hooks. Components
(`settings-panel`, `table-of-contents`, `highlights-panel`, `bookmarks-panel`,
`scrubber`, `footnote-popover`, `announcer`) are thin, headless, and read the
context.
`primitives.tsx` wraps Radix (Dialog, Tabs, Slider, Switch, Popover) with
`data-pore-*` hooks. **No stylesheet is shipped.**

---

## 10. Testing strategy

| what                                                                                       | how                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| pagination math, anchor/CFI round-trips, ZIP parsing, spread pairing, OPDS parsing, search | **Vitest** (`reader-core`), against fake documents                              |
| React wiring, primitives                                                                   | **Vitest** + Testing Library (`reader-react`)                                   |
| gestures, resize, resume, offline, a11y (axe), the assembled chrome                        | **Playwright** against the built demo (`apps/demo/e2e/reader.spec.ts`)          |
| anything needing a real iframe/`Range`/`SpeechSynthesis`                                   | **browser verification** — drive the running demo, read console/DOM, screenshot |

Run the full Playwright suite every milestone — it has repeatedly caught bugs
the unit tests and manual checks missed.
