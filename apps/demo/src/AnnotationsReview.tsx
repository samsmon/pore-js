import type { Bookmark, HighlightRecord, Position, ReaderSource } from 'porejs';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryEntry } from './use-library.js';
import {
  buildBundle,
  downloadBundle,
  mergeBundle,
  validateBundle,
  type PortableBook,
} from './portability.js';

export interface JumpTarget {
  bookId: string;
  cfi?: string;
  position?: Position;
}

interface BookGroup {
  entry: LibraryEntry;
  highlights: HighlightRecord[];
  bookmarks: Bookmark[];
}

/**
 * A full-screen "everything you've marked" overlay, reachable from the landing.
 * Reads the per-book highlight / bookmark stores straight off the shared source
 * — no aggregate API in core. Only sample books (which all share the demo
 * source) are covered; dropped files keep their annotations but aren't listed
 * here until re-opened.
 */
export function AnnotationsReview({
  open,
  onClose,
  entries,
  source,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  entries: LibraryEntry[];
  source: ReaderSource;
  onJump: (target: JumpTarget) => void;
}) {
  const [groups, setGroups] = useState<BookGroup[]>([]);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const samples = useMemo(() => entries.filter((e) => e.kind === 'sample'), [entries]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.all(
      samples.map(async (entry) => ({
        entry,
        highlights: (await source.loadHighlights?.(entry.id)) ?? [],
        bookmarks: (await source.loadBookmarks?.(entry.id)) ?? [],
      })),
    ).then((all) => {
      if (!live) return;
      setGroups(all.filter((g) => g.highlights.length > 0 || g.bookmarks.length > 0));
    });
    return () => {
      live = false;
    };
  }, [open, samples, source, reloadKey]);

  const gather = async (ids: string[]): Promise<PortableBook[]> =>
    Promise.all(
      ids.map(async (id) => ({
        id,
        title: entries.find((e) => e.id === id)?.title ?? id,
        position: (await source.loadProgress(id)) ?? null,
        highlights: (await source.loadHighlights?.(id)) ?? [],
        bookmarks: (await source.loadBookmarks?.(id)) ?? [],
      })),
    );

  const exportBooks = async (ids: string[], filename: string) => {
    const books = await gather(ids);
    downloadBundle(buildBundle(books), filename);
  };

  const importFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setNotice('That file isn’t valid JSON.');
      return;
    }
    const v = validateBundle(parsed);
    if (!v.ok) {
      setNotice(`Import failed — ${v.error}`);
      return;
    }
    let report = { books: 0, highlights: 0, bookmarks: 0, skipped: 0 };
    for (const book of v.bundle.books) {
      const existing = await gather([book.id]);
      const { merged, report: r } = mergeBundle(existing, {
        ...v.bundle,
        books: [book],
      });
      const out = merged.find((m) => m.id === book.id);
      if (out) {
        await source.saveHighlights?.(book.id, out.highlights);
        await source.saveBookmarks?.(book.id, out.bookmarks);
        if (out.position) await source.saveProgress(book.id, out.position);
      }
      report = {
        books: report.books + r.books,
        highlights: report.highlights + r.highlights,
        bookmarks: report.bookmarks + r.bookmarks,
        skipped: report.skipped + r.skipped,
      };
    }
    setNotice(
      `Imported ${report.highlights} highlight(s), ${report.bookmarks} bookmark(s)` +
        (report.skipped ? ` · ${report.skipped} already present` : ''),
    );
    setReloadKey((k) => k + 1);
  };

  if (!open) return null;

  const needle = filter.trim().toLowerCase();
  const match = (s: string | undefined) => !needle || (s ?? '').toLowerCase().includes(needle);

  const total = groups.reduce((n, g) => n + g.highlights.length + g.bookmarks.length, 0);

  return (
    <div className="review" role="dialog" aria-label="My annotations" aria-modal="true">
      <div className="review__panel">
        <header className="review__head">
          <h2 className="review__title">My annotations</h2>
          <input
            type="search"
            className="review__filter"
            placeholder="Filter by text or note…"
            aria-label="Filter annotations"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button type="button" className="review__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="review__toolbar">
          <button
            type="button"
            className="review__tool"
            disabled={groups.length === 0}
            onClick={() =>
              void exportBooks(
                groups.map((g) => g.entry.id),
                `pore-annotations-${new Date().toISOString().slice(0, 10)}.json`,
              )
            }
          >
            Export all
          </button>
          <button type="button" className="review__tool" onClick={() => fileRef.current?.click()}>
            Import…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFile(f);
            }}
          />
          {notice && (
            <span className="review__notice" role="status">
              {notice}
            </span>
          )}
        </div>

        <div className="review__body">
          {total === 0 && (
            <p className="review__empty">
              Nothing marked yet. Highlight a passage or drop a bookmark (<kbd>b</kbd>) and it shows
              up here.
            </p>
          )}

          {groups.map((g) => {
            const hs = g.highlights.filter((h) => match(h.text) || match(h.note));
            const bs = g.bookmarks.filter((b) => match(b.label) || match(b.text));
            if (needle && hs.length === 0 && bs.length === 0) return null;
            const isCollapsed = collapsed[g.entry.id] ?? false;
            return (
              <section className="review__group" key={g.entry.id}>
                <div className="review__group-bar">
                  <button
                    type="button"
                    className="review__group-head"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((c) => ({ ...c, [g.entry.id]: !isCollapsed }))}
                  >
                    <span className="review__group-title">{g.entry.title}</span>
                    <span className="review__group-count">
                      {g.highlights.length + g.bookmarks.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="review__group-export"
                    onClick={() => void exportBooks([g.entry.id], `${g.entry.id}-annotations.json`)}
                  >
                    Export
                  </button>
                </div>
                {!isCollapsed && (
                  <ul className="review__list">
                    {hs.map((h) => (
                      <li key={h.id} className="review__row">
                        <button
                          type="button"
                          className="review__jump"
                          onClick={() =>
                            onJump({
                              bookId: g.entry.id,
                              ...(h.kind === 'text' ? { cfi: h.cfi.start } : {}),
                            })
                          }
                        >
                          <span
                            className="review__swatch"
                            style={{ background: h.color }}
                            aria-hidden
                          />
                          <span className="review__text">
                            <span className="review__quote">{h.text || '(highlight)'}</span>
                            {h.note && <span className="review__note">{h.note}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                    {bs.map((b) => (
                      <li key={b.id} className="review__row">
                        <button
                          type="button"
                          className="review__jump"
                          onClick={() =>
                            onJump({
                              bookId: g.entry.id,
                              ...(b.cfi ? { cfi: b.cfi } : { position: b.position }),
                            })
                          }
                        >
                          <span className="review__bm" aria-hidden>
                            ▸
                          </span>
                          <span className="review__text">
                            <span className="review__quote">{b.label}</span>
                            {b.text && <span className="review__note">{b.text}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
