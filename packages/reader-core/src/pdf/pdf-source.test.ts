// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderSource } from '../source/types.js';
import type { PdfDoc } from './parse.js';

const fakeDoc = (over: Partial<PdfDoc> = {}): PdfDoc => ({
  pageCount: 3,
  outline: [
    { label: 'Intro', href: '#page=1', children: [] },
    {
      label: 'Body',
      href: '#page=2',
      children: [{ label: 'Body.a', href: '#page=3', children: [] }],
    },
  ],
  pageSize: async () => ({ width: 612, height: 792 }),
  renderToBlob: async () => new Blob([new Uint8Array([1, 2])], { type: 'image/webp' }),
  textContent: async (n: number) =>
    n === 2 ? 'the falcon flies over the harbour at dawn' : `page ${n} filler text`,
  textRects: async (n: number) =>
    n === 2
      ? [
          { str: 'the falcon', x: 0.1, y: 0.1, w: 0.3, h: 0.02 },
          { str: 'flies over', x: 0.1, y: 0.14, w: 0.3, h: 0.02 },
        ]
      : [],
  destroy: async () => {},
  ...over,
});

const loadPdf = vi.fn(async () => fakeDoc());
vi.mock('./parse.js', () => ({ loadPdf: (...a: unknown[]) => loadPdf(...(a as [])) }));

beforeEach(() => {
  loadPdf.mockClear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

function inner(): ReaderSource {
  return {
    getManifest: vi.fn(),
    getPage: vi.fn(),
    getFile: vi.fn(async () => new Blob([new Uint8Array([37, 80, 68, 70])])), // "%PDF"
    loadProgress: vi.fn(async () => null),
    saveProgress: vi.fn(async () => {}),
  };
}

describe('PdfImageSource', () => {
  it('adapts a PDF to an ImageManifest with chapters from the outline', async () => {
    const { PdfImageSource } = await import('./pdf-source.js');
    const src = new PdfImageSource(inner());
    const m = await src.getManifest('doc');
    expect(m.type).toBe('image');
    if (m.type === 'image') {
      expect(m.pageCount).toBe(3);
      expect(m.pages).toHaveLength(3);
      expect(m.chapters).toEqual([
        { id: '#page=1', label: 'Intro', startIndex: 0 },
        { id: '#page=2', label: 'Body', startIndex: 1 },
        { id: '#page=3', label: 'Body.a', startIndex: 2 },
      ]);
    }
    expect(loadPdf).toHaveBeenCalledTimes(1); // cached
    await src.getManifest('doc');
    expect(loadPdf).toHaveBeenCalledTimes(1);
  });

  it('getPage renders a blob', async () => {
    const { PdfImageSource } = await import('./pdf-source.js');
    const src = new PdfImageSource(inner());
    const blob = await src.getPage('doc', 0);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('proxies progress to the inner source', async () => {
    const { PdfImageSource } = await import('./pdf-source.js');
    const i = inner();
    const src = new PdfImageSource(i);
    await src.saveProgress('doc', { type: 'page', value: 2, total: 3 });
    expect(i.saveProgress).toHaveBeenCalledWith('doc', { type: 'page', value: 2, total: 3 });
  });

  it('exposes pageCount and per-page textContent for search', async () => {
    const { PdfImageSource } = await import('./pdf-source.js');
    const src = new PdfImageSource(inner());
    expect(await src.pageCount()).toBe(3);
    expect(await src.textContent(2)).toContain('falcon');
  });
});

describe('createPdfEngine', () => {
  it('mounts the image engine over the PDF and emits reader:toc', async () => {
    const { createPdfEngine } = await import('./create-pdf-engine.js');
    const container = document.createElement('div');
    const engine = createPdfEngine({ container, source: inner(), bookId: 'doc' });
    const tocs: unknown[] = [];
    const ready: unknown[] = [];
    engine.on('reader:toc', (p) => tocs.push(p.toc));
    engine.on('reader:ready', (p) => ready.push(p));
    await engine.mount();
    await new Promise((r) => setTimeout(r, 10));
    expect(ready).toHaveLength(1);
    expect((tocs[0] as { label: string }[]).map((t) => t.label)).toEqual(['Intro', 'Body']);

    const locs: Array<{ page: number }> = [];
    engine.on('reader:locationchange', (p) => locs.push(p));
    engine.goToHref('#page=2');
    expect(locs.at(-1)?.page).toBe(1);
    engine.destroy();
  });

  it('searches the PDF text layer and jumps to the hit page', async () => {
    const { createPdfEngine } = await import('./create-pdf-engine.js');
    const container = document.createElement('div');
    const engine = createPdfEngine({
      container,
      source: inner(),
      bookId: 'doc',
      searchWorkerFactory: false,
    });
    const results: unknown[] = [];
    engine.on('reader:searchresults', (p) => results.push(p));
    await engine.mount();

    const hits = await engine.search('falcon');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sectionId).toBe('page:2');
    expect(hits[0]!.sectionIndex).toBe(1);
    expect(results).toHaveLength(1);

    const locs: Array<{ page: number }> = [];
    engine.on('reader:locationchange', (p) => locs.push(p));
    engine.gotoHit(hits[0]!);
    expect(locs.at(-1)?.page).toBe(1);
    engine.destroy();
  });

  it('rect highlights: update/remove are safe with no pending marquee, load filters to kind:rect', async () => {
    const { createPdfEngine } = await import('./create-pdf-engine.js');
    const stored: unknown[] = [];
    const src: ReaderSource = {
      ...inner(),
      loadHighlights: vi.fn(async () => [
        {
          kind: 'rect' as const,
          id: 'r1',
          page: 1,
          rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }],
          color: 'yellow',
          text: 'the falcon',
          createdAt: 1,
        },
        // a text highlight from an EPUB session on the same store — must be ignored
        {
          kind: 'text' as const,
          id: 't1',
          range: { spine: 0, startBlock: 0, startOffset: 0, endBlock: 0, endOffset: 1 },
          cfi: { start: '', end: '' },
          color: 'lime',
          text: 'x',
          createdAt: 1,
        },
      ]),
      saveHighlights: vi.fn(async (_id, hs) => {
        stored.length = 0;
        stored.push(...hs);
      }),
    };
    const container = document.createElement('div');
    const engine = createPdfEngine({ container, source: src, bookId: 'doc' });
    const changes: Array<{ highlights: unknown[] }> = [];
    engine.on('reader:highlightschange', (p) => changes.push(p));
    await engine.mount();
    await new Promise((r) => setTimeout(r, 10));

    expect(engine.listHighlights().map((h) => h.id)).toEqual(['r1']);
    expect(engine.addHighlight()).toBeNull(); // no Shift+drag pending
    expect(engine.updateHighlight('nope', { color: 'red' })).toBeNull();

    const edited = engine.updateHighlight('r1', { note: 'a bird', color: 'cyan' });
    expect(edited).toMatchObject({ id: 'r1', kind: 'rect', note: 'a bird', color: 'cyan' });
    await new Promise((r) => setTimeout(r, 500));
    expect((stored[0] as { note: string }).note).toBe('a bird');

    engine.removeHighlight('r1');
    expect(engine.listHighlights()).toEqual([]);
    engine.destroy();
  });
});
