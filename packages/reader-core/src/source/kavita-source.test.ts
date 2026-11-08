import { describe, expect, it, vi } from 'vitest';
import { KavitaAuthError, KavitaDownloadForbiddenError, KavitaSource } from './kavita-source.js';

const BASE = 'https://kavita.home.lan';

interface FakeOpts {
  format?: number;
  pages?: number;
  /** Fail the first N authed calls with 401 (exercises the refresh path). */
  unauthorizedFirst?: number;
  /** 403 the download endpoint. */
  forbidDownload?: boolean;
  /** Reject the plugin authenticate call. */
  badKey?: boolean;
}

function fakeKavita(opts: FakeOpts = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let authCount = 0;
  let unauthLeft = opts.unauthorizedFirst ?? 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, ...(init ? { init } : {}) });
    const path = url.slice(BASE.length);

    if (path.startsWith('/api/Plugin/authenticate')) {
      if (opts.badKey) return new Response('nope', { status: 401 });
      authCount++;
      return json({ token: `jwt-${authCount}`, apiKey: 'k' });
    }

    // every other endpoint is bearer-authed
    if (unauthLeft > 0) {
      unauthLeft--;
      return new Response('', { status: 401 });
    }

    if (path.startsWith('/api/Reader/chapter-info')) {
      return json({
        pages: opts.pages ?? 20,
        seriesId: 7,
        volumeId: 3,
        libraryId: 1,
        seriesFormat: opts.format ?? 1,
        title: 'Test Book',
        fileName: 'test.cbz',
      });
    }
    if (path.startsWith('/api/Reader/image')) {
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
    }
    if (path.startsWith('/api/Download/chapter')) {
      if (opts.forbidDownload) return new Response('forbidden', { status: 403 });
      return new Response(new Blob([new Uint8Array([9])], { type: 'application/epub+zip' }));
    }
    if (path.startsWith('/api/Reader/progress')) {
      if (init?.method === 'POST') return new Response('', { status: 200 });
      return json({ pageNum: 5, seriesId: 7, volumeId: 3, chapterId: 42, libraryId: 1 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  return {
    src: new KavitaSource(BASE, { apiKey: 'secret', fetch }),
    calls,
    authCount: () => authCount,
  };
}

describe('KavitaSource', () => {
  it('adapts an archive chapter to an image manifest', async () => {
    const { src } = fakeKavita({ format: 1, pages: 18 });
    const m = await src.getManifest('42');
    expect(m).toMatchObject({ bookId: '42', type: 'image', pageCount: 18, title: 'Test Book' });
    expect(m.type === 'image' && m.pages).toHaveLength(18);
  });

  it('adapts an epub chapter to a text manifest', async () => {
    const { src } = fakeKavita({ format: 3 });
    expect(await src.getManifest('42')).toMatchObject({ type: 'epub', title: 'Test Book' });
  });

  it('adapts a pdf chapter', async () => {
    const { src } = fakeKavita({ format: 4 });
    expect(await src.getManifest('42')).toMatchObject({ type: 'pdf' });
  });

  it('fetches a page image with bearer token without leaking apiKey in URL', async () => {
    const { src, calls } = fakeKavita();
    const blob = await src.getPage('42', 4);
    expect(blob.type).toBe('image/webp');
    const img = calls.find((c) => c.url.includes('/api/Reader/image'))!;
    expect(img.url).toContain('chapterId=42');
    expect(img.url).toContain('page=4');
    expect(img.url).not.toContain('apiKey=');
    expect((img.init?.headers as Record<string, string>).authorization).toMatch(/^Bearer jwt-/);
  });

  it('round-trips progress: page position in, kavita POST body out', async () => {
    const { src, calls } = fakeKavita({ pages: 20 });
    const pos = await src.loadProgress('42');
    expect(pos).toEqual({ type: 'page', value: 5, total: 20 });

    await src.saveProgress('42', { type: 'page', value: 11, total: 20 });
    const post = calls.find(
      (c) => c.url.endsWith('/api/Reader/progress') && c.init?.method === 'POST',
    )!;
    expect(JSON.parse(post.init!.body as string)).toEqual({
      pageNum: 11,
      chapterId: 42,
      seriesId: 7,
      volumeId: 3,
      libraryId: 1,
    });
  });

  it('derives a page number from a scroll position', async () => {
    const { src, calls } = fakeKavita({ pages: 100 });
    await src.saveProgress('42', { type: 'scroll', value: 0.5, total: 100, page: 40 });
    const post = calls.find(
      (c) => c.url.endsWith('/api/Reader/progress') && c.init?.method === 'POST',
    )!;
    expect(JSON.parse(post.init!.body as string).pageNum).toBe(40);
  });

  it('re-authenticates once on a 401 and retries', async () => {
    const { src, authCount } = fakeKavita({ unauthorizedFirst: 1 });
    const m = await src.getManifest('42');
    expect(m.type).toBe('image');
    expect(authCount()).toBe(2); // initial + one refresh
  });

  it('surfaces a missing Download permission', async () => {
    const { src } = fakeKavita({ format: 3, forbidDownload: true });
    await expect(src.getFile('42')).rejects.toBeInstanceOf(KavitaDownloadForbiddenError);
  });

  it('throws KavitaAuthError when the api key is rejected', async () => {
    const { src } = fakeKavita({ badKey: true });
    await expect(src.getManifest('42')).rejects.toBeInstanceOf(KavitaAuthError);
  });
});
