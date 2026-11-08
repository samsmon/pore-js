import { LocalFileSource } from './local-file-source.js';
import {
  acquisitionLink,
  guessFilename,
  parseOpdsFeed,
  type OpdsEntry,
  type OpdsFeed,
} from './opds-parse.js';

export type OpdsAuth =
  { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string };

export interface OpdsSourceOptions {
  auth?: OpdsAuth;
  /** Injectable fetch, for tests. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to the global `DOMParser`. */
  domParser?: DOMParser;
}

/**
 * A read-only OPDS 1.2 (Atom) catalog client — a **library** surface, distinct
 * from {@link ReaderSource} (which is per-book). Browse with
 * {@link listCatalog}, then {@link acquire} an entry to get a `ReaderSource`
 * for it: the acquisition link's bytes are handed to a fresh
 * {@link LocalFileSource}, which already sniffs EPUB/PDF/CBZ/images by
 * extension — no separate parsing path needed here.
 *
 * OPDS 2.0 (JSON) and non-Basic/Bearer auth flows are out of scope for this
 * pass — see docs/m4-plan.md F4.
 */
export class OpdsSource {
  readonly #baseUrl: string;
  readonly #auth: OpdsAuth | undefined;
  readonly #fetch: typeof fetch;
  readonly #domParser: DOMParser | undefined;

  constructor(baseUrl: string, opts: OpdsSourceOptions = {}) {
    this.#baseUrl = baseUrl;
    this.#auth = opts.auth;
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      throw new Error('OpdsSource: no fetch available; pass opts.fetch');
    }
    this.#fetch = f.bind(globalThis);
    this.#domParser = opts.domParser;
  }

  /** Fetch and parse a catalog feed — the root catalog by default, or a `next`/navigation link's URL. */
  async listCatalog(url: string = this.#baseUrl): Promise<OpdsFeed> {
    const res = await this.#fetch(
      url,
      this.#requestInit({ Accept: 'application/atom+xml,application/xml,text/xml' }),
    );
    if (!res.ok) throw new Error(`OpdsSource: catalog fetch "${url}" → HTTP ${res.status}`);
    const text = await res.text();
    return parseOpdsFeed(text, url, this.#domParser);
  }

  /** Download an entry's acquisition link and wrap it as a `LocalFileSource` (exposes `.bookId`/`.fixedLayout`). */
  async acquire(entry: OpdsEntry): Promise<LocalFileSource> {
    const link = acquisitionLink(entry);
    if (!link) throw new Error(`OpdsSource: "${entry.title}" has no acquisition link`);
    const res = await this.#fetch(link.href, this.#requestInit());
    if (!res.ok) throw new Error(`OpdsSource: acquiring "${entry.title}" → HTTP ${res.status}`);
    const blob = await res.blob();
    const filename = guessFilename(entry, link);
    const file = new File([blob], filename, link.type ? { type: link.type } : undefined);
    return new LocalFileSource([file], { title: entry.title });
  }

  #requestInit(extraHeaders: Record<string, string> = {}): RequestInit {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.#auth?.type === 'basic') {
      headers['Authorization'] = `Basic ${btoa(`${this.#auth.username}:${this.#auth.password}`)}`;
    } else if (this.#auth?.type === 'bearer') {
      headers['Authorization'] = `Bearer ${this.#auth.token}`;
    }
    return { headers };
  }
}
