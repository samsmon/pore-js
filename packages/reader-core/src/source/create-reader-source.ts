import type { Position } from '../position/types.js';
import type { Direction } from '../types.js';
import { LocalFileSource } from './local-file-source.js';
import type { GetPageOpts, ImageManifest, Manifest, ReaderSource } from './types.js';

/** Bibliographic metadata for the one-call reader source. All optional. */
export interface ReaderMeta {
  title?: string;
  /** A line under the title — a series name, an edition. `author` folds in here if you don't set it. */
  subtitle?: string;
  author?: string;
  /** `2`, `"Vol. II"` — shown as `Vol 2` in the document title. */
  volume?: string | number;
  /** `1074`, `"Extra 3"` — informational; the reader's own chapter list still comes from the file. */
  chapter?: string | number;
  /** `'rtl'` for manga, `'vertical'` for tategaki. Defaults to `'ltr'`. */
  direction?: Direction;
  /** A hint for a loading skeleton; the real count comes from the file. */
  totalPages?: number;
}

export interface CreateReaderSourceInput {
  /** A URL to a `.cbz` / `.zip` / `.epub` / `.pdf`. */
  src?: string;
  /** A list of image URLs — one chapter of a manga, comics pages, a scanned doc. */
  pages?: string[];
  /** A `File` / `Blob` you already have (a drop, an upload). */
  file?: File | Blob;
  /** Filename for `file`/`src` type detection when the URL/blob has no usable name. */
  name?: string;
  meta?: ReaderMeta;
  /** Swap the fetcher — e.g. to add `Referer` / auth headers for a CDN. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Seed the reading position (a value you got from `onProgress`). */
  initialProgress?: Position | null;
  /** Called whenever the reader saves a new position — persist it yourself. */
  onProgress?: (position: Position) => void;
}

const EXT_RE = /\.(cbz|zip|epub|pdf|png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#].*)?$/i;

function nameFromUrl(url: string, fallback: string): string {
  try {
    const p = new URL(url, 'http://x').pathname;
    const base = p.slice(p.lastIndexOf('/') + 1);
    return EXT_RE.test(base) ? base.replace(/[?#].*$/, '') : fallback;
  } catch {
    return fallback;
  }
}

/** A read-only image source over a plain list of URLs. */
class PagesSource implements ReaderSource {
  #progress: Position | null;
  constructor(
    readonly bookId: string,
    private readonly urls: string[],
    private readonly meta: ReaderMeta,
    private readonly fetcher: CreateReaderSourceInput['fetch'],
    initialProgress: Position | null,
    private readonly onProgress?: (p: Position) => void,
  ) {
    this.#progress = initialProgress;
  }

  getManifest(): Promise<Manifest> {
    const m: ImageManifest = {
      bookId: this.bookId,
      type: 'image',
      title: this.meta.title ?? this.bookId,
      ...(this.meta.subtitle !== undefined ? { subtitle: this.meta.subtitle } : {}),
      ...(this.meta.volume !== undefined ? { volume: this.meta.volume } : {}),
      direction: this.meta.direction ?? 'ltr',
      pageCount: this.urls.length,
      pages: this.urls.map((_, index) => ({ index })),
    };
    return Promise.resolve(m);
  }

  async getPage(_bookId: string, index: number, opts?: GetPageOpts): Promise<Blob | string> {
    const url = this.urls[index];
    if (!url) throw new RangeError(`page ${index} out of range (${this.urls.length})`);
    // no custom fetcher → hand the URL straight to the <img> (lets the browser
    // stream + cache it). With a fetcher (auth headers) we must fetch → Blob.
    if (!this.fetcher) return url;
    const res = await this.fetcher(url, opts?.signal ? { signal: opts.signal } : undefined);
    if (!res.ok) throw new Error(`page ${index}: ${res.status} ${res.statusText}`);
    return res.blob();
  }

  getFile(): Promise<Blob> {
    return Promise.reject(new Error('PagesSource: image pages only, no archive'));
  }

  loadProgress(): Promise<Position | null> {
    return Promise.resolve(this.#progress);
  }

  saveProgress(_bookId: string, p: Position): Promise<void> {
    this.#progress = p;
    this.onProgress?.(p);
    return Promise.resolve();
  }
}

/** Wrap any source so `initialProgress` seeds it and `onProgress` sees every save. */
function withProgress(
  inner: ReaderSource,
  initial: Position | null,
  onChange?: (p: Position) => void,
): ReaderSource {
  let current = initial;
  return {
    ...inner,
    getManifest: (id) => inner.getManifest(id),
    getPage: (id, i, o) => inner.getPage(id, i, o),
    getFile: (id, o) => inner.getFile(id, o),
    loadProgress: async (id) => current ?? (await inner.loadProgress(id)),
    saveProgress: async (id, p) => {
      current = p;
      onChange?.(p);
      await inner.saveProgress(id, p);
    },
  };
}

/**
 * The one-call source: point it at a file URL, a list of image URLs, or a
 * `File`/`Blob`, add metadata if you have it, and you get a `ReaderSource` for
 * `<ReaderProvider>` — or just use `<Book src=… />` which calls this for you.
 *
 * ```ts
 * const source = createReaderSource({
 *   src: 'https://cdn/one-piece/ch-1074.cbz',
 *   meta: { title: 'One Piece', volume: 108, chapter: 1074, direction: 'rtl' },
 *   onProgress: (pos) => saveToDb(pos),
 * });
 * ```
 */
export function createReaderSource(input: CreateReaderSourceInput): ReaderSource {
  if (!input.src && !input.pages && !input.file) {
    throw new Error('createReaderSource: pass one of `src`, `pages`, or `file`');
  }
  const sub = input.meta?.subtitle ?? input.meta?.author;
  const meta: ReaderMeta = {
    ...input.meta,
    ...(sub !== undefined ? { subtitle: sub } : {}),
  };
  const initial = input.initialProgress ?? null;

  if (input.pages) {
    if (input.pages.length === 0) throw new Error('createReaderSource: `pages` is empty');
    const id = input.name ?? nameFromUrl(input.pages[0]!, 'pages') + `+${input.pages.length}`;
    return new PagesSource(id, input.pages, meta, input.fetch, initial, input.onProgress);
  }

  const toLocal = async (): Promise<ReaderSource> => {
    let blob: Blob;
    let fname: string;
    if (input.file) {
      blob = input.file;
      fname = input.name ?? (input.file instanceof File ? input.file.name : 'book');
    } else if (input.src) {
      const f = input.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
      const res = await f(input.src);
      if (!res.ok) throw new Error(`createReaderSource: ${res.status} fetching ${input.src}`);
      blob = await res.blob();
      fname = input.name ?? nameFromUrl(input.src, 'book');
    } else {
      throw new Error('createReaderSource: pass one of `src`, `pages`, or `file`');
    }
    if (!EXT_RE.test(fname)) fname += guessExt(blob.type);
    const file = new File([blob], fname, { type: blob.type });
    return new LocalFileSource([file], {
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.subtitle !== undefined ? { subtitle: meta.subtitle } : {}),
      ...(meta.volume !== undefined ? { volume: meta.volume } : {}),
      ...(meta.direction !== undefined ? { direction: meta.direction } : {}),
    });
  };

  // LocalFileSource is sync-constructed elsewhere; here it's behind a fetch, so
  // expose a source whose methods await the real one.
  const localP = toLocal();
  const proxy: ReaderSource = {
    getManifest: async (id) => (await localP).getManifest(id),
    getPage: async (id, i, o) => (await localP).getPage(id, i, o),
    getFile: async (id, o) => (await localP).getFile(id, o),
    loadProgress: async (id) => (await localP).loadProgress(id),
    saveProgress: async (id, p) => (await localP).saveProgress(id, p),
  };
  return withProgress(proxy, initial, input.onProgress);
}

/**
 * A stable id for `<Reader bookId>` derived from the input — so the reader
 * re-mounts when you point it at a different book. `<Book>` uses this.
 */
export function readerSourceKey(input: CreateReaderSourceInput): string {
  if (input.name) return input.name;
  if (input.src) return input.src;
  if (input.pages?.length) return `pages:${input.pages.length}:${input.pages[0]}`;
  if (input.file instanceof File && input.file.name)
    return `file:${input.file.name}:${input.file.size}`;
  if (input.file) return `blob:${input.file.size}:${input.file.type}`;
  return 'book';
}

function guessExt(mime: string): string {
  if (mime === 'application/epub+zip') return '.epub';
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'application/zip' || mime === 'application/x-cbz') return '.cbz';
  if (mime.startsWith('image/')) return '.' + (mime.split('/')[1] ?? 'jpg');
  return '';
}
