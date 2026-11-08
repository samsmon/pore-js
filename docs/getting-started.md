# Getting started

Add a reader — manga, comics, EPUB, PDF — to a React app.

## Install

```bash
npm i porejs porejs-react
# peers: react >= 19, react-dom >= 19 (gsap optional — eased page turns)
```

ESM-only, Node ≥ 20, current + previous major of Chrome / Firefox / Safari.
`porejs-react` is **client-only** (Next.js: put it under `'use client'`).

## The one-call reader: `<Book>`

You have a URL to a file, or a list of image URLs. That's all `<Book>` needs.

```tsx
import { Book } from 'porejs-react';

// a .cbz / .epub / .pdf / .zip
<Book src="https://cdn.site/one-piece/vol-108/ch-1074.cbz" />

// …or a list of image URLs (one manga chapter)
<Book pages={['https://cdn/1.webp', 'https://cdn/2.webp', '…']} />

// …or a File / Blob you already have
<Book file={droppedFile} />
```

Add metadata if you have it — it drives the tab title and reading direction:

```tsx
<Book
  src="https://cdn.site/one-piece/ch-1074.cbz"
  meta={{
    title: 'One Piece',
    author: 'Eiichiro Oda',
    volume: 108,
    chapter: 1074,
    direction: 'rtl', // manga; 'vertical' for tategaki
  }}
/>
```

### Progress, chapters, auth

```tsx
<Book
  src={chapterUrl}
  meta={meta}
  seriesId="one-piece" // keeps fit/zoom prefs across chapters
  progress={savedPosition} // resume — a value from onProgress
  onProgress={(pos) => saveToMyDb(pos)} // persist it yourself
  onEnd={({ kind }) => {
    // reached the end
    if (kind === 'book') loadNextChapter();
  }}
  fetch={(url, init) =>
    // CDN that needs auth / Referer
    fetch(url, { ...init, headers: { Referer: 'https://site' } })
  }
  className="reader"
  style={{ height: '100dvh' }}
/>
```

Style the reader host with `className` / `style`. `<Book>` renders no chrome —
add your own toolbar with the hooks (below) if you want one.

### Mobile

The engines are touch-first: horizontal **swipe** turns the page (image and
text), images stay locked at a clean 1.0 fit scale without accidental pan/zoom displacement, and the browser keeps vertical scroll (`touch-action`). Nothing to
configure.

For the menu, each engine renders a faint **chrome handle** — a small upward
chevron pinned bottom-centre (`[data-pore-chrome-handle]`, respects
`env(safe-area-inset-*)`) that fades while idle and toggles your chrome on tap.
Change it with the `chromeGesture` setting (`'handle'` default, or
`'tap-center'`, `'long-press'`, `'handle+long-press'`, `'none'`).

Give the host a real height that survives the mobile URL bar and notches:

```tsx
<Book src={url} meta={meta} style={{ height: '100dvh' }} />
```

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

## Adding chrome

`porejs-react` ships **no CSS**. The headless components carry `data-pore-*`
hooks; you style and place them. They work inside `<Book>` via `children`:

```tsx
import { Book, useReader, useReaderLocation, TableOfContents } from 'porejs-react';

function Toolbar() {
  const reader = useReader();
  const loc = useReaderLocation();
  return (
    <div className="toolbar">
      <button onClick={() => reader.turn('back')}>‹</button>
      <span>{loc ? `${loc.page + 1} / ${loc.total}` : '…'}</span>
      <button onClick={() => reader.turn('forward')}>›</button>
      <TableOfContents />
    </div>
  );
}

<Book src={url} meta={meta}>
  <Toolbar />
</Book>;
```

Hooks: `useReader`, `useReaderLocation`, `useReaderProgress`,
`useReaderSettings`, `useReaderSearch`, `useReaderHighlights`, `useBookmarks`,
`useTts`, `useTableOfContents`. Components: `<SettingsPanel>`,
`<TableOfContents>`, `<HighlightsPanel>`, `<BookmarksPanel>`,
`<ReaderScrubber>`, `<FootnotePopover>`, `<ReaderAnnouncer>` (mount once for
screen readers). `apps/demo/src/styles.css` is a full worked stylesheet — copy
from it.

## When you have a real backend

If you need auth, streaming, server-side progress, or offline caching, drop to
the source tier — implement `ReaderSource` (one object, ~5 methods) and pass it
to `<ReaderProvider>`. See [`integration.md`](integration.md) and the worked
example in [`examples/host-app/`](../examples/host-app) (`pnpm example`).

`<Book>` is `createReaderSource(...)` + `<ReaderProvider>` + `<Reader>` — you
can compose those yourself at any point.

## PDF worker (only if you show PDFs)

pdf.js is a lazy chunk. Point it at its worker once at startup:

```ts
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'; // Vite
import { setPdfWorkerSrc } from 'porejs';
setPdfWorkerSrc(pdfWorkerUrl);
```

## Next

- [`integration.md`](integration.md) — the source seam, security / CSP, bundle
  size, embed isolation.
- [`architecture.md`](architecture.md) — how the engines work.
- [`stability.md`](stability.md) — what `v1.x` SemVer covers.
