# Integrating Pore.js

How to embed the reader in your own app. Two layers:

- **`porejs-react`** — React 19. `<Reader>` + hooks + headless components.
  This is what most apps use.
- **`porejs`** — framework-agnostic. Use directly only if you are not
  on React or want to drive the engine imperatively.

```bash
npm i porejs porejs-react
```

Peer deps: `react` / `react-dom` ≥ 19 for the React package; `gsap` is an
**optional** peer (only `gsapAdapter` needs it).

> **Packaging:** **ESM only** — `"type": "module"`, Node ≥ 20, evergreen
> browsers. There is no CommonJS build; `require('porejs')` won't work. `porejs`
> hard-depends on `pdfjs-dist`, but it is only reached through `createPdfEngine`
> / `loadPdf` / `PdfImageSource` — an app that never opens a PDF tree-shakes it
> out. Lower-level building blocks (layout math, anchor internals, the
> store/emitter) are a separate opt-in deep import, `porejs/internal`, and are
> **not** covered by SemVer — see [`stability.md`](stability.md).

> **Styling model:** `porejs-react` ships **no CSS**. Every component
> renders semantic markup with `data-pore-*` hooks and (where interactive)
> Radix primitives. You bring the stylesheet. The `apps/demo` stylesheet
> (`apps/demo/src/styles.css`) is a complete worked example.

---

## 0. Two tiers

**Tier 1 — `<Book>`.** You have a URL to a file, a list of image URLs, or a
`File`. Render `<Book src|pages|file meta … />` — it builds the source, no
`ReaderSource` to implement, no `<ReaderProvider>`. Covers most manga /
comics / book sites. See [`getting-started.md`](getting-started.md). Props:

| prop                                                                                   |                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src` \| `pages` \| `file`                                                             | **one required** — archive URL / image-URL list / `File`\|`Blob`                          |
| `meta`                                                                                 | `{ title, author, subtitle, volume, chapter, direction }` — tab title + reading direction |
| `progress` / `onProgress`                                                              | resume value in / out (you persist it)                                                    |
| `onEnd`                                                                                | `({ kind: 'book' \| 'chapter', hasNext })` — load the next chapter                        |
| `seriesId`                                                                             | keep fit / zoom / direction prefs across chapters served as separate `<Book>`s            |
| `fetch`                                                                                | swap the fetcher — add `Referer` / auth headers for a CDN                                 |
| `className` / `style` / `children` / `transitions` / `persistSettings` / `fontFaceCss` | passthrough to `<Reader>`                                                                 |

`createReaderSource(input)` (also from `porejs`, no React) is the same builder
if you want the source object.

**Tier 2 — `ReaderSource` + `<ReaderProvider>`.** A real backend: auth,
streaming, server-side progress, offline caching, per-page signed URLs. One
object, ~5 methods (§2). This is the rest of this document.

---

## 0.5. Embedding in an existing site

The common case: you already have a manga / comics / book library — a catalog,
a content API, auth, routing. You want a reader without building one.

**What you provide:**

1. **A `ReaderSource`** — one object mapping your book ids to a manifest, page
   bytes, and reading position (§2). ~40 lines over your existing API.
2. **A mount point** — a sized `<div>` (`<Reader className>`).
3. **A stylesheet** — the components are headless; you style the `data-pore-*`
   markup (the styling note above).

**What stays yours:** authentication, the content API, app routing (which book
is open, deep links), where reading progress / highlights are stored (your
`ReaderSource` decides), and the page layout _around_ the reader.

`porejs` keeps to its box — engine input listeners are scoped to its own
focused element (it won't eat your keyboard shortcuts), it declares no global
singletons (two `<Reader>`s on a page are independent), and it writes nothing to
the URL unless you call `useReaderHistory` (§4). `porejs-react`'s own
per-viewer settings go to `localStorage` under `pore:settings:*` — pass
`persistSettings={false}` or your own store to opt out.

A complete worked integration — a fake library site with its own source, its
own progress storage, and its own tab-title — is in
[`examples/host-app/`](../examples/host-app) (`pnpm example`).

### Security — the EPUB trust model

EPUB/XHTML chapters are **untrusted publisher content**. The text engine renders
each into an `<iframe srcdoc>` and, before it does, `rewriteResources`:

- drops every `<script>`, inline `on*` handler, `javascript:` URL, and
  `<iframe>` / `<object>` / `<embed>` / `<meta http-equiv>`;
- injects a strict frame CSP —
  `default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none';
base-uri 'none'; form-action 'none'` (images/fonts/styles limited to
  `blob:`/`data:`; author styles are inline or blob-URL'd);
- the frame's `sandbox` is `allow-same-origin allow-scripts` — `allow-scripts`
  **only** because WebKit/Safari delivers no input events without it; the CSP is
  what blocks scripts. No `allow-top-navigation`, `allow-forms`,
  `allow-popups`, `allow-modals`, `allow-downloads`.

**Net:** no author JavaScript runs, the frame can't navigate your page, and it
can't reach the network. Publisher CSS _does_ apply by default (turn it off with
the `publisherStyles` setting).

**For your own page**, a matching top-level CSP is fine — `porejs` needs
`img-src blob: data:` (image books), `worker-src 'self'` (the in-book search
worker chunk, unless you pass your own `workerFactory` / disable it),
`child-src blob:` (the reading `<iframe srcdoc>`), and `connect-src` to wherever
your `ReaderSource` fetches. It uses no `eval` and no inline `<script>`.

---

## 1. Minimal React integration

```tsx
import { ReaderProvider, Reader } from 'porejs-react';
import { DemoSource, CachedSource } from 'porejs';

// A source resolves book ids to manifests, pages/files, and reading position.
const source = new CachedSource(new DemoSource()); // CachedSource = offline + resume

export function App() {
  return (
    <ReaderProvider source={source}>
      <Reader bookId="demo-book" className="reader-host">
        {/* chrome goes here — see §4 */}
      </Reader>
    </ReaderProvider>
  );
}
```

`<Reader>` picks the engine from the manifest `type`: `epub` → text engine,
`pdf` → PDF engine, anything else → image engine. It mounts imperatively into
its own host `<div>` (give it `className` and size it — `flex: 1; min-height:
0`). It restores the last-read position before first paint.

### `<Reader>` props

| prop               | type                             | notes                                                                           |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------- |
| `bookId`           | `string`                         | required. Changing it re-mounts the engine (`key` it in the demo).              |
| `className`        | `string`                         | on the host div you must size                                                   |
| `initialSettings`  | `Partial<AnySettings>`           | seed layout/typography for this book                                            |
| `onPositionChange` | `(loc: ReaderLocation) => void`  | every location change                                                           |
| `persistSettings`  | `boolean \| SettingsPersistence` | `true` (localStorage) by default                                                |
| `transitions`      | `ReaderTransitions`              | page-turn/zoom animation seam; default instant. `gsapAdapter(gsap)` for smooth. |
| `ref`              | `Ref<ReaderHandle>`              | imperative control — see §3                                                     |

---

## 2. Sources — the seam

A source is any object implementing `ReaderSource`:

```ts
interface ReaderSource {
  getManifest(bookId: string): Promise<Manifest>;
  getPage(bookId: string, index: number, opts?): Promise<Blob | string>;
  getFile(bookId: string, opts?): Promise<Blob>; // whole EPUB/PDF/CBZ
  loadProgress(bookId: string): Promise<Position | null>;
  saveProgress(bookId: string, p: Position): Promise<void>;
  // optional — annotation persistence
  loadHighlights?(bookId: string): Promise<HighlightRecord[]>;
  saveHighlights?(bookId: string, highlights: HighlightRecord[]): Promise<void>;
  loadBookmarks?(bookId: string): Promise<Bookmark[]>;
  saveBookmarks?(bookId: string, bookmarks: Bookmark[]): Promise<void>;
}
```

`HighlightRecord` is a discriminated union: `kind: 'text'` (EPUB / reflowable —
carries a DOM `range` + portable `cfi: { start, end }`) or `kind: 'rect'` (PDF /
fixed pages — carries `page` + normalised `rects`). A `Bookmark` is
`{ id, position, cfi?, page, percent, label, text?, createdAt }`. Both are
per-book collections, parallel to the single `Position` resume checkpoint.

`Manifest` is `ImageManifest` (`type: 'image'`, a page list) or `TextManifest`
(`type: 'epub' | 'pdf' | 'cbz'`). `getFile` returns the archive for text
formats; `getPage` returns per-page blobs/URLs for image books.

### Built-in sources

| source                             | use                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new DemoSource()`                 | bundled fixtures, zero backend                                                                                                                                                                                                               |
| `new LocalFileSource(files)`       | a `File[]` / `FileList` the user dropped — `.epub`, `.pdf`, `.cbz`/`.zip`, or loose images. Detects the type.                                                                                                                                |
| `new CachedSource(inner, opts?)`   | wraps any source: local-first manifests + resume + `MediaCache` full-book download for offline. Implements `loadHighlights`/`saveHighlights` **and `loadBookmarks`/`saveBookmarks`** (local-first). Use `useDownload()` for the download UI. |
| `new KavitaSource(opts)`           | a live [Kavita](https://kavitareader.com) server (HTTP, bearer auth)                                                                                                                                                                         |
| `new OpdsSource(url, opts?)`       | a read-only OPDS 1.2 catalog. `.acquire(entry)` → a `LocalFileSource` for the picked book.                                                                                                                                                   |
| `new PdfImageSource(inner, opts?)` | used internally by the PDF engine; you rarely construct it                                                                                                                                                                                   |

### A custom source

```ts
import type { ReaderSource, Manifest, Position } from 'porejs';

export class MyApiSource implements ReaderSource {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async getManifest(bookId: string): Promise<Manifest> {
    const r = await fetch(`${this.baseUrl}/books/${bookId}`, this.#auth());
    const j = await r.json();
    // adapt your API shape to ImageManifest | TextManifest
    return { bookId, type: 'epub', title: j.title };
  }
  getFile(bookId: string) {
    return fetch(`${this.baseUrl}/books/${bookId}/file`, this.#auth()).then((r) => r.blob());
  }
  getPage() {
    return Promise.reject(new Error('text only'));
  }
  async loadProgress(bookId: string): Promise<Position | null> {
    const r = await fetch(`${this.baseUrl}/books/${bookId}/position`, this.#auth());
    return r.ok ? r.json() : null;
  }
  async saveProgress(bookId: string, p: Position) {
    await fetch(`${this.baseUrl}/books/${bookId}/position`, {
      ...this.#auth(),
      method: 'PUT',
      body: JSON.stringify(p),
    });
  }
  // optional: loadHighlights / saveHighlights for cross-device annotations
  #auth() {
    return { headers: { authorization: `Bearer ${this.token}` } };
  }
}
```

Wrap it in `CachedSource` to get offline + a local resume fallback for free.
`Position` is a small JSON value — keep it opaque and store it verbatim.

---

## 3. Imperative control — `ReaderHandle`

```tsx
const ref = useRef<ReaderHandle>(null);
<Reader bookId={id} ref={ref} />

ref.current.turn('forward' | 'back');
ref.current.goto(pageNumber | position);
ref.current.goToHref('OEBPS/ch03.xhtml#s2');   // TOC navigation
ref.current.setSettings({ theme: 'sepia', columns: 'one' });
ref.current.chapters();                          // Chapter[]
ref.current.search(query);                       // Promise<SearchHit[]>
ref.current.getCfi();                            // portable epubcfi(...) | null
ref.current.goToCfi('epubcfi(/6/8!/4/2)');       // navigate to one (text engine)
ref.current.addHighlight({ color, note });       // from the current selection
ref.current.updateHighlight(id, { color?, note? });
ref.current.removeHighlight(id);
ref.current.listHighlights();
ref.current.ttsPlay() / ttsPause() / ttsResume() / ttsStop() / ttsSetRate(n) / ttsSetVoice(v);
```

Methods that don't apply to the active engine are safe no-ops (`getCfi()` on a
PDF returns `null`, `goToCfi()` on image/PDF does nothing, TTS on an image book
never plays).

---

## 4. Hooks (must be used inside `<Reader>`)

| hook                      | returns                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useReader()`             | the `ReaderHandle`                                                                                                                                           |
| `useReaderKind()`         | `'text' \| 'image'` (PDF reports `'image'`)                                                                                                                  |
| `useReaderManifest()`     | the book's `Manifest` (`title`, `subtitle?`, `volume?`, type, …) — `null` until loaded                                                                       |
| `useReaderLocation()`     | `ReaderLocation` — page, total, percent, label, chapter                                                                                                      |
| `useReaderProgress()`     | `{ page, total, percent, … }`                                                                                                                                |
| `useReaderChapters()`     | `Chapter[]`                                                                                                                                                  |
| `useTableOfContents()`    | `TocEntry[]` (nested)                                                                                                                                        |
| `useReaderSettings<T>()`  | `[settings, setSettings]`                                                                                                                                    |
| `useReaderKeymap()`       | `[keymap, setKeymap]`                                                                                                                                        |
| `useReaderSearch()`       | `{ query, setQuery, hits, activeIndex, go, next, prev, clear, busy }`                                                                                        |
| `useReaderHighlights()`   | `HighlightRecord[]`                                                                                                                                          |
| `useBookmarks()`          | `{ bookmarks, isBookmarkedHere, supported, add(label?), remove(id), rename(id, label), goTo(bm), toggle() }` — over the handle + `source.load/saveBookmarks` |
| `useReaderSelection()`    | `{ selection, highlight(opts), removeHighlight(id), updateHighlight(id, patch) }`                                                                            |
| `useTts()`                | `{ state, play, pause, resume, stop, setRate, setVoice, listVoices }`                                                                                        |
| `useFootnote()`           | the footnote/endnote currently opened by a link tap                                                                                                          |
| `useEndPage()`            | end-of-chapter / end-of-book card state                                                                                                                      |
| `useReaderLoading()`      | set of loading page/spine ids (for skeletons)                                                                                                                |
| `useReaderError()`        | last engine error                                                                                                                                            |
| `useResumedFromPage()`    | page number if the session was resumed (for a toast)                                                                                                         |
| `useChromeVisible()`      | engine's own chrome-visibility signal (tap-to-toggle)                                                                                                        |
| `useReaderHistory(opts?)` | reflects position into `document.title` (and the URL in `mode: 'url-and-title'`) — see below                                                                 |
| `useDownload()`           | `{ status, progress, download, remove }` (needs a `CachedSource`)                                                                                            |

### `useReaderHistory` — the tab title

By default it sets `document.title` to `Work · Vol N · Chapter` — the `Vol N`
part appears only when the manifest carries `volume`, the chapter part only when
the book has chapters, otherwise it falls back to `Work · 42%`. A dropped local
file's manifest title is already its file name, so that reads `my-comic · 42%`.

```tsx
useReaderHistory({
  mode: 'title', // or 'url-and-title' (back/forward turns pages), or 'none'
  formatTitle: ({ manifest, chapterLabel, percent }) =>
    manifest ? `${manifest.title} — ${chapterLabel ?? `${Math.round(percent * 100)}%`}` : '',
});
```

Return `''` from `formatTitle` to leave `document.title` alone — the right move
when your app framework owns the title.

---

## 5. Headless components

All render `data-pore-*` markup + Radix; you style them.

| component                                                                | what                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `<SettingsPanel open onOpenChange extraTabs?>`                           | Radix Dialog with the typography/theme/navigation tabs. `extraTabs` appends your own (`TabDef[]`).               |
| `<SettingsPanelBody>`                                                    | the tabs without the dialog shell                                                                                |
| `<TableOfContents className? placeholder?>`                              | a native `<select>` bound to `goToHref` (`data-pore-toc`)                                                        |
| `<HighlightsPanel className? colors? emptyLabel? onJump? previewChars?>` | editable list — jump / recolour / note textarea / remove (`data-pore-hl-*`)                                      |
| `<BookmarksPanel className? onJump? emptyLabel?>`                        | list — jump / inline rename / remove (`data-pore-bm-*`). Renders `null` when the source has no bookmark methods. |
| `<FootnotePopover>`                                                      | renders the footnote a link opened                                                                               |
| `<ReaderScrubber>`                                                       | bottom seek bar with chapter ticks                                                                               |
| `<ReaderAnnouncer>`                                                      | visually-hidden ARIA live region — mount once inside `<Reader>`                                                  |

See `apps/demo/src/Chrome.tsx` for a full chrome assembled from these +
`apps/demo/src/styles.css` for the styling.

---

## 6. Settings & persistence

`AnySettings` = `ImageEngineSettings | TextEngineSettings`. Defaults:
`DEFAULT_IMAGE_SETTINGS` / `DEFAULT_TEXT_SETTINGS`. Persistence is a global
prefs layer + a per-book layout layer; pass `persistSettings={false}` to
disable or your own `SettingsPersistence` (`createSettingsPersistence`).

---

## 7. Transitions

```tsx
import gsap from 'gsap';
import { gsapAdapter } from 'porejs-react';
<Reader transitions={gsapAdapter(gsap)} />;
```

Without it, page turns / zoom / scroll are instant. The adapter is
reduced-motion aware.

---

## 8. PDF worker

pdf.js is a lazy chunk. Point it at its worker once at startup so it never
lands in your main bundle:

```ts
// Vite — the engine imports the *legacy* pdf.js build, so match it here
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { setPdfWorkerSrc } from 'porejs';
setPdfWorkerSrc(pdfWorkerUrl);
```

### Bundle size

`porejs` reaches `pdfjs-dist` **only through a dynamic `import()`**
(`pdf/parse.ts`). Vite / webpack / Rollup / esbuild all code-split that into a
lazy chunk by default, so:

| you import                                                   | up-front cost (brotli)                     |
| ------------------------------------------------------------ | ------------------------------------------ |
| `createTextEngine` + sources                                 | ~18 kB                                     |
| `createImageEngine` + sources                                | ~12 kB                                     |
| all three engines + every source                             | ~30 kB (pdf.js **not** counted)            |
| pdf.js itself                                                | ~130 kB — loads the first time a PDF opens |
| `porejs-react` (`Reader` + hooks, `react`/`porejs` external) | ~2 kB                                      |

These are `size-limit` budgets checked in CI (`.size-limit.json`,
`pnpm size`) — a regression fails the build. If your bundler is configured to
**inline** dynamic imports, `import { createPdfEngine }` will pull the full
~130 kB; keep dynamic-import code-splitting on, or don't import `createPdfEngine`
in a bundle that never shows PDFs.

---

## 9. Framework-agnostic core (no React)

```ts
import { createTextEngine } from 'porejs';

const engine = createTextEngine({ container, source, bookId, settings });
const off = engine.on('reader:locationchange', (loc) => {
  /* … */
});
await engine.mount();
engine.turn('forward');
// engine.goto / setSettings / search / getCfi / addHighlight / on / destroy
```

`createImageEngine` and `createPdfEngine` have the same shape. Events are
`reader:*` (see `docs/architecture.md` §2 for the full list). `destroy()` tears
down listeners, observers, object URLs and the DOM subtree.
