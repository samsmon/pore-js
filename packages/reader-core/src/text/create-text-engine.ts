import type { ReaderSource } from '../source/types.js';
import type { Position } from '../position/types.js';
import { createEmitter } from '../internal/emitter.js';
import type { Chapter } from '../reader-engine.js';
import { PaceEstimator } from '../progress.js';
import { parseEpub } from './epub/parse.js';
import type { EpubBook } from './epub/types.js';
import { dirOf, resolveHref, stripHash } from './epub/path.js';
import type { TtsState, TtsSynthLike, TtsUtteranceLike, TtsVoiceLike } from './tts.js';
import { injectTextStyle } from './text-style.js';
import { TextTtsCoordinator } from './text-tts-coordinator.js';
import { SearchController } from '../search/search-controller.js';
import type { SearchHit } from '../search/search-index.js';
import { instantTransitions, type ReaderTransitions } from '../transitions.js';
import { computeTextLayout, offsetForPage, pageCountFor, type TextLayout } from './paginate.js';
import {
  DEFAULT_TEXT_SETTINGS,
  type TextEngine,
  type TextEngineEvents,
  type TextEngineSettings,
} from './types.js';
import { createTextHighlightController } from './text-highlights.js';
import {
  applyFixedLayoutTransform,
  buildSearchSections,
  chapterLabelForBook,
  extractFootnoteHtml,
  fixedPageSizeFor,
  renderEndCardDom,
} from './text-dom-helpers.js';
import {
  buildEngineChapters,
  buildLocationAndProgress,
  computeCurrentAnchor,
  computeCurrentCfi,
  createTextDomShell,
  createViewportRectHelpers,
  getFlowEl,
  getViewportEl,
} from './text-navigation-helpers.js';
import { createTextInputController } from './text-input.js';
import { createTextSpineRunner } from './text-spine-runner.js';

const SAVE_DEBOUNCE_MS = 800;

export interface CreateTextEngineOptions {
  container: HTMLElement;
  source: ReaderSource;
  bookId: string;
  settings?: Partial<TextEngineSettings>;
  domParser?: DOMParser;
  fontFaceCss?: string;
  searchWorkerFactory?: (() => Worker) | false;
  transitions?: ReaderTransitions;
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
  const pace = new PaceEstimator(30);
  let book: EpubBook | null = null,
    resizeObserver: ResizeObserver | null = null,
    saveTimer: ReturnType<typeof setTimeout> | null = null,
    saveHlTimer: ReturnType<typeof setTimeout> | null = null;
  let spineIndex = 0,
    page = 0,
    pageOffset = 0,
    spinePageCount = 1,
    destroyed = false;
  let spinePages: (number | undefined)[] = [];

  const { root, frame, endEl } = createTextDomShell(doc);
  const { relRectOf, relRangeRectOf } = createViewportRectHelpers(frame);
  const flowEl = () => getFlowEl(frame);
  const viewportEl = () => getViewportEl(frame);
  const fixedLayoutActive = (): boolean => book?.metadata.fixedLayout === true;
  const mql = (q: string): boolean =>
    typeof matchMedia === 'function' ? matchMedia(q).matches : false;
  const reduced = (): boolean => mql('(prefers-reduced-motion: reduce)');
  const flowActive = (): boolean =>
    !fixedLayoutActive() &&
    (settings.flowMode === 'flow' ||
      (settings.flowMode !== 'paged' && mql('(forced-colors: active)')));
  const verticalActive = (): boolean =>
    !fixedLayoutActive() &&
    !flowActive() &&
    (settings.verticalText === 'on' ||
      (settings.verticalText !== 'off' &&
        book?.metadata.direction === 'rtl' &&
        /^ja/i.test(book?.metadata.language ?? '')));
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
  const estimateSpinePages = (i: number): number => {
    if (fixedLayoutActive()) return 1;
    const res = book?.spine[i]?.href ? book?.resource(book.spine[i]!.href) : null;
    return res ? Math.max(1, Math.round(res.bytes.length / 1800)) : 1;
  };
  const hasEndSlot = (i: number): boolean =>
    settings.endBehavior === 'endpage' || i === lastSpine();
  const effectivePages = (i: number): number =>
    (spinePages[i] ?? estimateSpinePages(i)) + (hasEndSlot(i) ? 1 : 0);
  const maxPage = (): number => spinePageCount - 1 + (hasEndSlot(spineIndex) ? 1 : 0);
  const onEndSlot = (): boolean => hasEndSlot(spineIndex) && page >= spinePageCount;
  const bookPageBefore = (idx: number): number => {
    let sum = 0;
    for (let i = 0; i < idx; i++) sum += effectivePages(i);
    return sum;
  };
  const totalPages = (): number => bookPageBefore(lastSpine() + 1);

  const anchorFor = (): Position =>
    computeCurrentAnchor({
      cdoc: frame.contentDocument,
      fixedLayout: fixedLayoutActive(),
      spineIndex,
      page,
      spinePageCount,
      total: totalPages(),
      bookPageBeforeSpine: bookPageBefore(spineIndex),
      pageWidth: layout().measure,
      relRectOf,
      relRangeRectOf,
    });
  const chapterLabel = (i: number): string => chapterLabelForBook(book, i);
  const engineChapters = (): Chapter[] => buildEngineChapters(book, totalPages(), bookPageBefore);

  const flushSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (book && !destroyed) void source.saveProgress(bookId, anchorFor()).catch(() => {});
  };
  const flushSaveHighlights = () => {
    if (saveHlTimer) clearTimeout(saveHlTimer);
    saveHlTimer = null;
    if (!destroyed) void source.saveHighlights?.(bookId, hlCtrl.listHighlights()).catch(() => {});
  };

  const hlCtrl = createTextHighlightController({
    getDocument: () => frame.contentDocument,
    getBook: () => book,
    getSpineIndex: () => spineIndex,
    scheduleSave: () => {
      if (saveHlTimer) clearTimeout(saveHlTimer);
      saveHlTimer = setTimeout(flushSaveHighlights, SAVE_DEBOUNCE_MS);
    },
    onSelectionEmit: (payload) => emitter.emit('reader:selection', payload),
    onHighlightsEmit: (highlights) => emitter.emit('reader:highlightschange', { highlights }),
  });

  const emitLocation = () => {
    if (!book) return;
    const total = totalPages();
    const { loc, progress } = buildLocationAndProgress({
      book,
      spineIndex,
      page,
      total,
      bookPage: bookPageBefore(spineIndex) + page,
      atBookEnd: onEndSlot() && spineIndex === lastSpine(),
      anchor: anchorFor(),
      chapters: engineChapters(),
      pace,
    });
    emitter.emit('reader:locationchange', loc);
    emitter.emit('reader:progress', progress);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
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
    if (showing && book) {
      renderEndCardDom({
        doc,
        endEl,
        book,
        spineIndex,
        lastSpine: lastSpine(),
        settings,
        chapterLabel,
        onRestart: () => runner.goto(0),
        onContents: () => emitter.emit('reader:endpage', endPagePayload(true)),
        onContinue: () => runner.turn('forward'),
      });
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
    if (fixedLayoutActive())
      return applyFixedLayoutTransform(frame.contentDocument, flowEl(), root);
    const l = layout();
    if (flowActive()) {
      const vp = viewportEl();
      if (vp) transitions.scrollTo(vp, 'scrollTop', page * (vp.clientHeight || 0), reduced());
      return;
    }
    const flow = flowEl();
    if (!flow) return;
    const x = l.vertical ? page * l.pageStep : offsetForPage(page, l.pageStep);
    transitions.page(flow, pageOffset, x, { axis: 'x', dir, reduced: reduced() });
    pageOffset = x;
  };

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

  const measure = () => {
    if (fixedLayoutActive()) {
      spinePageCount = 1;
    } else if (flowActive()) {
      const vp = viewportEl();
      const h = vp?.clientHeight || 1;
      spinePageCount = Math.max(1, Math.ceil((vp?.scrollHeight ?? h) / h));
      if (vp && vp !== scrollSyncEl) {
        scrollSyncEl?.removeEventListener('scroll', onFlowScroll);
        vp.addEventListener('scroll', onFlowScroll, { passive: true });
        scrollSyncEl = vp;
      }
    } else {
      const flow = flowEl();
      if (!flow) return;
      spinePageCount = pageCountFor(flow.scrollWidth, layout().pageStep);
    }
    spinePages[spineIndex] = spinePageCount;
    page = Math.min(page, maxPage());
    applyPage();
  };

  const injectStyle = () => {
    if (frame.contentDocument)
      injectTextStyle({
        cdoc: frame.contentDocument,
        fontFaceCss: options.fontFaceCss,
        settings,
        layout: layout(),
        direction: book?.metadata.direction ?? 'ltr',
        fixedLayout: fixedLayoutActive(),
        fixedPageSize: fixedPageSizeFor(frame.contentDocument),
        flow: flowActive(),
      });
  };

  const tts = new TextTtsCoordinator({
    synth:
      options.tts?.synth ??
      (typeof speechSynthesis !== 'undefined'
        ? (speechSynthesis as unknown as TtsSynthLike)
        : null),
    createUtterance:
      options.tts?.createUtterance ??
      ((text: string) => new SpeechSynthesisUtterance(text) as unknown as TtsUtteranceLike),
    getDocument: () => frame.contentDocument,
    getSpineIndex: () => spineIndex,
    getSpinePageCount: () => spinePageCount,
    getCurrentPage: () => page,
    getPageStep: () => layout().pageStep,
    relRectOf,
    isPagingEligible: () => !fixedLayoutActive() && !flowActive() && !layout().vertical,
    onNavigateToPage: (target) => {
      transitions.cancel();
      page = target;
      renderView();
      emitLocation();
    },
    advanceSpine: async (): Promise<boolean> => {
      if (!book || spineIndex >= lastSpine()) return false;
      await runner.renderSpine(spineIndex + 1);
      return true;
    },
    onStateChange: (state) => emitter.emit('reader:ttsstate', state),
  });

  const inputCtrl = createTextInputController({
    root,
    doc,
    getDocument: () => frame.contentDocument,
    getBook: () => book,
    getSettings: () => settings,
    isVertical: () => layout().vertical,
    totalPages,
    currentHref: () => book?.spine[spineIndex]?.href ?? '',
    turn: (dir) => runner.turn(dir),
    goto: (target) => runner.goto(target),
    onSelectionChange: hlCtrl.onSelectionChange,
    onChromeToggle: (visible) => emitter.emit('reader:chrometoggle', { visible }),
    onOpenFootnote: (href) => {
      const safeHtml = extractFootnoteHtml({
        href,
        currentHref: book?.spine[spineIndex]?.href ?? '',
        cdoc: frame.contentDocument,
        book,
        parser,
      });
      if (safeHtml) emitter.emit('reader:footnote', { html: safeHtml, href });
    },
    onGotoRelativeHref: (href, fromHref) => {
      if (!book) return;
      const [pathPart, frag] = href.split('#');
      runner.jumpToResolvedHref(
        stripHash(pathPart ? resolveHref(dirOf(fromHref), pathPart) : fromHref),
        frag,
      );
    },
  });

  const runner = createTextSpineRunner({
    frame,
    parser,
    getBook: () => book,
    getSettings: () => settings,
    setSettingsState: (next) => (settings = next),
    getSpineIndex: () => spineIndex,
    setSpineIndex: (idx) => (spineIndex = idx),
    getPage: () => page,
    setPage: (p) => (page = p),
    setPageOffset: (off) => (pageOffset = off),
    getSpinePageCount: () => spinePageCount,
    maxPage,
    lastSpine,
    effectivePages,
    onEndSlot,
    fixedLayoutActive,
    flowActive,
    layout,
    flowEl,
    viewportEl,
    relRectOf,
    relRangeRectOf,
    isDestroyed: () => destroyed,
    injectStyle,
    measure,
    renderView,
    applyPage,
    applyHighlights: hlCtrl.applyHighlights,
    emitLocation,
    wireFrameLinks: inputCtrl.wireFrameLinks,
    wireFrameInput: inputCtrl.wireFrameInput,
    syncHandle: inputCtrl.syncHandle,
    stopTts: () => tts.stop(),
    cancelTransitions: () => transitions.cancel(),
    emit: (ev, payload) => emitter.emit(ev, payload),
  });

  const search = new SearchController(
    options.searchWorkerFactory !== undefined ? { workerFactory: options.searchWorkerFactory } : {},
  );
  let searchBuilt: Promise<void> | null = null;
  const runSearch = async (query: string): Promise<SearchHit[]> => {
    if (!book) return [];
    searchBuilt ??= search.build(buildSearchSections(book, parser));
    await searchBuilt;
    const hits = await search.query(query, { limit: 300 });
    emitter.emit('reader:searchresults', { query, hits });
    return hits;
  };

  async function mount(): Promise<void> {
    const manifest = await source.getManifest(bookId);
    if (destroyed) return;
    if (manifest.type !== 'epub')
      throw new Error(`createTextEngine: "${bookId}" is a ${manifest.type} book, not an EPUB`);
    const blob = await source.getFile(bookId);
    if (destroyed) return;
    const arrayBuffer = await blob.arrayBuffer();
    if (destroyed) return;
    book = parseEpub(new Uint8Array(arrayBuffer), { domParser: parser });
    spinePages = new Array(book.spine.length).fill(undefined);

    container.replaceChildren(root);
    inputCtrl.wireRootInput();
    inputCtrl.syncHandle();
    if (typeof ResizeObserver !== 'undefined') {
      let raf = 0;
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(runner.reflowKeepingPlace);
      });
      resizeObserver.observe(root);
    }

    const restore = await source.loadProgress(bookId).catch(() => null);
    if (destroyed) return;
    emitter.emit('reader:resumed', { position: restore });
    emitter.emit('reader:toc', { toc: book.toc });

    const loadedHl = await (source.loadHighlights?.(bookId) ?? Promise.resolve([])).catch(() => []);
    if (destroyed) return;
    hlCtrl.setHighlights(loadedHl);
    emitter.emit('reader:highlightschange', { highlights: hlCtrl.listHighlights() });

    const startSpine =
      restore?.type === 'anchor' ? Math.min(restore.spine, book.spine.length - 1) : 0;
    if (restore?.type === 'anchor') runner.setPendingAnchor(restore);
    await runner.renderSpine(startSpine);
    if (destroyed) return;
    emitter.emit('reader:chrometoggle', { visible: inputCtrl.getChromeVisible() });
    emitter.emit('reader:ready', {
      metadata: book.metadata,
      spineCount: book.spine.length,
      vertical: verticalActive(),
      flow: flowActive(),
    });
  }

  function destroy(): void {
    flushSave();
    flushSaveHighlights();
    tts.stop();
    destroyed = true;
    inputCtrl.destroyInput();
    resizeObserver?.disconnect();
    if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
    hlCtrl.clearSelectionTimer();
    scrollSyncEl?.removeEventListener('scroll', onFlowScroll);
    transitions.cancel();
    runner.revokeUrls();
    search.destroy();
    emitter.clear();
    root.remove();
  }

  return {
    mount,
    goto: runner.goto,
    goToHref: runner.gotoResolvedHref,
    turn: runner.turn,
    setSettings: runner.setSettings,
    on: (ev, h) => emitter.on(ev, h),
    destroy,
    chapters: engineChapters,
    search: runSearch,
    gotoHit: runner.gotoHit,
    getCfi: () => computeCurrentCfi(frame.contentDocument, book, spineIndex, anchorFor()),
    goToCfi: runner.goToCfi,
    addHighlight: hlCtrl.addHighlight,
    removeHighlight: hlCtrl.removeHighlight,
    updateHighlight: hlCtrl.updateHighlight,
    listHighlights: hlCtrl.listHighlights,
    ttsPlay: () => tts.play(),
    ttsPause: () => tts.pause(),
    ttsResume: () => tts.resume(),
    ttsStop: () => tts.stop(),
    ttsSetRate: (rate: number) => tts.setRate(rate),
    ttsSetVoice: (voice: TtsVoiceLike | null) => tts.setVoice(voice),
    ttsListVoices: () => tts.listVoices(),
    ttsState: (): TtsState => tts.getState(),
  };
}
