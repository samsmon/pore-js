// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { OpdsSource } from './opds-source.js';
import { LocalFileSource } from './local-file-source.js';

const BASE = 'https://opds.example.org/catalog';

const FEED_PAGE_1 = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Catalog</title>
  <link rel="next" href="/catalog?page=2"/>
  <entry>
    <id>urn:book:1</id>
    <title>Pride and Prejudice</title>
    <link rel="http://opds-spec.org/acquisition/open-access"
          href="/download/1.epub" type="application/epub+zip"/>
  </entry>
</feed>`;

const FEED_PAGE_2 = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Catalog</title>
  <entry><id>urn:book:2</id><title>Second Book</title></entry>
</feed>`;

function fakeOpds(opts: { epubBytes?: Uint8Array } = {}) {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    seen.push({ url, headers });
    if (url === BASE) {
      return new Response(FEED_PAGE_1, { status: 200 });
    }
    if (url === 'https://opds.example.org/catalog?page=2') {
      return new Response(FEED_PAGE_2, { status: 200 });
    }
    if (url === 'https://opds.example.org/download/1.epub') {
      return new Response(new Blob([opts.epubBytes ?? new Uint8Array([1, 2, 3])]), {
        status: 200,
      });
    }
    return new Response('not found', { status: 404 });
  });
  return { fetch, seen };
}

describe('OpdsSource', () => {
  it('lists the root catalog and follows a next link', async () => {
    const { fetch } = fakeOpds();
    const src = new OpdsSource(BASE, { fetch });
    const page1 = await src.listCatalog();
    expect(page1.entries.map((e) => e.title)).toEqual(['Pride and Prejudice']);
    expect(page1.next).toBe('https://opds.example.org/catalog?page=2');

    const page2 = await src.listCatalog(page1.next);
    expect(page2.entries.map((e) => e.title)).toEqual(['Second Book']);
  });

  it('acquires an entry into a working LocalFileSource', async () => {
    const { fetch } = fakeOpds();
    const src = new OpdsSource(BASE, { fetch });
    const feed = await src.listCatalog();
    const acquired = await src.acquire(feed.entries[0]!);
    expect(acquired).toBeInstanceOf(LocalFileSource);
    const manifest = await acquired.getManifest('Pride and Prejudice.epub');
    expect(manifest).toMatchObject({ type: 'epub', title: 'Pride and Prejudice' });
  });

  it('throws when an entry has no acquisition link', async () => {
    const { fetch } = fakeOpds();
    const src = new OpdsSource(BASE, { fetch });
    await expect(src.acquire({ id: '1', title: 'No Link', links: [] })).rejects.toThrow(
      /no acquisition link/,
    );
  });

  it('throws with the HTTP status on a failed catalog fetch', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const src = new OpdsSource(BASE, { fetch });
    await expect(src.listCatalog()).rejects.toThrow(/500/);
  });

  it('sends HTTP Basic auth when configured', async () => {
    const { fetch, seen } = fakeOpds();
    const src = new OpdsSource(BASE, {
      fetch,
      auth: { type: 'basic', username: 'alice', password: 'secret' },
    });
    await src.listCatalog();
    expect(seen[0]!.headers['authorization']).toBe(`Basic ${btoa('alice:secret')}`);
  });

  it('sends a bearer token when configured', async () => {
    const { fetch, seen } = fakeOpds();
    const src = new OpdsSource(BASE, { fetch, auth: { type: 'bearer', token: 'tok123' } });
    await src.listCatalog();
    expect(seen[0]!.headers['authorization']).toBe('Bearer tok123');
  });
});
