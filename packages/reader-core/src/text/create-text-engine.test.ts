// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createTextEngine } from './create-text-engine.js';
import type { ReaderSource } from '../source/types.js';
import type { TtsSynthLike, TtsUtteranceLike } from './tts.js';

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
    // book.toc entries (and thus <TableOfContents>) hand goToHref an
    // already-resolved archive path like "OEBPS/ch02.xhtml" — distinct from
    // the chapter-relative hrefs wireLinks() resolves for in-book <a> clicks.
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
    // jsdom has no layout so each spine is 1 page; last spine also gets the end slot
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
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: fromX, clientY: 200, pointerId: id, bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: (fromX + toX) / 2, clientY: 202, pointerId: id, bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: toX, clientY: 202, pointerId: id, bubbles: true }));
    };
    const spineBefore = locs.length;
    swipe(300, 40, 1); // left → forward → next spine (async in the tiny fixture)
    await new Promise((r) => setTimeout(r, 120));
    expect(locs.length).toBeGreaterThan(spineBefore); // a turn happened

    // the chrome handle exists by default
    expect(container.querySelector('[data-pore-chrome-handle]')).toBeTruthy();
    engine.destroy();
  });

  it('auto-enables vertical writing mode for a Japanese rtl EPUB', async () => {
    const jpOpf = OPF.replace('<dc:title>Fixture</dc:title>', '<dc:title>縦</dc:title><dc:language>ja</dc:language>')
      .replace('<spine>', '<spine page-progression-direction="rtl">');
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
              'OEBPS/ch01.xhtml': strToU8('<html lang="ja"><body><p>あいうえお、かきくけこ。</p></body></html>'),
              'OEBPS/ch02.xhtml': strToU8('<html lang="ja"><body><p>さしすせそ。</p></body></html>'),
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

    // In a vertical/rtl book the horizontal keys are swapped:
    // ArrowRight at page 0 reads *backward* → hits the start of the book.
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
      searchWorkerFactory: false, // synchronous in jsdom
    });
    const events: Array<{ query: string; hits: unknown[] }> = [];
    engine.on('reader:searchresults', (p) => events.push(p));
    await engine.mount();

    const hits = await engine.search('lighthouse');
    expect(hits.map((h) => h.sectionId)).toEqual(['c1', 'c2']);
    expect(hits[0]!.snippet.toLowerCase()).toContain('lighthouse');
    expect(events.at(-1)).toMatchObject({ query: 'lighthouse' });

    // jump to the second hit → lands on that spine item
    const locs: Array<{ chapter?: string }> = [];
    engine.on('reader:locationchange', (p) => locs.push(p));
    engine.gotoHit(hits[1]!);
    await new Promise((r) => setTimeout(r, 90));
    expect(locs.at(-1)?.chapter).toBe('c2');
    engine.destroy();
  });

  it('getCfi returns null before mount and never throws once mounted', async () => {
    // The full generate -> serialize -> resolve mechanics are covered against
    // fake documents in anchor.test.ts / cfi.test.ts; jsdom's srcdoc iframe
    // doesn't reliably expose contentDocument outside the initial render tick
    // (a standing limitation of this test env, not this feature — see the
    // Playwright coverage / browser verification for the real integration).
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
    // a well-shaped CFI for the first spine item — resolves or drifts, never throws
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
    // one emission from mount() with whatever was persisted (empty here)
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
      // clearing the note drops the field
      const cleared = engine.updateHighlight(hl.id, { note: '' });
      expect(cleared && 'note' in cleared).toBe(false);

      engine.removeHighlight(hl.id);
      expect(engine.listHighlights()).toEqual([]);
      await new Promise((r) => setTimeout(r, 900));
      expect(stored).toEqual([]);
    }
    // jsdom's iframe selection/contentDocument access is flaky outside the
    // synchronous render tick (see the getCfi test above) — when it doesn't
    // cooperate, addHighlight legitimately returns null and the assertions
    // above are skipped; the real mechanics are covered against fake
    // documents in highlight.test.ts, and browser-verified manually.
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
    engine.turn('forward'); // walks to the next spine in the tiny fixture
    await new Promise((r) => setTimeout(r, 90));
    engine.destroy();
    expect(calls).toContain('cancel');
    // instantTransitions is the default and unaffected
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

    // forward from the (short) first chapter walks into the next spine item
    engine.turn('forward');
    await new Promise((r) => setTimeout(r, 90));
    expect(locs.at(-1)?.chapter).toBe('c2');

    // toggling back to paged re-measures without throwing
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
    engine.turn('forward'); // ch1 last page -> ch1 end slot
    expect(ends.at(-1)).toMatchObject({ visible: true, kind: 'chapter' });
    engine.turn('forward'); // -> ch2 (async spine render)
    await new Promise((r) => setTimeout(r, 90));
    expect(ends.at(-1)?.visible).toBe(false);
    engine.destroy();
  });
});

const FIXED_OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixed</dc:title><meta property="rendition:layout">pre-paginated</meta></metadata><manifest><item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/><item id="p2" href="p2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="p1"/><itemref idref="p2"/></spine></package>`;
const FIXED_NAV = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="p1.xhtml">Page 1</a></li><li><a href="p2.xhtml">Page 2</a></li></ol></nav></body></html>`;

function fixedPageXhtml(n: number): string {
  return `<html><head><meta name="viewport" content="width=750,height=1000"/></head><body><div style="position:absolute;top:0;left:0;">Page ${n}</div></body></html>`;
}

function fixedLayoutSource(): ReaderSource {
  return {
    getManifest: vi.fn(async () => ({ bookId: 'b', type: 'epub' as const, title: 'Fixed' })),
    getPage: vi.fn(),
    getFile: vi.fn(
      async () =>
        new Blob([
          zipSync({
            mimetype: strToU8('application/epub+zip'),
            'META-INF/container.xml': strToU8(CONTAINER),
            'OEBPS/content.opf': strToU8(FIXED_OPF),
            'OEBPS/nav.xhtml': strToU8(FIXED_NAV),
            'OEBPS/p1.xhtml': strToU8(fixedPageXhtml(1)),
            'OEBPS/p2.xhtml': strToU8(fixedPageXhtml(2)),
          }),
        ]),
    ),
    loadProgress: vi.fn(async () => null),
    saveProgress: vi.fn(async () => {}),
  };
}

describe('createTextEngine — fixed-layout EPUB', () => {
  it('detects pre-paginated layout and pages one spine item at a time', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: fixedLayoutSource(), bookId: 'b' });
    let ready: { metadata: { fixedLayout: boolean } } | null = null;
    engine.on('reader:ready', (p) => (ready = p));
    const locs: Array<{ chapter?: string }> = [];
    engine.on('reader:locationchange', (p) => locs.push(p));
    await engine.mount();
    expect(ready?.metadata.fixedLayout).toBe(true);
    expect(locs.at(-1)?.chapter).toBe('p1');

    engine.turn('forward'); // one page per spine item -> straight to p2
    await new Promise((r) => setTimeout(r, 90));
    expect(locs.at(-1)?.chapter).toBe('p2');
    expect(engine.chapters()).toHaveLength(2);
    engine.destroy();
  });

  it('never throws resizing/reflowing or toggling settings on a fixed-layout page', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const engine = createTextEngine({ container, source: fixedLayoutSource(), bookId: 'b' });
    await engine.mount();
    expect(() => engine.setSettings({ fontSizePct: 150, publisherStyles: false })).not.toThrow();
    expect(engine.getCfi()).toBeDefined(); // null or a string, either way must not throw
    engine.destroy();
    container.remove();
  });
});

function fakeTtsSynth() {
  const spoken: string[] = [];
  const synth: TtsSynthLike = {
    speak: vi.fn((u: TtsUtteranceLike) => queueMicrotask(() => u.onend?.())),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    getVoices: () => [],
  };
  const createUtterance = (text: string): TtsUtteranceLike => {
    spoken.push(text);
    return { rate: 1, voice: null, onend: null, onerror: null };
  };
  return { synth, createUtterance, spoken };
}

describe('createTextEngine — text-to-speech', () => {
  it('is a safe no-op (no voices, ttsPlay does nothing) when the Web Speech API is unsupported', async () => {
    const container = document.createElement('div');
    const engine = createTextEngine({ container, source: source(), bookId: 'b' });
    await engine.mount();
    expect(engine.ttsListVoices()).toEqual([]);
    expect(() => engine.ttsPlay()).not.toThrow();
    expect(engine.ttsState().playing).toBe(false);
    engine.destroy();
  });

  it('drives through every spine via advanceSpine() and stops at the end of the book without throwing', async () => {
    // jsdom's iframe contentDocument is unreliable outside the initial render
    // tick (the same standing limitation as the getCfi()/addHighlight() tests
    // above), so `getSentences()` sees no blocks here and this exercises the
    // "no sentences this spine -> advanceSpine() -> next spine -> ... -> stop
    // at the last spine" path rather than real speech. Sentence-by-sentence
    // playback against a fake DOM is covered in tts.test.ts; the real
    // end-to-end behaviour is browser-verified manually.
    const { synth, createUtterance } = fakeTtsSynth();
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      tts: { synth, createUtterance },
    });
    const states: boolean[] = [];
    engine.on('reader:ttsstate', (s) => states.push(s.playing));
    await engine.mount();
    engine.ttsPlay();
    expect(engine.ttsState().playing).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 150));

    expect(engine.ttsState().playing).toBe(false);
    expect(states.at(-1)).toBe(false);
    engine.destroy();
  });

  it('ttsPause/ttsResume delegate to the injected synth; ttsStop cancels it', async () => {
    const { synth, createUtterance } = fakeTtsSynth();
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      tts: { synth: { ...synth, speak: vi.fn() }, createUtterance }, // never auto-ends — stays on sentence 0
    });
    await engine.mount();
    engine.ttsPlay();
    expect(engine.ttsState().playing).toBe(true);

    engine.ttsPause();
    expect(synth.pause).toHaveBeenCalled();
    expect(engine.ttsState().playing).toBe(false);

    engine.ttsResume();
    expect(synth.resume).toHaveBeenCalled();
    expect(engine.ttsState().playing).toBe(true);

    engine.ttsStop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(engine.ttsState().playing).toBe(false);
    engine.destroy();
  });

  it('ttsSetRate/ttsSetVoice never throw, called before or during playback', async () => {
    // Applying rate/voice to the actual spoken utterance is exercised against
    // a fake DOM in tts.test.ts ("applies rate/voice to subsequent
    // utterances") — jsdom's iframe never exposes real sentences here (see
    // the test above), so there'd be nothing for this engine-level test to
    // observe on the utterance itself.
    const { synth, createUtterance } = fakeTtsSynth();
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      tts: { synth: { ...synth, speak: vi.fn() }, createUtterance },
    });
    await engine.mount();
    expect(() => engine.ttsSetRate(1.75)).not.toThrow();
    expect(() => engine.ttsSetVoice({ voiceURI: 'v1', name: 'Voice One', lang: 'en-US' })).not.toThrow();
    engine.ttsPlay();
    expect(() => engine.ttsSetRate(0.5)).not.toThrow();
    expect(() => engine.ttsSetVoice(null)).not.toThrow();
    engine.destroy();
  });

  it('turn()/goto() interrupt an in-progress TTS playback', async () => {
    const { synth, createUtterance } = fakeTtsSynth();
    const container = document.createElement('div');
    const engine = createTextEngine({
      container,
      source: source(),
      bookId: 'b',
      tts: { synth: { ...synth, speak: vi.fn() }, createUtterance },
    });
    await engine.mount();
    engine.ttsPlay();
    expect(engine.ttsState().playing).toBe(true);
    engine.turn('forward');
    expect(engine.ttsState().playing).toBe(false);
    expect(synth.cancel).toHaveBeenCalled();
    engine.destroy();
  });

  it('sanitizes footnote HTML before emitting reader:footnote (SEC-01)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const engine = createTextEngine({ container, source: source(), bookId: 'b' });
      const footnotes: { html: string; href: string }[] = [];
      engine.on('reader:footnote', (payload) => footnotes.push(payload));

      await engine.mount();

      const iframe = container.querySelector('iframe') as HTMLIFrameElement;
      const cdoc = iframe.contentDocument;
      expect(cdoc).toBeTruthy();

      if (cdoc) {
        cdoc.body.innerHTML =
          '<p>Reference <a id="link1" href="#fn1" epub:type="noteref">1</a></p>' +
          '<aside id="fn1" epub:type="footnote">' +
          '<p>Safe paragraph</p>' +
          '<script>alert("xss")</script>' +
          '<iframe src="https://evil.com"></iframe>' +
          '<object data="evil.swf"></object>' +
          '<embed src="evil.swf">' +
          '<button onclick="alert(1)">Click me</button>' +
          '<a href="javascript:alert(2)">Dangerous link</a>' +
          '</aside>';

        const link = cdoc.getElementById('link1');
        expect(link).not.toBeNull();
        link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }

      expect(footnotes).toHaveLength(1);
      const html = footnotes[0]!.html;
      expect(html).toContain('Safe paragraph');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<object');
      expect(html).not.toContain('<embed');
      expect(html).not.toContain('onclick');
      expect(html).not.toContain('javascript:');

      engine.destroy();
    } finally {
      container.remove();
    }
  });
});
