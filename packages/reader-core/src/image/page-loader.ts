import type { ReaderSource, Variant } from '../source/types.js';
import type { PageLoadState } from './types.js';

export interface PageLoaderOptions {
  source: ReaderSource;
  bookId: string;
  variant?: Variant;
  /** 'native' can use a source-provided URL directly; others go via object URL. */
  loadingMethod: 'native' | 'blob' | 'bitmap';
  /** How many loaded-but-unretained pages to keep before revoking (back-nav LRU). */
  keepExtra?: number;
  onState?: (index: number, state: PageLoadState) => void;
  /** Fired once per page when its bytes are known (object-URL path only). */
  onBytes?: (index: number, bytes: number) => void;
}

interface Entry {
  state: PageLoadState;
  url: string | undefined;
  objectUrl: boolean;
  bytes: number;
  bitmap: ImageBitmap | undefined;
  promise: Promise<string> | undefined;
  controller: AbortController | undefined;
}

/**
 * Loads page images and hands back a URL usable as an `<img>` src.
 * Cache + retain-set eviction (with a small back-nav LRU) + abort.
 * Prefetch policy (ring buffer / whole-chapter) lives in {@link PrefetchScheduler}.
 */
export class PageLoader {
  readonly #opts: PageLoaderOptions;
  readonly #entries = new Map<number, Entry>();
  #retained = new Set<number>();
  /** loaded entries outside the retain set, oldest first */
  #lru: number[] = [];

  constructor(opts: PageLoaderOptions) {
    this.#opts = opts;
  }

  state(index: number): PageLoadState {
    return this.#entries.get(index)?.state ?? 'idle';
  }

  bytesOf(index: number): number {
    return this.#entries.get(index)?.bytes ?? 0;
  }

  isLoaded(index: number): boolean {
    return this.#entries.get(index)?.state === 'loaded';
  }

  /** Synchronously returns the loaded URL for an index if already available. */
  getUrl(index: number): string | undefined {
    return this.#entries.get(index)?.url;
  }

  /** Synchronously returns the loaded bitmap for an index if already available. */
  getBitmapSync(index: number): ImageBitmap | undefined {
    return this.#entries.get(index)?.bitmap;
  }

  /** Decoded bitmap for a page (bitmap loading method only). Triggers a load if needed. */
  async getBitmap(index: number): Promise<ImageBitmap | null> {
    const existing = this.#entries.get(index);
    if (existing?.bitmap) return existing.bitmap;
    await this.get(index).catch(() => undefined);
    return this.#entries.get(index)?.bitmap ?? null;
  }

  get(index: number): Promise<string> {
    const existing = this.#entries.get(index);
    if (existing?.url) return Promise.resolve(existing.url);
    if (existing?.promise) return existing.promise;

    const controller = new AbortController();
    const entry: Entry = {
      state: 'loading',
      url: undefined,
      objectUrl: false,
      bytes: 0,
      bitmap: undefined,
      promise: undefined,
      controller,
    };
    this.#entries.set(index, entry);
    this.#emit(index, 'loading');

    entry.promise = this.#fetch(index, controller.signal)
      .then(({ url, objectUrl, bytes, bitmap }) => {
        entry.url = url;
        entry.objectUrl = objectUrl;
        entry.bytes = bytes;
        entry.bitmap = bitmap;
        entry.state = 'loaded';
        entry.promise = undefined;
        entry.controller = undefined;
        this.#emit(index, 'loaded');
        if (bytes > 0) this.#opts.onBytes?.(index, bytes);
        if (!this.#retained.has(index)) this.#touchLru(index);
        return url;
      })
      .catch((err: unknown) => {
        entry.state = 'error';
        entry.promise = undefined;
        entry.controller = undefined;
        this.#emit(index, 'error');
        throw err;
      });
    return entry.promise;
  }

  /**
   * Declare the pages worth keeping. In-flight loads outside the set are
   * aborted; loaded pages outside the set stay until the LRU overflows.
   */
  retain(indices: Iterable<number>): void {
    this.#retained = new Set(indices);
    this.#lru = this.#lru.filter((i) => !this.#retained.has(i));

    for (const [index, entry] of this.#entries) {
      if (this.#retained.has(index)) continue;
      if (entry.state === 'loading') {
        entry.controller?.abort();
        this.#drop(index);
      } else if (entry.state === 'loaded' && !this.#lru.includes(index)) {
        this.#touchLru(index);
      } else if (entry.state === 'error') {
        this.#drop(index);
      }
    }
    this.#trimLru();
  }

  destroy(): void {
    for (const entry of this.#entries.values()) {
      entry.controller?.abort();
      if (entry.objectUrl && entry.url) URL.revokeObjectURL(entry.url);
      entry.bitmap?.close();
    }
    this.#entries.clear();
    this.#retained.clear();
    this.#lru = [];
  }

  #touchLru(index: number): void {
    this.#lru = this.#lru.filter((i) => i !== index);
    this.#lru.push(index);
    this.#trimLru();
  }

  #trimLru(): void {
    const cap = this.#opts.keepExtra ?? 12;
    while (this.#lru.length > cap) {
      const victim = this.#lru.shift()!;
      this.#drop(victim);
    }
  }

  #drop(index: number): void {
    const entry = this.#entries.get(index);
    if (!entry) return;
    if (entry.objectUrl && entry.url) URL.revokeObjectURL(entry.url);
    entry.bitmap?.close();
    this.#entries.delete(index);
    this.#lru = this.#lru.filter((i) => i !== index);
  }

  /** Discard a page's cache entry (in-flight loads aborted) so the next
   *  `get(index)` re-fetches it — used to retry a page that failed. */
  forget(index: number): void {
    this.#entries.get(index)?.controller?.abort();
    this.#drop(index);
  }

  async #fetch(
    index: number,
    signal: AbortSignal,
  ): Promise<{
    url: string;
    objectUrl: boolean;
    bytes: number;
    bitmap: ImageBitmap | undefined;
  }> {
    const { source, bookId, variant, loadingMethod } = this.#opts;
    const opts = variant ? { variant, signal } : { signal };
    const result = await source.getPage(bookId, index, opts);

    let blob: Blob;
    let url: string;
    let objectUrl: boolean;
    if (typeof result === 'string') {
      if (loadingMethod === 'native') {
        return { url: result, objectUrl: false, bytes: 0, bitmap: undefined };
      }
      const res = await fetch(result, { signal });
      if (!res.ok) throw new Error(`page ${index}: HTTP ${res.status}`);
      blob = await res.blob();
      url = URL.createObjectURL(blob);
      objectUrl = true;
    } else {
      blob = result;
      url = URL.createObjectURL(blob);
      objectUrl = true;
    }

    let bitmap: ImageBitmap | undefined;
    if (loadingMethod === 'bitmap' && typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob).catch(() => undefined);
    }
    return { url, objectUrl, bytes: blob.size, bitmap };
  }

  #emit(index: number, state: PageLoadState): void {
    this.#opts.onState?.(index, state);
  }
}
