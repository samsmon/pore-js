import type { GetFileOpts, GetPageOpts, ImageManifest, Position, ReaderSource } from 'porejs';
import { seriesOf, volumeOf } from './catalog.js';

/**
 * The whole integration: one class implementing `ReaderSource` over the host's
 * own catalog + API. porejs never learns where the bytes or the progress live.
 *
 *  - `getManifest` — map the host's record to porejs's `ImageManifest`.
 *  - `getPage`     — hand back page bytes (here: generated SVG; in a real app,
 *                    `fetch('/api/pages/…')`).
 *  - `getFile`     — only for EPUB/PDF books; rejected here.
 *  - load/saveProgress — the host owns storage. This one uses localStorage
 *                    under its *own* namespace, so it never collides with
 *                    porejs-react's settings store.
 */
export class LibrarySource implements ReaderSource {
  #key(bookId: string) {
    return `inkwell:progress:${bookId}`;
  }

  async getManifest(bookId: string): Promise<ImageManifest> {
    const vol = volumeOf(bookId);
    if (!vol) throw new Error(`Unknown book: ${bookId}`);
    const series = seriesOf(vol);
    return {
      bookId,
      type: 'image',
      title: series.title,
      subtitle: series.author,
      volume: vol.volume,
      direction: vol.direction,
      pageCount: vol.pageCount,
      preferredLayout: 'paged-single',
      pages: Array.from({ length: vol.pageCount }, (_, index) => ({
        index,
        width: 800,
        height: 1200,
      })),
      chapters: [{ id: 'ch1', label: vol.chapterTitle, startIndex: 0 }],
    };
  }

  async getPage(bookId: string, index: number, _opts?: GetPageOpts): Promise<string> {
    const vol = volumeOf(bookId)!;
    const series = seriesOf(vol);
    // a real host does: return fetch(`/api/books/${bookId}/pages/${index}`).then(r => r.blob())
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">
      <rect width="800" height="1200" fill="hsl(${series.hue} 40% ${index % 2 ? 92 : 88}%)"/>
      <rect x="40" y="40" width="720" height="1120" fill="none" stroke="hsl(${series.hue} 45% 35%)" stroke-width="3"/>
      <text x="400" y="120" text-anchor="middle" font-family="Georgia, serif" font-size="46" fill="hsl(${series.hue} 45% 25%)">${series.title}</text>
      <text x="400" y="180" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="hsl(${series.hue} 30% 40%)">Vol. ${vol.volume} — ${vol.chapterTitle}</text>
      <text x="400" y="640" text-anchor="middle" font-family="Georgia, serif" font-size="180" fill="hsl(${series.hue} 45% 30%)">${index + 1}</text>
      <text x="400" y="1140" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="hsl(${series.hue} 20% 50%)">page ${index + 1} / ${vol.pageCount}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  async getFile(_bookId: string, _opts?: GetFileOpts): Promise<Blob> {
    throw new Error('LibrarySource serves image books only (no EPUB/PDF)');
  }

  async loadProgress(bookId: string): Promise<Position | null> {
    try {
      const raw = localStorage.getItem(this.#key(bookId));
      return raw ? (JSON.parse(raw) as Position) : null;
    } catch {
      return null;
    }
  }

  async saveProgress(bookId: string, position: Position): Promise<void> {
    try {
      localStorage.setItem(this.#key(bookId), JSON.stringify(position));
    } catch {
      /* private mode / quota — a real host would POST to its API */
    }
  }
}
