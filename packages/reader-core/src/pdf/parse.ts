import type * as Pdfjs from 'pdfjs-dist';
import type { TocEntry } from '../text/epub/types.js';

type PdfjsModule = typeof Pdfjs;
type PdfDocumentProxy = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;

let workerSrc: string | null = null;

/**
 * Point pdf.js at its worker script (a URL). Call once at startup, before any
 * PDF is opened. Lets an app pass e.g. Vite's `?url` import for the worker so
 * pdf.js itself never lands in the main bundle — this module already imports
 * the library lazily.
 */
export function setPdfWorkerSrc(src: string): void {
  workerSrc = src;
}

interface RenderTarget {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toBlob(): Promise<Blob>;
}

/**
 * A 2D canvas that can hand back an image Blob, across environments:
 *  - `OffscreenCanvas` where it exists *and works* (Chromium, Firefox, Safari 16.4+)
 *  - an `HTMLCanvasElement` fallback (Playwright's WebKit, older Safari)
 * plus WebP → PNG fallback (Safari can't encode WebP from a canvas).
 */
let canvasKind: Promise<{ offscreen: boolean; type: 'image/webp' | 'image/png' }> | null = null;
function probeCanvas() {
  canvasKind ??= (async () => {
    let offscreen = false;
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const b = await new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/png' });
        offscreen = b.size > 0;
      } catch {
        offscreen = false;
      }
    }
    let webp = false;
    try {
      if (offscreen) {
        webp = (await new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/webp' })).type === 'image/webp';
      } else if (typeof document !== 'undefined') {
        webp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
      }
    } catch {
      webp = false;
    }
    return { offscreen, type: webp ? ('image/webp' as const) : ('image/png' as const) };
  })();
  return canvasKind;
}

async function renderTarget(w: number, h: number): Promise<RenderTarget> {
  const { offscreen, type } = await probeCanvas();
  if (offscreen) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('pdf: no 2d context');
    return { canvas, ctx, toBlob: () => canvas.convertToBlob({ type, quality: 0.9 }) };
  }
  if (typeof document === 'undefined') throw new Error('pdf: no canvas available to render a page');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pdf: no 2d context');
  return {
    canvas,
    ctx,
    toBlob: () =>
      new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('pdf: canvas.toBlob failed'))), type, 0.9),
      ),
  };
}

let modPromise: Promise<PdfjsModule> | null = null;
function pdfjs(): Promise<PdfjsModule> {
  // the legacy build runs in Node and older browsers alike
  modPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    const mod = m as unknown as PdfjsModule;
    if (workerSrc) mod.GlobalWorkerOptions.workerSrc = workerSrc;
    return mod;
  });
  return modPromise;
}

export interface PdfDoc {
  pageCount: number;
  /** Bookmarks resolved to page numbers (1-based). */
  outline: TocEntry[];
  pageSize(n: number): Promise<{ width: number; height: number }>;
  /**
   * Every text run on page `n` (1-based) as a normalized (0–1, page-relative,
   * y-down) box plus its string — enough to turn a marquee drag into a
   * highlight with real text. Browser or Node.
   */
  textRects(n: number): Promise<{ str: string; x: number; y: number; w: number; h: number }[]>;
  /**
   * Render page `n` (1-based) to an image the image engine can consume.
   * Browser only (needs a canvas).
   */
  renderToBlob(n: number, opts?: { scale?: number; maxDim?: number }): Promise<Blob>;
  textContent(n: number): Promise<string>;
  destroy(): Promise<void>;
}

export async function loadPdf(data: Uint8Array): Promise<PdfDoc> {
  const { getDocument, Util } = await pdfjs();
  const task = getDocument({ data, isEvalSupported: false } as Parameters<typeof getDocument>[0]);
  const doc: PdfDocumentProxy = await task.promise;
  const outline = await buildOutline(doc);

  return {
    pageCount: doc.numPages,
    outline,

    async pageSize(n) {
      const page = await doc.getPage(n);
      try {
        const v = page.getViewport({ scale: 1 });
        return { width: v.width, height: v.height };
      } finally {
        page.cleanup();
      }
    },

    async renderToBlob(n, o = {}) {
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        let scale = o.scale ?? (globalThis.devicePixelRatio || 1.5);
        if (o.maxDim) scale = Math.min(scale, o.maxDim / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const w = Math.ceil(viewport.width);
        const h = Math.ceil(viewport.height);
        const { canvas, ctx, toBlob } = await renderTarget(w, h);
        await page.render({
          canvasContext: ctx as unknown as never,
          viewport,
          canvas: canvas as unknown as never,
        }).promise;
        return await toBlob();
      } finally {
        page.cleanup();
      }
    },

    async textContent(n) {
      const page = await doc.getPage(n);
      try {
        const tc = await page.getTextContent();
        return tc.items
          .map((it) => ('str' in it ? it.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      } finally {
        page.cleanup();
      }
    },

    async textRects(n) {
      const page = await doc.getPage(n);
      try {
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const out: { str: string; x: number; y: number; w: number; h: number }[] = [];
        for (const it of tc.items) {
          if (!('str' in it) || it.str === '') continue;
          // item transform → device space (y-down, origin top-left)
          const m = Util.transform(vp.transform, it.transform);
          const fontH = Math.hypot(m[2], m[3]) || it.height || 1;
          const x = m[4];
          const y = m[5] - fontH;
          out.push({
            str: it.str,
            x: x / vp.width,
            y: y / vp.height,
            w: it.width / vp.width,
            h: fontH / vp.height,
          });
        }
        return out;
      } finally {
        page.cleanup();
      }
    },

    async destroy() {
      await task.destroy();
    },
  };
}

interface RawOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutlineNode[];
}

async function buildOutline(doc: PdfDocumentProxy): Promise<TocEntry[]> {
  const raw = (await doc.getOutline()) as RawOutlineNode[] | null;
  if (!raw) return [];

  const resolve = async (node: RawOutlineNode): Promise<TocEntry> => {
    let href = '';
    try {
      const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest;
      const ref = Array.isArray(dest) ? dest[0] : null;
      if (ref) href = `#page=${(await doc.getPageIndex(ref as never)) + 1}`;
    } catch {
      /* unresolvable bookmark — leave href empty */
    }
    return {
      label: node.title,
      href,
      children: await Promise.all((node.items ?? []).map(resolve)),
    };
  };

  return Promise.all(raw.map(resolve));
}
