# porejs-react

React 19 bindings for [`porejs`](https://www.npmjs.com/package/porejs) — a
drop-in **web reader** for manga, comics and books (EPUB, PDF, CBZ).

You provide **a content source and a mount point**; you get the whole reader —
pagination, themes, TOC, highlights, bookmarks, in-book search, TTS. The
components are **headless** (no CSS shipped) — you style the `data-pore-*`
markup.

## Install

```bash
npm i porejs porejs-react
# peer: react >= 19, react-dom >= 19; gsap optional (eased page turns)
```

ESM-only, Node ≥ 20.

## Quick start

```tsx
import { ReaderProvider, Reader } from 'porejs-react';
import { CachedSource, DemoSource } from 'porejs';

// swap DemoSource for your own ReaderSource (see below)
const source = new CachedSource(new DemoSource());

function App() {
  return (
    <ReaderProvider source={source}>
      <Reader bookId="demo-book" className="reader-host" />
    </ReaderProvider>
  );
}
```

## Bring your own content

Implement one interface and every engine feature works over it:

```ts
import type { ReaderSource } from 'porejs';

class MyLibrarySource implements ReaderSource {
  getManifest(bookId) {
    /* → { type, title, pages | spine, … } */
  }
  getPage(bookId, index) {
    /* → Blob | URL (image books) */
  }
  getFile(bookId) {
    /* → Blob (EPUB / PDF / CBZ) */
  }
  loadProgress(bookId) {
    /* → Position | null */
  }
  saveProgress(bookId, position) {
    /* persist the opaque Position value */
  }
  // optional: loadHighlights / saveHighlights / loadBookmarks / saveBookmarks
}
```

The host still owns auth, the content API, routing, storage, and the layout
around the reader. Everything else is this library.

## What's in the box

- **`<Reader>`** — auto-selects the image / text / PDF engine by manifest type.
- **Hooks** — `useReader`, `useReaderLocation`, `useReaderProgress`,
  `useReaderSettings`, `useReaderSearch`, `useReaderHighlights`, `useBookmarks`,
  `useTts`, `useTableOfContents`, `useReaderHistory`, …
- **Headless components** — `<SettingsPanel>`, `<TableOfContents>`,
  `<HighlightsPanel>`, `<BookmarksPanel>`, `<ReaderScrubber>`,
  `<FootnotePopover>`, `<ReaderAnnouncer>`.
- Injectable animation seam — `gsapAdapter(gsap)` for eased page turns / zoom /
  scroll, reduced-motion aware.

`apps/demo/src/styles.css` in the repo is a complete worked styling example.

## Docs

- [Integration guide](https://github.com/srytmj/pore-js/blob/main/docs/integration.md)
- [Architecture](https://github.com/srytmj/pore-js/blob/main/docs/architecture.md)

MIT © Surya
