/**
 * Marquee → rect-highlight overlay for the PDF engine. The image engine renders
 * each page as a plain `<img>`; this hangs a transparent layer over the page,
 * turns a **Shift+drag** into a normalized box + the text it covers, and paints
 * persisted highlights back over the right page.
 *
 * Scope: single-page (`paged-single`) mode only — the common PDF case. In
 * continuous / double / zoomed modes the overlay hides and highlights simply
 * aren't painted (they stay persisted). Same pragmatic limit as the text
 * engine's `<mark>` fallback for cross-element ranges.
 */
import type { NormRect, RectHighlightRecord } from '../source/types.js';

type TextRect = { str: string; x: number; y: number; w: number; h: number };

export interface PdfHighlightOverlayOptions {
  container: HTMLElement;
  textRects: (page1: number) => Promise<TextRect[]>;
  /** Current 0-based page. */
  currentPage: () => number;
  onSelection: (sel: { rect: DOMRect; text: string } | null) => void;
}

const MARQUEE_MIN_PX = 6;

function intersects(a: NormRect, b: NormRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function createPdfHighlightOverlay(opts: PdfHighlightOverlayOptions) {
  const { container, textRects, currentPage, onSelection } = opts;
  const doc = container.ownerDocument;

  const layer = doc.createElement('div');
  layer.className = 'pore-pdf-hl';
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';

  const marquee = doc.createElement('div');
  marquee.className = 'pore-pdf-hl__marquee';
  marquee.style.cssText =
    'position:absolute;border:1px solid rgba(80,130,255,.9);background:rgba(80,130,255,.18);display:none;';
  layer.appendChild(marquee);

  let highlights: RectHighlightRecord[] = [];
  let textCache = new Map<number, TextRect[]>();
  /** The box a Shift+drag produced, normalized to the page, awaiting `commit()`. */
  let pending: { page: number; rects: NormRect[]; text: string } | null = null;

  /** The single rendered page `<img>`, or null when not in single-page mode. */
  const pageImg = (): HTMLImageElement | null => {
    const imgs = container.querySelectorAll<HTMLImageElement>('.pore-image__viewport img');
    return imgs.length === 1 ? imgs[0]! : null;
  };

  /** Page-image box relative to the container. */
  const pageBox = (): { left: number; top: number; width: number; height: number } | null => {
    const img = pageImg();
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    const c = container.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height };
  };

  const paint = () => {
    // native <img> drag would otherwise hijack a Shift+drag (and can navigate
    // the page to the blob URL)
    const img = pageImg();
    if (img) img.draggable = false;
    const box = pageBox();
    for (const el of [...layer.querySelectorAll('.pore-pdf-hl__box')]) el.remove();
    if (!box) {
      layer.style.display = 'none';
      return;
    }
    layer.style.display = '';
    // `inset` is shorthand for top/right/bottom/left — clear it first, then set
    // the two edges we position from (order matters)
    layer.style.inset = 'auto';
    layer.style.left = `${box.left}px`;
    layer.style.top = `${box.top}px`;
    layer.style.width = `${box.width}px`;
    layer.style.height = `${box.height}px`;
    const page = currentPage();
    for (const h of highlights) {
      if (h.page !== page) continue;
      for (const r of h.rects) {
        const el = doc.createElement('div');
        el.className = 'pore-pdf-hl__box';
        el.style.cssText = `position:absolute;left:${r.x * 100}%;top:${r.y * 100}%;width:${
          r.w * 100
        }%;height:${r.h * 100}%;background:${h.color};mix-blend-mode:multiply;pointer-events:none;`;
        layer.appendChild(el);
      }
    }
  };

  // ---- Shift+drag marquee ---------------------------------------------------

  let dragging: { x0: number; y0: number } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (!e.shiftKey || e.button !== 0) return;
    const box = pageBox();
    if (!box) return;
    const c = container.getBoundingClientRect();
    const px = e.clientX - c.left - box.left;
    const py = e.clientY - c.top - box.top;
    if (px < 0 || py < 0 || px > box.width || py > box.height) return;
    e.preventDefault();
    dragging = { x0: px, y0: py };
    marquee.style.display = 'block';
    marquee.style.left = `${px}px`;
    marquee.style.top = `${py}px`;
    marquee.style.width = '0px';
    marquee.style.height = '0px';
    container.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const box = pageBox();
    if (!box) return;
    const c = container.getBoundingClientRect();
    const px = Math.max(0, Math.min(box.width, e.clientX - c.left - box.left));
    const py = Math.max(0, Math.min(box.height, e.clientY - c.top - box.top));
    marquee.style.left = `${Math.min(px, dragging.x0)}px`;
    marquee.style.top = `${Math.min(py, dragging.y0)}px`;
    marquee.style.width = `${Math.abs(px - dragging.x0)}px`;
    marquee.style.height = `${Math.abs(py - dragging.y0)}px`;
  };

  const onPointerUp = async (e: PointerEvent) => {
    if (!dragging) return;
    const start = dragging;
    dragging = null;
    marquee.style.display = 'none';
    const box = pageBox();
    if (!box) return;
    const c = container.getBoundingClientRect();
    const px = Math.max(0, Math.min(box.width, e.clientX - c.left - box.left));
    const py = Math.max(0, Math.min(box.height, e.clientY - c.top - box.top));
    if (Math.abs(px - start.x0) < MARQUEE_MIN_PX && Math.abs(py - start.y0) < MARQUEE_MIN_PX) {
      onSelection(null);
      return;
    }
    const sel: NormRect = {
      x: Math.min(px, start.x0) / box.width,
      y: Math.min(py, start.y0) / box.height,
      w: Math.abs(px - start.x0) / box.width,
      h: Math.abs(py - start.y0) / box.height,
    };
    const page = currentPage();
    let items = textCache.get(page);
    if (!items) {
      items = await textRects(page + 1).catch(() => []);
      textCache.set(page, items);
    }
    const hit = items.filter((it) => intersects(sel, it));
    const text = hit
      .map((it) => it.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    // tighten the stored boxes to the covered lines when we matched text
    const rects: NormRect[] = hit.length
      ? mergeRows(hit.map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h })))
      : [sel];
    pending = { page, rects, text };
    onSelection({
      rect: new DOMRect(
        c.left + box.left + sel.x * box.width,
        c.top + box.top + sel.y * box.height,
        sel.w * box.width,
        sel.h * box.height,
      ),
      text,
    });
  };

  const onDragStart = (e: Event) => {
    if (dragging) e.preventDefault();
  };
  // the page <img> swaps its src on every turn; repaint once it has painted
  const onLoadCapture = (e: Event) => {
    if ((e.target as HTMLElement).tagName === 'IMG') paint();
  };
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', (e) => void onPointerUp(e));
  container.addEventListener('dragstart', onDragStart);
  container.addEventListener('load', onLoadCapture, true);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paint()) : null;
  ro?.observe(container);

  return {
    layer,
    /** Mount the overlay into the rendered page container (call after the engine has mounted). */
    attach() {
      const pore = container.querySelector('.pore-image');
      (pore ?? container).appendChild(layer);
      paint();
    },
    repaint: paint,
    setHighlights(next: RectHighlightRecord[]) {
      highlights = next;
      paint();
    },
    /** Consume the pending Shift+drag selection into a record body (id/meta added by the caller). */
    takePending(): { page: number; rects: NormRect[]; text: string } | null {
      const p = pending;
      pending = null;
      return p;
    },
    clearPending() {
      pending = null;
      onSelection(null);
    },
    destroy() {
      ro?.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('dragstart', onDragStart);
      container.removeEventListener('load', onLoadCapture, true);
      layer.remove();
      textCache = new Map();
    },
  };
}

/** Merge text-item boxes that sit on the same line into one row rect each. */
function mergeRows(rects: NormRect[]): NormRect[] {
  const rows: NormRect[] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((q) => Math.abs(q.y - r.y) < r.h * 0.6);
    if (row) {
      const x1 = Math.min(row.x, r.x);
      const x2 = Math.max(row.x + row.w, r.x + r.w);
      row.x = x1;
      row.w = x2 - x1;
      row.y = Math.min(row.y, r.y);
      row.h = Math.max(row.h, r.h);
    } else {
      rows.push({ ...r });
    }
  }
  return rows;
}
