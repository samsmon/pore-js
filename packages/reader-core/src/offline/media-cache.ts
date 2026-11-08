import { openKvStore, type KvStore } from './idb.js';

/** Per-book bookkeeping kept alongside the cached blobs. */
export interface BookCacheMeta {
  /** Cached slot ids: page indices as strings, or `"file"`. */
  slots: string[];
  /** Total bytes across this book's cached slots. */
  bytes: number;
  /** `Date.now()` of the last read or write — the LRU key. */
  at: number;
  /** Page count from the manifest, so `downloadState` can say "partial". */
  pageCount?: number;
}

const DEFAULT_BUDGET = 500 * 1024 * 1024; // 500 MB

/**
 * Blob store for downloaded pages / files, with an LRU byte budget. Backed by
 * its own IndexedDB object store so it never collides with progress keys.
 *
 * Keys: `blob:<bookId>:<slot>` for blobs, `meta:<bookId>` for {@link BookCacheMeta}.
 */
export class MediaCache {
  readonly #store: KvStore;
  readonly #budget: number;
  readonly #now: () => number;

  constructor(opts: { store?: KvStore; budgetBytes?: number; now?: () => number } = {}) {
    // Its own database — the default 'pore'/'kv' DB is created at v1 with only
    // the progress store, so a second store name there would never be created.
    this.#store = opts.store ?? openKvStore('pore-media', 'media');
    this.#budget = opts.budgetBytes ?? DEFAULT_BUDGET;
    this.#now = opts.now ?? Date.now;
  }

  async getBlob(bookId: string, slot: string): Promise<Blob | undefined> {
    const blob = await this.#store.get<Blob>(blobKey(bookId, slot));
    if (blob) await this.#touch(bookId);
    return blob;
  }

  async putBlob(bookId: string, slot: string, blob: Blob, pageCount?: number): Promise<void> {
    const meta = (await this.meta(bookId)) ?? { slots: [], bytes: 0, at: this.#now() };
    if (!meta.slots.includes(slot)) {
      meta.slots.push(slot);
      meta.bytes += blob.size;
    }
    meta.at = this.#now();
    if (pageCount !== undefined) meta.pageCount = pageCount;

    await this.#store.set(blobKey(bookId, slot), blob);
    await this.#store.set(metaKey(bookId), meta);
    await this.#evictToFit(bookId);
  }

  meta(bookId: string): Promise<BookCacheMeta | undefined> {
    return this.#store.get<BookCacheMeta>(metaKey(bookId));
  }

  async removeBook(bookId: string): Promise<void> {
    const meta = await this.meta(bookId);
    if (!meta) return;
    for (const slot of meta.slots) await this.#store.delete(blobKey(bookId, slot));
    await this.#store.delete(metaKey(bookId));
  }

  async totalBytes(): Promise<number> {
    let sum = 0;
    for (const b of await this.#books()) sum += b.meta.bytes;
    return sum;
  }

  get budgetBytes(): number {
    return this.#budget;
  }

  // ---- internals ----------------------------------------------------------

  async #touch(bookId: string): Promise<void> {
    const meta = await this.meta(bookId);
    if (meta) {
      meta.at = this.#now();
      await this.#store.set(metaKey(bookId), meta);
    }
  }

  async #books(): Promise<{ bookId: string; meta: BookCacheMeta }[]> {
    const keys = await this.#store.keys();
    const out: { bookId: string; meta: BookCacheMeta }[] = [];
    for (const k of keys) {
      if (!k.startsWith('meta:')) continue;
      const bookId = k.slice('meta:'.length);
      const meta = await this.#store.get<BookCacheMeta>(k);
      if (meta) out.push({ bookId, meta });
    }
    return out;
  }

  /** Drop whole books, least-recently-used first, until under budget. Never the one in use. */
  async #evictToFit(keepBookId: string): Promise<void> {
    let books = await this.#books();
    let total = books.reduce((s, b) => s + b.meta.bytes, 0);
    if (total <= this.#budget) return;

    books = books.filter((b) => b.bookId !== keepBookId).sort((a, b) => a.meta.at - b.meta.at);

    for (const victim of books) {
      if (total <= this.#budget) break;
      await this.removeBook(victim.bookId);
      total -= victim.meta.bytes;
    }
  }
}

const blobKey = (bookId: string, slot: string) => `blob:${bookId}:${slot}`;
const metaKey = (bookId: string) => `meta:${bookId}`;
