# Known issues & bug log

Running list of bugs, limitations and papercuts — what's open, what got fixed,
and what's deliberately left alone. New entries at the top of each section.
Milestone plans (`docs/m*-plan.md`) hold the "why deferred" detail; this file is
the index.

Severity: 🔴 broken feature · 🟠 degraded / edge case · 🟡 papercut / nice-to-have

---

## Open — fix if/when motivated

### 🟡 PWA manifest + icons not done

The demo has a service worker (`apps/demo/public/sw.js`) but no
`manifest.webmanifest` / maskable icons / `theme-color`, so it's not "installable".
Small follow-up for H9; the reader works fine without it. _(M8 H9)_

### 🟠 No manual screen-reader pass yet

axe (2.0 + 2.1 A/AA), keyboard-traversal and `forced-colors` are automated and
green. A real **NVDA + VoiceOver** walk-through (open → read → TOC → highlight →
bookmark → settings → search → home) is still owed for `v1.0`. See
`docs/accessibility.md`. _(M8 H7)_

### 🟡 e2e flake: WebKit selection / reduced-motion under full parallel load

`highlight persists…` and `reduced motion: page turns apply instantly`
occasionally fail first-try on WebKit when both browsers run in parallel; pass on
retry (CI has `retries: 2`). The synthetic-selection tests now wait for
`.selection-toolbar` (10 s) which helped but didn't fully kill it. A real
mouse-drag selection helper would be firmer. _(M8 H5/H7)_

### 🟡 No engine-level performance scenario harness

`size-limit` gates bundle size and `perf.test.ts` guards the pure hot-paths
(`buildSpreads`, search index, CFI). There's no measurement of **first-page
TTI, `paginate` ms, or peak heap** for a real 1000-page PDF / 400-chapter EPUB /
3000-image webtoon in a real browser — that needs Playwright +
`performance.measureUserAgentSpecificMemory()`. Follow-up, not `1.0`-blocking.
_(M8 H6)_

### 🟡 `porejs` "all engines" import is +130 kB if the bundler inlines dynamic imports

`createPdfEngine` reaches pdf.js only through a **dynamic `import()`**
(`pdf/parse.ts`). Vite / webpack / Rollup code-split it into a lazy chunk by
default (so `import { createPdfEngine }` costs ~4 kB up front; pdf.js loads when
a PDF opens). A bundler configured to inline dynamic imports, or `size-limit`
without the `ignore`, sees the full ~130 kB brotli. Not a bug — but worth a
louder note in `integration.md` and maybe a `porejs/pdf` subpath export so the
split is explicit. _(found M8 H6)_

### 🟠 No load-time guard rails on the engines

A source that hangs forever in `getManifest()` / `getFile()`, a manifest with
100 000 pages, or an image page 100 000 px wide will not crash (H4 proved the
parse layer is safe) but also won't time out or clamp — the reader just spins.
Planned as additive `<Reader>` options (`loadTimeoutMs`, `maxManifestPages`,
`maxPageDim`); own small task, not `1.0`-blocking. _(M8 H4)_

### 🟠 Firefox e2e unverified on the maintainer's Windows box

`browserType.launch: spawn UNKNOWN` — an AV / Mark-of-the-Web quarantine of the
Playwright Firefox binary, not a code issue. Firefox **is** in the CI matrix and
green there. If CI ever flags a real Firefox-only bug it lands here. To run
locally: reinstall (`pnpm --filter @pore/demo exec playwright install firefox`)
and unblock the `.exe`. _(M8 H5)_

### 🟠 PDF pages are larger on Safari / no-`OffscreenCanvas` browsers

The WebP → PNG fallback (needed because Safari can't encode WebP from a canvas)
roughly triples the per-page blob size. Fine for reading, heavier on the
`MediaCache` offline download. A JPEG fallback (`image/jpeg`, q≈0.85) would be a
middle ground. _(M8 H5)_

### 🟡 Annotations review / export–import only see "sample" books in the demo

They read the shared demo source; a dropped local file keeps its annotations but
isn't listed until re-opened. Demo-level limitation (the review is a
`useLibrary()` + demo-source thing), not a library one. _(M7 L3 / L4)_

### 🟡 `demo-pdf` opened right-to-left until M8

`DEFAULT_IMAGE_SETTINGS.direction` is `'rtl'` (manga-first). PDFs and Western
comics want `'ltr'`. Worked around per-sample in the demo; the engine default is
arguably wrong for a general PDF but flipping it is a behaviour change for
manga-first consumers. Revisit at the API freeze if not already. _(M8 H5)_

### 🟡 e2e flake: vertical-JP under parallel load

`vertical-JP EPUB reads right-to-left` occasionally times out at 30 s when the
3-browser matrix saturates the box; passes solo and on retry. Polls for a
settled transform already; could use a firmer readiness signal. _(M8 H5)_

---

## Fixed

### 🟠 Not usable one-handed on a phone — `(M8 H12)`

No swipe on the text engine, no `touch-action` (300 ms tap delay, browser
fighting the engine for gestures), and the only way to the
menu was a keyboard or a centre tap you couldn't discover. Fixed at the engine
level: touch swipe-to-turn (text + image), deliberate `touch-action`, locked 1.0 fit scale on images (eliminating accidental zoom/pan displacement), and a faint bottom-centre chrome handle
(`[data-pore-chrome-handle]`, `chromeGesture` setting). Double-tap detection is
gated to `pointerType !== 'mouse'` so a fast double-click still turns two pages;
the synthetic `dblclick` that trails a touch double-tap is suppressed for 500 ms.

### 🟠 Manga library integration gaps — `(M8 H11)`

Three things that would have bitten a real per-chapter manga library, addressed
together with the `<Book>` one-call API:

- **Next chapter served as a separate `bookId`** had no hook → `<Reader onEnd>`
  / `<Book onEnd>` `({ kind, hasNext })` fires at the end-of-book card; the host
  swaps `src` / `bookId`.
- **A page image that fails mid-chapter showed a silent blank** → the image
  engine now renders a tappable "Page N — tap to retry" tile
  (`img[data-pore-page-error]`) that re-fetches just that page. The demo's
  blocking error card is now for fatal (whole-book) errors only.
- **Per-chapter `bookId` reset the reader's fit / direction / zoom every
  chapter** → `<Reader settingsKey>` / `<Book seriesId>` keys the per-book
  settings layer by a series id instead.
- CDN auth headers → `<Book fetch>` / `createReaderSource({ fetch })`.

### 🔴 Text selection / highlights / footnote taps were dead in Safari/WebKit — `7b70ab4` (M8 H5)

A sandboxed `<iframe>` without `allow-scripts` receives **no** input events in
WebKit. Fix: `sandbox="allow-same-origin allow-scripts"` + a strict in-frame CSP
(`script-src 'none'`) + `rewrite.ts` stripping `on*` / `javascript:` /
`<iframe|object|embed>` / `<meta http-equiv>`. Scripts still can't run.

### 🔴 PDF rendered nothing without `OffscreenCanvas` (Playwright WebKit, older Safari) — `7b70ab4` (M8 H5)

`pdf/parse.ts` `renderToBlob` now falls back to `HTMLCanvasElement`, and WebP →
PNG where the canvas can't encode WebP.

### 🔴 A corrupt / unreadable book showed a blank reader, not the error card — `c047e98` (M8 H4)

`<Reader>`'s mount effect `void`-ed its async work with no `try/catch` — a
rejecting `getManifest()` / `mount()` was an unhandled rejection + an empty
`<div>`. Now caught → error card.

### 🟠 PDF page-turn broke in the built demo (RTL default + physical input) — `4f2…` (post-M7)

Removing the Prev/Next buttons exposed that `demo-pdf` inherited the image
engine's `rtl` default, so keyboard/tap "forward" went backward. Fixed per-sample
(`settings: { direction: 'ltr' }`).

### 🟠 Highlights / Bookmarks panel covered the menu rail — `4f2…` (post-M7)

Rail defaults to the right edge; the panels were also `right`-anchored. They now
open on the opposite side (`highlights-panel--left`).

### 🟠 Native image drag navigated the page to the blob URL — (M6-era)

`img.draggable = false` + a `dragstart` guard in the image engine.

---

## Won't fix / by design

- **Author scripts in EPUBs never run.** CSP `script-src 'none'` + sandbox +
  `rewrite.ts`. Interactive EPUB3 widgets are out of scope.
- **No CJS build.** ESM-only (`docs/stability.md`).
- **The demo needs the network.** Offline-download UI was cut in M8 — the demo
  is served from a homelab; if the box is down, offline doesn't help. The
  library keeps `CachedSource` / `useDownload` for real consumers.
- **`porejs-react` ships no CSS.** Headless on purpose; style the `data-pore-*`
  hooks. `apps/demo/src/styles.css` is the worked example.
