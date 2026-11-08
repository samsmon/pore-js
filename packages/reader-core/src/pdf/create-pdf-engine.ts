import { createImageEngine } from '../image/create-image-engine.js';
import type { ImageEngine, ImageEngineOptions } from '../image/engine.js';
import type { ImageEngineEvents } from '../image/types.js';
import type { TocEntry } from '../text/epub/types.js';
import { SearchController } from '../search/search-controller.js';
import type { SearchHit, SearchSection } from '../search/search-index.js';
import type { HighlightRecord, RectHighlightRecord } from '../source/types.js';
import { PdfImageSource, type PdfSourceOptions } from './pdf-source.js';
import { createPdfHighlightOverlay } from './pdf-highlights.js';

export interface CreatePdfEngineOptions extends Omit<ImageEngineOptions, 'source'> {
  source: ImageEngineOptions['source'];
  pdf?: PdfSourceOptions;
  /** Passed to the in-book `SearchController`. `false` forces synchronous search. */
  searchWorkerFactory?: (() => Worker) | false;
}

export interface PdfSelection {
  rect: DOMRect;
  text: string;
}

export interface PdfEngineEvents extends ImageEngineEvents {
  'reader:toc': { toc: TocEntry[] };
  'reader:searchresults': { query: string; hits: SearchHit[] };
  /** A Shift+drag marquee over the page, or `null` when it collapses / is consumed. */
  'reader:selection': PdfSelection | null;
  'reader:highlightschange': { highlights: HighlightRecord[] };
}

export interface PdfEngine extends Omit<ImageEngine, 'on'> {
  on<E extends keyof PdfEngineEvents>(
    event: E,
    handler: (payload: PdfEngineEvents[E]) => void,
  ): () => void;
  /** Navigate to a PDF outline href (`#page=N`, 1-based). */
  goToHref(href: string): void;
  /** Full-text search across the PDF (via pdf.js's per-page text layer). */
  search(query: string): Promise<SearchHit[]>;
  /** Jump to a hit's page. */
  gotoHit(hit: SearchHit): void;
  /** Turn the pending Shift+drag marquee into a rect highlight (`null` if none / not single-page). */
  addHighlight(opts?: { color?: string; note?: string }): HighlightRecord | null;
  removeHighlight(id: string): void;
  updateHighlight(id: string, patch: { color?: string; note?: string }): HighlightRecord | null;
  listHighlights(): HighlightRecord[];
}

/**
 * A PDF reader: the image engine driving pdf.js-rendered pages. Reuses every
 * image behaviour (paged/continuous, zoom/pan, fit, gestures, preload) and adds
 * the document outline as `reader:toc`, plus Shift+drag rect highlights over
 * the page (single-page mode).
 */
export function createPdfEngine(options: CreatePdfEngineOptions): PdfEngine {
  let destroyed = false;
  const pdfSource = new PdfImageSource(options.source, options.pdf);
  const engine = createImageEngine({ ...options, source: pdfSource });

  const tocListeners = new Set<(p: { toc: TocEntry[] }) => void>();
  const searchListeners = new Set<(p: { query: string; hits: SearchHit[] }) => void>();
  const selectionListeners = new Set<(p: PdfSelection | null) => void>();
  const highlightListeners = new Set<(p: { highlights: HighlightRecord[] }) => void>();
  let toc: TocEntry[] = [];

  // ---- highlights ----------------------------------------------------------

  const { source, bookId, container } = options;
  let highlights: RectHighlightRecord[] = [];
  let page = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const emitHighlights = () => {
    for (const l of highlightListeners) l({ highlights });
  };
  const scheduleSave = () => {
    if (!source.saveHighlights) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () => void source.saveHighlights?.(bookId, highlights).catch(() => {}),
      400,
    );
  };

  const overlay = createPdfHighlightOverlay({
    container,
    textRects: (p1) => pdfSource.textRects(p1),
    currentPage: () => page,
    onSelection: (sel) => {
      for (const l of selectionListeners) l(sel);
    },
  });

  const locOff = engine.on('reader:locationchange', (p) => {
    page = (p as { page: number }).page;
    overlay.repaint();
  });
  const zoomOff = engine.on('reader:zoomchange', () => overlay.repaint());
  const layoutOff = engine.on('reader:layoutchange', () => overlay.repaint());

  const readyOff = engine.on('reader:ready', (): void => {
    // the image engine calls container.replaceChildren(root) during mount, so
    // the overlay can only be attached once that has happened
    overlay.attach();
    void pdfSource.outline().then((o) => {
      if (destroyed) return;
      toc = o;
      for (const l of tocListeners) l({ toc });
    });
    void (async () => {
      const loaded = (await source.loadHighlights?.(bookId)) ?? [];
      if (destroyed) return;
      highlights = loaded.filter((h): h is RectHighlightRecord => h.kind === 'rect');
      overlay.setHighlights(highlights);
      emitHighlights();
    })();
  });

  const addHighlight = (opts?: { color?: string; note?: string }): HighlightRecord | null => {
    const pending = overlay.takePending();
    if (!pending) return null;
    const rec: RectHighlightRecord = {
      kind: 'rect',
      id: `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      page: pending.page,
      rects: pending.rects,
      color: opts?.color ?? 'yellow',
      ...(opts?.note !== undefined ? { note: opts.note } : {}),
      text: pending.text,
      createdAt: Date.now(),
    };
    highlights = [...highlights, rec];
    overlay.setHighlights(highlights);
    overlay.clearPending();
    scheduleSave();
    emitHighlights();
    return rec;
  };

  const removeHighlight = (id: string): void => {
    const next = highlights.filter((h) => h.id !== id);
    if (next.length === highlights.length) return;
    highlights = next;
    overlay.setHighlights(highlights);
    scheduleSave();
    emitHighlights();
  };

  const updateHighlight = (
    id: string,
    patch: { color?: string; note?: string },
  ): HighlightRecord | null => {
    const idx = highlights.findIndex((h) => h.id === id);
    if (idx === -1) return null;
    const next: RectHighlightRecord = {
      ...highlights[idx]!,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
    };
    if (patch.note !== undefined) {
      if (patch.note === '') delete next.note;
      else next.note = patch.note;
    }
    highlights = highlights.map((h, i) => (i === idx ? next : h));
    overlay.setHighlights(highlights);
    scheduleSave();
    emitHighlights();
    return next;
  };

  // ---- search -------------------------------------------------------------

  const search = new SearchController(
    options.searchWorkerFactory !== undefined ? { workerFactory: options.searchWorkerFactory } : {},
  );
  let searchBuilt: Promise<void> | null = null;

  const buildSearch = async (): Promise<void> => {
    const count = await pdfSource.pageCount();
    const sections: SearchSection[] = await Promise.all(
      Array.from({ length: count }, async (_, i) => ({
        id: `page:${i + 1}`,
        index: i,
        text: await pdfSource.textContent(i + 1),
      })),
    );
    await search.build(sections);
  };

  const runSearch = async (query: string): Promise<SearchHit[]> => {
    searchBuilt ??= buildSearch();
    await searchBuilt;
    const hits = await search.query(query, { limit: 300 });
    for (const l of searchListeners) l({ query, hits });
    return hits;
  };

  const gotoHit = (hit: SearchHit): void => engine.goto(hit.sectionIndex);

  const goToHref = (href: string): void => {
    const m = /(?:#|^)page=(\d+)/i.exec(href.trim());
    if (!m) return;
    const pageNum = Number(m[1]);
    if (Number.isFinite(pageNum) && pageNum >= 1) {
      engine.goto(pageNum - 1);
    }
  };

  const mount = async (): Promise<void> => {
    await engine.mount();
    if (destroyed) return;
  };

  return {
    ...engine,
    mount,
    goToHref,
    on(event, handler) {
      if (event === 'reader:toc') {
        const l = handler as unknown as (p: { toc: TocEntry[] }) => void;
        tocListeners.add(l);
        if (toc.length) l({ toc });
        return () => tocListeners.delete(l);
      }
      if (event === 'reader:searchresults') {
        const l = handler as unknown as (p: { query: string; hits: SearchHit[] }) => void;
        searchListeners.add(l);
        return () => searchListeners.delete(l);
      }
      if (event === 'reader:selection') {
        const l = handler as unknown as (p: PdfSelection | null) => void;
        selectionListeners.add(l);
        return () => selectionListeners.delete(l);
      }
      if (event === 'reader:highlightschange') {
        const l = handler as unknown as (p: { highlights: HighlightRecord[] }) => void;
        highlightListeners.add(l);
        l({ highlights });
        return () => highlightListeners.delete(l);
      }
      return engine.on(
        event as keyof ImageEngineEvents,
        handler as (p: ImageEngineEvents[keyof ImageEngineEvents]) => void,
      );
    },
    search: runSearch,
    gotoHit,
    addHighlight,
    removeHighlight,
    updateHighlight,
    listHighlights: () => highlights,
    destroy() {
      destroyed = true;
      readyOff();
      locOff();
      zoomOff();
      layoutOff();
      clearTimeout(saveTimer);
      overlay.destroy();
      tocListeners.clear();
      searchListeners.clear();
      selectionListeners.clear();
      highlightListeners.clear();
      search.destroy();
      engine.destroy();
      void pdfSource.dispose();
    },
  };
}
