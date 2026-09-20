import { useRef } from 'react';
import { relativeTime, type LibraryEntry } from './use-library.js';

export type ModeGlyph = 'spread' | 'strip' | 'text' | 'vertical' | 'rtl' | 'page' | 'pdf';

export interface SampleBook {
  id: string;
  label: string;
  /** One line on what engine mode / feature this sample shows off. */
  blurb: string;
  /** Which little layout diagram to draw on the card. */
  glyph: ModeGlyph;
  settings?: Record<string, unknown>;
}

/** A tiny 2-tone diagram of the layout each sample demonstrates. */
function Glyph({ kind }: { kind: ModeGlyph }) {
  const line = (x: number, y: number, w: number) => (
    <rect x={x} y={y} width={w} height="2" rx="1" fill="currentColor" opacity="0.35" />
  );
  return (
    <svg
      className="landing__glyph"
      viewBox="0 0 44 32"
      width="44"
      height="32"
      aria-hidden
      role="presentation"
    >
      <rect
        x="0.75"
        y="0.75"
        width="42.5"
        height="30.5"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
      />
      {kind === 'text' && [7, 12, 17, 22].map((y, i) => line(7, y, i === 3 ? 18 : 30))}
      {kind === 'rtl' && [7, 12, 17, 22].map((y, i) => line(i === 3 ? 19 : 7, y, i === 3 ? 18 : 30))}
      {kind === 'spread' && (
        <>
          <rect x="6" y="6" width="14" height="20" rx="1.5" fill="currentColor" opacity="0.22" />
          <rect x="24" y="6" width="14" height="20" rx="1.5" fill="currentColor" opacity="0.35" />
        </>
      )}
      {kind === 'strip' && (
        <>
          <rect x="15" y="4" width="14" height="10" rx="1.5" fill="currentColor" opacity="0.35" />
          <rect x="15" y="16" width="14" height="10" rx="1.5" fill="currentColor" opacity="0.22" />
          <rect x="15" y="28" width="14" height="6" rx="1.5" fill="currentColor" opacity="0.15" />
        </>
      )}
      {kind === 'vertical' &&
        [30, 22, 14].map((x, i) => (
          <rect
            key={x}
            x={x}
            y="6"
            width="2"
            height={i === 2 ? 12 : 20}
            rx="1"
            fill="currentColor"
            opacity="0.35"
          />
        ))}
      {kind === 'page' && (
        <>
          <rect x="12" y="4" width="20" height="24" rx="1.5" fill="currentColor" opacity="0.28" />
          <path d="M26 4 L32 10 L26 10 Z" fill="currentColor" opacity="0.5" />
        </>
      )}
      {kind === 'pdf' && (
        <>
          <rect x="10" y="5" width="24" height="22" rx="1.5" fill="currentColor" opacity="0.22" />
          {[10, 14, 18].map((y) => line(14, y, y === 18 ? 10 : 16))}
        </>
      )}
    </svg>
  );
}

export function Landing({
  books,
  onFiles,
  onSample,
  recent = [],
  onResume,
  onForget,
  onReview,
}: {
  books: SampleBook[];
  onFiles: (files: FileList | File[]) => void;
  onSample: (id: string) => void;
  recent?: LibraryEntry[];
  onResume?: (entry: LibraryEntry) => void;
  onForget?: (id: string) => void;
  onReview?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="landing">
      <div className="landing__inner">
        <header className="landing__head">
          <h1 className="landing__title">Pore.js</h1>
          <p className="landing__tagline">
            A source-agnostic web reader for manga, comics and books — built from
            scratch, with its own pagination engine and no backend.
          </p>
        </header>

        {recent.length > 0 && (
          <section className="landing__section" aria-labelledby="landing-recent">
            <div className="landing__section-head">
              <h2 className="landing__h2" id="landing-recent">
                Continue reading
              </h2>
              {onReview && (
                <button type="button" className="landing__review-link" onClick={onReview}>
                  My annotations
                </button>
              )}
            </div>
            <ul className="landing__recent">
              {recent.map((e) => (
                <li key={e.id} className="landing__recent-item">
                  <button
                    type="button"
                    className="landing__recent-open"
                    onClick={() => (e.kind === 'file' ? inputRef.current?.click() : onResume?.(e))}
                  >
                    <Glyph kind={e.glyph} />
                    <span className="landing__recent-body">
                      <span className="landing__recent-title">{e.title}</span>
                      <span className="landing__recent-meta">
                        {e.percent > 0 ? `${Math.round(e.percent * 100)}% · ` : ''}
                        {relativeTime(e.lastOpened)}
                        {e.kind === 'file' ? ' · re-pick the file' : ''}
                      </span>
                      <span className="landing__recent-track" aria-hidden>
                        <span
                          className="landing__recent-fill"
                          style={{ width: `${Math.round(e.percent * 100)}%` }}
                        />
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="landing__recent-forget"
                    aria-label={`Remove ${e.title} from library`}
                    onClick={() => onForget?.(e.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="landing__section" aria-labelledby="landing-open">
          <h2 className="landing__h2" id="landing-open">
            Open your own
          </h2>
          <button type="button" className="landing__drop" onClick={() => inputRef.current?.click()}>
            <span className="landing__drop-icon" aria-hidden>
              ↑
            </span>
            <span className="landing__drop-title">Drop a file, or click to choose</span>
            <span className="landing__drop-hint">
              EPUB · PDF · CBZ / ZIP · a folder of images. It stays in your browser — nothing is
              uploaded.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".epub,.pdf,.cbz,.zip,image/*"
            className="landing__file"
            onChange={(e) => {
              if (e.target.files?.length) onFiles(e.target.files);
            }}
          />
        </section>

        <section className="landing__section" aria-labelledby="landing-modes">
          <h2 className="landing__h2" id="landing-modes">
            Or try every mode
          </h2>
          <ul className="landing__samples">
            {books.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => onSample(b.id)}>
                  <Glyph kind={b.glyph} />
                  <span className="landing__sample-label">{b.label}</span>
                  <span className="landing__sample-blurb">{b.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <footer className="landing__footer">
          <a href="https://github.com/samsmon/pore-js" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span aria-hidden>·</span>
          <span>
            Project B of two — the reader engine; Project A is the{' '}
            <a
              href="https://github.com/samsmon/yado"
              target="_blank"
              rel="noreferrer"
            >
              whitearchive
            </a>{' '}
            library platform.
          </span>
          <span aria-hidden>·</span>
          <span>MIT</span>
        </footer>
      </div>
    </div>
  );
}
