import type { Position } from '../position/types.js';
import type { Chapter } from '../reader-engine.js';
import { type PaceEstimator, chapterProgress } from '../progress.js';
import type { EpubBook } from './epub/types.js';
import {
  blockElements,
  generateAnchor,
  pageForElement,
  type Rect,
  type RectOf,
  type RangeRectOf,
} from './anchor.js';
import { serializeCfi } from './cfi.js';
import { FLOW_ID, VIEWPORT_ID, type TextLayout } from './paginate.js';
import { blockForOffset, chapterLabelForBook } from './text-dom-helpers.js';

export function createTextDomShell(doc: Document): {
  root: HTMLDivElement;
  frame: HTMLIFrameElement;
  endEl: HTMLDivElement;
} {
  const root = doc.createElement('div');
  root.className = 'pore-text';
  root.tabIndex = 0;
  root.style.cssText =
    'position:relative;width:100%;height:100%;outline:none;overflow:hidden;touch-action:manipulation;';
  const frame = doc.createElement('iframe');
  frame.className = 'pore-text__frame';
  frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent;';
  root.appendChild(frame);
  const endEl = doc.createElement('div');
  endEl.className = 'pore-text__end';
  endEl.style.cssText =
    'position:absolute;inset:0;display:none;flex-direction:column;gap:1rem;align-items:center;justify-content:center;text-align:center;padding:2rem;z-index:2;';
  root.appendChild(endEl);
  return { root, frame, endEl };
}

export function getFlowEl(frame: HTMLIFrameElement): HTMLElement | null {
  return (frame.contentDocument?.getElementById(FLOW_ID) as HTMLElement | null) ?? null;
}

export function getViewportEl(frame: HTMLIFrameElement): HTMLElement | null {
  return (frame.contentDocument?.getElementById(VIEWPORT_ID) as HTMLElement | null) ?? null;
}

export function createViewportRectHelpers(frame: HTMLIFrameElement): {
  relRectOf: RectOf;
  relRangeRectOf: RangeRectOf;
} {
  const viewportLeft = (): number => getViewportEl(frame)?.getBoundingClientRect().left ?? 0;
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
  return { relRectOf, relRangeRectOf };
}

export function computeCurrentAnchor(opts: {
  cdoc: Document | null;
  fixedLayout: boolean;
  spineIndex: number;
  page: number;
  spinePageCount: number;
  total: number;
  bookPageBeforeSpine: number;
  pageWidth: number;
  relRectOf: RectOf;
  relRangeRectOf: RangeRectOf;
}): Position {
  const {
    cdoc,
    fixedLayout,
    spineIndex,
    page,
    spinePageCount,
    total,
    bookPageBeforeSpine,
    pageWidth,
    relRectOf,
    relRangeRectOf,
  } = opts;
  const bookPercent = total > 0 ? (bookPageBeforeSpine + page) / total : 0;
  if (!cdoc || fixedLayout) {
    return { type: 'anchor', spine: spineIndex, block: 0, offset: 0, percent: bookPercent };
  }
  return generateAnchor(
    cdoc,
    {
      spine: spineIndex,
      page,
      spinePages: spinePageCount,
      bookPercent,
      pageWidth,
    },
    relRectOf,
    relRangeRectOf,
  );
}

export function computeCurrentCfi(
  cdoc: Document | null,
  book: EpubBook | null,
  spineIndex: number,
  anchor: Position,
): string | null {
  if (!cdoc || !book || anchor.type !== 'anchor') return null;
  const el = blockElements(cdoc)[anchor.block];
  if (!el) return null;
  const idref = book.spine[spineIndex]?.idref ?? String(spineIndex);
  return serializeCfi(cdoc, spineIndex, idref, el, anchor.offset);
}

export function buildEngineChapters(
  book: EpubBook | null,
  total: number,
  bookPageBefore: (i: number) => number,
): Chapter[] {
  if (!book) return [];
  return book.spine.map((s, i) => {
    const startPage = bookPageBefore(i);
    return {
      id: s.idref ?? String(i),
      label: chapterLabelForBook(book, i),
      startPage,
      startPercent: total > 0 ? startPage / total : 0,
    };
  });
}

export function buildLocationAndProgress(opts: {
  book: EpubBook;
  spineIndex: number;
  page: number;
  total: number;
  bookPage: number;
  atBookEnd: boolean;
  anchor: Position;
  chapters: Chapter[];
  pace: PaceEstimator;
}) {
  const { book, spineIndex, total, bookPage, atBookEnd, anchor, chapters, pace } = opts;
  const percent = atBookEnd ? 1 : total > 0 ? bookPage / total : 0;
  const ch = chapterLabelForBook(book, spineIndex);
  const loc = {
    position: anchor,
    page: bookPage,
    total,
    percent,
    label: `${ch} · ${Math.round(percent * 100)}%`,
    chapter: book.spine[spineIndex]?.idref ?? String(spineIndex),
  };
  pace.mark();
  const cp = chapterProgress(chapters, bookPage, total);
  const progress = {
    locator: loc,
    percent,
    chapterLabel: cp.label || ch,
    chapterIndex: cp.index,
    chapterCount: chapters.length,
    pagesLeftInChapter: cp.pagesLeftInChapter,
    minutesLeft: pace.minutesLeft(Math.max(0, total - 1 - bookPage)),
    page: loc.page,
    pageCount: total,
  };
  return { loc, progress };
}

export function landOnSearchHitInDoc(opts: {
  cdoc: Document;
  hitStart: number;
  spinePageCount: number;
  flow: boolean;
  layout: TextLayout;
  viewportEl: HTMLElement | null;
  flowEl: HTMLElement | null;
  cancelTransitions: () => void;
  relRectOf: RectOf;
  fallbackPage: number;
}): { page: number; resetOffset: boolean } {
  const { cdoc, hitStart, spinePageCount, flow, layout, viewportEl, flowEl, relRectOf } = opts;
  const { el, fraction } = blockForOffset(cdoc, hitStart);
  const last = Math.max(0, spinePageCount - 1);
  if (flow) {
    el?.scrollIntoView({ block: 'start' });
    const page = viewportEl
      ? Math.round(viewportEl.scrollTop / (viewportEl.clientHeight || 1))
      : Math.round(fraction * last);
    return { page, resetOffset: false };
  }
  let resetOffset = false;
  if (flowEl) {
    opts.cancelTransitions();
    flowEl.style.transform = 'translateX(0)';
    resetOffset = true;
  }
  const page = layout.vertical
    ? Math.min(Math.round(fraction * last), last)
    : el
      ? Math.min(pageForElement(el, layout.pageStep, relRectOf), last)
      : opts.fallbackPage;
  return { page, resetOffset };
}

export function landOnFragmentInDoc(opts: {
  cdoc: Document | null;
  frag: string | undefined;
  spinePageCount: number;
  flow: boolean;
  layout: TextLayout;
  viewportEl: HTMLElement | null;
  flowEl: HTMLElement | null;
  cancelTransitions: () => void;
  relRectOf: RectOf;
}): { page: number; resetOffset: boolean } {
  const { cdoc, frag, spinePageCount, flow, layout, viewportEl, flowEl, relRectOf } = opts;
  const el = frag && cdoc ? cdoc.getElementById(frag) : null;
  if (el && cdoc && flow) {
    el.scrollIntoView({ block: 'start' });
    const page = viewportEl ? Math.round(viewportEl.scrollTop / (viewportEl.clientHeight || 1)) : 0;
    return { page, resetOffset: false };
  }
  if (el && cdoc && !layout.vertical) {
    let resetOffset = false;
    if (flowEl) {
      opts.cancelTransitions();
      flowEl.style.transform = 'translateX(0)';
      resetOffset = true;
    }
    const page = Math.min(
      pageForElement(el, layout.pageStep, relRectOf),
      Math.max(0, spinePageCount - 1),
    );
    return { page, resetOffset };
  }
  return { page: 0, resetOffset: false };
}
