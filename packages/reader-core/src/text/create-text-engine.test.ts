// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createTextEngine } from './create-text-engine.js';
import type { ReaderSource } from '../source/types.js';

let seq = 0;
beforeEach(() => {
  seq = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:mock/${++seq}`,
    revokeObjectURL: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

const CONTAINER = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title></metadata><manifest><item id="c1" href="ch01.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch02.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
const NAV = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch01.xhtml">Ch 1</a></li><li><a href="ch02.xhtml">Ch 2</a></li></ol></nav></body></html>`;

function epubBlob() {
  return new Blob([
    zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(CONTAINER),
      'OEBPS/content.opf': strToU8(OPF),
      'OEBPS/nav.xhtml': strToU8(NAV),
      'OEBPS/ch01.xhtml': strToU8(
        '<html><body><p>Chapter one text about a peculiar lighthouse.</p></body></html>',
      ),
      'OEBPS/ch02.xhtml': strToU8(
        '<html><body><p>Chapter two returns to the lighthouse once more.</p></body></html>',
      ),
    }),
  ]);
}

function source(): ReaderSource {
  return {
    getManifest: vi.fn(async () => ({ bookId: 'b', type: 'epub' as const, title: 'Fixture' })),
    getPage: vi.fn(),
    getFile: vi.fn(async () => epubBlob()),
    loadProgress: vi.fn(async () => null),
    saveProgress: vi.fn(async () => {}),
  };
}

describe('createTextEngine', () => {
  it('mounts an EPUB, emits ready + toc, renders an iframe', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    const ready: unknown[] = [];
    const toc: unknown[] = [];
    engine.on('reader:ready', (p) => ready.push(p));
    engine.on('reader:toc', (p) => toc.push(p.toc));
    await engine.mount();
    expect(ready).toHaveLength(1);
    expect((toc[0] as { label: string }[]).map((t) => t.label)).toEqual(['Ch 1', 'Ch 2']);
    expect(container.querySelector('iframe.pore-text__frame')).toBeTruthy();
    engine.destroy();
  });

  it('goToHref (public API) navigates using a TOC-style archive-absolute path, not one relative to the current chapter', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    const locs: Array<{ chapter?: string }> = [];
    engine.on('reader:locationchange', (p) => locs.push(p));
    await engine.mount();
    engine.goToHref('OEBPS/ch02.xhtml');
    await new Promise((r) => setTimeout(r, 90));
    expect(locs.at(-1)?.chapter).toBe('c2');
    engine.destroy();
  });

  it('rejects a non-EPUB book', async () => {
    const stub = {
      ...source(),
      getManifest: vi.fn(async () => ({
        bookId: 'b',
        type: 'image' as const,
        title: 't',
        direction: 'ltr' as const,
        pageCount: 0,
        pages: [],
      })),
    };
    const engine = createTextEngine({
      container: document.createElement('div'),
      source: stub,
      bookId: 'b',
    });
    await expect(engine.mount()).rejects.toThrow(/not an EPUB/);
  });

  it('setSettings emits settingschange', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    const seen: Array<{ fontSizePct: number }> = [];
    engine.on('reader:settingschange', (p) => seen.push(p.settings));
    await engine.mount();
    engine.setSettings({ fontSizePct: 130 });
    expect(seen.at(-1)?.fontSizePct).toBe(130);
    engine.destroy();
  });

  it('shows a "The End" card at the end of the book and reports 100%', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    const ends: Array<{ visible: boolean; kind: string }> = [];
    let lastPct = 0;
    engine.on('reader:endpage', (p) => ends.push(p));
    engine.on('reader:locationchange', (p) => (lastPct = p.percent));
    await engine.mount();
    engine.turn('forward'); // ch1 -> ch2 (continuous)
    engine.turn('forward'); // ch2 last page -> end slot
    expect(ends.at(-1)).toMatchObject({ visible: true, kind: 'book' });
    expect(container.querySelector('.pore-text__end')?.textContent).toContain('The End');
    expect(lastPct).toBe(1);
    engine.destroy();
  });

  it('swipe turns the page (LTR: left = forward), and renders a chrome handle', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    const locs: number[] = [];
    engine.on('reader:locationchange', (p) => locs.push(p.page));
    await engine.mount();
    const el = container.querySelector('.pore-text')!;
    const swipe = (fromX: number, toX: number, id: number) => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: fromX,
          clientY: 200,
          pointerId: id,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: (fromX + toX) / 2,
          clientY: 202,
          pointerId: id,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', { clientX: toX, clientY: 202, pointerId: id, bubbles: true }),
      );
    };
    const spineBefore = locs.length;
    swipe(300, 40, 1);
    await new Promise((r) => setTimeout(r, 120));
    expect(locs.length).toBeGreaterThan(spineBefore);

    expect(container.querySelector('[data-pore-chrome-handle]')).toBeTruthy();
    engine.destroy();
  });

  it('auto-enables vertical writing mode for a Japanese rtl EPUB', async () => {
    const jpOpf = OPF.replace(
      '<dc:title>Fixture</dc:title>',
      '<dc:title>縦</dc:title><dc:language>ja</dc:language>',
    ).replace('<spine>', '<spine page-progression-direction="rtl">');
    const src: ReaderSource = {
      getManifest: vi.fn(async () => ({ bookId: 'b', type: 'epub' as const, title: '縦' })),
      getPage: vi.fn(),
      getFile: vi.fn(
        async () =>
          new Blob([
            zipSync({
              mimetype: strToU8('application/epub+zip'),
              'META-INF/container.xml': strToU8(CONTAINER),
              'OEBPS/content.opf': strToU8(jpOpf),
              'OEBPS/nav.xhtml': strToU8(NAV),
              'OEBPS/ch01.xhtml': strToU8(
                '<html lang="ja"><body><p>あいうえお、かきくけこ。</p></body></html>',
              ),
              'OEBPS/ch02.xhtml': strToU8(
                '<html lang="ja"><body><p>さしすせそ。</p></body></html>',
              ),
            }),
          ]),
      ),
      loadProgress: vi.fn(async () => null),
      saveProgress: vi.fn(async () => {}),
    };
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: src, bookId: 'b' });
    let ready: { vertical: boolean } | null = null;
    engine.on('reader:ready', (p) => (ready = p));
    await engine.mount();
    expect(ready).toMatchObject({ vertical: true });

    let started = false;
    engine.on('reader:start', () => (started = true));
    container
      .querySelector('.pore-text')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(started).toBe(true);
    engine.destroy();
  });

  it('searches the whole book and emits reader:searchresults', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      searchWorkerFactory: false,
    });
    const events: Array<{ query: string; hits: unknown[] }> = [];
    engine.on('reader:searchresults', (p) => events.push(p));
    await engine.mount();

    const hits = await engine.search('lighthouse');
    expect(hits.map((h) => h.sectionId)).toEqual(['c1', 'c2']);
    expect(hits[0]!.snippet.toLowerCase()).toContain('lighthouse');
    expect(events.at(-1)).toMatchObject({ query: 'lighthouse' });

    const locs: Array<{ chapter?: string }> = [];
    engine.on('reader:locationchange', (p) => locs.push(p));
    engine.gotoHit(hits[1]!);
    await new Promise((r) => setTimeout(r, 90));
    expect(locs.at(-1)?.chapter).toBe('c2');
    engine.destroy();
  });

  it('getCfi returns null before mount and never throws once mounted', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    expect(engine.getCfi()).toBeNull();
    await engine.mount();
    expect(() => engine.getCfi()).not.toThrow();
    engine.destroy();
  });

  it('goToCfi is a safe no-op for a bad string and never throws for a shaped one', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    expect(() => engine.goToCfi('not a cfi')).not.toThrow();
    await engine.mount();
    expect(() => engine.goToCfi('not a cfi')).not.toThrow();
    expect(() => engine.goToCfi('epubcfi(/6/2[ch01]!/4/2:0)')).not.toThrow();
    engine.destroy();
  });

  it('addHighlight returns null with no live selection; listHighlights/removeHighlight never throw', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    expect(engine.addHighlight()).toBeNull();
    await engine.mount();
    expect(engine.addHighlight()).toBeNull();
    expect(engine.listHighlights()).toEqual([]);
    expect(() => engine.removeHighlight('nope')).not.toThrow();
    expect(engine.updateHighlight('nope', { note: 'x' })).toBeNull();
    engine.destroy();
  });

  it('highlights persist through the source (loadHighlights/saveHighlights)', async () => {
    const stored: Array<{ id: string }> = [];
    const src: ReaderSource = {
      ...source(),
      loadHighlights: vi.fn(async () => []),
      saveHighlights: vi.fn(async (_bookId, hs) => {
        stored.length = 0;
        stored.push(...hs);
      }),
    };
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: src, bookId: 'b' });
    const changes: Array<{ highlights: unknown[] }> = [];
    engine.on('reader:highlightschange', (p) => changes.push(p));
    await engine.mount();
    expect(src.loadHighlights).toHaveBeenCalledWith('b');
    expect(changes.at(-1)?.highlights).toEqual([]);

    const cdoc = container.querySelector('iframe')?.contentDocument;
    const p = cdoc?.querySelector('p');
    if (cdoc && p) {
      const range = cdoc.createRange();
      range.selectNodeContents(p);
      const sel = cdoc.getSelection?.();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    const hl = engine.addHighlight({ color: 'lime', note: 'nice line' });
    if (hl) {
      expect(hl.kind).toBe('text');
      expect(engine.listHighlights()).toEqual([hl]);
      expect(changes.at(-1)?.highlights).toEqual([hl]);
      await new Promise((r) => setTimeout(r, 900));
      expect(src.saveHighlights).toHaveBeenCalled();
      expect(stored).toEqual([hl]);

      const edited = engine.updateHighlight(hl.id, { note: 'edited', color: 'cyan' });
      expect(edited).toMatchObject({ id: hl.id, note: 'edited', color: 'cyan' });
      expect(changes.at(-1)?.highlights).toEqual([edited]);
      await new Promise((r) => setTimeout(r, 900));
      expect(stored).toEqual([edited]);
      const cleared = engine.updateHighlight(hl.id, { note: '' });
      expect(cleared && 'note' in cleared).toBe(false);

      engine.removeHighlight(hl.id);
      expect(engine.listHighlights()).toEqual([]);
      await new Promise((r) => setTimeout(r, 900));
      expect(stored).toEqual([]);
    }
    engine.destroy();
  });

  it('accepts a custom transitions adapter and cancels it on destroy', async () => {
    const calls: string[] = [];
    const spy = {
      page: () => calls.push('page'),
      zoom: () => calls.push('zoom'),
      scrollTo: () => calls.push('scrollTo'),
      cancel: () => calls.push('cancel'),
    };
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      transitions: spy as never,
    });
    await engine.mount();
    engine.turn('forward');
    await new Promise((r) => setTimeout(r, 90));
    engine.destroy();
    expect(calls).toContain('cancel');
  });

  it('flow mode reports itself and still navigates', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      settings: { flowMode: 'flow' },
    });
    let ready: { flow: boolean; vertical: boolean } | null = null;
    engine.on('reader:ready', (p) => (ready = p));
    const locs: Array<{ chapter?: string }> = [];
    engine.on('reader:locationchange', (p) => locs.push(p));
    await engine.mount();
    expect(ready).toMatchObject({ flow: true, vertical: false });

    engine.turn('forward');
    await new Promise((r) => setTimeout(r, 90));
    expect(locs.at(-1)?.chapter).toBe('c2');

    engine.setSettings({ flowMode: 'paged' });
    expect(locs.length).toBeGreaterThan(0);
    engine.destroy();
  });

  it('endpage mode pauses between chapters', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      settings: { endBehavior: 'endpage' },
    });
    const ends: Array<{ visible: boolean; kind: string }> = [];
    engine.on('reader:endpage', (p) => ends.push(p));
    await engine.mount();
    engine.turn('forward');
    expect(ends.at(-1)).toMatchObject({ visible: true, kind: 'chapter' });
    engine.turn('forward');
    await new Promise((r) => setTimeout(r, 90));
    expect(ends.at(-1)?.visible).toBe(false);
    engine.destroy();
  });
});
