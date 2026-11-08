import type { ImageManifest } from '../source/types.js';
import type { Position } from '../position/types.js';
import type { ImageEngineSettings } from '../settings/types.js';
import type { Direction, TurnDirection } from '../types.js';
import type { Chapter } from '../reader-engine.js';
import { type PaceEstimator, chapterProgress } from '../progress.js';
import { visibleRange, type ContinuousAxis, type LinearLayout } from './continuous.js';
import type { PageLoader } from './page-loader.js';
import type { PrefetchScheduler } from './prefetch.js';

export const FIT_CYCLE: ImageEngineSettings['fit'][] = [
  'contain',
  'width',
  'height',
  'original',
  'smart',
];

export const ERR_STYLE =
  'min-height:60vh;width:100%;display:flex;align-items:center;justify-content:center;' +
  'border:1px dashed currentColor;opacity:0.6;font:inherit;text-align:center;cursor:pointer;padding:1rem;box-sizing:border-box;';

/** Directions where "forward" advances leftward / upward (reverse of LTR). */
export function isReverseDirection(direction: Direction): boolean {
  return direction === 'rtl' || direction === 'vertical';
}

/** Translate a physical page-turn (screen direction) to a logical one. */
export function physicalToLogical(
  physical: 'page-right' | 'page-left',
  direction: Direction,
): TurnDirection {
  const forwardIsRight = !isReverseDirection(direction);
  const wantRight = physical === 'page-right';
  return wantRight === forwardIsRight ? 'forward' : 'back';
}

export function createImageDomShell(doc: Document): {
  root: HTMLDivElement;
  viewport: HTMLDivElement;
  dimEl: HTMLDivElement;
} {
  const root = doc.createElement('div');
  root.className = 'pore-image';
  root.tabIndex = 0;
  root.style.cssText = 'position:relative;width:100%;height:100%;outline:none;';
  const viewport = doc.createElement('div');
  viewport.className = 'pore-image__viewport';
  root.appendChild(viewport);
  const dimEl = doc.createElement('div');
  dimEl.className = 'pore-image__dim';
  dimEl.style.cssText =
    'position:absolute;inset:0;pointer-events:none;background:#000;opacity:0;transition:opacity .2s;z-index:1;';
  root.appendChild(dimEl);
  return { root, viewport, dimEl };
}

export function chapterForManifest(
  manifest: ImageManifest | null,
  page: number,
): { id?: string; label: string } {
  const ch = manifest?.chapters?.filter((c) => c.startIndex <= page).at(-1);
  return ch ? { id: ch.id, label: ch.label } : { label: manifest?.title ?? '' };
}

export function altForManifest(manifest: ImageManifest | null, pageIndex: number): string {
  const total = manifest?.pageCount ?? 0;
  const ch = chapterForManifest(manifest, pageIndex);
  const base = `page ${pageIndex + 1}${total ? ` of ${total}` : ''}`;
  return ch.id ? `${ch.label} — ${base}` : base;
}

export function engineChaptersForManifest(manifest: ImageManifest | null): Chapter[] {
  const total = manifest?.pageCount ?? 0;
  return (manifest?.chapters ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    startPage: c.startIndex,
    startPercent: total > 1 ? c.startIndex / (total - 1) : 0,
  }));
}

export function buildImageLocationAndProgress(opts: {
  manifest: ImageManifest;
  page: number;
  position: Position;
  chapters: Chapter[];
  pace: PaceEstimator;
}) {
  const { manifest, page, position, chapters, pace } = opts;
  const total = manifest.pageCount;
  const ch = chapterForManifest(manifest, page);
  const loc = {
    position,
    page,
    total,
    percent: total > 1 ? page / (total - 1) : 0,
    ...(ch.id ? { chapter: ch.id } : {}),
    label: `${ch.label} · ${page + 1}/${total}`,
  };
  pace.mark();
  const cp = chapterProgress(chapters, page, total);
  const progress = {
    locator: loc,
    percent: loc.percent,
    chapterLabel: cp.label || ch.label,
    chapterIndex: cp.index,
    chapterCount: chapters.length,
    pagesLeftInChapter: cp.pagesLeftInChapter,
    minutesLeft: pace.minutesLeft(Math.max(0, total - 1 - page)),
    page: loc.page,
    pageCount: total,
  };
  return { loc, progress };
}

export function syncImagePrefetchAndRetain(opts: {
  loader: PageLoader | null;
  prefetch: PrefetchScheduler | null;
  manifest: ImageManifest | null;
  settings: ImageEngineSettings;
  page: number;
  isContinuous: boolean;
  clayout: LinearLayout;
  slotToPage: number[];
  scrollMain: number;
  viewportMain: number;
  overscanPx: number;
}): void {
  const {
    loader,
    prefetch,
    manifest,
    settings,
    page,
    isContinuous,
    clayout,
    slotToPage,
    scrollMain,
    viewportMain,
    overscanPx,
  } = opts;
  if (!loader) return;
  const keep = new Set<number>();
  for (let d = -Math.max(settings.preloadBehind, 1); d <= Math.max(settings.preloadAhead, 1); d++) {
    const i = page + d;
    if (i >= 0 && i < (manifest?.pageCount ?? 0)) keep.add(i);
  }
  if (isContinuous) {
    const { first, last } = visibleRange(clayout, scrollMain, viewportMain, overscanPx);
    for (let s = first; s <= last; s++) {
      const p = slotToPage[s];
      if (p !== undefined) keep.add(p);
    }
  }
  loader.retain(keep);
  prefetch?.update(page);
}

export function applyImageContainerStyle(
  root: HTMLElement,
  dimEl: HTMLElement,
  settings: ImageEngineSettings,
  isContinuous: boolean,
  axis: ContinuousAxis,
): void {
  root.style.setProperty('--pore-page-gap', `${settings.pageGap}px`);
  root.style.overflowY = isContinuous && axis === 'y' ? 'auto' : 'hidden';
  root.style.overflowX = isContinuous && axis === 'x' ? 'auto' : 'hidden';
  root.style.touchAction =
    isContinuous && axis === 'x' ? 'pan-x' : isContinuous ? 'pan-y' : 'manipulation';
  root.style.background =
    settings.background === 'white' ? '#fff' : settings.background === 'black' ? '#000' : '';
  dimEl.style.opacity = settings.dim ? '0.12' : '0';
}

export function applyImageFilters(viewport: HTMLElement, settings: ImageEngineSettings): void {
  const filters: string[] = [];
  if (settings.brightness !== 1) filters.push(`brightness(${settings.brightness})`);
  if (settings.greyscale) filters.push('grayscale(1)');
  viewport.style.filter = filters.join(' ');
}

export function applyImageFitStyle(
  img: HTMLImageElement | HTMLCanvasElement,
  settings: ImageEngineSettings,
  isDouble: boolean,
  prefersReducedMotion: boolean,
): void {
  const singleMap: Record<ImageEngineSettings['fit'], string> = {
    width: 'width:100%;height:auto;',
    height: 'height:100%;width:auto;',
    contain: 'max-width:100%;max-height:100%;width:auto;height:auto;',
    original: 'width:auto;height:auto;max-width:none;',
    smart: 'max-width:100%;max-height:100%;width:auto;height:auto;',
  };
  const doubleMap: Record<ImageEngineSettings['fit'], string> = {
    width:
      'width:calc(50% - (var(--pore-page-gap, 0px) / 2));height:auto;flex:0 1 auto;min-width:0;',
    height: 'height:100%;width:auto;flex:0 1 auto;min-width:0;',
    contain:
      'max-width:calc(50% - (var(--pore-page-gap, 0px) / 2));width:auto;height:auto;max-height:100%;object-fit:contain;flex:0 1 auto;min-width:0;min-height:0;',
    original: 'width:auto;height:auto;max-width:none;flex:0 1 auto;min-width:0;',
    smart:
      'max-width:calc(50% - (var(--pore-page-gap, 0px) / 2));width:auto;height:auto;max-height:100%;object-fit:contain;flex:0 1 auto;min-width:0;min-height:0;',
  };
  const transition = prefersReducedMotion
    ? ''
    : 'transition:width 0.25s cubic-bezier(0.16, 1, 0.3, 1),max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1),height 0.25s cubic-bezier(0.16, 1, 0.3, 1),max-height 0.25s cubic-bezier(0.16, 1, 0.3, 1);';
  const baseStyle = isDouble ? doubleMap[settings.fit] : singleMap[settings.fit];
  img.style.cssText = `display:block;${baseStyle}${transition}`;
  if (settings.maxWidth) {
    img.style.maxWidth = isDouble
      ? `min(calc(50% - (var(--pore-page-gap, 0px) / 2)), ${settings.maxWidth}px)`
      : `${settings.maxWidth}px`;
  }
  if (settings.maxHeight) img.style.maxHeight = `${settings.maxHeight}px`;
}
