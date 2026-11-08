import type { ImageManifest } from '../source/types.js';
import type { ImageEngineSettings } from '../settings/types.js';
import type { Spread } from './spreads.js';
import {
  estimateLinearLayout,
  visibleRange,
  type ContinuousAxis,
  type LinearLayout,
} from './continuous.js';
import type { PageLoader } from './page-loader.js';
import { ERR_STYLE, altForManifest, applyImageFitStyle } from './image-fit-style.js';

export const OVERSCAN_PX = 1200;

export function loadIntoImageElement(opts: {
  img: HTMLImageElement;
  pageIndex: number;
  loader: PageLoader | null;
  isDestroyed: () => boolean;
  onLoadingState: (index: number, state: 'loading' | 'loaded' | 'error') => void;
  onError: (index: number, error: unknown) => void;
}): void {
  const { img, pageIndex, loader, isDestroyed, onLoadingState, onError } = opts;
  img.removeAttribute('data-pore-page-error');
  const syncUrl = loader?.getUrl(pageIndex);
  if (syncUrl) {
    img.src = syncUrl;
    onLoadingState(pageIndex, 'loaded');
    return;
  }
  onLoadingState(pageIndex, 'loading');
  loader
    ?.get(pageIndex)
    .then((url) => {
      if (isDestroyed()) return;
      img.src = url;
      onLoadingState(pageIndex, 'loaded');
    })
    .catch((error: unknown) => {
      if (isDestroyed()) return;
      onLoadingState(pageIndex, 'error');
      onError(pageIndex, error);
      img.removeAttribute('src');
      img.alt = `Page ${pageIndex + 1} failed to load — tap to retry`;
      img.setAttribute('data-pore-page-error', String(pageIndex + 1));
      img.setAttribute('role', 'button');
      img.style.cssText = ERR_STYLE;
    });
}

export function renderPagedSpreadDom(opts: {
  doc: Document;
  viewport: HTMLElement;
  spread: Spread;
  currentSpread: number;
  renderedSpread: number;
  setRenderedSpread: (s: number) => void;
  nextToken: () => number;
  getToken: () => number;
  getCurrentSpread: () => number;
  isDestroyed: () => boolean;
  bitmapMode: boolean;
  loader: PageLoader | null;
  manifest: ImageManifest | null;
  settings: ImageEngineSettings;
  prefersReducedMotion: boolean;
  loadInto: (img: HTMLImageElement, pageIndex: number) => void;
  maybeDiscoverWideDims: (pageIndex: number, w: number, h: number) => void;
}): void {
  const {
    doc,
    viewport,
    spread,
    currentSpread,
    renderedSpread,
    setRenderedSpread,
    nextToken,
    getToken,
    getCurrentSpread,
    isDestroyed,
    bitmapMode,
    loader,
    manifest,
    settings,
    prefersReducedMotion,
    loadInto,
    maybeDiscoverWideDims,
  } = opts;
  const isDouble = spread.pages.length === 2;
  viewport.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:var(--pore-page-gap,0px);';

  if (renderedSpread === currentSpread && viewport.children.length === spread.pages.length) {
    for (const el of Array.from(viewport.children)) {
      if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement) {
        applyImageFitStyle(el, settings, isDouble, prefersReducedMotion);
      }
    }
    return;
  }

  const targetSpread = currentSpread;
  const token = nextToken();
  const newChildren: HTMLElement[] = [];
  for (const pageIndex of spread.pages) {
    if (bitmapMode) {
      const canvas = doc.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `page ${pageIndex + 1}`);
      applyImageFitStyle(canvas, settings, isDouble, prefersReducedMotion);
      const syncBmp = loader?.getBitmapSync(pageIndex);
      if (syncBmp) {
        canvas.width = syncBmp.width;
        canvas.height = syncBmp.height;
        canvas.getContext('2d')?.drawImage(syncBmp, 0, 0);
        maybeDiscoverWideDims(pageIndex, syncBmp.width, syncBmp.height);
      } else {
        void loader?.getBitmap(pageIndex).then((bmp) => {
          if (isDestroyed() || !bmp) return;
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          canvas.getContext('2d')?.drawImage(bmp, 0, 0);
          maybeDiscoverWideDims(pageIndex, bmp.width, bmp.height);
        });
      }
      newChildren.push(canvas);
      continue;
    }
    const img = doc.createElement('img');
    const syncUrl = loader?.getUrl(pageIndex);
    img.decoding = syncUrl ? 'sync' : 'async';
    img.alt = altForManifest(manifest, pageIndex);
    applyImageFitStyle(img, settings, isDouble, prefersReducedMotion);
    img.addEventListener(
      'load',
      () => maybeDiscoverWideDims(pageIndex, img.naturalWidth, img.naturalHeight),
      { once: true },
    );
    loadInto(img, pageIndex);
    newChildren.push(img);
  }

  if (bitmapMode || viewport.children.length === 0) {
    setRenderedSpread(targetSpread);
    viewport.replaceChildren(...newChildren);
    return;
  }

  const decodable = newChildren.filter(
    (el): el is HTMLImageElement =>
      el instanceof HTMLImageElement && typeof el.decode === 'function',
  );

  if (decodable.length === 0) {
    setRenderedSpread(targetSpread);
    viewport.replaceChildren(...newChildren);
    return;
  }

  const decodePromises = decodable.map((img) => img.decode().catch(() => {}));
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });

  void Promise.race([Promise.allSettled(decodePromises), timeoutPromise]).then(() => {
    if (isDestroyed() || token !== getToken() || getCurrentSpread() !== targetSpread) {
      return;
    }
    setRenderedSpread(targetSpread);
    viewport.replaceChildren(...newChildren);
  });
}

export function computeContinuousLayoutState(opts: {
  manifest: ImageManifest;
  rtlHorizontal: boolean;
  measured: Map<number, number>;
  axis: ContinuousAxis;
  crossSize: number;
  fallbackMain: number;
  gap: number;
}): { slotToPage: number[]; clayout: LinearLayout } {
  const { manifest, rtlHorizontal, measured, axis, crossSize, fallbackMain, gap } = opts;
  const n = manifest.pages.length;
  const slotToPage = rtlHorizontal
    ? Array.from({ length: n }, (_, s) => n - 1 - s)
    : Array.from({ length: n }, (_, s) => s);
  const slotPages = slotToPage.map((p) => manifest.pages[p]!);
  const slotMeasured = new Map<number, number>();
  slotToPage.forEach((p, s) => {
    const m = measured.get(p);
    if (m !== undefined) slotMeasured.set(s, m);
  });
  const clayout = estimateLinearLayout(slotPages, {
    axis,
    crossSize,
    fallbackMain,
    gap,
    measured: slotMeasured,
  });
  return { slotToPage, clayout };
}

export function renderContinuousStripDom(opts: {
  doc: Document;
  viewport: HTMLElement;
  manifest: ImageManifest;
  axis: ContinuousAxis;
  clayout: LinearLayout;
  slotToPage: number[];
  mountedImgs: Map<number, HTMLImageElement>;
  scrollMain: number;
  viewportMain: number;
  stripWidth: number;
  prefersReducedMotion: boolean;
  loadInto: (img: HTMLImageElement, p: number) => void;
  onMeasurePage: (p: number, s: number, img: HTMLImageElement) => void;
}): void {
  const {
    doc,
    viewport,
    manifest,
    axis,
    clayout,
    slotToPage,
    mountedImgs,
    scrollMain,
    viewportMain,
    stripWidth,
    prefersReducedMotion,
    loadInto,
    onMeasurePage,
  } = opts;
  const horiz = axis === 'x';
  viewport.style.cssText = horiz
    ? `position:relative;height:100%;width:${clayout.total}px;`
    : `position:relative;width:100%;height:${clayout.total}px;`;
  const { first, last } = visibleRange(clayout, scrollMain, viewportMain, OVERSCAN_PX);
  const wanted = new Set<number>();
  for (let s = first; s <= last; s++) wanted.add(slotToPage[s]!);

  for (const [p, img] of mountedImgs) {
    if (!wanted.has(p)) {
      img.remove();
      mountedImgs.delete(p);
    }
  }
  for (let s = first; s <= last; s++) {
    const p = slotToPage[s]!;
    let img = mountedImgs.get(p);
    if (!img) {
      img = doc.createElement('img');
      img.decoding = 'async';
      img.alt = altForManifest(manifest, p);
      img.style.cssText = horiz
        ? 'position:absolute;top:0;height:100%;width:auto;'
        : 'position:absolute;left:50%;height:auto;';
      const el = img;
      img.addEventListener('load', () => onMeasurePage(p, s, el), { once: true });
      viewport.appendChild(img);
      mountedImgs.set(p, img);
      loadInto(img, p);
    }
    if (!horiz) {
      img.style.width = `${stripWidth}px`;
      img.style.maxWidth = '100%';
      img.style.transform = 'translateX(-50%)';
      if (!prefersReducedMotion) {
        img.style.transition =
          'width 0.25s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1), height 0.25s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      }
    }
    img.style[horiz ? 'left' : 'top'] = `${clayout.offsets[s]}px`;
  }
}
