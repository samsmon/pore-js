import type { Position } from '../position/types.js';
import type { EpubBook } from './epub/types.js';
import { stripHash } from './epub/path.js';
import { rewriteResources } from './rewrite.js';
import { parseCfi, type ParsedCfi } from './cfi.js';
import type { SearchHit } from '../search/search-index.js';
import type { RectOf, RangeRectOf } from './anchor.js';
import type { TextLayout } from './paginate.js';
import type { TextEngineEvents, TextEngineSettings } from './types.js';
import { resolveAnchorToPage, resolveCfiToAnchor, wrapContent } from './text-dom-helpers.js';
import { landOnFragmentInDoc, landOnSearchHitInDoc } from './text-navigation-helpers.js';

export interface TextSpineRunnerDeps {
  frame: HTMLIFrameElement;
  parser: DOMParser;
  getBook: () => EpubBook | null;
  getSettings: () => TextEngineSettings;
  setSettingsState: (next: TextEngineSettings) => void;
  getSpineIndex: () => number;
  setSpineIndex: (idx: number) => void;
  getPage: () => number;
  setPage: (p: number) => void;
  setPageOffset: (off: number) => void;
  getSpinePageCount: () => number;
  maxPage: () => number;
  lastSpine: () => number;
  effectivePages: (i: number) => number;
  onEndSlot: () => boolean;
  fixedLayoutActive: () => boolean;
  flowActive: () => boolean;
  layout: () => TextLayout;
  flowEl: () => HTMLElement | null;
  viewportEl: () => HTMLElement | null;
  relRectOf: RectOf;
  relRangeRectOf: RangeRectOf;
  isDestroyed: () => boolean;
  injectStyle: () => void;
  measure: () => void;
  renderView: (dir?: -1 | 0 | 1) => void;
  applyPage: (dir?: -1 | 0 | 1) => void;
  applyHighlights: () => void;
  emitLocation: () => void;
  wireFrameLinks: () => void;
  wireFrameInput: () => void;
  syncHandle: () => void;
  stopTts: () => void;
  cancelTransitions: () => void;
  emit: <E extends keyof TextEngineEvents>(ev: E, payload: TextEngineEvents[E]) => void;
}

export function createTextSpineRunner(deps: TextSpineRunnerDeps) {
  let spineRenderToken = 0;
  let pendingAnchor: Extract<Position, { type: 'anchor' }> | null = null;
  let pendingCfi: ParsedCfi | null = null;
  let objectUrls: string[] = [];

  const revokeUrls = (): void => {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls = [];
  };

  const resolvePendingCfi = (): void => {
    const cdoc = deps.frame.contentDocument;
    const spineIndex = deps.getSpineIndex();
    if (!cdoc || !pendingCfi || pendingCfi.spineIndex !== spineIndex) return;
    const parsed = pendingCfi;
    pendingCfi = null;
    pendingAnchor = resolveCfiToAnchor(cdoc, parsed, spineIndex);
  };

  const resolvePendingAnchor = (): void => {
    const cdoc = deps.frame.contentDocument;
    const spineIndex = deps.getSpineIndex();
    if (!cdoc || !pendingAnchor || pendingAnchor.spine !== spineIndex) return;
    const anchor = pendingAnchor;
    pendingAnchor = null;
    deps.setPage(
      resolveAnchorToPage(cdoc, anchor, {
        fixedLayout: deps.fixedLayoutActive(),
        flowEl: deps.flowEl(),
        spinePageCount: deps.getSpinePageCount(),
        pageStep: deps.layout().pageStep,
        byPercent: deps.layout().vertical || deps.flowActive(),
        relRectOf: deps.relRectOf,
        relRangeRectOf: deps.relRangeRectOf,
      }),
    );
  };

  const renderSpine = (idx: number, atLastPage = false): Promise<void> => {
    const book = deps.getBook();
    if (!book) return Promise.resolve();
    const spineItem = book.spine[idx];
    if (!spineItem) return Promise.resolve();
    const token = ++spineRenderToken;
    deps.setSpineIndex(idx);
    deps.emit('reader:loadingstate', { spine: idx, state: 'loading' });

    revokeUrls();
    const res = book.resource(spineItem.href);
    const source_ = res ? new TextDecoder().decode(res.bytes) : '<p>(missing chapter)</p>';
    const { html, urls } = rewriteResources(source_, book, spineItem.href, deps.parser, {
      stripAuthorCss: !deps.fixedLayoutActive() && !deps.getSettings().publisherStyles,
    });
    objectUrls = urls;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        clearTimeout(timer);
        deps.frame.removeEventListener('load', finish);
        if (settled) return;
        settled = true;
        if (deps.isDestroyed() || token !== spineRenderToken) {
          resolve();
          return;
        }
        wrapContent(deps.frame.contentDocument);
        deps.injectStyle();
        deps.measure();
        deps.setPage(atLastPage ? Math.max(0, deps.getSpinePageCount() - 1) : 0);
        resolvePendingCfi();
        resolvePendingAnchor();
        deps.renderView();
        deps.applyHighlights();
        deps.emit('reader:loadingstate', { spine: idx, state: 'loaded' });
        deps.emitLocation();
        resolve();
      };
      deps.frame.addEventListener('load', finish, { once: true });
      const timer = setTimeout(() => {
        if (!deps.frame.contentDocument || deps.frame.contentDocument.readyState === 'complete') {
          finish();
        }
      }, 60);
      deps.frame.srcdoc = html;
    }).then(() => {
      if (deps.isDestroyed() || token !== spineRenderToken) return;
      deps.wireFrameLinks();
      deps.wireFrameInput();
    });
  };

  const jumpToResolvedHref = (targetPath: string, frag: string | undefined): void => {
    const book = deps.getBook();
    if (!book) return;
    const idx = book.spine.findIndex((s) => s.href === targetPath);
    if (idx === -1) return;
    const jump = () => {
      const res = landOnFragmentInDoc({
        cdoc: deps.frame.contentDocument,
        frag,
        spinePageCount: deps.getSpinePageCount(),
        flow: deps.flowActive(),
        layout: deps.layout(),
        viewportEl: deps.viewportEl(),
        flowEl: deps.flowEl(),
        cancelTransitions: deps.cancelTransitions,
        relRectOf: deps.relRectOf,
      });
      if (res.resetOffset) deps.setPageOffset(0);
      deps.setPage(res.page);
      deps.applyPage();
      deps.emitLocation();
    };
    if (idx === deps.getSpineIndex()) jump();
    else void renderSpine(idx).then(jump);
  };

  const gotoResolvedHref = (href: string): void => {
    const book = deps.getBook();
    if (!book) return;
    const [pathPart, frag] = href.split('#');
    const currentHref = book.spine[deps.getSpineIndex()]?.href ?? '';
    jumpToResolvedHref(stripHash(pathPart || currentHref), frag);
  };

  const gotoHit = (hit: SearchHit): void => {
    const book = deps.getBook();
    if (!book) return;
    const idx = book.spine.findIndex(
      (_, i) => (book.spine[i]?.idref ?? String(i)) === hit.sectionId,
    );
    if (idx < 0) return;
    const land = () => {
      const cdoc = deps.frame.contentDocument;
      if (!cdoc) return;
      const res = landOnSearchHitInDoc({
        cdoc,
        hitStart: hit.start,
        spinePageCount: deps.getSpinePageCount(),
        flow: deps.flowActive(),
        layout: deps.layout(),
        viewportEl: deps.viewportEl(),
        flowEl: deps.flowEl(),
        cancelTransitions: deps.cancelTransitions,
        relRectOf: deps.relRectOf,
        fallbackPage: deps.getPage(),
      });
      if (res.resetOffset) deps.setPageOffset(0);
      deps.setPage(res.page);
      deps.renderView();
      deps.emitLocation();
    };
    if (idx === deps.getSpineIndex()) land();
    else void renderSpine(idx).then(land);
  };

  const turn = (dir: 'forward' | 'back'): void => {
    if (!deps.getBook()) return;
    deps.stopTts();
    const delta = dir === 'forward' ? 1 : -1;
    const next = deps.getPage() + delta;
    if (next >= 0 && next <= deps.maxPage()) {
      deps.cancelTransitions();
      deps.setPage(next);
      deps.renderView(delta);
      deps.emitLocation();
      return;
    }
    const spineIndex = deps.getSpineIndex();
    if (next < 0) {
      if (spineIndex === 0) deps.emit('reader:start', {});
      else void renderSpine(spineIndex - 1, true);
      return;
    }
    if (spineIndex === deps.lastSpine()) deps.emit('reader:end', {});
    else void renderSpine(spineIndex + 1, false);
  };

  const goToCfi = (cfi: string): void => {
    const book = deps.getBook();
    if (!book) return;
    const parsed = parseCfi(cfi);
    if (!parsed) return;
    deps.stopTts();
    const idx = Math.min(Math.max(parsed.spineIndex, 0), book.spine.length - 1);
    pendingCfi = { ...parsed, spineIndex: idx };
    if (idx === deps.getSpineIndex()) {
      deps.cancelTransitions();
      resolvePendingCfi();
      resolvePendingAnchor();
      deps.renderView();
      deps.emitLocation();
    } else {
      void renderSpine(idx);
    }
  };

  const goto = (target: number | Position): void => {
    const book = deps.getBook();
    if (!book) return;
    deps.stopTts();
    if (typeof target === 'object') {
      if (target.type === 'anchor') {
        const idx = Math.min(target.spine, book.spine.length - 1);
        pendingAnchor = target;
        if (idx === deps.getSpineIndex()) {
          resolvePendingAnchor();
          deps.renderView();
          deps.emitLocation();
        } else {
          void renderSpine(idx);
        }
      }
      return;
    }
    let acc = 0;
    for (let i = 0; i < book.spine.length; i++) {
      const eff = deps.effectivePages(i);
      if (target < acc + eff || i === deps.lastSpine()) {
        const localPage = Math.max(0, target - acc);
        const land = () => {
          deps.setPage(Math.min(localPage, deps.maxPage()));
          deps.renderView();
          deps.emitLocation();
        };
        if (i === deps.getSpineIndex()) land();
        else void renderSpine(i).then(land);
        return;
      }
      acc += eff;
    }
  };

  const reflowKeepingPlace = (): void => {
    const wasEnd = deps.onEndSlot();
    const count = deps.getSpinePageCount();
    const frac = count > 0 ? deps.getPage() / count : 0;
    deps.injectStyle();
    deps.measure();
    const nextCount = deps.getSpinePageCount();
    deps.setPage(
      wasEnd
        ? nextCount
        : Math.min(Math.max(Math.round(frac * nextCount), 0), Math.max(0, nextCount - 1)),
    );
    deps.renderView();
    deps.emitLocation();
  };

  const setSettings = (patch: Partial<TextEngineSettings>): void => {
    const prev = deps.getSettings();
    const next = { ...prev, ...patch };
    deps.setSettingsState(next);
    if (next.publisherStyles !== prev.publisherStyles) {
      void renderSpine(deps.getSpineIndex());
    } else if (next.verticalText !== prev.verticalText || next.flowMode !== prev.flowMode) {
      deps.cancelTransitions();
      deps.injectStyle();
      deps.measure();
      deps.setPage(0);
      deps.setPageOffset(0);
      deps.renderView();
      deps.emitLocation();
    } else {
      reflowKeepingPlace();
    }
    if (next.chromeGesture !== prev.chromeGesture) deps.syncHandle();
    deps.emit('reader:settingschange', { settings: next });
  };

  return {
    setPendingAnchor: (a: Extract<Position, { type: 'anchor' }> | null) => {
      pendingAnchor = a;
    },
    revokeUrls,
    renderSpine,
    jumpToResolvedHref,
    gotoResolvedHref,
    gotoHit,
    turn,
    goToCfi,
    goto,
    reflowKeepingPlace,
    setSettings,
  };
}
