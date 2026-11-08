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
    expect(engine.getCfi()).toBeDefined();
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

describe('createTextEngine — text-to-speech & security', () => {
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
      tts: { synth: { ...synth, speak: vi.fn() }, createUtterance },
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
    expect(() =>
      engine.ttsSetVoice({ voiceURI: 'v1', name: 'Voice One', lang: 'en-US' }),
    ).not.toThrow();
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
