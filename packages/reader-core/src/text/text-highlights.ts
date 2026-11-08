import { blockElements, type Rect } from './anchor.js';
import { serializeCfi } from './cfi.js';
import { highlightRangeFromSelection, rangeForHighlight } from './highlight.js';
import type { EpubBook } from './epub/types.js';
import type { HighlightRange, HighlightRecord } from '../source/types.js';

export const SAFE_HIGHLIGHT_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;

export function sanitizeHighlightColor(color: string | undefined): string {
  return typeof color === 'string' && SAFE_HIGHLIGHT_COLOR_RE.test(color.trim())
    ? color.trim()
    : 'yellow';
}

const isNonNegInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function isValidHighlightRange(r: unknown): r is HighlightRange {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    isNonNegInt(o['spine']) &&
    isNonNegInt(o['startBlock']) &&
    isNonNegInt(o['startOffset']) &&
    isNonNegInt(o['endBlock']) &&
    isNonNegInt(o['endOffset'])
  );
}

const highlightName = (color: string): string => `pore-hl-${color.replace(/[^a-z0-9]/gi, '')}`;

/** Inject `::highlight(...)` rules for the CSS Custom Highlight API path. */
function ensureHighlightStyle(cdoc: Document, colors: string[]): void {
  let el = cdoc.getElementById('pore-highlight-style') as HTMLStyleElement | null;
  if (!el) {
    el = cdoc.createElement('style');
    el.id = 'pore-highlight-style';
    cdoc.head?.appendChild(el);
  }
  el.textContent = colors
    .map((c) => {
      const safe = sanitizeHighlightColor(c);
      return `::highlight(${highlightName(safe)}){background-color:${safe};color:inherit;}`;
    })
    .join('\n');
}

function clearMarkFallback(cdoc: Document): void {
  cdoc.querySelectorAll('mark.pore-highlight').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
}

interface HighlightWindow {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => unknown;
}

export interface TextHighlightControllerDeps {
  getDocument: () => Document | null;
  getBook: () => EpubBook | null;
  getSpineIndex: () => number;
  scheduleSave: () => void;
  onSelectionEmit: (payload: { rect: Rect; text: string } | null) => void;
  onHighlightsEmit: (highlights: HighlightRecord[]) => void;
}

export function createTextHighlightController(deps: TextHighlightControllerDeps) {
  let highlights: HighlightRecord[] = [];
  let pendingSelectionRange: Range | null = null;
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;

  const applyHighlights = (): void => {
    const cdoc = deps.getDocument();
    if (!cdoc) return;
    const spineIndex = deps.getSpineIndex();
    const blocks = blockElements(cdoc);
    const visible = highlights.filter(
      (h): h is Extract<HighlightRecord, { kind: 'text' }> =>
        h.kind === 'text' && isValidHighlightRange(h.range) && h.range.spine === spineIndex,
    );
    const win = cdoc.defaultView as unknown as HighlightWindow | null;
    if (win?.CSS?.highlights && win.Highlight) {
      win.CSS.highlights.clear();
      const byColor = new Map<string, Range[]>();
      for (const h of visible) {
        const r = rangeForHighlight(cdoc, blocks, h.range);
        if (!r) continue;
        const safeColor = sanitizeHighlightColor(h.color);
        const list = byColor.get(safeColor);
        if (list) list.push(r);
        else byColor.set(safeColor, [r]);
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
        mark.style.backgroundColor = sanitizeHighlightColor(h.color);
        r.surroundContents(mark);
      } catch {
        // a range spanning more than one element cannot be wrapped in a single <mark>
      }
    }
  };

  const onSelectionChange = (): void => {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const cdoc = deps.getDocument();
      const sel = cdoc?.getSelection?.();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        pendingSelectionRange = null;
        deps.onSelectionEmit(null);
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
      deps.onSelectionEmit({ rect, text: sel.toString() });
    }, 150);
  };

  const addHighlight = (opts?: { color?: string; note?: string }): HighlightRecord | null => {
    const cdoc = deps.getDocument();
    const book = deps.getBook();
    const spineIndex = deps.getSpineIndex();
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
      color: sanitizeHighlightColor(opts?.color),
      ...(opts?.note !== undefined ? { note: opts.note } : {}),
      text: pendingSelectionRange.toString(),
      createdAt: Date.now(),
    };
    highlights = [...highlights, highlight];
    pendingSelectionRange = null;
    cdoc.getSelection?.()?.removeAllRanges();
    deps.onSelectionEmit(null);
    applyHighlights();
    deps.scheduleSave();
    deps.onHighlightsEmit(highlights);
    return highlight;
  };

  const removeHighlight = (id: string): void => {
    const next = highlights.filter((h) => h.id !== id);
    if (next.length === highlights.length) return;
    highlights = next;
    applyHighlights();
    deps.scheduleSave();
    deps.onHighlightsEmit(highlights);
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
      ...(patch.color !== undefined ? { color: sanitizeHighlightColor(patch.color) } : {}),
    };
    if (patch.note !== undefined) {
      if (patch.note === '') delete next.note;
      else next.note = patch.note;
    }
    highlights = highlights.map((h, i) => (i === idx ? next : h));
    if (patch.color !== undefined) applyHighlights();
    deps.scheduleSave();
    deps.onHighlightsEmit(highlights);
    return next;
  };

  const setHighlights = (next: HighlightRecord[]): void => {
    highlights = next.map((h) =>
      h.kind === 'text' ? { ...h, color: sanitizeHighlightColor(h.color) } : h,
    );
  };

  const listHighlights = (): HighlightRecord[] => highlights;

  const clearSelectionTimer = (): void => {
    if (selectionTimer) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }
  };

  return {
    applyHighlights,
    onSelectionChange,
    addHighlight,
    removeHighlight,
    updateHighlight,
    setHighlights,
    listHighlights,
    clearSelectionTimer,
  };
}
