import type { ReaderSource } from '../source/types.js';
import type { Position } from '../position/types.js';
import { createEmitter } from '../internal/emitter.js';
import type { Chapter } from '../reader-engine.js';
import { PaceEstimator, chapterProgress } from '../progress.js';
import { parseEpub } from './epub/parse.js';
import type { EpubBook, TocEntry } from './epub/types.js';
import { dirOf, resolveHref, stripHash } from './epub/path.js';
import { rewriteResources } from './rewrite.js';
import {
  blockElements,
  generateAnchor,
  pageForElement,
  resolveAnchor,
  type Rect,
  type RectOf,
  type RangeRectOf,
} from './anchor.js';
import { parseCfi, resolveCfiElement, serializeCfi, type ParsedCfi } from './cfi.js';
import { highlightRangeFromSelection, rangeForHighlight } from './highlight.js';
import { sanitizeFootnoteHtml } from './sanitize.js';
import type { HighlightRange, HighlightRecord } from '../source/types.js';
import {
  createTtsController,
  segmentSentences,
  type TtsSentence,
  type TtsState,
  type TtsSynthLike,
  type TtsUtteranceLike,
  type TtsVoiceLike,
} from './tts.js';
import { SearchController } from '../search/search-controller.js';
import type { SearchHit, SearchSection } from '../search/search-index.js';
import { instantTransitions, type ReaderTransitions } from '../transitions.js';
import { createChromeHandle } from '../chrome-handle.js';
import {
  buildBaseStylesheet,
  buildFixedLayoutStylesheet,
  computeTextLayout,
  fixedLayoutScale,
  FLOW_ID,
  offsetForPage,
  pageCountFor,
  parseFixedViewportMeta,
  VIEWPORT_ID,
  type FixedPageSize,
  type TextLayout,
} from './paginate.js';
import {
  DEFAULT_TEXT_SETTINGS,
  type TextEngine,
  type TextEngineEvents,
  type TextEngineSettings,
} from './types.js';

const THEME_COLORS: Record<
  TextEngineSettings['theme'],
  { color: string; background: string; dark: boolean }
> = {
  // warm, editorial — mirrors the demo shell palette (docs/design-language.md)
  light: { color: '#23201a', background: '#faf7f1', dark: false },
  sepia: { color: '#4a3f30', background: '#f2e7d3', dark: false },
  dark: { color: '#d8d1c4', background: '#17150f', dark: true },
  oled: { color: '#cfc8bb', background: '#000000', dark: true },
};

const SAVE_DEBOUNCE_MS = 800;

export interface CreateTextEngineOptions {
  container: HTMLElement;
  source: ReaderSource;
  bookId: string;
  settings?: Partial<TextEngineSettings>;
  domParser?: DOMParser;
  /**
   * `@font-face` CSS injected into the sandboxed reading iframe, so the `serif`
   * / `sans` typography options can resolve to bundled webfonts the host app
   * ships (the font files must be same-origin). Falls back to the system stack
   * when omitted.
   */
  fontFaceCss?: string;
  /** Passed to the in-book `SearchController`. `false` forces synchronous search. */
  searchWorkerFactory?: (() => Worker) | false;
  /** Animation seam — defaults to synchronous {@link instantTransitions}. */
  transitions?: ReaderTransitions;
  /** Injectable for tests, and for environments without the Web Speech API. Defaults to `speechSynthesis`/`SpeechSynthesisUtterance` when available. */
  tts?: {
    synth?: TtsSynthLike;
    createUtterance?: (text: string) => TtsUtteranceLike;
  };
}

export function createTextEngine(options: CreateTextEngineOptions): TextEngine {
  const emitter = createEmitter<TextEngineEvents>();
  const { container, source, bookId } = options;
  const doc = container.ownerDocument;
  const parser = options.domParser ?? new DOMParser();

  let settings: TextEngineSettings = { ...DEFAULT_TEXT_SETTINGS, ...options.settings };
  const transitions = options.transitions ?? instantTransitions;
  let book: EpubBook | null = null;
  const pace = new PaceEstimator(30);
  let spineIndex = 0;
  let page = 0; // page within the current spine
  let pageOffset = 0; // last translate applied by `applyPage` (paged / vertical)
  let spinePageCount = 1;
  /** page count per spine item, undefined until measured */
  let spinePages: (number | undefined)[] = [];
  let destroyed = false;
  let pendingAnchor: Extract<Position, { type: 'anchor' }> | null = null;
  let pendingCfi: ParsedCfi | null = null;
  let objectUrls: string[] = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let highlights: HighlightRecord[] = [];
  let pendingSelectionRange: Range | null = null;
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let saveHlTimer: ReturnType<typeof setTimeout> | null = null;

  const root = doc.createElement('div');
  root.className = 'pore-text';
  root.tabIndex = 0;
  root.style.cssText =
    'position:relative;width:100%;height:100%;outline:none;overflow:hidden;touch-action:manipulation;';
  const frame = doc.createElement('iframe');
  frame.className = 'pore-text__frame';
  // `allow-scripts` is here only so WebKit/Safari delivers pointer & selection
  // events to the engine's listeners on the frame document — WebKit dispatches
  // *nothing* to a sandboxed frame without it. Scripts still can't run: the
  // frame carries a `script-src 'none'` CSP (see rewrite.ts) and `rewrite.ts`
  // strips <script>, on* handlers and javascript: URLs. No `allow-top-navigation`,
  // `allow-forms`, `allow-popups`, `allow-modals`, `allow-downloads`.
  frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent;';
  root.appendChild(frame);
  const endEl = doc.createElement('div');
  endEl.className = 'pore-text__end';
  endEl.style.cssText =
    'position:absolute;inset:0;display:none;flex-direction:column;gap:1rem;align-items:center;justify-content:center;text-align:center;padding:2rem;z-index:2;';
  root.appendChild(endEl);

  // ---- helpers -------------------------------------------------------------

  /** A fixed-layout book renders one scaled page per spine item — no reflow, no columns, no vertical writing mode. */
  const fixedLayoutActive = (): boolean => book?.metadata.fixedLayout === true;

  /** Resolve the `verticalText` setting against the book's metadata. */
  const verticalActive = (): boolean => {
    if (fixedLayoutActive() || flowActive()) return false; // flow mode is always horizontal-tb scroll
    if (settings.verticalText === 'on') return true;
    if (settings.verticalText === 'off') return false;
    return book?.metadata.direction === 'rtl' && /^ja/i.test(book?.metadata.language ?? '');
  };

  const mql = (q: string): boolean =>
    typeof matchMedia === 'function' ? matchMedia(q).matches : false;

  const reduced = (): boolean => mql('(prefers-reduced-motion: reduce)');

  /** Single scrolling column (screen-reader friendly). */
  const flowActive = (): boolean => {
    if (fixedLayoutActive()) return false;
    if (settings.flowMode === 'flow') return true;
    if (settings.flowMode === 'paged') return false;
    return mql('(forced-colors: active)');
  };

  const layout = (): TextLayout =>
    computeTextLayout({
      viewportWidth: root.clientWidth || 800,
      viewportHeight: root.clientHeight || 1000,
      columns: flowActive() ? 1 : settings.columns,
      columnGap: settings.columnGap,
      marginPct: settings.marginPct,
      fontSizePct: settings.fontSizePct,
      vertical: verticalActive(),
    });

  const lastSpine = () => (book ? book.spine.length - 1 : 0);
  const contentPages = (i: number): number => spinePages[i] ?? estimateSpinePages(i);
  /** The last chapter always ends on a "The End" card; others only in `endpage` mode. */
  const hasEndSlot = (i: number): boolean =>
    settings.endBehavior === 'endpage' || i === lastSpine();
  const effectivePages = (i: number): number => contentPages(i) + (hasEndSlot(i) ? 1 : 0);
  /** Highest valid `page` for the current spine (the end-slot index, if any). */
  const maxPage = (): number => spinePageCount - 1 + (hasEndSlot(spineIndex) ? 1 : 0);
  const onEndSlot = (): boolean => hasEndSlot(spineIndex) && page >= spinePageCount;

  const totalPages = (): number => {
    let sum = 0;
    for (let i = 0; i <= lastSpine(); i++) sum += effectivePages(i);
    return sum;
  };

  const bookPageBefore = (idx: number): number => {
    let sum = 0;
    for (let i = 0; i < idx; i++) sum += effectivePages(i);
    return sum;
  };

  const estimateSpinePages = (i: number): number => {
    if (fixedLayoutActive()) return 1; // one page per spine item, always
    const href = book?.spine[i]?.href;
    const res = href ? book?.resource(href) : null;
    if (!res) return 1;
    // ~1800 rendered chars per page is a rough prose average
    return Math.max(1, Math.round(res.bytes.length / 1800));
  };

  const anchorFor = (): Position => {
    const total = totalPages();
    const bookPercent = total > 0 ? (bookPageBefore(spineIndex) + page) / total : 0;
    const cdoc = frame.contentDocument;
    // one page per spine item — no block/offset to resolve within it.
    if (!cdoc || fixedLayoutActive()) {
      return { type: 'anchor', spine: spineIndex, block: 0, offset: 0, percent: bookPercent };
    }
    return generateAnchor(
      cdoc,
      {
        spine: spineIndex,
        page,
        spinePages: spinePageCount,
        bookPercent,
        pageWidth: layout().measure,
      },
      relRectOf,
      relRangeRectOf,
    );
  };

  /** Portable `epubcfi(...)` for the current position, or `null` before the spine has rendered. */
  const getCfi = (): string | null => {
    const cdoc = frame.contentDocument;
    if (!cdoc || !book) return null;
    const anchor = anchorFor();
    if (anchor.type !== 'anchor') return null;
    const el = blockElements(cdoc)[anchor.block];
    if (!el) return null;
    const idref = book.spine[spineIndex]?.idref ?? String(spineIndex);
    return serializeCfi(cdoc, spineIndex, idref, el, anchor.offset);
  };

  const emitLocation = () => {
    if (!book) return;
    const total = totalPages();
    const bookPage = bookPageBefore(spineIndex) + page;
    const atBookEnd = onEndSlot() && spineIndex === lastSpine();
    const percent = atBookEnd ? 1 : total > 0 ? bookPage / total : 0;
    const ch = chapterLabel(spineIndex);
    const loc = {
      position: anchorFor(),
      page: bookPage,
      total,
      percent,
      label: `${ch} · ${Math.round(percent * 100)}%`,
      chapter: book.spine[spineIndex]?.idref ?? String(spineIndex),
    };
    emitter.emit('reader:locationchange', loc);
    pace.mark();
    const chs = engineChapters();
    const cp = chapterProgress(chs, bookPage, total);
    emitter.emit('reader:progress', {
      locator: loc,
      percent,
      chapterLabel: cp.label || ch,
      chapterIndex: cp.index,
      chapterCount: chs.length,
      pagesLeftInChapter: cp.pagesLeftInChapter,
      minutesLeft: pace.minutesLeft(Math.max(0, total - 1 - bookPage)),
      page: loc.page,
      pageCount: total,
    });
    scheduleSave();
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };
  const flushSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!book || destroyed) return;
    void source.saveProgress(bookId, anchorFor()).catch(() => {});
  };

  const scheduleSaveHighlights = () => {
    if (saveHlTimer) clearTimeout(saveHlTimer);
    saveHlTimer = setTimeout(flushSaveHighlights, SAVE_DEBOUNCE_MS);
  };
  const flushSaveHighlights = () => {
    if (saveHlTimer) clearTimeout(saveHlTimer);
    saveHlTimer = null;
    if (destroyed) return;
    void source.saveHighlights?.(bookId, highlights).catch(() => {});
  };

  // ---- highlights -----------------------------------------------------------

  const highlightName = (color: string): string => `pore-hl-${color.replace(/[^a-z0-9]/gi, '')}`;

  /** Inject `::highlight(...)` rules for the CSS Custom Highlight API path. */
  const ensureHighlightStyle = (cdoc: Document, colors: string[]) => {
    let el = cdoc.getElementById('pore-highlight-style') as HTMLStyleElement | null;
    if (!el) {
      el = cdoc.createElement('style');
      el.id = 'pore-highlight-style';
      cdoc.head?.appendChild(el);
    }
    el.textContent = colors
      .map((c) => `::highlight(${highlightName(c)}){background-color:${c};color:inherit;}`)
      .join('\n');
  };

  const clearMarkFallback = (cdoc: Document) => {
    cdoc.querySelectorAll('mark.pore-highlight').forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });
  };

  interface HighlightWindow {
    CSS?: { highlights?: Map<string, unknown> };
    Highlight?: new (...ranges: Range[]) => unknown;
  }

  /** Re-paint highlights for the currently rendered spine — CSS Custom Highlight API, `<mark>` fallback otherwise. */
  const applyHighlights = () => {
    const cdoc = frame.contentDocument;
    if (!cdoc) return;
    const blocks = blockElements(cdoc);
    const visible = highlights.filter(
      (h): h is Extract<HighlightRecord, { kind: 'text' }> =>
        h.kind === 'text' && h.range.spine === spineIndex,
    );
    const win = cdoc.defaultView as unknown as HighlightWindow | null;
    if (win?.CSS?.highlights && win.Highlight) {
      win.CSS.highlights.clear();
      const byColor = new Map<string, Range[]>();
      for (const h of visible) {
        const r = rangeForHighlight(cdoc, blocks, h.range);
        if (!r) continue;
        const list = byColor.get(h.color);
        if (list) list.push(r);
        else byColor.set(h.color, [r]);
      }
      ensureHighlightStyle(cdoc, [...byColor.keys()]);
      for (const [color, ranges] of byColor) {
        win.CSS.highlights.set(highlightName(color), new win.Highlight(...ranges));
      }
      return;
    }
    clearMarkFallback(cdoc);
    for (const h of visible) {
      const r = rangeForHighlight(cdoc, blocks, h.range);
      if (!r) continue;
      try {
        const mark = cdoc.createElement('mark');
        mark.className = 'pore-highlight';
        mark.dataset['highlightId'] = h.id;
        mark.style.backgroundColor = h.color;
        r.surroundContents(mark);
      } catch {
        // a range spanning more than one element can't be wrapped in a single
        // <mark> — the highlight stays persisted, just unpainted in this path.
      }
    }
  };

  const onSelectionChange = () => {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const cdoc = frame.contentDocument;
      const sel = cdoc?.getSelection?.();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        pendingSelectionRange = null;
        emitter.emit('reader:selection', null);
        return;
      }
      const range = sel.getRangeAt(0);
      pendingSelectionRange = range.cloneRange();
      let rect: Rect;
      try {
        rect = range.getBoundingClientRect();
      } catch {
        rect = { left: 0, right: 0, top: 0, bottom: 0 };
      }
      emitter.emit('reader:selection', { rect, text: sel.toString() });
    }, 150);
  };

  const addHighlight = (opts?: { color?: string; note?: string }): HighlightRecord | null => {
    const cdoc = frame.contentDocument;
    if (!cdoc || !book || !pendingSelectionRange) return null;
    const blocks = blockElements(cdoc);
    const range = highlightRangeFromSelection(cdoc, blocks, pendingSelectionRange);
    if (!range) return null;
    const anchorRange: HighlightRange = { ...range, spine: spineIndex };
    const startEl = blocks[anchorRange.startBlock];
    const endEl = blocks[anchorRange.endBlock];
    if (!startEl || !endEl) return null;
    const idref = book.spine[spineIndex]?.idref ?? String(spineIndex);
    const highlight: HighlightRecord = {
      kind: 'text',
      id: `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      range: anchorRange,
      cfi: {
        start: serializeCfi(cdoc, spineIndex, idref, startEl, anchorRange.startOffset),
        end: serializeCfi(cdoc, spineIndex, idref, endEl, anchorRange.endOffset),
      },
      color: opts?.color ?? 'yellow',
      ...(opts?.note !== undefined ? { note: opts.note } : {}),
      text: pendingSelectionRange.toString(),
      createdAt: Date.now(),
    };
    highlights = [...highlights, highlight];
    pendingSelectionRange = null;
    cdoc.getSelection?.()?.removeAllRanges();
    emitter.emit('reader:selection', null);
    applyHighlights();
    scheduleSaveHighlights();
    emitter.emit('reader:highlightschange', { highlights });
    return highlight;
  };

  const removeHighlight = (id: string): void => {
    const next = highlights.filter((h) => h.id !== id);
    if (next.length === highlights.length) return;
    highlights = next;
    applyHighlights();
    scheduleSaveHighlights();
    emitter.emit('reader:highlightschange', { highlights });
  };

  const updateHighlight = (
    id: string,
    patch: { color?: string; note?: string },
  ): HighlightRecord | null => {
    const idx = highlights.findIndex((h) => h.id === id);
    if (idx === -1) return null;
    const prev = highlights[idx]!;
    const next: HighlightRecord = {
      ...prev,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
    };
    if (patch.note !== undefined) {
      if (patch.note === '') delete next.note;
      else next.note = patch.note;
    }
    highlights = highlights.map((h, i) => (i === idx ? next : h));
    if (patch.color !== undefined) applyHighlights();
    scheduleSaveHighlights();
    emitter.emit('reader:highlightschange', { highlights });
    return next;
  };

  const listHighlights = (): HighlightRecord[] => highlights;

  // ---- text-to-speech (stretch goal) ----------------------------------------

  const ttsSynth: TtsSynthLike | null =
    options.tts?.synth ??
    (typeof speechSynthesis !== 'undefined' ? (speechSynthesis as unknown as TtsSynthLike) : null);
  const ttsCreateUtterance: (text: string) => TtsUtteranceLike =
    options.tts?.createUtterance ??
    ((text: string) => new SpeechSynthesisUtterance(text) as unknown as TtsUtteranceLike);

  /** One TTS sentence per `Intl.Segmenter` split of each block's flattened text — same block-ordinal addressing as `HighlightRange`. */
  const sentencesForSpine = (cdoc: Document): TtsSentence[] => {
    const blocks = blockElements(cdoc);
    const out: TtsSentence[] = [];
    blocks.forEach((el, block) => {
      for (const s of segmentSentences(el.textContent ?? '')) {
        out.push({ block, start: s.start, end: s.end, text: s.text });
      }
    });
    return out;
  };

  const clearTtsHighlight = (cdoc: Document) => {
    const win = cdoc.defaultView as unknown as HighlightWindow | null;
    win?.CSS?.highlights?.delete('pore-tts');
    cdoc.querySelectorAll('mark.pore-tts').forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });
  };

  /** Paint the currently-spoken sentence — its own highlight name/class, kept separate from user highlights. */
  const paintTtsSentence = (cdoc: Document, range: Range | null) => {
    clearTtsHighlight(cdoc);
    if (!range) return;
    const win = cdoc.defaultView as unknown as HighlightWindow | null;
    if (win?.CSS?.highlights && win.Highlight) {
      let style = cdoc.getElementById('pore-tts-style') as HTMLStyleElement | null;
      if (!style) {
        style = cdoc.createElement('style');
        style.id = 'pore-tts-style';
        cdoc.head?.appendChild(style);
      }
      style.textContent = '::highlight(pore-tts){background-color:#fde68a99;}';
      win.CSS.highlights.set('pore-tts', new win.Highlight(range));
      return;
    }
    try {
      const mark = cdoc.createElement('mark');
      mark.className = 'pore-tts';
      mark.style.backgroundColor = '#fde68a99';
      range.surroundContents(mark);
    } catch {
      // a sentence spanning more than one element can't be wrapped in a
      // single <mark> — playback continues, just unpainted in this path.
    }
  };

  /** Highlight the sentence about to be spoken, and turn the page if it isn't the one currently showing. */
  const ttsOnSentence = (sentence: TtsSentence | null) => {
    const cdoc = frame.contentDocument;
    if (!cdoc) return;
    const blocks = blockElements(cdoc);
    const range = sentence
      ? rangeForHighlight(cdoc, blocks, {
          spine: spineIndex,
          startBlock: sentence.block,
          startOffset: sentence.start,
          endBlock: sentence.block,
          endOffset: sentence.end,
        })
      : null;
    paintTtsSentence(cdoc, range);
    if (!sentence) return;
    const el = blocks[sentence.block];
    if (!el || fixedLayoutActive() || flowActive() || layout().vertical) return;
    const target = Math.min(
      pageForElement(el, layout().pageStep, relRectOf),
      Math.max(0, spinePageCount - 1),
    );
    if (target !== page) {
      transitions.cancel();
      page = target;
      renderView();
      emitLocation();
    }
  };

  const ttsAdvanceSpine = async (): Promise<boolean> => {
    if (!book || spineIndex >= lastSpine()) return false;
    await renderSpine(spineIndex + 1);
    return true;
  };

  const tts = createTtsController({
    synth: ttsSynth ?? {
      speak: () => {},
      pause: () => {},
      resume: () => {},
      cancel: () => {},
      getVoices: () => [],
    },
    createUtterance: ttsCreateUtterance,
    getSentences: () => {
      const cdoc = frame.contentDocument;
      return cdoc ? sentencesForSpine(cdoc) : [];
    },
    onSentence: ttsOnSentence,
    advanceSpine: ttsAdvanceSpine,
    onStateChange: (state) => emitter.emit('reader:ttsstate', state),
  });

  /** All `tts*` methods are safe to call when the Web Speech API is unsupported — playback just never starts. */
  function ttsPlay(): void {
    if (ttsSynth) tts.play();
  }
  function ttsPause(): void {
    if (ttsSynth) tts.pause();
  }
  function ttsResume(): void {
    if (ttsSynth) tts.resume();
  }
  function ttsStop(): void {
    tts.stop();
  }
  function ttsSetRate(rate: number): void {
    tts.setRate(rate);
  }
  function ttsSetVoice(voice: TtsVoiceLike | null): void {
    tts.setVoice(voice);
  }
  function ttsListVoices(): TtsVoiceLike[] {
    return ttsSynth ? tts.listVoices() : [];
  }
  function ttsState(): TtsState {
    return tts.getState();
  }

  const flowEl = (): HTMLElement | null =>
    (frame.contentDocument?.getElementById(FLOW_ID) as HTMLElement | null) ?? null;

  const viewportEl = (): HTMLElement | null =>
    (frame.contentDocument?.getElementById(VIEWPORT_ID) as HTMLElement | null) ?? null;

  const fixedPageSizeFor = (cdoc: Document): FixedPageSize =>
    parseFixedViewportMeta(cdoc.querySelector('meta[name="viewport"]')?.getAttribute('content'));

  /** Scale + centre the current spine's fixed-size page inside the reader window. */
  const applyFixedLayoutTransform = () => {
    const cdoc = frame.contentDocument;
    const flow = flowEl();
    if (!cdoc || !flow) return;
    const size = fixedPageSizeFor(cdoc);
    const cw = root.clientWidth || size.width;
    const ch = root.clientHeight || size.height;
    const { scale, offsetX, offsetY } = fixedLayoutScale(cw, ch, size);
    flow.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  /**
   * `#pore-viewport` is centred inside the iframe whenever the reader window
   * is wider than the reading column (common on desktop), so a bare
   * `getBoundingClientRect().left` is offset by that centring gap — dividing
   * it by `pageStep` (which assumes page 0 starts at `left: 0`) then lands on
   * the wrong page. `relRectOf`/`relRangeRectOf` subtract that gap so anchor
   * generation/resolution operate in the viewport's own coordinate space.
   */
  const viewportLeft = (): number => viewportEl()?.getBoundingClientRect().left ?? 0;

  const relRectOf: RectOf = (el) => {
    const r = el.getBoundingClientRect();
    const off = viewportLeft();
    return { left: r.left - off, right: r.right - off, top: r.top, bottom: r.bottom };
  };

  const relRangeRectOf: RangeRectOf = (range) => {
    let r: Rect;
    try {
      r = range.getBoundingClientRect();
    } catch {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    }
    const off = viewportLeft();
    return { left: r.left - off, right: r.right - off, top: r.top, bottom: r.bottom };
  };

  /** Move the spine body's content into a clipped viewport + multicol flow. */
  const wrapContent = () => {
    const cdoc = frame.contentDocument;
    if (!cdoc?.body || cdoc.getElementById(FLOW_ID)) return;
    const viewport = cdoc.createElement('div');
    viewport.id = VIEWPORT_ID;
    const flow = cdoc.createElement('div');
    flow.id = FLOW_ID;
    while (cdoc.body.firstChild) flow.appendChild(cdoc.body.firstChild);
    viewport.appendChild(flow);
    cdoc.body.appendChild(viewport);
  };

  const chapterLabel = (i: number): string => {
    if (!book) return `Chapter ${i + 1}`;
    const href = book.spine[i]?.href;
    const flat = (entries: TocEntry[]): TocEntry[] =>
      entries.flatMap((e) => [e, ...flat(e.children)]);
    const hit = flat(book.toc).find((e) => stripHash(e.href) === href);
    return hit?.label ?? `Chapter ${i + 1}`;
  };

  // ---- in-book search -----------------------------------------------------

  const search = new SearchController(
    options.searchWorkerFactory !== undefined
      ? { workerFactory: options.searchWorkerFactory }
      : {},
  );
  let searchBuilt: Promise<void> | null = null;

  const sectionId = (i: number): string => book?.spine[i]?.idref ?? String(i);

  const searchSections = (): SearchSection[] => {
    const b = book;
    if (!b) return [];
    return b.spine.map((item, index) => {
      const res = b.resource(item.href);
      const doc = parser.parseFromString(
        res ? new TextDecoder().decode(res.bytes) : '',
        'text/html',
      );
      doc.querySelectorAll('script, style').forEach((el) => el.remove());
      return { id: sectionId(index), index, text: doc.body?.textContent ?? '' };
    });
  };

  const runSearch = async (query: string): Promise<SearchHit[]> => {
    if (!book) return [];
    searchBuilt ??= search.build(searchSections());
    await searchBuilt;
    const hits = await search.query(query, { limit: 300 });
    emitter.emit('reader:searchresults', { query, hits });
    return hits;
  };

  /** Block element whose accumulated collapsed text spans `offset`, and how far through the doc that is. */
  const blockForOffset = (doc: Document, offset: number): { el: Element | null; fraction: number } => {
    const blocks = blockElements(doc);
    let seen = 0;
    let total = 0;
    const lens = blocks.map((el) => {
      const len = (el.textContent ?? '').replace(/\s+/g, ' ').trim().length + 1;
      total += len;
      return len;
    });
    for (let i = 0; i < blocks.length; i++) {
      if (seen + lens[i]! > offset) {
        return { el: blocks[i]!, fraction: total > 0 ? seen / total : 0 };
      }
      seen += lens[i]!;
    }
    return { el: blocks.at(-1) ?? null, fraction: total > 0 ? seen / total : 0 };
  };

  const gotoHit = (hit: SearchHit): void => {
    if (!book) return;
    const idx = book.spine.findIndex((_, i) => sectionId(i) === hit.sectionId);
    if (idx < 0) return;
    const land = () => {
      const cdoc = frame.contentDocument;
      if (!cdoc) return;
      const { el, fraction } = blockForOffset(cdoc, hit.start);
      const last = Math.max(0, spinePageCount - 1);
      if (flowActive()) {
        el?.scrollIntoView({ block: 'start' });
        const vp = viewportEl();
        page = vp ? Math.round(vp.scrollTop / (vp.clientHeight || 1)) : Math.round(fraction * last);
      } else {
        const flow = flowEl();
        if (flow) {
        transitions.cancel();
        flow.style.transform = 'translateX(0)';
        pageOffset = 0;
      }
        page = layout().vertical
          ? Math.min(Math.round(fraction * last), last)
          : el
            ? Math.min(pageForElement(el, layout().pageStep, relRectOf), last)
            : page;
      }
      renderView();
      emitLocation();
    };
    if (idx === spineIndex) land();
    else void renderSpine(idx).then(land);
  };

  const engineChapters = (): Chapter[] => {
    if (!book) return [];
    const total = totalPages();
    return book.spine.map((s, i) => {
      const startPage = bookPageBefore(i);
      return {
        id: s.idref ?? String(i),
        label: chapterLabel(i),
        startPage,
        startPercent: total > 0 ? startPage / total : 0,
      };
    });
  };

  const renderEndCard = () => {
    if (!book) return;
    const bookEnd = spineIndex === lastSpine();
    const theme = THEME_COLORS[settings.theme];
    endEl.style.background = theme.background || '#fff';
    endEl.style.color = theme.color || '#111';
    endEl.replaceChildren();

    const title = doc.createElement('div');
    title.style.cssText = 'font-size:1.4rem;font-weight:700;';
    title.textContent = bookEnd ? 'The End' : `End of ${chapterLabel(spineIndex)}`;
    const sub = doc.createElement('div');
    sub.style.cssText = 'opacity:.7;font-size:.95rem;';
    sub.textContent = bookEnd ? book.metadata.title : 'Next: ' + chapterLabel(spineIndex + 1);
    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;';

    const btn = (text: string, onClick: () => void) => {
      const b = doc.createElement('button');
      b.textContent = text;
      b.style.cssText =
        'font:inherit;padding:.4rem .9rem;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;';
      b.addEventListener('click', onClick);
      return b;
    };
    if (bookEnd) {
      row.append(
        btn('Restart', () => goto(0)),
        btn('Contents', () => emitter.emit('reader:endpage', endPagePayload(true))),
      );
    } else {
      row.append(btn('Continue →', () => turn('forward')));
    }
    endEl.append(title, sub, row);
  };

  const endPagePayload = (visible: boolean) => ({
    visible,
    kind: (spineIndex === lastSpine() ? 'book' : 'chapter') as 'book' | 'chapter',
    label: spineIndex === lastSpine() ? 'The End' : `End of ${chapterLabel(spineIndex)}`,
    hasNext: spineIndex < lastSpine(),
  });

  let endVisible = false;
  const renderView = (dir: -1 | 0 | 1 = 0) => {
    const showing = onEndSlot();
    if (showing) {
      renderEndCard();
      endEl.style.display = 'flex';
      frame.style.visibility = 'hidden';
    } else {
      endEl.style.display = 'none';
      frame.style.visibility = 'visible';
      applyPage(dir);
    }
    if (showing !== endVisible) {
      endVisible = showing;
      emitter.emit('reader:endpage', endPagePayload(showing));
    }
  };

  const applyPage = (dir: -1 | 0 | 1 = 0) => {
    if (fixedLayoutActive()) {
      applyFixedLayoutTransform();
      return;
    }
    const l = layout();
    if (flowActive()) {
      const vp = viewportEl();
      // scrolling to `page * clientHeight` yields a scroll event that computes
      // back to the same `page` (a no-op), so no suppression flag is needed.
      if (vp) transitions.scrollTo(vp, 'scrollTop', page * (vp.clientHeight || 0), reduced());
      return;
    }
    const flow = flowEl();
    if (!flow) return;
    // vertical-rl content grows leftward from a right-pinned flow, so paging
    // forward shifts it right by `+pageStep` (mirror of the horizontal case).
    const x = l.vertical ? page * l.pageStep : offsetForPage(page, l.pageStep);
    transitions.page(flow, pageOffset, x, { axis: 'x', dir, reduced: reduced() });
    pageOffset = x;
  };

  const measure = () => {
    if (fixedLayoutActive()) {
      spinePageCount = 1;
      spinePages[spineIndex] = 1;
      page = Math.min(page, maxPage());
      applyPage();
      return;
    }
    if (flowActive()) {
      const vp = viewportEl();
      const h = vp?.clientHeight || 1;
      spinePageCount = Math.max(1, Math.ceil((vp?.scrollHeight ?? h) / h));
      spinePages[spineIndex] = spinePageCount;
      wireScrollSync();
      page = Math.min(page, maxPage());
      applyPage();
      return;
    }
    const flow = flowEl();
    if (!flow) return;
    spinePageCount = pageCountFor(flow.scrollWidth, layout().pageStep);
    spinePages[spineIndex] = spinePageCount;
    page = Math.min(page, maxPage());
    applyPage();
  };

  // Keep `page` in step with manual / assistive-tech scrolling in flow mode.
  let scrollSyncEl: HTMLElement | null = null;
  let scrollSyncTimer: ReturnType<typeof setTimeout> | null = null;
  const onFlowScroll = () => {
    if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
    scrollSyncTimer = setTimeout(() => {
      const vp = viewportEl();
      if (!vp) return;
      const next = Math.round(vp.scrollTop / (vp.clientHeight || 1));
      if (next !== page && next >= 0 && next <= maxPage()) {
        page = next;
        emitLocation();
      }
    }, 120);
  };
  const wireScrollSync = () => {
    if (!flowActive()) return;
    const vp = viewportEl();
    if (!vp || vp === scrollSyncEl) return;
    scrollSyncEl?.removeEventListener('scroll', onFlowScroll);
    vp.addEventListener('scroll', onFlowScroll, { passive: true });
    scrollSyncEl = vp;
  };

  const injectStyle = () => {
    const cdoc = frame.contentDocument;
    if (!cdoc) return;
    if (options.fontFaceCss && !cdoc.getElementById('pore-fonts')) {
      const f = cdoc.createElement('style');
      f.id = 'pore-fonts';
      f.textContent = options.fontFaceCss;
      cdoc.head?.appendChild(f);
    }
    let el = cdoc.getElementById('pore-base-style') as HTMLStyleElement | null;
    if (!el) {
      el = cdoc.createElement('style');
      el.id = 'pore-base-style';
      cdoc.head?.appendChild(el);
    }
    const theme = THEME_COLORS[settings.theme];
    if (fixedLayoutActive()) {
      el.textContent = buildFixedLayoutStylesheet(fixedPageSizeFor(cdoc), theme.background);
      return;
    }
    el.textContent = buildBaseStylesheet(layout(), {
      fontSizePct: settings.fontSizePct,
      lineHeight: settings.lineHeight,
      textAlign: settings.textAlign,
      fontFamily: settings.fontFamily,
      color: theme.color,
      background: theme.background,
      direction: book?.metadata.direction ?? 'ltr',
      publisherStyles: settings.publisherStyles,
      dimImages: settings.dimImages && THEME_COLORS[settings.theme].dark,
      flow: flowActive(),
    });
  };

  /**
   * Turn a pending `epubcfi(...)` target for the current spine into a
   * `pendingAnchor` (block ordinal + offset), which the normal anchor path then
   * resolves to a page. The CFI addresses an element by element-sibling steps;
   * we walk up to the nearest block so `resolveAnchor` has something to measure.
   */
  const resolvePendingCfi = () => {
    const cdoc = frame.contentDocument;
    if (!cdoc || !pendingCfi || pendingCfi.spineIndex !== spineIndex) return;
    const parsed = pendingCfi;
    pendingCfi = null;
    const el = resolveCfiElement(cdoc, parsed.steps);
    if (!el) return;
    const blocks = blockElements(cdoc);
    let b: Element | null = el;
    while (b && !blocks.includes(b)) b = b.parentElement;
    const block = b ? blocks.indexOf(b) : -1;
    if (block < 0 || !b) return;
    // the CFI's offset is relative to `el`'s flattened text; make it relative to
    // the block by adding the text that precedes `el` inside the block
    let offset = parsed.offset;
    if (b !== el) {
      const walker = cdoc.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        if (el.contains(n)) break;
        offset += n.textContent?.length ?? 0;
      }
    }
    pendingAnchor = { type: 'anchor', spine: spineIndex, block, offset, percent: 0 };
  };

  const resolvePendingAnchor = () => {
    const cdoc = frame.contentDocument;
    if (!cdoc || !pendingAnchor || pendingAnchor.spine !== spineIndex) return;
    const anchor = pendingAnchor;
    pendingAnchor = null;
    if (fixedLayoutActive()) {
      page = 0; // one page per spine item — nothing further to resolve
      return;
    }
    const flow = flowEl();
    if (flow) flow.style.transform = 'translateX(0)';
    const { page: resolved } = resolveAnchor(
      cdoc,
      anchor,
      {
        spinePages: spinePageCount,
        pageStep: layout().pageStep,
        byPercent: layout().vertical || flowActive(),
      },
      relRectOf,
      relRangeRectOf,
    );
    page = Math.min(Math.max(resolved, 0), spinePageCount - 1);
  };

  const renderSpine = (idx: number, atLastPage = false): Promise<void> => {
    if (!book) return Promise.resolve();
    const item = book.spine[idx];
    if (!item) return Promise.resolve();
    spineIndex = idx;
    emitter.emit('reader:loadingstate', { spine: idx, state: 'loading' });

    revokeUrls();
    const res = book.resource(item.href);
    const source_ = res ? new TextDecoder().decode(res.bytes) : '<p>(missing chapter)</p>';
    const { html, urls } = rewriteResources(source_, book, item.href, parser, {
      // fixed-layout positioning is entirely author-CSS-driven — never strip it
      stripAuthorCss: !fixedLayoutActive() && !settings.publisherStyles,
    });
    objectUrls = urls;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled || destroyed) return;
        settled = true;
        wrapContent();
        injectStyle();
        measure();
        page = atLastPage ? Math.max(0, spinePageCount - 1) : 0;
        resolvePendingCfi();
        resolvePendingAnchor();
        renderView();
        applyHighlights();
        emitter.emit('reader:loadingstate', { spine: idx, state: 'loaded' });
        emitLocation();
        resolve();
      };
      frame.addEventListener('load', finish, { once: true });
      // jsdom / edge cases where `load` never fires for srcdoc
      setTimeout(finish, 60);
      frame.srcdoc = html;
    }).then(() => {
      wireLinks();
      wireInput();
    });
  };

  /** Intercept footnote / same-doc links inside the iframe. */
  const wireLinks = () => {
    const cdoc = frame.contentDocument;
    if (!cdoc) return;
    cdoc.addEventListener('click', (ev) => {
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      const isNote =
        a.getAttribute('epub:type')?.includes('noteref') ||
        a.getAttribute('type')?.includes('noteref');
      if (href.startsWith('#') || isNote) {
        ev.preventDefault();
        openFootnote(href);
      } else if (!/^[a-z]+:/i.test(href)) {
        ev.preventDefault();
        gotoHref(href, item()?.href ?? '');
      }
    });
  };

  let chromeVisible = true;
  let lastWheel = 0;

  const toggleChrome = () => {
    chromeVisible = !chromeVisible;
    handle.setChromeOpen(chromeVisible);
    emitter.emit('reader:chrometoggle', { visible: chromeVisible });
  };

  const handle = createChromeHandle({ root, doc, onToggle: toggleChrome });
  const syncHandle = () => {
    const g = settings.chromeGesture;
    handle.setActive(g === 'handle' || g === 'handle+long-press');
  };
  const wantsLongPress = () =>
    settings.chromeGesture === 'long-press' || settings.chromeGesture === 'handle+long-press';
  const wantsCenterTap = () => settings.chromeGesture === 'tap-center';

  // swipe-to-turn inside the reading iframe (pointer events, so it works on
  // touch; the browser owns vertical scroll via `touch-action`)
  let swipe: { x: number; y: number; t: number; id: number } | null = null;
  let lpTimer: ReturnType<typeof setTimeout> | null = null;
  const clearLp = () => {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = null;
    }
  };
  const onPointerDown = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse') {
      swipe = null;
      return;
    }
    swipe = { x: ev.clientX, y: ev.clientY, t: Date.now(), id: ev.pointerId };
    handle.wake();
    clearLp();
    if (wantsLongPress()) {
      lpTimer = setTimeout(() => {
        lpTimer = null;
        swipe = null;
        try {
          navigator.vibrate?.(10);
        } catch {
          /* unsupported */
        }
        toggleChrome();
      }, 450);
    }
  };
  const onPointerMoveSwipe = (ev: PointerEvent) => {
    if (swipe && Math.hypot(ev.clientX - swipe.x, ev.clientY - swipe.y) > 10) clearLp();
  };
  let lastSwipeAt = 0;
  const onPointerUp = (ev: PointerEvent) => {
    clearLp();
    if (!swipe || ev.pointerId !== swipe.id) return;
    const dx = ev.clientX - swipe.x;
    const dy = ev.clientY - swipe.y;
    const dt = Date.now() - swipe.t;
    swipe = null;
    if (dt > 600 || Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy)) return;
    const rtl = book?.metadata.direction === 'rtl';
    // swiping left = forward in LTR, back in RTL
    const forward = dx < 0 ? !rtl : rtl;
    lastSwipeAt = Date.now();
    turn(forward ? 'forward' : 'back');
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    // RTL / vertical-JP books read leftward: swap the horizontal keys.
    const reverse = book?.metadata.direction === 'rtl';
    const rightKeys = ['ArrowRight', 'd', 'D', 'l'];
    const leftKeys = ['ArrowLeft', 'a', 'A', 'h'];
    const horizFwd = reverse ? leftKeys : rightKeys;
    const horizBack = reverse ? rightKeys : leftKeys;
    const fwd =
      ([...horizFwd, 'ArrowDown', 'PageDown', ' '].includes(k) && !ev.shiftKey);
    const back =
      [...horizBack, 'ArrowUp', 'PageUp'].includes(k) || (k === ' ' && ev.shiftKey);
    if (fwd) {
      ev.preventDefault();
      turn('forward');
    } else if (back) {
      ev.preventDefault();
      turn('back');
    } else if (k === 'Home') {
      ev.preventDefault();
      goto(0);
    } else if (k === 'End') {
      ev.preventDefault();
      goto(totalPages() - 1);
    } else if (k === 'm' || k === 'M') {
      ev.preventDefault();
      toggleChrome();
    }
  };

  const onWheel = (ev: WheelEvent) => {
    if (ev.ctrlKey) return;
    const now = Date.now();
    // vertical-rl readers often scroll horizontally; take the dominant axis.
    const horizontal = layout().vertical && Math.abs(ev.deltaX) > Math.abs(ev.deltaY);
    const delta = horizontal ? -ev.deltaX : ev.deltaY;
    if (Math.abs(delta) < 4 || now - lastWheel < 320) return;
    lastWheel = now;
    ev.preventDefault();
    turn(delta > 0 ? 'forward' : 'back');
  };

  const onClick = (ev: MouseEvent) => {
    if (Date.now() - lastSwipeAt < 450) return; // the click that trails a swipe
    if ((ev.target as Element | null)?.closest?.('a, button, [data-pore-chrome-handle]')) return;
    const rect = root.getBoundingClientRect();
    const r = rect.width > 0 ? (ev.clientX - rect.left) / rect.width : 0.5;
    const rtl = book?.metadata.direction === 'rtl';
    if (r < 1 / 3) turn(rtl ? 'forward' : 'back');
    else if (r > 2 / 3) turn(rtl ? 'back' : 'forward');
    else if (wantsCenterTap()) toggleChrome();
  };

  /** Wire keyboard/wheel/click on the iframe doc (events don't bubble to the parent). */
  // Pointer moves inside the sandboxed iframe don't reach the host page, so
  // forward a throttled synthetic move — lets an auto-hiding chrome outside
  // the reader wake up when the pointer is over the text.
  let lastPointerFwd = 0;
  const forwardPointerActivity = () => {
    const now = Date.now();
    if (now - lastPointerFwd < 400) return;
    lastPointerFwd = now;
    root.dispatchEvent(new Event('pointermove', { bubbles: true }));
  };

  const wireInput = () => {
    const cdoc = frame.contentDocument;
    if (!cdoc) return;
    cdoc.addEventListener('keydown', onKey);
    cdoc.addEventListener('wheel', onWheel, { passive: false });
    cdoc.addEventListener('click', onClick);
    cdoc.addEventListener('selectionchange', onSelectionChange);
    cdoc.addEventListener('pointermove', forwardPointerActivity, { passive: true });
    cdoc.addEventListener('pointerdown', onPointerDown);
    cdoc.addEventListener('pointermove', onPointerMoveSwipe, { passive: true });
    cdoc.addEventListener('pointerup', onPointerUp);
    cdoc.addEventListener('pointercancel', () => {
      swipe = null;
      clearLp();
    });
  };

  const item = () => book?.spine[spineIndex];

  const openFootnote = (href: string) => {
    const cdoc = frame.contentDocument;
    if (!book || !cdoc) return;
    const [pathPart, frag] = href.split('#');
    let targetDoc = cdoc;
    let noteHtml = '';
    if (pathPart) {
      const resolved = resolveHref(dirOf(item()?.href ?? ''), pathPart);
      const res = book.resource(resolved);
      if (res) targetDoc = parser.parseFromString(new TextDecoder().decode(res.bytes), 'text/html');
    }
    const el = frag ? targetDoc.getElementById(frag) : null;
    noteHtml = (el?.innerHTML ?? el?.textContent ?? '').trim();
    if (noteHtml) {
      const safeHtml = sanitizeFootnoteHtml(noteHtml);
      if (safeHtml) emitter.emit('reader:footnote', { html: safeHtml, href });
    }
  };

  /** Jump to an archive-absolute spine path (+ optional `#fragment`), already resolved. */
  const jumpToResolvedHref = (targetPath: string, frag: string | undefined) => {
    if (!book) return;
    const idx = book.spine.findIndex((s) => s.href === targetPath);
    if (idx === -1) return;
    const jump = () => {
      const cdoc = frame.contentDocument;
      const el = frag && cdoc ? cdoc.getElementById(frag) : null;
      if (el && cdoc && flowActive()) {
        el.scrollIntoView({ block: 'start' });
        const vp = viewportEl();
        page = vp ? Math.round(vp.scrollTop / (vp.clientHeight || 1)) : 0;
      } else if (el && cdoc && !layout().vertical) {
        const flow = flowEl();
        if (flow) {
        transitions.cancel();
        flow.style.transform = 'translateX(0)';
        pageOffset = 0;
      }
        page = Math.min(
          pageForElement(el, layout().pageStep, relRectOf),
          Math.max(0, spinePageCount - 1),
        );
      } else {
        page = 0;
      }
      applyPage();
      emitLocation();
    };
    if (idx === spineIndex) jump();
    else void renderSpine(idx).then(jump);
  };

  /** `href` is relative to the chapter it was clicked from (e.g. an in-chapter `<a>` or footnote link). */
  const gotoHref = (href: string, fromHref: string) => {
    if (!book) return;
    const [pathPart, frag] = href.split('#');
    const resolved = pathPart ? resolveHref(dirOf(fromHref), pathPart) : fromHref;
    jumpToResolvedHref(stripHash(resolved), frag);
  };

  /** `href` is already an archive-absolute spine path (e.g. from `book.toc`, resolved against the nav doc's own directory) — the shape `goToHref()`'s public API takes. */
  const gotoResolvedHref = (href: string) => {
    if (!book) return;
    const [pathPart, frag] = href.split('#');
    jumpToResolvedHref(stripHash(pathPart || item()?.href || ''), frag);
  };

  const revokeUrls = () => {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls = [];
  };

  // ---- public API -----------------------------------------------------------

  function turn(dir: 'forward' | 'back'): void {
    if (!book) return;
    tts.stop(); // manual navigation interrupts playback; TTS's own auto-advance calls renderSpine directly, bypassing this
    const delta = dir === 'forward' ? 1 : -1;
    const next = page + delta;
    if (next >= 0 && next <= maxPage()) {
      transitions.cancel();
      page = next;
      renderView(delta);
      emitLocation();
      return;
    }
    if (next < 0) {
      if (spineIndex === 0) emitter.emit('reader:start', {});
      else void renderSpine(spineIndex - 1, true);
      return;
    }
    // past the end slot
    if (spineIndex === lastSpine()) emitter.emit('reader:end', {});
    else void renderSpine(spineIndex + 1, false);
  }

  /** Navigate to a portable `epubcfi(...)` — the inverse of {@link getCfi}. */
  function goToCfi(cfi: string): void {
    if (!book) return;
    const parsed = parseCfi(cfi);
    if (!parsed) return;
    tts.stop();
    const idx = Math.min(Math.max(parsed.spineIndex, 0), book.spine.length - 1);
    pendingCfi = { ...parsed, spineIndex: idx };
    if (idx === spineIndex) {
      transitions.cancel();
      resolvePendingCfi();
      resolvePendingAnchor();
      renderView();
      emitLocation();
    } else {
      void renderSpine(idx);
    }
  }

  function goto(target: number | Position): void {
    if (!book) return;
    tts.stop();
    if (typeof target === 'object') {
      if (target.type === 'anchor') {
        const idx = Math.min(target.spine, book.spine.length - 1);
        pendingAnchor = target;
        if (idx === spineIndex) {
          resolvePendingAnchor();
          renderView();
          emitLocation();
        } else {
          void renderSpine(idx);
        }
      }
      return;
    }
    // absolute book page
    let acc = 0;
    for (let i = 0; i < book.spine.length; i++) {
      const eff = effectivePages(i);
      if (target < acc + eff || i === lastSpine()) {
        const localPage = Math.max(0, target - acc);
        const land = () => {
          page = Math.min(localPage, maxPage());
          renderView();
          emitLocation();
        };
        if (i === spineIndex) land();
        else void renderSpine(i).then(land);
        return;
      }
      acc += eff;
    }
  }

  /** Reflow (resize / restyle) keeping the reader at the same fraction of the spine. */
  const reflowKeepingPlace = () => {
    const wasEnd = onEndSlot();
    const frac = spinePageCount > 0 ? page / spinePageCount : 0;
    injectStyle();
    measure();
    page = wasEnd
      ? spinePageCount
      : Math.min(Math.max(Math.round(frac * spinePageCount), 0), Math.max(0, spinePageCount - 1));
    renderView();
    emitLocation();
  };

  function setSettings(patch: Partial<TextEngineSettings>): void {
    const prev = settings;
    settings = { ...settings, ...patch };
    if (settings.publisherStyles !== prev.publisherStyles) {
      // author CSS is baked in at render time — re-render the spine
      void renderSpine(spineIndex);
    } else if (
      settings.verticalText !== prev.verticalText ||
      settings.flowMode !== prev.flowMode
    ) {
      // writing mode / flow flips the whole pagination model — re-measure fresh
      transitions.cancel();
      injectStyle();
      measure();
      page = 0;
      pageOffset = 0;
      renderView();
      emitLocation();
    } else {
      reflowKeepingPlace();
    }
    if (settings.chromeGesture !== prev.chromeGesture) syncHandle();
    emitter.emit('reader:settingschange', { settings });
  }

  async function mount(): Promise<void> {
    const manifest = await source.getManifest(bookId);
    if (destroyed) return;
    if (manifest.type !== 'epub') {
      throw new Error(`createTextEngine: "${bookId}" is a ${manifest.type} book, not an EPUB`);
    }
    const blob = await source.getFile(bookId);
    if (destroyed) return;
    const arrayBuffer = await blob.arrayBuffer();
    if (destroyed) return;
    book = parseEpub(new Uint8Array(arrayBuffer), { domParser: parser });
    spinePages = new Array(book.spine.length).fill(undefined);

    container.replaceChildren(root);
    root.addEventListener('keydown', onKey);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMoveSwipe, { passive: true });
    root.addEventListener('pointerup', onPointerUp);
    syncHandle();
    if (typeof ResizeObserver !== 'undefined') {
      let raf = 0;
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(reflowKeepingPlace);
      });
      resizeObserver.observe(root);
    }

    let restore: Position | null = null;
    try {
      restore = await source.loadProgress(bookId);
      if (destroyed) return;
    } catch {
      if (destroyed) return;
      restore = null;
    }
    emitter.emit('reader:resumed', { position: restore });
    emitter.emit('reader:toc', { toc: book.toc });

    try {
      highlights = (await source.loadHighlights?.(bookId)) ?? [];
      if (destroyed) return;
    } catch {
      if (destroyed) return;
      highlights = [];
    }
    emitter.emit('reader:highlightschange', { highlights });

    const startSpine =
      restore?.type === 'anchor' ? Math.min(restore.spine, book.spine.length - 1) : 0;
    if (restore?.type === 'anchor') pendingAnchor = restore;
    await renderSpine(startSpine);
    if (destroyed) return;
    emitter.emit('reader:chrometoggle', { visible: chromeVisible });
    emitter.emit('reader:ready', {
      metadata: book.metadata,
      spineCount: book.spine.length,
      vertical: verticalActive(),
      flow: flowActive(),
    });
  }

  function on<E extends keyof TextEngineEvents>(
    event: E,
    handler: (payload: TextEngineEvents[E]) => void,
  ): () => void {
    return emitter.on(event, handler);
  }

  function destroy(): void {
    flushSave();
    flushSaveHighlights();
    tts.stop();
    destroyed = true;
    clearLp();
    handle.destroy();
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('click', onClick);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMoveSwipe);
    root.removeEventListener('pointerup', onPointerUp);
    resizeObserver?.disconnect();
    if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
    if (selectionTimer) clearTimeout(selectionTimer);
    scrollSyncEl?.removeEventListener('scroll', onFlowScroll);
    transitions.cancel();
    revokeUrls();
    search.destroy();
    emitter.clear();
    root.remove();
  }

  return {
    mount,
    goto,
    goToHref: gotoResolvedHref,
    turn,
    setSettings,
    on,
    destroy,
    chapters: engineChapters,
    search: runSearch,
    gotoHit,
    getCfi,
    goToCfi,
    addHighlight,
    removeHighlight,
    updateHighlight,
    listHighlights,
    ttsPlay,
    ttsPause,
    ttsResume,
    ttsStop,
    ttsSetRate,
    ttsSetVoice,
    ttsListVoices,
    ttsState,
  };
}
