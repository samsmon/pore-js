import { Reader, ReaderProvider, useReaderHistory, type ReaderTitleContext } from 'porejs-react';
import { useMemo, useState } from 'react';
import { SERIES, VOLUMES, seriesOf, volumeOf } from './catalog.js';
import { LibrarySource } from './library-source.js';
import './reader.css';

/** The host decides the tab title — porejs just hands it the pieces. */
function tabTitle({ manifest, chapterLabel, percent }: ReaderTitleContext): string {
  if (!manifest) return 'Inkwell';
  const vol = manifest.volume !== undefined ? ` · Vol. ${manifest.volume}` : '';
  const ch = chapterLabel ? ` · ${chapterLabel}` : '';
  const pct = percent > 0 ? ` (${Math.round(percent * 100)}%)` : '';
  return `${manifest.title}${vol}${ch}${pct} — Inkwell`;
}

/** A tiny slice of the reader chrome — proves the host styles the headless bits. */
function ReaderChrome({ onClose }: { onClose: () => void }) {
  useReaderHistory({ mode: 'title', formatTitle: tabTitle });
  return (
    <div className="chrome">
      <button onClick={onClose}>← Library</button>
      <span className="hint">← / → or click the edges to turn pages</span>
    </div>
  );
}

export function App() {
  // one source instance for the whole library — reused across books
  const source = useMemo(() => new LibrarySource(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) {
    const vol = volumeOf(openId)!;
    return (
      <ReaderProvider source={source}>
        <div className="reader-shell">
          <Reader
            key={openId}
            bookId={openId}
            className="reader-host"
            initialSettings={{ direction: vol.direction, layout: 'paged-single' }}
          >
            {/* chrome lives *inside* <Reader> so the hooks have its context */}
            <ReaderChrome onClose={() => setOpenId(null)} />
          </Reader>
        </div>
      </ReaderProvider>
    );
  }

  return (
    <div className="library">
      <header>
        <h1>Inkwell</h1>
        <p>
          A pretend manga library. The reader is dropped in from <code>porejs-react</code>.
        </p>
      </header>
      {SERIES.map((s) => (
        <section key={s.slug}>
          <h2>
            {s.title} <small>· {s.author}</small>
          </h2>
          <ul>
            {VOLUMES.filter((v) => v.seriesSlug === s.slug).map((v) => (
              <li key={v.id}>
                <button onClick={() => setOpenId(v.id)} data-book={v.id}>
                  <span
                    className="cover"
                    style={{ background: `hsl(${seriesOf(v).hue} 40% 82%)` }}
                    aria-hidden
                  />
                  <span className="meta">
                    <strong>Vol. {v.volume}</strong>
                    <span>{v.chapterTitle}</span>
                    <span className="dir">{v.direction.toUpperCase()}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
