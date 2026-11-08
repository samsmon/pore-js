import type { SearchRequest, SearchResponse } from './protocol.js';
import {
  buildSearchIndex,
  querySearchIndex,
  type QueryOptions,
  type SearchHit,
  type SearchIndex,
  type SearchSection,
} from './search-index.js';

export interface SearchControllerOptions {
  /**
   * Force worker on/off. Default: use a Worker when the environment has one.
   * A custom factory lets the host wire `new Worker(new URL(...))` itself
   * (bundlers need the literal `new URL` at the call site).
   */
  workerFactory?: (() => Worker) | false;
}

/**
 * Owns a book's search index. Runs queries in a Worker when one is available,
 * otherwise synchronously on the calling thread. Only the most recent query's
 * result resolves; earlier in-flight queries resolve to `[]`.
 */
export class SearchController {
  #worker: Worker | null = null;
  #index: SearchIndex | null = null;
  #ready: Promise<void> | null = null;
  #seq = 0;
  #pending = new Map<number, (hits: SearchHit[]) => void>();

  constructor(opts: SearchControllerOptions = {}) {
    const factory =
      opts.workerFactory === false ? null : (opts.workerFactory ?? defaultWorkerFactory());
    if (factory) {
      try {
        this.#worker = factory();
        this.#worker.addEventListener('message', (ev: MessageEvent<SearchResponse>) => {
          const msg = ev.data;
          if (msg.type === 'result') {
            this.#pending.get(msg.id)?.(msg.hits);
            this.#pending.delete(msg.id);
          }
        });
      } catch {
        this.#worker = null;
      }
    }
  }

  get usingWorker(): boolean {
    return this.#worker !== null;
  }

  build(sections: SearchSection[]): Promise<void> {
    if (this.#worker) {
      const w = this.#worker;
      this.#ready = new Promise<void>((resolve) => {
        const onBuilt = (ev: MessageEvent<SearchResponse>) => {
          if (ev.data.type === 'built') {
            w.removeEventListener('message', onBuilt);
            resolve();
          }
        };
        w.addEventListener('message', onBuilt);
        this.#send({ type: 'build', sections });
      });
    } else {
      this.#index = buildSearchIndex(sections);
      this.#ready = Promise.resolve();
    }
    return this.#ready;
  }

  async query(query: string, opts?: QueryOptions): Promise<SearchHit[]> {
    const id = ++this.#seq;
    await this.#ready;
    if (this.#worker) {
      return new Promise<SearchHit[]>((resolve) => {
        this.#pending.set(id, resolve);
        this.#send({ type: 'query', id, query, ...(opts ? { opts } : {}) });
      }).then((hits) => (id === this.#seq ? hits : []));
    }
    const hits = this.#index ? querySearchIndex(this.#index, query, opts) : [];
    return id === this.#seq ? hits : [];
  }

  destroy(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#index = null;
    this.#pending.clear();
  }

  #send(msg: SearchRequest): void {
    this.#worker?.postMessage(msg);
  }
}

function defaultWorkerFactory(): (() => Worker) | null {
  if (typeof Worker === 'undefined') return null;
  if (typeof import.meta?.url !== 'string') return null;
  return () =>
    // `search-worker` sits next to this module in `dist/search/`; bundlers
    // pick up this `new Worker(new URL(...))` form and emit a worker chunk.
    new Worker(new URL('./search-worker.js', import.meta.url), {
      type: 'module',
      name: 'pore-search',
    });
}
