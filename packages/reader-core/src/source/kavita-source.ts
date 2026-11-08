import type { Position } from '../position/types.js';
import type { GetFileOpts, GetPageOpts, ImageManifest, Manifest, ReaderSource } from './types.js';

/**
 * Kavita's `MangaFormat` enum (server-side numeric values).
 * @see https://github.com/Kareadita/Kavita
 */
const KavitaFormat = {
  Image: 0,
  Archive: 1,
  Unknown: 2,
  Epub: 3,
  Pdf: 4,
} as const;
type KavitaFormat = (typeof KavitaFormat)[keyof typeof KavitaFormat];

/** Subset of `GET /api/Reader/chapter-info` we rely on. */
interface KavitaChapterInfo {
  pages: number;
  seriesId: number;
  volumeId: number;
  libraryId: number;
  seriesFormat: KavitaFormat;
  chapterTitle?: string;
  title?: string;
  subtitle?: string;
  fileName?: string;
}

/** `GET /api/Reader/progress` / body of the matching POST. */
interface KavitaProgress {
  pageNum: number;
  seriesId: number;
  volumeId: number;
  chapterId: number;
  libraryId: number;
}

export interface KavitaSourceOptions {
  /** The account API key (Kavita → User settings → API Key). */
  apiKey: string;
  /** Plugin name Kavita records against the session. Default `pore-js`. */
  pluginName?: string;
  /** Injectable fetch, for tests. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

/** Thrown when the API key is rejected and a refresh doesn't help. */
export class KavitaAuthError extends Error {
  constructor(message = 'Kavita rejected the API key') {
    super(message);
    this.name = 'KavitaAuthError';
  }
}

/** Thrown when the account lacks the Download role for `getFile`. */
export class KavitaDownloadForbiddenError extends Error {
  constructor() {
    super('Kavita account lacks the Download permission (needed for EPUB/PDF)');
    this.name = 'KavitaDownloadForbiddenError';
  }
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

/**
 * Reads from a running [Kavita](https://www.kavitareader.com/) server.
 *
 * `bookId` is a Kavita **chapterId** — the unit Kavita's own reader addresses,
 * whether that's a book (EPUB/PDF) or a manga chapter. Auth is the plugin flow:
 * the API key is exchanged for a short-lived JWT, refreshed transparently on a
 * 401. Progress is last-writer-wins; wrap in {@link CachedSource} for a local
 * checkpoint + offline queue.
 */
export class KavitaSource implements ReaderSource {
  readonly #base: string;
  readonly #apiKey: string;
  readonly #pluginName: string;
  readonly #fetch: typeof fetch;
  #token: string | null = null;
  #authPromise: Promise<string> | null = null;
  readonly #info = new Map<string, Promise<KavitaChapterInfo>>();

  constructor(baseUrl: string, opts: KavitaSourceOptions) {
    if (!opts?.apiKey) throw new Error('KavitaSource: opts.apiKey is required');
    this.#base = baseUrl.replace(/\/+$/, '');
    this.#apiKey = opts.apiKey;
    this.#pluginName = opts.pluginName ?? 'pore-js';
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== 'function')
      throw new Error('KavitaSource: no fetch available; pass opts.fetch');
    this.#fetch = f.bind(globalThis);
  }

  async getManifest(bookId: string): Promise<Manifest> {
    const info = await this.#chapterInfo(bookId);
    const title = info.title || info.chapterTitle || info.fileName || `Chapter ${bookId}`;

    switch (info.seriesFormat) {
      case KavitaFormat.Epub:
        return { bookId, type: 'epub', title };
      case KavitaFormat.Pdf:
        return { bookId, type: 'pdf', title };
      case KavitaFormat.Image:
      case KavitaFormat.Archive: {
        const manifest: ImageManifest = {
          bookId,
          type: 'image',
          title,
          direction: 'ltr',
          pageCount: info.pages,
          pages: Array.from({ length: info.pages }, (_, index) => ({ index })),
        };
        return manifest;
      }
      default:
        throw new Error(`KavitaSource: unsupported format for chapter ${bookId}`);
    }
  }

  async getPage(bookId: string, index: number, opts?: GetPageOpts): Promise<Blob> {
    const url = `${this.#base}/api/Reader/image?chapterId=${encodeURIComponent(
      bookId,
    )}&page=${index}`;
    const res = await this.#authed(url, opts?.signal ? { signal: opts.signal } : {});
    if (!res.ok) throw new Error(`KavitaSource: page ${index} of ${bookId} → HTTP ${res.status}`);
    return res.blob();
  }

  async getFile(bookId: string, opts?: GetFileOpts): Promise<Blob> {
    const url = `${this.#base}/api/Download/chapter?chapterId=${encodeURIComponent(bookId)}`;
    const res = await this.#authed(url, opts?.signal ? { signal: opts.signal } : {});
    if (res.status === 403) throw new KavitaDownloadForbiddenError();
    if (!res.ok) throw new Error(`KavitaSource: file for ${bookId} → HTTP ${res.status}`);
    return res.blob();
  }

  async loadProgress(bookId: string): Promise<Position | null> {
    const info = await this.#chapterInfo(bookId);
    const res = await this.#authed(
      `${this.#base}/api/Reader/progress?chapterId=${encodeURIComponent(bookId)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<KavitaProgress> | null;
    const pageNum = body?.pageNum ?? 0;
    if (!pageNum) return null;
    return { type: 'page', value: pageNum, total: info.pages };
  }

  async saveProgress(bookId: string, p: Position): Promise<void> {
    const info = await this.#chapterInfo(bookId);
    const pageNum = pageNumFor(p, info.pages);
    const body: KavitaProgress = {
      pageNum,
      chapterId: Number(bookId),
      seriesId: info.seriesId,
      volumeId: info.volumeId,
      libraryId: info.libraryId,
    };
    const res = await this.#authed(`${this.#base}/api/Reader/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`KavitaSource: save progress for ${bookId} → HTTP ${res.status}`);
  }

  // ---- internals ----------------------------------------------------------

  #chapterInfo(bookId: string): Promise<KavitaChapterInfo> {
    let hit = this.#info.get(bookId);
    if (!hit) {
      hit = (async () => {
        const res = await this.#authed(
          `${this.#base}/api/Reader/chapter-info?chapterId=${encodeURIComponent(bookId)}`,
        );
        if (!res.ok) {
          this.#info.delete(bookId);
          throw new Error(`KavitaSource: chapter-info ${bookId} → HTTP ${res.status}`);
        }
        return (await res.json()) as KavitaChapterInfo;
      })().catch((err: unknown) => {
        this.#info.delete(bookId);
        throw err;
      });
      this.#info.set(bookId, hit);
    }
    return hit;
  }

  async #authenticate(): Promise<string> {
    this.#authPromise ??= (async () => {
      const url = `${this.#base}/api/Plugin/authenticate?apiKey=${encodeURIComponent(
        this.#apiKey,
      )}&pluginName=${encodeURIComponent(this.#pluginName)}`;
      const res = await this.#fetch(url, { method: 'POST' });
      if (!res.ok) throw new KavitaAuthError(`authenticate → HTTP ${res.status}`);
      const body = (await res.json()) as { token?: string };
      if (!body.token) throw new KavitaAuthError('authenticate response had no token');
      this.#token = body.token;
      return body.token;
    })();
    try {
      return await this.#authPromise;
    } finally {
      this.#authPromise = null;
    }
  }

  /** Fetch with the bearer token, one transparent re-auth on 401, backoff on 5xx/429. */
  async #authed(url: string, init: RequestInit = {}): Promise<Response> {
    let token = this.#token ?? (await this.#authenticate());
    for (let attempt = 0; ; attempt++) {
      const res = await this.#fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && attempt === 0) {
        this.#token = null;
        token = await this.#authenticate();
        continue;
      }
      if (res.status === 401) throw new KavitaAuthError();
      if (RETRY_STATUS.has(res.status) && attempt < MAX_RETRIES) {
        await delay(2 ** attempt * 250);
        continue;
      }
      return res;
    }
  }
}

function pageNumFor(p: Position, total: number): number {
  if (p.type === 'page') return clampPage(p.value, total);
  if (p.type === 'scroll') {
    return clampPage(p.page ?? Math.round(p.value * Math.max(0, total - 1)), total);
  }
  return clampPage(Math.round(p.percent * Math.max(0, total - 1)), total);
}

function clampPage(n: number, total: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), Math.max(0, total - 1));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
