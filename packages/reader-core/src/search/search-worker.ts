/// <reference lib="webworker" />
import type { SearchRequest, SearchResponse } from './protocol.js';
import { buildSearchIndex, querySearchIndex, type SearchIndex } from './search-index.js';

let index: SearchIndex | null = null;

const post = (msg: SearchResponse) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

self.addEventListener('message', (ev: MessageEvent<SearchRequest>) => {
  const msg = ev.data;
  if (msg.type === 'build') {
    index = buildSearchIndex(msg.sections);
    post({ type: 'built' });
  } else if (msg.type === 'query') {
    post({
      type: 'result',
      id: msg.id,
      hits: index ? querySearchIndex(index, msg.query, msg.opts) : [],
    });
  }
});
