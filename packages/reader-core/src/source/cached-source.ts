import type { Position } from '../position/types.js';
import type {
  Bookmark,
  GetFileOpts,
  GetPageOpts,
  HighlightRecord,
  Manifest,
  ReaderSource,
} from './types.js';
import { openKvStore, type KvStore } from '../offline/idb.js';
import { MediaCache } from '../offline/media-cache.js';

export interface CachedSourceOptions {
  /** Storage backend; defaults to an IndexedDB-backed KV store. */
  store?: KvStore;
  /** Namespace for keys (lets multiple libraries coexist). Default "pore". */
  namespace?: string;
  /**
   * Offline media cache. Pass `false` to disable (progress-only, the pre-v2
   * behaviour). An object tunes it; the default is a 500 MB LRU cache.
   */
  cache?: false | { store?: KvStore; budgetBytes?: number };
}

export type DownloadState = 'none' | 'partial' | 'complete';

export interface DownloadStatus {
  state: DownloadState;
  cached: number;
  total: number;
  bytes: number;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (status: DownloadStatus) => void;
}

const FILE_SLOT = 'file';

interface QueuedWrite {
  bookId: string;
  position: Position;
  at: number;
}

/**
 * Wraps any {@link ReaderSource}, persisting reading progress locally so a
 * checkpoint survives reloads and works offline. Manifest/page/file calls pass
 * straight through. See docs/image-engine-spec.md §2.2.1.
 *
 * Progress writes are mirrored to the wrapped source (best-effort). If that
 * write fails (offline), it is queued and flushed on the next `online` event.
 */
export class CachedSource implements ReaderSource {
  readonly #inner: ReaderSource;
  readonly #store: KvStore;
  readonly #ns: string;
  readonly #media: MediaCache | null;
  #queue: QueuedWrite[] = [];
  #flushing = false;
  readonly #onOnline = () => void this.flush();

  constructor(inner: ReaderSource, opts: CachedSourceOptions = {}) {
    this.#inner = inner;
    this.#store = opts.store ?? openKvStore();
    this.#ns = opts.namespace ?? 'pore';
    this.#media =
      opts.cache === false
        ? null
        : new MediaCache(typeof opts.cache === 'object' ? opts.cache : {});
    if (typeof addEventListener === 'function') addEventListener('online', this.#onOnline);
  }

  /** Live manifest when online; the copy saved by {@link download} when the wrapped source is unreachable (offline). */
  async getManifest(bookId: string): Promise<Manifest> {
    try {
      const manifest = await this.#inner.getManifest(bookId);
      await this.#store.set(this.#manifestKey(bookId), manifest).catch(() => {});
      return manifest;
    } catch (err) {
      const cached = await this.#store.get<Manifest>(this.#manifestKey(bookId)).catch(() => null);
      if (cached) return cached;
      throw err;
    }
  }

  /** Cached blob first (once downloaded), then the wrapped source. */
  async getPage(bookId: string, index: number, opts?: GetPageOpts): Promise<Blob | string> {
    const hit = await this.#media?.getBlob(bookId, String(index));
    if (hit) return hit;
    return this.#inner.getPage(bookId, index, opts);
  }

  async getFile(bookId: string, opts?: GetFileOpts): Promise<Blob> {
    const hit = await this.#media?.getBlob(bookId, FILE_SLOT);
    if (hit) return hit;
    return this.#inner.getFile(bookId, opts);
  }

  /**
   * Pull a whole book into the offline cache — every page for an image book,
   * the file for EPUB / PDF. Safe to call again to resume a partial download.
   */
  async download(bookId: string, opts: DownloadOptions = {}): Promise<void> {
    if (!this.#media) throw new Error('CachedSource: media cache is disabled');
    const manifest = await this.getManifest(bookId); // also persists it for offline getManifest()

    if (manifest.type === 'image') {
      const total = manifest.pageCount;
      for (let i = 0; i < total; i++) {
        opts.signal?.throwIfAborted();
        if (!(await this.#media.getBlob(bookId, String(i)))) {
          const page = await this.#inner.getPage(bookId, i, sig(opts.signal));
          const blob = typeof page === 'string' ? await (await fetch(page)).blob() : page;
          await this.#media.putBlob(bookId, String(i), blob, total);
        }
        opts.onProgress?.(await this.downloadStatus(bookId));
      }
      return;
    }

    opts.signal?.throwIfAborted();
    if (!(await this.#media.getBlob(bookId, FILE_SLOT))) {
      const file = await this.#inner.getFile(bookId, sig(opts.signal));
      await this.#media.putBlob(bookId, FILE_SLOT, file, 1);
    }
    opts.onProgress?.(await this.downloadStatus(bookId));
  }

  async downloadStatus(bookId: string): Promise<DownloadStatus> {
    const meta = await this.#media?.meta(bookId);
    if (!meta || meta.slots.length === 0) {
      return { state: 'none', cached: 0, total: 0, bytes: 0 };
    }
    const hasFile = meta.slots.includes(FILE_SLOT);
    const total = hasFile ? 1 : (meta.pageCount ?? meta.slots.length);
    const cached = hasFile ? 1 : meta.slots.filter((s) => s !== FILE_SLOT).length;
    return {
      state: cached >= total ? 'complete' : 'partial',
      cached,
      total,
      bytes: meta.bytes,
    };
  }

  /** Alias kept short for the common check. */
  async downloadState(bookId: string): Promise<DownloadState> {
    return (await this.downloadStatus(bookId)).state;
  }

  removeDownload(bookId: string): Promise<void> {
    return this.#media?.removeBook(bookId) ?? Promise.resolve();
  }

  /** Local copy wins; falls back to the wrapped source if we have nothing. */
  async loadProgress(bookId: string): Promise<Position | null> {
    const local = await this.#store.get<Position>(this.#key(bookId));
    if (local) return local;
    try {
      return await this.#inner.loadProgress(bookId);
    } catch {
      return null;
    }
  }

  async saveProgress(bookId: string, p: Position): Promise<void> {
    await this.#store.set(this.#key(bookId), p);
    try {
      await this.#inner.saveProgress(bookId, p);
    } catch {
      this.#enqueue({ bookId, position: p, at: Date.now() });
    }
  }

  /** Local copy wins; falls back to the wrapped source when we have nothing (both optional — most sources have neither). */
  async loadHighlights(bookId: string): Promise<HighlightRecord[]> {
    const local = await this.#store.get<HighlightRecord[]>(this.#hlKey(bookId));
    if (local) return local;
    try {
      return (await this.#inner.loadHighlights?.(bookId)) ?? [];
    } catch {
      return [];
    }
  }

  /** Mirrors {@link saveProgress}'s local-first approach, without the offline queue (a highlight save can just retry on the next call). */
  async saveHighlights(bookId: string, highlights: HighlightRecord[]): Promise<void> {
    await this.#store.set(this.#hlKey(bookId), highlights);
    try {
      await this.#inner.saveHighlights?.(bookId, highlights);
    } catch {
      // best-effort mirror; the local copy above is authoritative for loadHighlights
    }
  }

  /** Bookmarks — same local-first pattern as highlights. */
  async loadBookmarks(bookId: string): Promise<Bookmark[]> {
    const local = await this.#store.get<Bookmark[]>(this.#bmKey(bookId));
    if (local) return local;
    try {
      return (await this.#inner.loadBookmarks?.(bookId)) ?? [];
    } catch {
      return [];
    }
  }

  async saveBookmarks(bookId: string, bookmarks: Bookmark[]): Promise<void> {
    await this.#store.set(this.#bmKey(bookId), bookmarks);
    try {
      await this.#inner.saveBookmarks?.(bookId, bookmarks);
    } catch {
      // best-effort mirror
    }
  }

  /** Push any queued offline writes to the wrapped source. */
  async flush(): Promise<void> {
    if (this.#flushing || this.#queue.length === 0) return;
    this.#flushing = true;
    // keep only the latest write per book
    const latest = new Map<string, QueuedWrite>();
    for (const w of this.#queue) latest.set(w.bookId, w);
    this.#queue = [];
    try {
      for (const w of latest.values()) {
        try {
          await this.#inner.saveProgress(w.bookId, w.position);
        } catch {
          this.#queue.push(w);
        }
      }
    } finally {
      this.#flushing = false;
    }
  }

  get pendingWrites(): number {
    return this.#queue.length;
  }

  dispose(): void {
    if (typeof removeEventListener === 'function') removeEventListener('online', this.#onOnline);
  }

  #enqueue(w: QueuedWrite): void {
    this.#queue = this.#queue.filter((q) => q.bookId !== w.bookId);
    this.#queue.push(w);
  }

  #key(bookId: string): string {
    return `${this.#ns}:progress:${bookId}`;
  }

  #hlKey(bookId: string): string {
    return `${this.#ns}:highlights:${bookId}`;
  }

  #bmKey(bookId: string): string {
    return `${this.#ns}:bookmarks:${bookId}`;
  }

  #manifestKey(bookId: string): string {
    return `${this.#ns}:manifest:${bookId}`;
  }
}

function sig(signal?: AbortSignal): { signal: AbortSignal } | undefined {
  return signal ? { signal } : undefined;
}
