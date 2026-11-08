# Pore.js — M4 Plan (annotations, fixed-layout, OPDS, TTS)

**Goal:** the "cut for v1" list from the design doc §14 — `epubcfi`-precise text
ranges, highlights & notes, fixed-layout EPUB, an `OpdsSource`, and a TTS
stretch goal. This is genuinely new surface area, not a fundamentals gap —
scope and sequence below before any code lands.

**Design:** [`reader-engine-design.md`](reader-engine-design.md) §5 ("CFI is a
stretch goal"), §7 ("Search, selection, footnotes"), §12 (fixed-layout risk),
§14 ("M4+ — CFI, highlights/notes, TTS, fixed-layout, OPDS source") · builds on
`v0.6.0-ui` + the post-UI follow-ups (scrubber, PDF search, RTL confirmation,
end-page restyle). Target tag: `v0.7.0-annotate`.

Sequential, one commit per task, same as every milestone so far. **Not
started** — this doc is the scope for discussion before F1 begins.

---

## Why this order

```
F1 (precise ranges) ─→ F2 (highlights & notes)
F3 (fixed-layout)   ─┐
F4 (OPDS source)     ├─→ F6 (hardening + release)
F5 (TTS, stretch)   ─┘
```

F2 needs character-level range addressing to persist a highlight's exact
start/end — today's `anchor.offset` is always `0` (a deferred sliver since
M0.5). F1 closes that gap first. F3/F4/F5 are independent of each other and of
F1/F2; they can reorder or drop without blocking the others.

---

## F1 — Precise text ranges (`epubcfi`-flavored) · M · done (v0.7.0-annotate wip)

- [x] Extend `anchor.ts`: `generateAnchor` records a real character `offset`
      into the resolved block via `offsetForVisibleWord` (word-level Range walk
      over text nodes, not full-character precision — cheap and sufficient for
      resume/highlight-anchor purposes). `resolveAnchor` resolves it back via
      `rangeAtOffset`, falling back to whole-block resolution when the range
      has no layout signal (jsdom, or a drifted document). Fully backward
      compatible — offset `0` behaves exactly as before.
- [x] `serializeCfi(doc, spineIndex, spineIdref, el, offset) → string` /
      `parseCfi(cfi) → ParsedCfi` / `resolveCfiElement` / `resolveCfiRange` in
      new `cfi.ts` — a **documented, pragmatic CFI-shaped serialization**, not
      full IDPF conformance: element-sibling-only step numbering (ignores
      interleaved text-node steps) and the conventional `/6/` package→spine
      assumption. Round-trips through nested inline markup (em/strong/a).
      (Skipped the separate `RangeAnchor` type — a single-offset CFI covers
      the resume-position use case F1 targets; F2 can add a range pair when
      highlights need start+end.)
- [x] `TextEngine.getCfi(): string | null` wired end-to-end: engine →
      `reader-react`'s `ReaderHandle` → a real demo feature (🔗 "Copy position"
      button in `Chrome.tsx`, EPUB-only) — browser-verified producing
      `epubcfi(/6/6[c3]!/2/2/2:0)` for a real reading position.
- [x] Fallback cascade on resolve: exact offset-range → whole block → (existing
      percent fallback further up the stack) — same pattern as before.
- [x] Vitest: `anchor.test.ts` (+8 tests: `offsetForVisibleWord`,
      `rangeAtOffset`, offset-precision generate/resolve incl. the
      no-layout-signal fallback) and new `cfi.test.ts` (8 tests: step
      round-trip, serialize/parse, escaping, nested inline markup, drift →
      null). 199 total tests passing, lint/typecheck clean.

**Done when:** a highlight's start/end survives a reload and a re-render at a
different font size, and its CFI string is one a spec-reader would accept. —
met for the single-position case (resume/share-position); highlight start+end
pairing is F2's job.

---

## F2 — Highlights & notes · L · done for EPUB (v0.7.0-annotate wip); PDF cut below

- [x] Selection bridge: `selectionchange` inside the sandboxed iframe →
      debounced 150ms → `reader:selection` (`{ rect, text } | null`) — the
      demo renders a floating "highlight this" toolbar off it (color swatches;
      no note editor yet, see cut below)
- [x] `TextEngine.addHighlight(opts?: { color?, note? })` / `removeHighlight(id)`
      / `listHighlights(): HighlightRecord[]`; persisted through `ReaderSource`
      as a new `HighlightRecord[]` — **not** `Position`, a parallel per-book
      collection (`loadHighlights`/`saveHighlights`, optional so existing
      sources don't need to implement it). `CachedSource` implements both
      (mirrors its existing local-first `saveProgress` pattern), so the demo's
      `CachedSource(DemoSource())` persists highlights for free.
- [x] Highlight endpoints addressed the same way `Position['anchor']` is
      (block ordinal + flattened-text offset), just with a start/end pair —
      new `HighlightRange` type + `text/highlight.ts` (`locateOffset`/
      `offsetOfPoint`/`rangeForHighlight`/`highlightRangeFromSelection`).
      Each endpoint also gets its own `epubcfi(...)` via F1's `serializeCfi`,
      stored as `HighlightRecord.cfi.{start,end}` for interchange.
- [x] Render: CSS Custom Highlight API (`CSS.highlights.set(...)` +
      `::highlight(...)` CSS) when available; `<mark>` fallback (wrapped via
      `Range.surroundContents`, silently skipped — still persisted — for a
      selection spanning more than one element, which `surroundContents`
      can't wrap) otherwise.
- [x] A highlights panel in the demo (`Chrome.tsx`) — list, jump-to (via
      `goto({ type: 'anchor', ... })`), remove. Kept as plain demo markup
      rather than a `reader-react` component, since a full editor UI (notes,
      color re-pick) is deferred — see cut below.
- [x] **Found and fixed while verifying jump-to in a real (wide) browser
      window**: `pageForElement`/`resolveAnchor`/`generateAnchor` divided a
      block's raw `getBoundingClientRect().left` by `pageStep` assuming page 0
      starts at `left: 0` — true only when the reading column fills the whole
      iframe. On a desktop-width window `#pore-viewport` is horizontally
      centred, so every anchor resolved to the wrong page by however wide that
      centring gap was. Fixed with `relRectOf`/`relRangeRectOf` in
      `create-text-engine.ts` (subtract `#pore-viewport`'s own
      `getBoundingClientRect().left` before dividing) — this was a **pre-existing
      bug affecting the M0.5 resume-position feature and F1's `getCfi()` too**,
      just invisible at narrow widths where the centring gap happens to be ~0
      (like the ~800px browser tab F1 was verified in). Now correct at any
      width; all 211 tests still pass (the jsdom suite never exercises real
      layout, so it couldn't have caught this — browser verification did).
- [x] Vitest: `highlight.test.ts` (7 tests — offset/range helpers against fake
      documents, same pattern as `anchor.test.ts`/`cfi.test.ts`); `CachedSource`
      highlight persistence (3 tests); `create-text-engine` highlight tests (2 —
      no-selection returns `null`/never throws, and a full add→persist→reload→
      remove round trip that self-skips its deep assertions when jsdom's
      iframe selection isn't available, same documented limitation as
      `getCfi`'s test). Browser-verified end-to-end: select → highlight →
      painted → persisted across reload → listed in the panel → jump-to lands
      on the right page → remove.

**Done when:** select text in the demo EPUB, highlight it, reload, it's still
there and click-to-jump works. — met. Note-taking UI, PDF highlights, and a
dedicated `reader-react` highlights-panel component are cut to a follow-up
(below); the `HighlightRecord.note` field and engine API already support a
note, so that follow-up is UI-only.

**Cut from this pass (tracked, not blocking F1→F3/F4/F5/F6):**

- **PDF rect-based highlights** — `createPdfEngine` doesn't get `addHighlight`
  in this pass; it needs its own page+bbox addressing (via pdf.js's text
  layer) distinct from the EPUB block/offset scheme, sized like its own
  follow-up task rather than folded into F2's EPUB work.
- **Note editor UI** — the API (`{ note?: string }`) and storage
  (`HighlightRecord.note`) exist; the demo doesn't yet have a way to type one
  in (would need a small popover/textarea, deferred to avoid a `window.prompt`
  UX compromise).
- **A `reader-react` highlights-panel component** — today it's plain markup in
  the demo's `Chrome.tsx`; extracting a headless component (like
  `<TableOfContents>`) is worth doing once the note editor exists too, so it's
  one extraction instead of two.

---

## F3 — Fixed-layout EPUB · M · done (v0.7.0-annotate wip); spreads cut below

Went with the **live-iframe** path from open question #2, not the
snapshot-to-canvas/image-engine adapter originally sketched below — F2's
highlight/selection mechanics are DOM-range-based, and a live iframe keeps
those working on fixed-layout books for free (a canvas snapshot would have
needed its own rect-based highlight scheme, duplicating F2). The `<meta
name="viewport">`-driven scale-to-fit turned out simple enough that the
adapter/image-engine detour wasn't worth it.

- [x] Detect `rendition:layout="pre-paginated"` (`EpubMetadata.fixedLayout`,
      already sniffed since M0.5/`LocalFileSource`) — `mount()` no longer
      rejects it with an error; `create-text-engine.ts` branches on
      `fixedLayoutActive()` throughout (`measure`/`applyPage`/`injectStyle`/
      `anchorFor`/`resolvePendingAnchor`) instead of the reflow/multicol path.
- [x] One page per spine item (no sub-paging — `estimateSpinePages` returns 1),
      scaled + centred via a live `transform: translate(...) scale(...)` on
      `#pore-flow` recomputed on resize; new pure helpers in `paginate.ts`:
      `parseFixedViewportMeta` (reads the page's own `<meta name="viewport"
content="width=…,height=…">`), `fixedLayoutScale`,
      `buildFixedLayoutStylesheet`. Author CSS is never stripped for a
      fixed-layout book regardless of the `publisherStyles` setting —
      positioning is entirely author-CSS-driven.
- [x] A synthetic fixed-layout fixture (`demo-fixed`, kids'-book-style: 4
      pages, absolutely-positioned panel + title, `pre-paginated` OPF meta) in
      `scripts/gen-fixtures.mjs`, wired into the demo's book picker.
- [x] Vitest: `paginate.test.ts` (+7: viewport-meta parsing, scale/centre math,
      stylesheet shape) and `create-text-engine.test.ts` (+2: layout
      detection + one-page-per-spine navigation, settings/resize don't throw).
      Browser-verified at both desktop (1280px) and narrow (500px) widths —
      correct centring and aspect-ratio-preserving scale at both.
- [x] **Found and fixed while browser-verifying**: the first cut left body/html
      unsized in `buildFixedLayoutStylesheet`, so a fixed-layout page's own
      author CSS (routinely `body{width:750px;height:1000px}`, since it's
      normally sized to the exact page) constrained `#pore-viewport`'s
      `width:100%` to that instead of the actual (usually wider) reader
      window. Fixed with an explicit `width:100% !important;height:100%
!important` on the injected `html, body` rule.

**Cut from this pass:**

- **Spread pairing** (`rendition:page-spread-left|right` → two-page display) —
  needs either two iframes shown side-by-side or one iframe spanning two
  spine items, real added complexity for a "beta" fixed-layout feature;
  tracked as a follow-up once single-page fixed-layout has seen real use.
- **`OpdsSource`/canvas-snapshot adapter** — superseded by the live-iframe
  approach above; not needed.

**Done when:** a fixed-layout EPUB opens and pages like a comic, not a broken
reflow. — met, for single-page (non-spread) fixed-layout books.

---

## F4 — `OpdsSource` · M · done (v0.7.0-annotate wip); OPDS 2.0 cut below

Went with the plan's own "leaning" answer to open question #3 (no further
discussion needed): OPDS 1.2 (Atom) read-only, HTTP Basic + bearer auth, no
OPDS 2.0.

- [x] `OpdsSource(baseUrl, { auth?, fetch?, domParser? })` — a **catalog +
      acquisition** surface distinct from `ReaderSource` (OPDS is a _library_
      protocol, not a per-book one): `listCatalog(url?) → OpdsFeed` (`{title?,
entries, next?}`), `acquire(entry) → LocalFileSource` — downloads the
      entry's acquisition link and wraps the bytes in a fresh
      `LocalFileSource` (as `File`), reusing its existing EPUB/PDF/CBZ/image
      sniffing rather than duplicating it.
- [x] Auth: HTTP Basic (`{type:'basic', username, password}`) and a bearer
      token (`{type:'bearer', token}`) escape hatch, since Kavita's own OPDS
      endpoint speaks bearer too.
- [x] Atom/OPDS 1.2 XML parsing in a standalone `opds-parse.ts` (mirrors
      `epub/parse.ts`'s split of pure parsing from the stateful class):
      `parseOpdsFeed` (feed title, entries, `rel="next"` pagination — correctly
      scoped to the feed's own direct-child `<link>`s, not leaking a
      same-named `<link>` nested inside an `<entry>`), `acquisitionLink`
      (prefers `.../acquisition/open-access` over borrow/sample/subscribe
      variants), `guessFilename` (href extension, falling back to the link's
      mime type, so `LocalFileSource` can sniff the right book kind).
- [x] A minimal demo catalog browser (`OpdsBrowser.tsx` in the demo, toggled
      from a 📚 button in `Chrome.tsx`): URL input, entry list with
      title/summary, `Open` acquires and hands the result to the same
      `dropped`-source path the file drop-zone uses, `next` pagination.
      Plain markup rather than a `reader-react` component — like F2's
      highlights panel, this is book-_selection_ UI (outside `<Reader>`), not
      reader chrome.
- [x] Vitest: `opds-parse.test.ts` (10 tests: feed/entry parsing, the
      entry-link-leak guard, acquisition-link preference, filename guessing)
      and `opds-source.test.ts` (6 tests: catalog + pagination, `acquire()`
      round-tripping into a working `LocalFileSource`, missing-link and HTTP-
      failure errors, both auth headers) against a fake `fetch` — same policy
      as `KavitaSource`'s tests, no live server. Browser-verified end-to-end
      against a same-origin fixture catalog (`apps/demo/public/opds/
catalog.xml`, listing the `demo-book`/`demo-fixed`/`demo-pdf` fixtures)
      — browse → open → the fixed-layout demo book renders correctly.

**Cut from this pass:**

- **A real external catalog (e.g. Project Gutenberg's) as the demo's default**
  — the plan's original "done when" language. Skipped because a browser
  automation environment can't rely on a public OPDS host's CORS policy, and
  a flaky external dependency in the demo's default flow isn't worth it for a
  portfolio piece. The demo ships a same-origin fixture catalog instead
  (`/opds/catalog.xml`) that exercises the exact same code path; the URL
  field is a plain input, so pointing it at a real external catalog is one
  paste away and works if that host's CORS allows it — just not verified here.
- **OPDS 2.0 (JSON)** — not implemented; `OpdsSource` throws on non-XML feeds
  same as any malformed-XML input would.

**Done when:** browse a catalog in the demo and open a book from it. — met
against the bundled fixture catalog; a real external OPDS host is a
follow-up, CORS permitting.

---

## F5 — Text-to-speech (stretch) · M · done (v0.7.0-annotate wip)

Kept, rather than cut — the user asked to go through the plan in order
("lanjut aja yang urut") instead of skipping straight to F6.

- [x] `createTtsController` + `segmentSentences` in a standalone `text/tts.ts`
      (mirrors `text/highlight.ts`'s split: pure logic file, engine wires it
      up). `segmentSentences` uses `Intl.Segmenter` (sentence granularity)
      where available, a punctuation regex fallback otherwise. The controller
      itself is synth-agnostic — it's driven entirely by an injected
      `TtsSynthLike`/`createUtterance`, which is exactly the DOM
      `SpeechSynthesis`/`SpeechSynthesisUtterance` shape (no adapter needed,
      just a structural-typing cast) but swappable for tests or unsupported
      environments.
- [x] Sentence-level highlight sync: `ttsOnSentence` reuses F2's
      `rangeForHighlight` (a sentence is just a single-block highlight range)
      and paints it via the same CSS Custom Highlight API / `<mark>` fallback
      path, under its own `pore-tts` name so it doesn't collide with user
      highlights. Auto page-turn: `ttsOnSentence` also computes the sentence's
      block's page and turns to it if it isn't the one showing (works
      mid-spine too, not just at spine boundaries); `ttsAdvanceSpine` calls
      `renderSpine()` directly at the end of a spine's sentences, bypassing
      `turn()`/`goto()` so it isn't mistaken for (and doesn't trigger) the
      "stop TTS on manual navigation" guard those two add.
- [x] Controls: `TextEngine.ttsPlay/ttsPause/ttsResume/ttsStop/ttsSetRate/
ttsSetVoice/ttsListVoices/ttsState`; `reader-react`'s `useTts()` hook
      (headless: `{state, play, pause, resume, stop, setRate, setVoice,
listVoices}`); the demo renders a play-bar UI (▶/⏸/⏹, rate select,
      voice select when any are available, current-sentence text) toggled
      from a 🔊 button.
- [x] Out of scope, as planned: audio export, cloud TTS voices, cross-device
      sync, non-EPUB engines (image/PDF have no text layer worth reading).
- [x] Vitest: `tts.test.ts` (9 tests — sentence segmentation + offsets, the
      controller's play/advance-spine/stop-cancels-pending-advance/pause-
      resume/rate-voice behavior against a fake synth) and 5 engine-level
      tests in `create-text-engine.test.ts` (unsupported-API no-op, drives
      through every spine via `advanceSpine()` and stops at the end,
      pause/resume/stop delegate to the injected synth, rate/voice setters
      never throw, `turn()`/`goto()` interrupt playback). The "drives through
      every spine" test's real sentence text isn't observable in jsdom (same
      standing `frame.contentDocument`-after-mount limitation as
      `getCfi()`/`addHighlight()`), so it exercises the advance/stop state
      machine only — sentence-level playback against a fake DOM is what
      `tts.test.ts` covers, and the real thing is browser-verified.
- [x] **Browser-verified for real** (not just the state machine): pressed
      play on the demo EPUB with real `speechSynthesis` — it spoke sentence
      by sentence, painted the live highlight correctly, the play bar's
      voice picker listed actual system voices (e.g. "Microsoft George/
      Hazel/Susan — English (UK)"), pause/resume worked, and the reader's
      page auto-advanced as playback moved past the visible page (progress
      moved from 0% to 21% during playback with no manual interaction).

**Done when:** press play on the demo EPUB, hear it (manually verified — CI
checks the state machine only), see the current sentence highlighted. — met.

---

## F6 — hardening + release · S · done

- [x] Playwright: highlight → reload → still there + click-to-jump (EPUB),
      fixed-layout page-turn (scaled to the window), OPDS browse → open,
      TTS state machine (play shows the current sentence, pause/resume
      toggles), and an axe scan of the highlights + OPDS + TTS panels — 5 new
      tests, all EPUB-scoped per F2/F5's own cut list (PDF highlights were cut
      in F2, so no PDF highlight-persistence test). **The full e2e suite
      (28 tests) now passes** — see the follow-up pass below.
- [x] **Found and fixed a real bug while writing the highlight-persistence
      Playwright test**: `highlight.ts`'s `offsetOfPoint` only handled a Range
      boundary point that was already a text node. `Range.selectNodeContents(el)`
      — and some browsers' whole-block drag-selections — instead produce an
      **element** node + a childNodes index (per DOM Range spec), which
      `offsetOfPoint` silently treated as "not found" → `addHighlight()`
      returned `null` for a whole-block selection. This didn't show up during
      manual browser verification (which happened to drag-select mid-block,
      producing text-node boundaries) — only the Playwright test, which
      selects a whole element via `selectNodeContents`, exposed it. Fixed with
      a `textBoundaryPoint()` step that reduces an element/index boundary to
      an actual text node + local offset before the existing walk. 2 new
      `highlight.test.ts` cases lock this in (9 tests total, was 7).
- [x] **Discovered the e2e suite had never actually been run** (`pnpm
--filter @pore/demo e2e` — every prior milestone verified manually via
      the Browser pane, never `playwright test`). Running it for the first
      time surfaced that most of the pre-existing suite used
      `getByRole('button', { name: '›' })`/`'‹'`/`'⚙'` — glyph text that
      **isn't** the accessible name once those buttons got `aria-label`
      (`"Next page"`/`"Previous page"`/`"Reader settings"`), likely sometime
      during the UI-foundation milestone. Fixed the whole file to query by
      the actual accessible names — this alone fixed 12 of 21 initially
      failing tests project-wide (unrelated to M4, but blocking all e2e
      verification, so fixing it was a prerequisite for running the new M4
      tests at all).
- [x] a11y: M4 UI keyboard-reachable + `aria-label`led throughout; axe scan
      passes. The `AxeBuilder.analyze()` "browser closed" crash turned out to
      be axe-core-playwright trying to inject into the reader's
      `sandbox`-no-`allow-scripts` iframe — fixed by `.exclude('iframe.
pore-text__frame')` on the two full-page axe scans (the iframe's markup
      is the publisher's, not ours, so it's not in scope anyway).
- [x] **Follow-up pass: fixed the 6 pre-existing e2e failures this run
      uncovered** (all predate F1-F5; the suite had just never been run to
      completion): - _TOC navigation was broken_ — `TextEngine.goToHref()` (used by
      `<TableOfContents>`) re-resolved its argument against the _current_
      chapter's directory, but `book.toc` hands it an already-archive-
      absolute path → double-resolved → no match → silent no-op. Split the
      internal helper into `gotoHref` (chapter-relative, for in-book `<a>`
      clicks) and `gotoResolvedHref` (archive-absolute, the public API's
      contract); new regression test in `create-text-engine.test.ts`. - _Real ARIA violation_ — `SettingsPanel`'s close button rendered as a
      DOM child of `role="tablist"` (only `tab` children allowed). Moved it
      into a sibling `.pore-settings__tabsrow` wrapper. - _Focus not returning on Escape_ — Radix `Dialog` only restores focus
      to a `Dialog.Trigger`, but the demo drives it via a controlled `open`
      prop with an external toggle. Added an `onCloseAutoFocus` that
      restores focus to whatever was focused when the dialog opened. - _`SettingsPanel` "close by re-clicking ⚙" in the flow-mode test_ was
      a test bug — the trigger is behind the modal overlay; switched to
      `Escape`. - _Offline "download → reload" was broken_ — the demo SW (a) never
      precached the content-hashed build assets (only fetched pre-SW-
      control on first load), (b) `Vary: Origin` on those assets hid
      otherwise-valid cache hits, (c) `CachedSource` never persisted the
      book manifest, so offline `getManifest()` threw. Fixed all three: SW
      parses `index.html` for its `/assets/*` and precaches them + matches
      with `ignoreVary`, and `CachedSource.download()`/`getManifest()` now
      store and fall back to the manifest. New `cached-source.test.ts`
      cases. - _Scrubber seek test_ clicked at 80% of the track and expected the
      last chapter — off by a hair against demo-manga's chapter boundaries;
      moved the click to 97%.
- [ ] ~~CFI round-trip fuzzed against a handful of real-world EPUBs~~ — cut:
      this repo's fixtures are deliberately CC0/synthetic-only (see every
      `demo-*` fixture's `SOURCE.md`/`LICENSE`); bundling real-world EPUBs for
      a fuzz corpus would break that policy. F1's `cfi.test.ts` already
      covers the documented edge case (nested inline markup) against
      synthetic fixtures.
- [x] Perf: highlight rendering already repaints only the highlights on the
      _current spine_ (`applyHighlights` filters `highlights` by
      `h.range.spine === spineIndex` before touching the DOM), not the whole
      book — satisfied by the existing design, no separate perf test needed.
      OPDS catalog virtualization: cut — the bundled fixture catalog has 3
      entries and there's no realistic path to hundreds in this portfolio's
      scope; would be premature optimization with nothing to optimize for.
- [x] CHANGELOG `v0.7.0-annotate`; README.
- [ ] Tag `v0.7.0-annotate` — pending.

---

## Cut from M4 (still later)

Cross-device highlight sync (needs a real backend — `KavitaSource`/
`OpdsSource` are read-mostly), cloud TTS voices, EPUB3 media overlays
(publisher-authored audio narration — different problem from F5's synthesized
TTS), CFI for images/PDF (page index is already stable and simpler, no CFI
needed there).

## Open questions

1. ~~**Highlight storage**~~ — **settled** (user, before F2): new optional
   `ReaderSource.loadHighlights`/`saveHighlights` methods. Done, see F2.
2. ~~**F3 fixed-layout rendering path**~~ — **settled**: live iframe, to keep
   F2's highlight/selection mechanics working on fixed-layout books. Done,
   see F3.
3. ~~**F4 scope for this portfolio**~~ — **settled**: OPDS 1.2 read-only, HTTP
   Basic + bearer auth, OPDS 2.0 cut. Done, see F4 (demo proof against a
   bundled fixture catalog rather than a real external host — CORS risk).
4. ~~**F5 priority**~~ — **settled**: kept rather than cut (user: proceed
   through the plan in order). Done, see F5.
