# Pore.js — M8 Plan (hardening, embed, publish, deploy)

**Goal:** take Pore.js from "feature-complete demo" to "a reader another site
can drop in." Freeze and document the public API, make the packages **cleanly
embeddable in someone else's web app** (a manga library, a comics site — they
provide a mount point + a content source, Pore.js is the whole reader), prove
the engines against **real-world content**, pass on **more than one browser**,
set perf/size budgets, tighten security + a11y, **publish `porejs` +
`porejs-react` to npm**, and **deploy the demo on the owner's homelab**. Ends at
**`v1.0.0`**.

**Not a feature milestone.** No new reader capabilities. The offline-download
control removed from the rail post-M7 is **cut for good** — the demo needs the
network for the library and the reader anyway; `useDownload` / `CachedSource`
MediaCache stay in the library for other consumers. F3b (fixed-layout spreads)
stays deferred.

**Design refs:** [`reader-engine-design.md`](reader-engine-design.md) §2 (the
source seam), §4/§11, [`adr/0001-core-surface.md`](adr/0001-core-surface.md)
(the surface this milestone finally freezes), [`integration.md`](integration.md),
[`architecture.md`](architecture.md). Builds on `v0.10.0-library`. Target tag:
**`v1.0.0`**.

Sequential-ish, one commit per task. H3–H7 are largely independent and can
reorder; H0–H2 come first, H8 needs them all, H9/H10 ship it.

---

## Decisions (2026-09-06)

1. **npm names — `porejs` (core) + `porejs-react`.** `pore` is taken; unscoped
   and consistent beats an unowned scope. `@pore/*` in the code → `porejs` /
   `porejs-react` in H0 (`apps/demo` stays private, name unchanged).
2. **`1.0.0-rc.1` through M8, cut `1.0.0` at H10** once corpus + cross-browser
   are green — the RC window is the last shake-out.
3. **ESM-only.** No CJS build; documented in H1.
4. **Deploy: the owner's homelab**, not a PaaS. H9 ships a `Dockerfile` +
   compose stanza; the homelab's reverse proxy serves it and
   `pore.suryatmaja.dev` points there.
5. **Offline-download UI: cut.** Not re-added. Engine support stays.
6. **Corpus: fetched + SHA-256 pinned**, not committed (bar the few-KB items).

---

## Why this order

```
H0 identity ─→ H1 API freeze ─→ H2 embeddable ─┐
                                               │
H3 corpus ─→ H4 robustness ────────────────────┼─→ H8 CI/CD ─→ H9 deploy ─→ H10 v1.0.0
H5 cross-browser + e2e de-flake ───────────────┤
H6 perf + size budget ─────────────────────────┤
H7 security + a11y hardening ──────────────────┘
```

`H0` sorts out names/versioning so nothing downstream churns. `H1` freezes what
`H8` publishes; `H2` proves that frozen surface is enough to embed. `H3`–`H7`
are the hardening and run in parallel. `H8` wires the pipeline, `H9` puts the
demo on the homelab, `H10` cuts `1.0.0`.

---

## H0 — Package identity & release tooling · S · **DONE**

- [x] **Renamed the packages** — the old `@pore/reader-core` → **`porejs`**,
      `@pore/reader-react` → **`porejs-react`** (folder names unchanged;
      `apps/demo` stays private `@pore/demo`). Every `name`, `workspace:*` dep,
      source import, `tsup` external, and doc mention. Lockfile regenerated.
- [x] Fixed `repository.url` (`srytmj/pore.js` → `srytmj/pore-js` `.git`);
      added `homepage`, `bugs`, `keywords`, `author`, and
      `publishConfig` (`access: public`, `provenance: true`) to both packages.
- [x] Bumped both publishable packages to **`1.0.0-rc.1`**.
- [x] Removed the dead `apps/demo/vercel.json` (deploy is the homelab now).
- [x] Per-package `README.md` + `LICENSE` (copy of root MIT); `files` is
      `["dist"]`, verified with `npm pack --dry-run`.
- [x] **Changesets** (`@changesets/cli`) — `.changeset/config.json`, a
      `CONTRIBUTING.md` note. `.npmrc` untouched (provenance rides on
      `publishConfig` + the CI OIDC in H8).

**Done when:** `npm pack --dry-run` shows a clean tarball with a real README,
and `pnpm changeset` works. ✓

---

## H1 — Freeze the public API · M · **DONE**

- [x] Audited both `index.ts` against ADR 0001. Trimmed `porejs` from ~180
      exports to **37 runtime + curated types**, grouped with section headers.
      Moved the plumbing (spread/tap/virtualization math, anchor + pagination
      internals, store/emitter, `PaceEstimator`, fixture-manifest parsing, TTS
      controller internals, low-level search index, EPUB path helpers) to a new
      **`porejs/internal`** entry (`src/internal/index.ts`, `"./internal"` in
      `exports`). tsup builds it as a 3rd entry with `splitting: true` so shared
      code is a chunk, not a duplicate (`internal.js` ≈ 1.4 KB). `VERSION` is
      now injected from `package.json` via tsup `define`.
- [x] **API-surface guard** — `src/public-api.test.ts` in both packages pins
      the sorted runtime export list; `porejs`'s also asserts `porejs/internal`
      stays disjoint. (Type-only exports aren't runtime-visible — reviewed by
      hand per `stability.md`.)
- [x] **`docs/stability.md`** — what `1.x` SemVer covers (runtime exports,
      `ReaderSource`, `Position` round-trip, record/`Manifest` shapes,
      `data-pore-*`, `reader:*` events, `<Reader>` props / hook shapes), what
      isn't (`porejs/internal`, type shapes, CSS, `@experimental`, the demo),
      ESM-only + pdfjs tree-shaking, deprecation policy.
- [x] ESM-only documented in `integration.md`; `porejs-react` no-CSS asserted by
      `scripts/verify-packages.mjs` (also: no `.map`/`.tsbuildinfo`/test files
      in the tarball, README + LICENSE present, built `VERSION` matches). Wired
      into `pnpm release` + a `verify:packages` script.
- [x] **Additive `Manifest` shapes landed** — `ManifestMeta` (`subtitle?`,
      `volume?: string | number`) mixed into `ImageManifest` + `TextManifest`,
      exported. The `useReaderHistory` title composition is H2.

**Done when:** the surface is deliberate, snapshotted, and `stability.md` says
what a `1.0` consumer can rely on. ✓ — 266 unit · 43 e2e green (search worker
still loads under the chunked build).

---

## H2 — Embeddable in a host app · M · **DONE**

- [x] **`examples/host-app/`** ("Inkwell") — a standalone Vite app: a fake manga
      library grid → clicking a volume mounts `<Reader>`. Its `LibrarySource`
      _fully_ implements `ReaderSource` over the example's own catalog
      (`getManifest` maps the host record → `ImageManifest` with `volume` /
      `subtitle`; `getPage` returns generated SVG; `loadProgress` /
      `saveProgress` use `localStorage` under the host's **own** `inkwell:*`
      namespace). Own tiny stylesheet for the `data-pore-*` bits. Its own
      Playwright suite (3 specs) + config; wired into CI. In the pnpm workspace
      (`examples/*` added); `pnpm example` / `pnpm typecheck` cover it.
- [x] **Isolation audit — the engines were already clean.** No `window` /
      `document` listeners in `porejs` (all on the engine's own `root` / the
      iframe's `cdoc` / element `load`); `visibilitychange` is the one
      doc-level listener (passive read, removed on `destroy`). No mutable
      module-level singletons (pdf.js module memo + the in-worker index are
      correct). `porejs-react`: `useReaderHistory` (opt-in) touches
      `document.title` / `window.history`; `createSettingsPersistence` writes
      `localStorage` under `pore:settings:*` and is overridable
      (`persistSettings`). The example's e2e proves two books don't share
      state and no `porejs` stylesheet is injected.
- [x] **`useReaderManifest()`** added (new hook — `Manifest | null`); `<Reader>`
      now keeps the manifest in context. `ManifestMeta` (`subtitle?` /
      `volume?`) landed in H1.
- [x] **Document title** — `useReaderHistory` composes `Work · Vol N · Chapter`
      (or `Work · N%`, or the file name) from the manifest + resolved chapter
      label, with a `formatTitle?(ctx)` override (return `''` to leave the
      title to the host). Old `title` template kept + `@deprecated`.
- [x] **`integration.md`** — new §0 "Embedding in an existing site" (what you
      provide / what stays yours / the isolation guarantees), a `useReaderHistory`
      title section, `useReaderManifest` in the hooks table.
- [x] Playwright (`examples/host-app/e2e/embed.spec.ts`): open a volume, read
      via tap-zones, progress round-trips through the host source under its own
      namespace, reload → library → re-open resumes; a 2nd book starts fresh;
      no CSS shipped.

<details><summary>original scope</summary>

## H2 — Embeddable in a host app · M

The point of the library: a manga/comics/book site provides **a content source
and a mount point**, and gets the whole reader — pagination, themes, TOC,
highlights, bookmarks, search, TTS — without building any of it.

- [ ] **`examples/host-app/`** — a standalone minimal app (NOT the demo, no
      `apps/demo` chrome): a fake "library" page (grid of series) where
      clicking one mounts `<Reader>` in a panel. Its `ReaderSource` pulls from
      the example's _own_ (fake) REST-ish API — `getManifest` / `getPage` /
      `getFile` / `loadProgress` / `saveProgress` + optional
      `loadHighlights` / `loadBookmarks`. Proves: implement one interface, get
      a reader.
- [ ] **Isolation audit + fixes:**
  - `porejs-react` ships zero CSS; the headless components carry only
    `data-pore-*` hooks. ✓ (assert in H1) — verify nothing leaks global styles.
  - the text engine's `<iframe sandbox>` keeps publisher CSS _inside_.
  - **engine input listeners are scoped to its own focused root**, never
    `document` / `window` — an embedded reader must not eat the host's
    keyboard shortcuts or scroll when it doesn't have focus. Audit
    `create-image-engine.ts` / `create-text-engine.ts`; fix any global binding.
  - **no module-level singletons / globals** that break a second `<Reader>` on
    the same page. Test two instances side by side.
  - all URL / `localStorage` writes are **opt-in** — `useReaderHistory`,
    `createSettingsPersistence` are things the host chooses to call; the host
    owns routing and persistence (via its `ReaderSource`).
- [ ] **Document title while reading.** `useReaderHistory` composes
      `document.title` from the manifest + current position:
  - a dropped local file → **the file name** (minus the `.epub` / `.cbz`);
  - a real work → **`<title> · Vol N · Ch M`** when the manifest / current
    chapter carry them (e.g. `Solo Leveling · Vol 2 · Ch 14`), else the title
    alone, else `<title> · N%`;
  - a `formatTitle?: (ctx) => string` option so an embedding host fully
    overrides it. `Manifest` gains optional `subtitle` / `volume` (chapter
    `label` already exists) — additive, lands in H1 before the freeze. The
    demo's ad-hoc `document.title` writes move onto this.
- [ ] **`integration.md`**: lead with the embed story — "implement
      `ReaderSource`, give `<Reader>` a `bookId` + a mount, style the
      `data-pore-*` bits, done", with the `examples/host-app` source as the
      worked example. A "what the host still owns" list (auth, the content API,
      routing, storage, layout around the reader).
- [ ] Playwright against `examples/host-app`: open a title, read, turn pages,
      progress round-trips through the host source, a second reader instance
      coexists.

**Done when:** `examples/host-app` is a believable third-party integration and
the reader provably doesn't reach outside its own box. ✓

</details>

---

## H3 — Real-world content corpus · M · **DONE (baseline — set can grow)**

- [x] **`scripts/fetch-corpus.mjs`** (`pnpm corpus:fetch`) — downloads the books
      in `test/corpus/sources.json` into `test/corpus/files/` (gitignored),
      sha256-verified (prints the hash on first fetch to pin).
- [x] **`test/corpus/corpus.test.ts`** — the `corpus` vitest project
      (`pnpm test:corpus`; also in `pnpm test`, **skips cleanly** when `files/`
      is empty — dynamic `import()` of built `porejs`, no `dist/` hard dep).
      Per book: `parseEpub` / `loadPdf` don't throw on the real structure ·
      spine + TOC + metadata sane · **every spine href resolves** ·
      `serializeCfi`→`parseCfi`→`resolveCfiElement` round-trips on a real spine
      doc · `SearchController` builds over the real text. (Full pagination stays
      on the e2e suites — jsdom can't run the iframe.)
- [x] **3 real books pinned** (owner approved the download): Gutenberg
      _Frankenstein_ #84 (illustrated EPUB3), _Alice_ #11 (illustrated),
      _Pride and Prejudice_ #1342 (long, no-images). **9 tests green — no
      engine bug in the parse/CFI/search layer against real content.**
- [x] `test/corpus/README.md` + provenance; **CI `corpus` job** fetches
      (cached on `sources.json` hash) + runs `pnpm test:corpus`.
- [ ] _Grow the set later:_ an RTL manga CBZ, a vertical-JP book, a real
      fixed-layout EPUB, an ≥ 800-page item, a messy/scanned PDF (Gutenberg
      has no reliable PDF URL — needs another source). Not blocking `1.0`.

**Done when:** `pnpm test:corpus` is green against real books. ✓ (baseline of 3;
widen as sources are found)

---

## H4 — Robustness / failure modes · M · **DONE (guard rails deferred)**

Never a blank screen — every bad input → a clean `reader:error` + the demo's
error card.

- [x] **Fixed the real bug:** `<Reader>`'s mount effect `void`-ed the async IIFE
      with **no `try/catch`** — a rejecting `source.getManifest()` or
      `engine.mount()` (corrupt file, dead API) was an unhandled rejection and a
      blank host `<div>`. Now both are caught → `setError` → `useReaderError` →
      the error card.
- [x] **`src/robustness.test.ts`** (15 cases) — `parseEpub` (empty / not-a-zip /
      truncated / no container.xml / bad container XML / missing OPF / malformed
      OPF / no spine), `LocalFileSource` (0-byte epub, non-zip cbz, unknown
      ext, `getPage` out of range), `loadPdf` (empty / not-a-pdf / truncated).
      **All already fail cleanly** — a real `Error` with a matching message, no
      raw `TypeError`, no hang. The parse layer was solid; the gap was purely
      the missing catch in `reader-react`.
- [x] e2e: drop a corrupt `.epub` → `role="alert"` "Couldn't load" card within
      seconds, "Back to start" still works (no white screen).
- [ ] **Guard rails deferred** (not `1.0`-blocking, tracked): a page-dimension
      clamp (a 100 000-px page shouldn't OOM the tab), a configurable
      `getManifest` / `getFile` load timeout (a hung content API), a max
      manifest size. These are additive `<Reader>` opts / engine settings —
      their own small task.

**Done when:** the fuzz table is green and a corrupt file can't white-screen. ✓

---

## H5 — Cross-browser + e2e de-flake · M · **DONE (WebKit + Chromium verified locally; Firefox on CI)**

- [x] Playwright **projects** for `firefox` + `webkit` next to `chromium`; CI
      `e2e` job is now a `{chromium, firefox, webkit}` matrix with an HTML-report
      artifact on failure.
- [x] **Two real cross-browser bugs fixed:**
  - **PDF rendered nowhere without `OffscreenCanvas`** (Playwright WebKit,
    older Safari) — `pdf/parse.ts` `renderToBlob` falls back to
    `HTMLCanvasElement`, and WebP → PNG where the canvas can't encode WebP.
  - **Selection / footnote taps / highlighting dead in WebKit** — a sandboxed
    reading frame without `allow-scripts` gets **zero input events** in WebKit.
    Fix: `sandbox="allow-same-origin allow-scripts"` + a strict in-frame CSP
    (`script-src 'none'; default-src 'none'; …`) + `rewrite.ts` now also strips
    `on*` handlers / `javascript:` URLs / `<iframe>|<object>|<embed>` /
    `<meta http-equiv>`. Scripts still can't run — pulled some H7 forward.
  - TTS e2e skipped on non-Chromium (Playwright's FF/WebKit ship no
    `speechSynthesis`; real Firefox/Safari have it — engine no-op path is
    unit-tested).
- [x] **Support matrix** in `README.md`; the sandbox/CSP note in
      `docs/architecture.md`.
- [x] **De-flake:** the "annotations review → jump" flake (stale `frameLocator`
      after re-mount + too-short h1 timeout) fixed; the "share a passage" test
      stubs `navigator.clipboard` (Playwright WebKit has no `clipboard-*`
      permission). **Chromium 44/44 + WebKit 43/43 (TTS skipped) green,
      repeated runs.**
- [ ] _Firefox:_ config'd + on CI, but **can't launch on this Windows box**
      (`browserType.launch: spawn UNKNOWN` — an AV / MOTW quarantine thing).
      Verified via CI. Owner can `pnpm --filter @pore/demo exec playwright
install firefox` + unblock if they want it locally.

**Done when:** the full e2e suite passes on all three engines. ✓ (Firefox on CI)

---

## H6 — Performance & size budget · S–M · **DONE**

- [x] **`size-limit`** (`.size-limit.json`, `pnpm size`, in the CI `check`
      job): text-engine+sources **18 kB**, image-engine+sources **12 kB**, all
      three engines + every source **30 kB** (pdf.js code-split out),
      `porejs-react` **2 kB** — budgets set at ~1.3× with the numbers in
      `integration.md`. A regression fails the build.
- [x] **Confirmed pdf.js is genuinely lazy** — `size-limit` without the
      `pdfjs-dist` ignore shows the +130 kB, with it (matching what real
      bundlers do) it's gone. Documented in `integration.md §8` with the "don't
      inline dynamic imports" caveat and the per-import cost table.
- [x] **Perf guard rails** — `packages/reader-core/src/perf.test.ts`:
      `buildSpreads` on a 5000-page book, `buildSearchIndex` + 20 queries over
      800 sections, CFI serialize/parse/resolve over a realistic chapter DOM
      ×40. Budgets ~10× a warm run — catches an O(n²) regression, tolerates a
      slow runner. Runs in the normal `pnpm test`.
- [ ] Full engine-level TTI / heap scenario harness (1000-page PDF, big EPUB,
      long webtoon) — needs a real browser + `performance.measureUserAgentSpecificMemory`;
      left as a follow-up (see `docs/known-issues.md`), not `1.0`-blocking.

**Done when:** budgets are written down and CI flags regressions. ✓

---

## H7 — Security & a11y hardening · M · **DONE (bar the manual SR pass)**

- [x] **Iframe security** — mostly landed in H5: `script-src 'none'` CSP +
      `rewrite.ts` stripping `<script>` / `on*` / `javascript:` /
      `<iframe|object|embed>` / `<meta http-equiv>`; sandbox with no
      `allow-top-navigation` / `allow-forms` / `allow-popups` / `allow-modals` /
      `allow-downloads`. H7 adds the **CSP recipe + EPUB trust model** to
      `integration.md §0` (what the frame blocks, what a host's own top-level
      CSP needs: `img-src blob: data:`, `worker-src 'self'`, `child-src blob:`).
- [x] **`docs/accessibility.md`** — the keyboard map, the ARIA / announcer
      story, what's automated, and the honest gap.
- [x] **Keyboard-traversal e2e** — rail controls all focusable, `Enter` opens a
      panel, **`Esc` closes the top panel and restores focus** (new handler in
      `Chrome.tsx` — the demo panels are plain divs, not Radix dialogs), the
      reading surface turns pages from the keyboard.
- [x] **`forced-colors` (Windows High Contrast)** — a `@media (forced-colors:
active)` block (system-colour borders, `Highlight` focus ring + active
      states; the text engine already drops to flow mode); e2e emulates it and
      re-runs axe (minus `color-contrast`, a false positive there).
- [x] **Broadened axe** — `expectAxeClean` helper now runs `wcag2a/aa` **+
      `wcag21a/aa`**; no new violations.
- [ ] **NVDA + VoiceOver manual pass** — still owed for `1.0`. Tracked in
      `docs/known-issues.md` + `accessibility.md`. The automated coverage is a
      floor, not a substitute.

**Done when:** the iframe threat model is documented and a keyboard-only user
can do everything the demo offers. ✓ (SR pass pending)

---

## H8 — CI/CD + publish pipeline · S · **DONE (dormant until owner enables)**

- [x] CI `check` is now a **node 20 + 22** matrix; `e2e` runs
      chromium + firefox + webkit (H5); API-surface guard (H1) + `size-limit`
      (H6) already in `check`; Playwright HTML report artifact on failure (H5).
- [x] **`.github/workflows/release.yml`** — `changesets/action`: on merge to
      `main` it opens/updates a "chore: version packages" PR; merging that runs
      `pnpm release` (`build` → `verify-packages` → `changeset publish`).
      Provenance via `publishConfig.provenance` + `id-token: write`. On a real
      publish it also logs in to GHCR and builds + pushes the demo image.
- [x] **`docs/releasing.md`** — the flow, the `rc → 1.0.0` step, the auth
      one-time (`NPM_TOKEN` secret _or_ npm Trusted Publishing), branch
      protection recommendation.
- [x] Job is **gated on repo variable `RELEASE_ENABLED=true`** — safe to merge,
      does nothing until the owner flips it + adds the token.
- [x] New CI `docker` job builds the demo image (no push) on every PR so the
      Dockerfile can't rot.
- **Skipped:** coverage upload — needs an external service (Codecov) token;
  not `1.0`-blocking.

**Done when:** merging a release PR publishes both packages with provenance —
mechanically ready. **npm publish is postponed** (2026-09-07): the owner is
dogfooding first. Local consumption via `pnpm pack:local` →
`docs/releasing.md`. Resume by enabling `RELEASE_ENABLED` + `NPM_TOKEN`.

---

## H9 — Deploy the demo (homelab) · S · **build side DONE; deploy is the owner's**

- [x] **`apps/demo/Dockerfile`** — multi-stage: `pnpm install` →
      `gen:fixtures` → `pnpm build` → `pnpm --filter @pore/demo build` → `dist`
      into `nginx:1.27-alpine` with `apps/demo/nginx.conf` (SPA fallback,
      immutable `/assets/*`, no-cache `index.html` + `sw.js`, `wasm` /
      `webmanifest` MIME). `.dockerignore` added. Built from the repo root.
- [x] **`docs/deploy.md`** — the `docker run` one-liner, a `docker-compose.yml`
      stanza for the homelab, and the owner one-time checklist.
- [x] `release.yml` builds + pushes `ghcr.io/srytmj/porejs-demo:{latest,<sha>}`
      on a real publish; CI `docker` job builds it (no push) on every PR.
- [ ] **Installable PWA** — `manifest.webmanifest` + icons + `theme-color`.
      _(deferred — the demo already has `sw.js`; the manifest + icons are a
      small follow-up, tracked in `known-issues.md`, not `1.0`-blocking.)_
- [ ] **Owner:** GHCR package public, reverse proxy + TLS for
      `pore.suryatmaja.dev`, DNS / tunnel, `docker compose up`. Checklist in
      `docs/deploy.md`.
- [ ] `README.md` screenshots + demo GIF + live link — once it's up (H10).

**Done when:** the homelab serves the demo at `https://pore.suryatmaja.dev`
from the CI-built image. **Blocked on the owner** for the box + DNS.

---

## H10 — Docs & `v1.0.0` · S · **docs DONE; the `1.0.0` tag waits for the RC**

- [x] Per-package `README.md` quickstarts (H0) — `porejs-react`'s **is** the
      embed story.
- [x] **`docs/getting-started.md`** — `<Reader>` in a fresh React app, step by
      step, cross-links `examples/host-app`.
- [x] README badges (CI, npm ×2, license); README `## Status` + `## Milestones`
      rewritten for M8; the docs index updated everywhere.
- [ ] API reference (typedoc `docs/api/`) — deferred; `.d.ts` +
      `integration.md` + `stability.md` cover the RC. Follow-up.
- [ ] **`CHANGELOG.md` `## v1.0.0`; Changesets `rc → 1.0.0`; tag `v1.0.0`** —
      **not yet.** Do this after: the owner has done a first `1.0.0-rc.1`
      publish, the RC has had a shake-out, and the manual SR pass +
      `known-issues.md` open items are triaged.

**Done when:** `npm i porejs-react`, follow getting-started, get a working
reader — ✓ (mechanically). `v1.0.0` tagged + published — **pending the RC**.

---

## H11 — Integration DX (added 2026-09-07) · M · **DONE**

Owner asked for a "one call" on-ramp before wiring the reader into their
library, plus three gaps a real per-chapter manga library would hit.

- [x] **`<Book>`** (`porejs-react`) — `src` (archive URL) / `pages` (image-URL
      list) / `file` (`File`\|`Blob`), `meta` (`title` / `author` / `volume` /
      `chapter` / `direction`), `progress` + `onProgress`, `onEnd`, `seriesId`,
      `fetch`. Builds its own source; no `<ReaderProvider>`.
- [x] **`createReaderSource(input)`** (`porejs`, also non-React) + a
      `PagesSource` (image-URL list → manifest; hands the URL straight to
      `<img>` unless a `fetch` override needs auth) + a fetch-and-parse path for
      `src`/`file` reusing `LocalFileSource`. `readerSourceKey()` for a stable
      re-mount key. `ManifestMeta` on `LocalFileSource` too.
- [x] **`<Reader onEnd>`** `({ kind: 'book' | 'chapter', hasNext })` — the
      host's hook for "load the next chapter" when chapters are separate
      `bookId`s.
- [x] **Broken-page retry** — the image engine renders a tappable
      `img[data-pore-page-error]` tile that re-fetches just that page
      (`PageLoader.forget(i)`); pointer-up ignores taps on it. The demo's
      blocking error card is now fatal-only (`error.index === undefined`).
- [x] **`<Reader settingsKey>` / `<Book seriesId>`** — key the per-book
      settings layer by a series id so fit / direction / zoom carry across
      chapters.
- [x] Docs: `getting-started.md` leads with `<Book>`; `integration.md §0` = the
      two tiers; `stability.md` covers `<Book>` / `createReaderSource`.
- [x] Tests: `create-reader-source.test.ts` (9), `book.test.tsx` (2),
      broken-page-retry e2e. 304 unit · 93 e2e (chromium+webkit) · size 4/4.

**Done when:** a host can show a chapter with one `<Book src … />` and handle
next-chapter + flaky pages without touching `ReaderSource`. ✓

---

## H12 — Mobile gestures & chrome handle (added 2026-09-07) · M · **DONE**

The engines weren't touch-friendly and there was no on-screen way to reach the
menu without a keyboard. Engine-level (scope A) — no demo redesign.

- [x] **Text swipe-to-turn** — horizontal pointer swipe inside the reading
      iframe turns the page (touch only; mouse drag stays selection). Vertical
      stays native scroll via `touch-action: pan-y` in flow mode.
- [x] **`touch-action`** set deliberately on both engine roots and the text
      `body` (pan-x / pan-y / manipulation by mode) so the browser owns scroll
      and kills the 300 ms tap delay.
- [x] **Double-tap zoom** (image, touch only) — toggles fit ↔ 2× at the tap
      point; `doubleTapZoom: false` opts out. Mouse keeps `onDblClick`.
- [x] **Chrome handle** — `createChromeHandle()` renders a faint bottom-centre
      chevron `button[data-pore-chrome-handle]` (idle-fade 0.28 → 0.6,
      `env(safe-area-inset-bottom)`), toggles chrome on tap. New
      `chromeGesture` setting: `'handle'` (default) · `'tap-center'` ·
      `'long-press'` · `'handle+long-press'` · `'none'`. `ChromeGesture`
      exported from `porejs`.
- [x] Docs: `getting-started.md` §Mobile (swipe/pinch/double-tap, the handle,
      `100dvh` + `viewport-fit=cover`); `stability.md` covers the settings
      shape + `ChromeGesture`.
- [x] Tests: image/text engine unit tests for the handle + swipe; a
      `@mobile` Playwright project (Pixel 7) exercising handle + double-tap +
      swipe. 279 unit · 94 e2e (chromium+webkit+mobile) · size 4/4.

**Done when:** a phone user can swipe pages, pinch/double-tap images, and open
the menu with one thumb — no demo CSS changes required. ✓

---

## Cut from M8 / still deferred

- **F3b — fixed-layout two-page spreads.** Engine reshape; its own milestone.
- **Offline-download demo UI.** Cut (engine support stays).
- **CJS build.** ESM-only unless a real consumer blocks on it.
- **Cross-device sync / a backend.** Project A (`WhiteArchiveSource`).
- **Import from KOReader / Calibre / Readwise**, **collections / tags / reading
  goals**, **bottom-edge menu bar**, **OPDS 2.0** — unchanged cut list.
- **Storybook / component playground** — nice, not `1.0`-blocking.
