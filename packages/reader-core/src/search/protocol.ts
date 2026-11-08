import type { QueryOptions, SearchHit, SearchSection } from './search-index.js';

/** Host → worker. */
export type SearchRequest =
  | { type: 'build'; sections: SearchSection[] }
  | { type: 'query'; id: number; query: string; opts?: QueryOptions };

/** Worker → host. */
export type SearchResponse = { type: 'built' } | { type: 'result'; id: number; hits: SearchHit[] };
