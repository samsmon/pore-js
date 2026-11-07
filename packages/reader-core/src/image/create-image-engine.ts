import type { ImageManifest } from '../source/types.js';
import type { Position } from '../position/types.js';
import type { ImageEngineSettings } from '../settings/types.js';
import type { Keymap } from '../settings/keymap.js';
import { resolveAction } from '../settings/keymap.js';
import { resolveKeymap, resolveSettings } from '../settings/merge.js';
import { clampPagePosition } from '../position/position.js';
import type { Direction, TurnDirection } from '../types.js';
import { createEmitter } from '../internal/emitter.js';
import type { Chapter } from '../reader-engine.js';
import { PaceEstimator, chapterProgress } from '../progress.js';
import { instantTransitions } from '../transitions.js';
import { createChromeHandle } from '../chrome-handle.js';
import type { ImageEngine, ImageEngineOptions } from './engine.js';
import type { ImageEngineEvents } from './types.js';
import {
  buildSpreads,
  clampSpreadIndex,
  isNaturallyWide,
  spreadIndexForPage,
  type Spread,
} from './spreads.js';
import {
  estimateLinearLayout,
  pageAtOffset,
  scrollForPage,
  visibleRange,
  type ContinuousAxis,
  type LinearLayout,
} from './continuous.js';
import { clampZoom, resolveTap, swipeTurn, zoneForPoint } from './input.js';
import { PageLoader } from './page-loader.js';
import { PrefetchScheduler } from './prefetch.js';

const FIT_CYCLE: ImageEngineSettings['fit'][] = ['contain', 'width', 'height', 'original', 'smart'];
const OVERSCAN_PX = 1200;
const TAP_SLOP = 10;
const TAP_MS = 350;
const SAVE_DEBOUNCE_MS = 800;

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

export function createImageEngine(options: ImageEngineOptions): ImageEngine {
  const emitter = createEmitter<ImageEngineEvents>();
  const { container, source, bookId } = options;
  const doc = container.ownerDocument;

  let settings = resolveSettings(options.settings);
  let keymap: Keymap = resolveKeymap(options.keymap);
  const transitions = options.transitions ?? instantTransitions;
  let manifest: ImageManifest | null = null;
  let destroyed = false;
  const pace = new PaceEstimator(8);
  let loader: PageLoader | null = null;
  let prefetch: PrefetchScheduler | null = null;
  let cappedNotified = false;
  let resizeObserver: ResizeObserver | null = null;

  // paged state
  let spreads: Spread[] = [];
  let currentSpread = 0;
  // continuous state
  let clayout: LinearLayout = { sizes: [], offsets: [], total: 0 };
  /** layout slot -> real page index (identity unless RTL horizontal, which reverses) */
  let slotToPage: number[] = [];
  const measured = new Map<number, number>();
  const mountedImgs = new Map<number, HTMLImageElement>();
  // input state
  let chromeVisible = settings.headerVisible;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let pointer: { x: number; y: number; t: number; id: number } | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // auto-advance state
  let autoOn = false;
  let autoRaf = 0;
  let autoLastT = 0;
  let autoStepTimer: ReturnType<typeof setInterval> | null = null;
  let autoPagedTimer: ReturnType<typeof setInterval> | null = null;
  let autoResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;

  const prefersReducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const isContinuous = () =>
    settings.layout === 'continuous-vertical' || settings.layout === 'continuous-horizontal';
  const axis = (): ContinuousAxis => (settings.layout === 'continuous-horizontal' ? 'x' : 'y');
  /** RTL horizontal reads right→left; we reverse the layout so scroll stays positive. */
  const rtlHorizontal = () => axis() === 'x' && settings.direction === 'rtl';
  const scrollMain = (): number => (axis() === 'x' ? root.scrollLeft : root.scrollTop);
  const setScrollMain = (v: number) => {
    if (axis() === 'x') root.scrollLeft = v;
    else root.scrollTop = v;
  };
  /** Deliberate jump (goto / turn) — routed through the animation seam. */
  const animateScrollMain = (v: number) => {
    transitions.scrollTo(root, axis() === 'x' ? 'scrollLeft' : 'scrollTop', v, prefersReducedMotion());
  };
  const viewportMain = (): number => (axis() === 'x' ? root.clientWidth : root.clientHeight) || 1;
  /**
   * Effective content width for the vertical continuous strip (webtoon): the
   * window width, capped by `maxWidth` when the reader has set one. Pages are
   * centred at this width so the strip can be read at a comfortable size on a
   * wide screen. Used for both layout estimation and the mounted `<img>` width.
   */
  const stripWidth = (): number => {
    const w = root.clientWidth || 800;
    return settings.maxWidth && settings.maxWidth > 0 ? Math.min(w, settings.maxWidth) : w;
  };
  const slotForPage = (page: number): number => {
    const s = slotToPage.indexOf(page);
    return s === -1 ? 0 : s;
  };

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

  // ---- shared helpers -------------------------------------------------------

  const chapterFor = (page: number): { id?: string; label: string } => {
    const ch = manifest?.chapters?.filter((c) => c.startIndex <= page).at(-1);
    return ch ? { id: ch.id, label: ch.label } : { label: manifest?.title ?? '' };
  };

  /** Descriptive alt text for a page image (chapter + position). */
  const altFor = (pageIndex: number): string => {
    const total = manifest?.pageCount ?? 0;
    const ch = chapterFor(pageIndex);
    const base = `page ${pageIndex + 1}${total ? ` of ${total}` : ''}`;
    return ch.id ? `${ch.label} — ${base}` : base;
  };

  const engineChapters = (): Chapter[] => {
    const total = manifest?.pageCount ?? 0;
    return (manifest?.chapters ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      startPage: c.startIndex,
      startPercent: total > 1 ? c.startIndex / (total - 1) : 0,
    }));
  };

  const currentPage = (): number => {
    if (!isContinuous()) return spreads[currentSpread]?.leading ?? 0;
    const slot = pageAtOffset(clayout, scrollMain());
    return slotToPage[slot] ?? 0;
  };

  const positionFor = (): Position => {
    const total = manifest?.pageCount ?? 0;
    if (isContinuous()) {
      const page = currentPage();
      return {
        type: 'scroll',
        value: clayout.total > 0 ? scrollMain() / clayout.total : 0,
        total,
        page,
      };
    }
    return { type: 'page', value: currentPage(), total };
  };

  const emitLocation = () => {
    if (!manifest) return;
    const page = currentPage();
    const total = manifest.pageCount;
    const ch = chapterFor(page);
    const loc = {
      position: positionFor(),
      page,
      total,
      percent: total > 1 ? page / (total - 1) : 0,
      ...(ch.id ? { chapter: ch.id } : {}),
      label: `${ch.label} · ${page + 1}/${total}`,
    };
    emitter.emit('reader:locationchange', loc);
    pace.mark();
    const chs = engineChapters();
    const cp = chapterProgress(chs, page, total);
    emitter.emit('reader:progress', {
      locator: loc,
      percent: loc.percent,
      chapterLabel: cp.label || ch.label,
      chapterIndex: cp.index,
      chapterCount: chs.length,
      pagesLeftInChapter: cp.pagesLeftInChapter,
      minutesLeft: pace.minutesLeft(Math.max(0, total - 1 - page)),
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
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!manifest || destroyed) return;
    void source.saveProgress(bookId, positionFor()).catch(() => {});
  };

  const applyContainerStyle = () => {
    root.style.setProperty('--pore-page-gap', `${settings.pageGap}px`);
    root.style.overflowY = isContinuous() && axis() === 'y' ? 'auto' : 'hidden';
    root.style.overflowX = isContinuous() && axis() === 'x' ? 'auto' : 'hidden';
    // let the browser own the scroll axis; the engine owns the other axis
    // (swipe-to-turn) and pinch. `manipulation` also kills the 300ms tap delay.
    root.style.touchAction =
      isContinuous() && axis() === 'x'
        ? 'pan-x'
        : isContinuous()
          ? 'pan-y'
          : 'manipulation';
    root.style.background =
      settings.background === 'white' ? '#fff' : settings.background === 'black' ? '#000' : '';
    dimEl.style.opacity = settings.dim ? '0.12' : '0';
  };

  const applyFilters = () => {
    const filters: string[] = [];
    if (settings.brightness !== 1) filters.push(`brightness(${settings.brightness})`);
    if (settings.greyscale) filters.push('grayscale(1)');
    viewport.style.filter = filters.join(' ');
  };

  const applyFitStyle = (img: HTMLImageElement | HTMLCanvasElement) => {
    const map: Record<ImageEngineSettings['fit'], string> = {
      width: 'width:100%;height:auto;',
      height: 'height:100%;width:auto;',
      contain: 'max-width:100%;max-height:100%;width:auto;height:auto;',
      original: 'width:auto;height:auto;max-width:none;',
      smart: 'max-width:100%;max-height:100%;width:auto;height:auto;',
    };
    const transition = prefersReducedMotion()
      ? ''
      : 'transition:width 0.25s cubic-bezier(0.16, 1, 0.3, 1),max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1),height 0.25s cubic-bezier(0.16, 1, 0.3, 1),max-height 0.25s cubic-bezier(0.16, 1, 0.3, 1);';
    img.style.cssText = `display:block;${map[settings.fit]}${transition}`;
    if (settings.maxWidth) img.style.maxWidth = `${settings.maxWidth}px`;
    if (settings.maxHeight) img.style.maxHeight = `${settings.maxHeight}px`;
  };

  const ERR_STYLE =
    'min-height:60vh;width:100%;display:flex;align-items:center;justify-content:center;' +
    'border:1px dashed currentColor;opacity:0.6;font:inherit;text-align:center;cursor:pointer;padding:1rem;box-sizing:border-box;';

  const loadInto = (img: HTMLImageElement, pageIndex: number) => {
    img.removeAttribute('data-pore-page-error');
    const syncUrl = loader?.getUrl(pageIndex);
    if (syncUrl) {
      img.src = syncUrl;
      emitter.emit('reader:loadingstate', { index: pageIndex, state: 'loaded' });
      return;
    }
    emitter.emit('reader:loadingstate', { index: pageIndex, state: 'loading' });
    loader
      ?.get(pageIndex)
      .then((url) => {
        if (destroyed) return;
        img.src = url;
        emitter.emit('reader:loadingstate', { index: pageIndex, state: 'loaded' });
      })
      .catch((error: unknown) => {
        if (destroyed) return;
        emitter.emit('reader:loadingstate', { index: pageIndex, state: 'error' });
        emitter.emit('reader:error', { index: pageIndex, error });
        // A tappable "page failed — retry" tile instead of a silent blank. An
        // <img> with no src renders its `alt`; the inline style makes it a hit
        // target. `img[data-pore-page-error]` is a styling hook for hosts.
        img.removeAttribute('src');
        img.alt = `Page ${pageIndex + 1} failed to load — tap to retry`;
        img.setAttribute('data-pore-page-error', String(pageIndex + 1));
        img.setAttribute('role', 'button');
        img.style.cssText = ERR_STYLE;
      });
  };

  /** Tap a failed page tile to retry just that page. */
  const onRetryClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement | null;
    const img = t?.closest?.('img[data-pore-page-error]') as HTMLImageElement | null;
    if (!img) return;
    const n = Number(img.getAttribute('data-pore-page-error'));
    if (!Number.isFinite(n) || n < 1) return;
    ev.stopPropagation();
    img.removeAttribute('role');
    applyFitStyle(img);
    loader?.forget(n - 1);
    loadInto(img, n - 1);
  };

  const syncPrefetchAndRetain = () => {
    if (!loader) return;
    const keep = new Set<number>();
    const page = currentPage();
    for (
      let d = -Math.max(settings.preloadBehind, 1);
      d <= Math.max(settings.preloadAhead, 1);
      d++
    ) {
      const i = page + d;
      if (i >= 0 && i < (manifest?.pageCount ?? 0)) keep.add(i);
    }
    if (isContinuous()) {
      const { first, last } = visibleRange(clayout, scrollMain(), viewportMain(), OVERSCAN_PX);
      for (let s = first; s <= last; s++) {
        const p = slotToPage[s];
        if (p !== undefined) keep.add(p);
      }
    }
    loader.retain(keep);
    prefetch?.update(page);
  };

  // ---- paged rendering ----------------------------------------------------------

  let renderedSpread = -1;

  const bitmapMode = () =>
    settings.loadingMethod === 'bitmap' && settings.preloadStrategy !== 'all';

  const renderPaged = () => {
    const spread = spreads[currentSpread];
    if (!spread) return;
    viewport.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:var(--pore-page-gap,0px);';

    if (renderedSpread === currentSpread && viewport.children.length === spread.pages.length) {
      for (const el of Array.from(viewport.children)) {
        if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement) {
          applyFitStyle(el);
        }
      }
      return;
    }

    renderedSpread = currentSpread;
    const newChildren: HTMLElement[] = [];
    for (const pageIndex of spread.pages) {
      if (bitmapMode()) {
        const canvas = doc.createElement('canvas');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `page ${pageIndex + 1}`);
        applyFitStyle(canvas);
        const syncBmp = loader?.getBitmapSync(pageIndex);
        if (syncBmp) {
          canvas.width = syncBmp.width;
          canvas.height = syncBmp.height;
          canvas.getContext('2d')?.drawImage(syncBmp, 0, 0);
          maybeDiscoverWideDims(pageIndex, syncBmp.width, syncBmp.height);
        } else {
          void loader?.getBitmap(pageIndex).then((bmp) => {
            if (destroyed || !bmp) return;
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
      img.alt = altFor(pageIndex);
      applyFitStyle(img);
      img.addEventListener('load', () => maybeDiscoverWide(pageIndex, img), { once: true });
      loadInto(img, pageIndex);
      newChildren.push(img);
    }
    viewport.replaceChildren(...newChildren);
  };

  const maybeDiscoverWide = (pageIndex: number, img: HTMLImageElement) =>
    maybeDiscoverWideDims(pageIndex, img.naturalWidth, img.naturalHeight);

  const maybeDiscoverWideDims = (pageIndex: number, w: number, h: number) => {
    if (destroyed || !manifest || settings.layout !== 'paged-double') return;
    const page = manifest.pages[pageIndex];
    if (!page || page.isWide !== undefined) return;
    if (!isNaturallyWide(page, w, h)) return;
    page.isWide = true;
    rebuildSpreads(currentPage());
    render();
  };

  // ---- continuous rendering (axis-generic) -----------------------------------

  const recomputeLayout = () => {
    if (!manifest) return;
    const n = manifest.pages.length;
    slotToPage = rtlHorizontal()
      ? Array.from({ length: n }, (_, s) => n - 1 - s)
      : Array.from({ length: n }, (_, s) => s);
    const slotPages = slotToPage.map((p) => manifest!.pages[p]!);
    const slotMeasured = new Map<number, number>();
    slotToPage.forEach((p, s) => {
      const m = measured.get(p);
      if (m !== undefined) slotMeasured.set(s, m);
    });
    const cross = axis() === 'x' ? root.clientHeight || 1000 : stripWidth();
    clayout = estimateLinearLayout(slotPages, {
      axis: axis(),
      crossSize: cross,
      fallbackMain: viewportMain(),
      gap: settings.pageGap,
      measured: slotMeasured,
    });
  };

  const renderContinuous = () => {
    if (!manifest) return;
    const horiz = axis() === 'x';
    viewport.style.cssText = horiz
      ? `position:relative;height:100%;width:${clayout.total}px;`
      : `position:relative;width:100%;height:${clayout.total}px;`;
    const { first, last } = visibleRange(clayout, scrollMain(), viewportMain(), OVERSCAN_PX);
    const wanted = new Set<number>();
    for (let s = first; s <= last; s++) wanted.add(slotToPage[s]!);

    for (const [p, img] of mountedImgs) {
      if (!wanted.has(p)) {
        img.remove();
        mountedImgs.delete(p);
      }
    }
    const sw = stripWidth();
    for (let s = first; s <= last; s++) {
      const p = slotToPage[s]!;
      let img = mountedImgs.get(p);
      if (!img) {
        img = doc.createElement('img');
        img.decoding = 'async';
        img.alt = altFor(p);
        img.style.cssText = horiz
          ? 'position:absolute;top:0;height:100%;width:auto;'
          : 'position:absolute;left:50%;height:auto;';
        const el = img;
        img.addEventListener('load', () => measurePage(p, s, el), { once: true });
        viewport.appendChild(img);
        mountedImgs.set(p, img);
        loadInto(img, p);
      }
      if (!horiz) {
        // centre the strip and constrain its width (webtoon size control)
        img.style.width = `${sw}px`;
        img.style.maxWidth = '100%';
        img.style.transform = 'translateX(-50%)';
        if (!prefersReducedMotion()) {
          img.style.transition =
            'width 0.25s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1), height 0.25s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        }
      }
      img.style[horiz ? 'left' : 'top'] = `${clayout.offsets[s]}px`;
    }
  };

  const measurePage = (page: number, slot: number, img: HTMLImageElement) => {
    if (destroyed || !img.naturalWidth) return;
    const horiz = axis() === 'x';
    const cross = horiz ? root.clientHeight || 1000 : stripWidth();
    const size = horiz
      ? (img.naturalWidth / img.naturalHeight) * cross
      : (img.naturalHeight / img.naturalWidth) * cross;
    if (Math.abs((measured.get(page) ?? 0) - size) < 1) return;
    const before = clayout.offsets[slot] ?? 0;
    measured.set(page, size);
    recomputeLayout();
    if ((clayout.offsets[slot] ?? 0) !== before && before < scrollMain()) {
      setScrollMain(scrollMain() + ((clayout.offsets[slot] ?? 0) - before));
    }
    renderContinuous();
  };

  // ---- unified render / navigation --------------------------------------------

  const render = () => {
    if (!manifest || destroyed) return;
    applyContainerStyle();
    if (isContinuous()) {
      recomputeLayout();
      renderContinuous();
    } else {
      renderPaged();
      applyZoom();
    }
    applyFilters();
    syncPrefetchAndRetain();
    emitLocation();
  };

  const onScroll = () => {
    if (destroyed || !isContinuous()) return;
    renderContinuous();
    applyFilters();
    syncPrefetchAndRetain();
    emitLocation();
  };

  const goToSpread = (index: number) => {
    const clamped = clampSpreadIndex(spreads, index);
    currentSpread = clamped;
    render();
  };

  const rebuildSpreads = (preserveLeadingPage?: number) => {
    if (!manifest) return;
    renderedSpread = -1;
    const leading = preserveLeadingPage ?? currentPage();
    spreads = buildSpreads(manifest.pages, {
      layout: isContinuous() ? 'paged-single' : settings.layout,
      direction: settings.direction,
      spreadOffset: settings.spreadOffset,
    });
    currentSpread = spreadIndexForPage(spreads, leading);
    emitter.emit('reader:layoutchange', { layout: settings.layout, spreads: spreads.length });
  };

  // ---- input ----------------------------------------------------------------

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const action = resolveAction(keymap, ev.key);
    if (!action) return;
    switch (action) {
      case 'page-right':
      case 'page-left':
        ev.preventDefault();
        turn(physicalToLogical(action, settings.direction));
        break;
      case 'scroll-up':
      case 'scroll-down':
        if (isContinuous()) {
          ev.preventDefault();
          setScrollMain(scrollMain() + (action === 'scroll-down' ? 1 : -1) * viewportMain() * 0.9);
        }
        break;
      case 'first-page':
        ev.preventDefault();
        goto(0);
        break;
      case 'last-page':
        ev.preventDefault();
        goto((manifest?.pageCount ?? 1) - 1);
        break;
      case 'cycle-fit': {
        ev.preventDefault();
        setSettings({ fit: FIT_CYCLE[(FIT_CYCLE.indexOf(settings.fit) + 1) % FIT_CYCLE.length]! });
        break;
      }
      case 'toggle-spread-offset':
        ev.preventDefault();
        setSettings({ spreadOffset: settings.spreadOffset === 1 ? 0 : 1 });
        break;
      case 'toggle-fullscreen':
        ev.preventDefault();
        void toggleFullscreen();
        break;
      case 'toggle-menu':
        ev.preventDefault();
        toggleChrome();
        break;
      case 'toggle-autoscroll':
        ev.preventDefault();
        setSettings({ autoscroll: !settings.autoscroll });
        break;
      default:
        break;
    }
    if (action === 'page-right' || action === 'page-left' || action === 'first-page') {
      cancelAutoAdvance();
    }
  };

  const applyZoom = () => {
    if (isContinuous()) return;
    const value =
      zoom === 1 && panX === 0 && panY === 0
        ? ''
        : `translate(${panX}px, ${panY}px) scale(${zoom})`;
    transitions.zoom(viewport, value, prefersReducedMotion());
  };

  const setZoom = (next: number, originX = 0.5, originY = 0.5) => {
    const clamped = clampZoom(next);
    if (clamped === zoom) return;
    zoom = clamped;
    if (zoom === 1) {
      panX = 0;
      panY = 0;
    } else {
      viewport.style.transformOrigin = `${originX * 100}% ${originY * 100}%`;
    }
    applyZoom();
    emitter.emit('reader:zoomchange', { scale: zoom });
  };

  // ---- auto-advance -------------------------------------------------------------

  const autoStep = (t: number) => {
    if (!autoOn || destroyed) return;
    const dt = autoLastT ? (t - autoLastT) / 1000 : 0;
    autoLastT = t;
    const before = scrollMain();
    setScrollMain(before + settings.autoscrollSpeed * dt);
    if (scrollMain() === before) {
      // hit the end
      stopAutoscroll();
      turn('forward');
      return;
    }
    onScroll();
    autoRaf = requestAnimationFrame(autoStep);
  };

  const startAutoscroll = () => {
    if (autoOn || !isContinuous() || prefersReducedMotion()) return;
    autoOn = true;
    autoLastT = 0;
    emitter.emit('reader:autoscroll', { running: true });
    if (settings.autoscrollSmooth) {
      autoRaf = requestAnimationFrame(autoStep);
    } else {
      const stepMs = (viewportMain() / Math.max(settings.autoscrollSpeed, 1)) * 1000;
      autoStepTimer = setInterval(() => turn('forward'), stepMs);
    }
  };

  const stopAutoscroll = (silent = false) => {
    if (!autoOn) return;
    autoOn = false;
    if (autoRaf) cancelAnimationFrame(autoRaf);
    autoRaf = 0;
    if (autoStepTimer) clearInterval(autoStepTimer);
    autoStepTimer = null;
    if (!silent) emitter.emit('reader:autoscroll', { running: false });
  };

  const pauseAutoscroll = () => {
    if (!autoOn) return;
    stopAutoscroll(true);
    if (autoResumeTimer) clearTimeout(autoResumeTimer);
    autoResumeTimer = setTimeout(() => {
      if (!destroyed && settings.autoscroll) startAutoscroll();
    }, 2000);
  };

  const startPagedAutoAdvance = () => {
    if (autoPagedTimer || settings.pagedAutoAdvanceSeconds <= 0 || isContinuous()) return;
    autoPagedTimer = setInterval(() => turn('forward'), settings.pagedAutoAdvanceSeconds * 1000);
  };

  const chapterIndexOf = (page: number): number => {
    const chs = manifest?.chapters;
    if (!chs?.length) return 0;
    let idx = 0;
    for (let i = 0; i < chs.length; i++) if (chs[i]!.startIndex <= page) idx = i;
    return idx;
  };

  const cancelAutoAdvance = () => {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
      emitter.emit('reader:autoadvance', { toChapter: null, inMs: -1 });
    }
  };

  /** Arm a countdown to `targetChapter`; `instant`/0 s advances synchronously-ish. */
  const armChapterAdvance = (target: { id: string; startIndex: number }) => {
    if (settings.nextChapterAfterLastPage === 'off') {
      goto(target.startIndex);
      return;
    }
    const secs =
      settings.nextChapterAfterLastPage === 'instant' ? 0 : settings.nextChapterAfterLastPage;
    emitter.emit('reader:autoadvance', { toChapter: target.id, inMs: secs * 1000 });
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      goto(target.startIndex);
    }, secs * 1000);
  };

  /** If turning forward would enter a later chapter, intercept for the countdown. */
  const interceptChapterBoundary = (nextPage: number): boolean => {
    if (!manifest?.chapters?.length) return false;
    const ci = chapterIndexOf(currentPage());
    const ni = chapterIndexOf(nextPage);
    if (ni <= ci) return false;
    const target = manifest.chapters[ni]!;
    emitter.emit('reader:end', { auto: settings.nextChapterAfterLastPage });
    armChapterAdvance(target);
    return true;
  };

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

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  let lastTap = { t: 0, x: 0, y: 0 };
  // a touch double-tap also emits a synthetic dblclick; suppress onDblClick then
  let touchDblTapAt = 0;

  const onPointerDown = (ev: PointerEvent) => {
    pointer = { x: ev.clientX, y: ev.clientY, t: Date.now(), id: ev.pointerId };
    cancelAutoAdvance();
    pauseAutoscroll();
    handle.wake();
    clearLongPress();
    if (wantsLongPress() && zoom === 1 && ev.pointerType !== 'mouse') {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        pointer = null; // consume — pointerup won't also turn
        try {
          navigator.vibrate?.(10);
        } catch {
          /* not supported */
        }
        toggleChrome();
      }, 450);
    }
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (!pointer || ev.pointerId !== pointer.id) return;
    if (Math.hypot(ev.clientX - pointer.x, ev.clientY - pointer.y) > TAP_SLOP) clearLongPress();
    if (zoom === 1) return;
    panX += ev.clientX - pointer.x;
    panY += ev.clientY - pointer.y;
    pointer = { ...pointer, x: ev.clientX, y: ev.clientY };
    applyZoom();
  };

  const onPointerUp = (ev: PointerEvent) => {
    clearLongPress();
    if (!pointer || ev.pointerId !== pointer.id) return;
    // a tap on a failed-page tile is a retry, not a page turn
    if ((ev.target as HTMLElement | null)?.closest?.('img[data-pore-page-error]')) {
      pointer = null;
      return;
    }
    const dx = ev.clientX - pointer.x;
    const dy = ev.clientY - pointer.y;
    const dt = Date.now() - pointer.t;
    pointer = null;
    const isTouch = ev.pointerType !== 'mouse';
    if (zoom > 1) {
      // when zoomed, a quick near-stationary tap can still be a double-tap to reset
      const now = Date.now();
      if (
        isTouch &&
        settings.doubleTapZoom &&
        !isContinuous() &&
        Math.hypot(dx, dy) <= TAP_SLOP &&
        dt <= TAP_MS &&
        now - lastTap.t < 300 &&
        Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 40
      ) {
        lastTap = { t: 0, x: 0, y: 0 };
        touchDblTapAt = now;
        setZoom(1);
        return;
      }
      if (Math.hypot(dx, dy) <= TAP_SLOP && dt <= TAP_MS) {
        lastTap = { t: now, x: ev.clientX, y: ev.clientY };
      }
      return; // otherwise: panning, not a tap/swipe
    }

    const dist = Math.hypot(dx, dy);
    if (dist <= TAP_SLOP && dt <= TAP_MS) {
      const now = Date.now();
      // double-tap → zoom to that point (toggle fit ↔ 2×); touch only (mouse
      // double-click zoom is handled by onDblClick)
      if (
        isTouch &&
        settings.doubleTapZoom &&
        !isContinuous() &&
        now - lastTap.t < 300 &&
        Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 40
      ) {
        lastTap = { t: 0, x: 0, y: 0 };
        touchDblTapAt = now;
        const rect = root.getBoundingClientRect();
        setZoom(zoom > 1 ? 1 : 2, (ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height);
        return;
      }
      lastTap = { t: now, x: ev.clientX, y: ev.clientY };
      const rect = root.getBoundingClientRect();
      const zone = zoneForPoint(ev.clientX - rect.left, rect.width);
      const result = resolveTap(zone, settings.tapToTurn, settings.direction);
      if (result === 'toggle-chrome') {
        if (wantsCenterTap()) toggleChrome();
      } else if (result) turn(result);
      return;
    }
    // swipe: only horizontal swipes turn pages (vertical = native scroll)
    if (!isContinuous() && Math.abs(dx) > Math.abs(dy)) {
      const t = swipeTurn(dx, settings.direction);
      if (t) turn(t);
    }
  };

  const onContextMenu = (ev: Event) => {
    // long-press on an image would otherwise pop the "save image" menu
    if (wantsLongPress()) ev.preventDefault();
  };

  const onWheel = (ev: WheelEvent) => {
    if (ev.ctrlKey) {
      ev.preventDefault();
      const rect = root.getBoundingClientRect();
      setZoom(
        zoom * (ev.deltaY < 0 ? 1.1 : 0.9),
        (ev.clientX - rect.left) / rect.width,
        (ev.clientY - rect.top) / rect.height,
      );
      return;
    }
    if (isContinuous()) return;
    const mode = settings.scrollToTurn;
    if (mode === 'wheel' || mode === 'both') {
      ev.preventDefault();
      turn(ev.deltaY > 0 ? 'forward' : 'back');
    }
  };

  const onDblClick = () => {
    if (Date.now() - touchDblTapAt < 500) return; // handled by the touch double-tap
    if (settings.doubleClickFullscreen) void toggleFullscreen();
    else setZoom(zoom > 1 ? 1 : 2);
  };

  async function toggleFullscreen(): Promise<void> {
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await doc.documentElement.requestFullscreen?.();
    } catch {
      /* user gesture / permission — ignore */
    }
  }

  async function acquireWakeLock(): Promise<void> {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      wakeLock = null;
    }
  }

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      flushSave();
      pauseAutoscroll();
    } else if (!wakeLock) void acquireWakeLock();
  };

  // ---- public API ---------------------------------------------------------------

  function turn(dir: TurnDirection): void {
    if (!manifest) return;
    if (isContinuous()) {
      const atStart = scrollMain() <= 0;
      const atEnd = scrollMain() + viewportMain() >= clayout.total - 1;
      if (dir === 'back' && atStart) return emitter.emit('reader:start', {});
      if (dir === 'forward' && atEnd) {
        emitter.emit('reader:end', { auto: settings.nextChapterAfterLastPage });
        const nextCh = manifest.chapters?.[chapterIndexOf(currentPage()) + 1];
        if (nextCh) armChapterAdvance(nextCh);
        return;
      }
      transitions.cancel();
      animateScrollMain(scrollMain() + (dir === 'forward' ? 1 : -1) * viewportMain() * 0.9);
      return;
    }
    const target = currentSpread + (dir === 'forward' ? 1 : -1);
    if (target < 0) return emitter.emit('reader:start', {});
    if (target >= spreads.length) {
      emitter.emit('reader:end', { auto: settings.nextChapterAfterLastPage });
      return;
    }
    if (dir === 'forward' && interceptChapterBoundary(spreads[target]!.leading)) return;
    goToSpread(target);
  }

  function goto(pageIndex: number): void {
    if (!manifest) return;
    const p = Math.round(pageIndex);
    if (isContinuous()) {
      transitions.cancel();
      recomputeLayout();
      animateScrollMain(scrollForPage(clayout, slotForPage(p)));
      onScroll();
    } else {
      goToSpread(spreadIndexForPage(spreads, p));
    }
  }

  function setSettings(patch: Partial<ImageEngineSettings>): void {
    const prev = settings;
    const page = currentPage();
    settings = resolveSettings({ ...settings, ...patch });
    const structural =
      settings.layout !== prev.layout ||
      settings.direction !== prev.direction ||
      settings.spreadOffset !== prev.spreadOffset;
    // a width/height cap change rescales every page in the continuous strip —
    // drop the measured cache so the layout re-estimates at the new size
    if (
      isContinuous() &&
      (settings.maxWidth !== prev.maxWidth || settings.maxHeight !== prev.maxHeight)
    ) {
      measured.clear();
    }
    if (structural) {
      measured.clear();
      mountedImgs.clear();
      viewport.replaceChildren();
      zoom = 1;
      panX = 0;
      panY = 0;
      rebuildSpreads(page);
    }
    prefetch?.setSettings(settings);
    render();
    if (structural && isContinuous()) goto(page);

    if (settings.autoscroll !== prev.autoscroll) {
      if (settings.autoscroll) startAutoscroll();
      else stopAutoscroll();
    }
    if (settings.pagedAutoAdvanceSeconds !== prev.pagedAutoAdvanceSeconds || structural) {
      if (autoPagedTimer) clearInterval(autoPagedTimer);
      autoPagedTimer = null;
      startPagedAutoAdvance();
    }
    if (settings.chromeGesture !== prev.chromeGesture) syncHandle();
    emitter.emit('reader:settingschange', { settings, keymap });
  }

  function setKeymap(patch: Partial<Keymap>): void {
    keymap = { ...keymap, ...patch };
    emitter.emit('reader:settingschange', { settings, keymap });
  }

  async function mount(): Promise<void> {
    const m = await source.getManifest(bookId);
    if (destroyed) return;
    if (m.type !== 'image') {
      throw new Error(`createImageEngine: "${bookId}" is a ${m.type} book, not an image book`);
    }
    manifest = m;
    // `bitmap` + whole-chapter preload would pin hundreds of decoded bitmaps → force blob.
    const effectiveMethod =
      settings.loadingMethod === 'bitmap' && settings.preloadStrategy === 'all'
        ? 'blob'
        : settings.loadingMethod;
    if (effectiveMethod !== settings.loadingMethod) {
      console.warn('[pore] loadingMethod "bitmap" with preloadStrategy "all" → using "blob"');
    }
    loader = new PageLoader({
      source,
      bookId,
      loadingMethod: effectiveMethod,
      onState: (index, state) => emitter.emit('reader:loadingstate', { index, state }),
    });
    prefetch = new PrefetchScheduler({
      loader,
      pages: m.pages,
      ...(m.chapters ? { chapters: m.chapters } : {}),
      settings,
      onCapped: () => {
        if (cappedNotified) return;
        cappedNotified = true;
        emitter.emit('reader:error', { error: 'preload-all-capped' });
      },
    });

    rebuildSpreads(0);

    let restoredPage = 0;
    try {
      const saved = await source.loadProgress(bookId);
      if (destroyed) return;
      if (saved) restoredPage = clampPagePosition(saved, m.pageCount);
      emitter.emit('reader:resumed', { position: saved ?? null, page: restoredPage });
    } catch {
      if (destroyed) return;
      emitter.emit('reader:resumed', { position: null, page: 0 });
    }

    if (destroyed) return;
    container.replaceChildren(root);
    currentSpread = spreadIndexForPage(spreads, restoredPage);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => render());
      resizeObserver.observe(root);
    }
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('click', onRetryClick);
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', () => {
      pointer = null;
      clearLongPress();
    });
    syncHandle();
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('dblclick', onDblClick);
    doc.addEventListener('visibilitychange', onVisibility);
    void acquireWakeLock();

    emitter.emit('reader:ready', { manifest: m });
    emitter.emit('reader:settingschange', { settings, keymap });
    render();
    if (isContinuous() && restoredPage > 0) goto(restoredPage);
    if (settings.autoscroll) startAutoscroll();
    startPagedAutoAdvance();
  }

  function on<E extends keyof ImageEngineEvents>(
    event: E,
    handler: (payload: ImageEngineEvents[E]) => void,
  ): () => void {
    return emitter.on(event, handler);
  }

  function destroy(): void {
    flushSave();
    destroyed = true;
    renderedSpread = -1;
    transitions.cancel();
    stopAutoscroll(true);
    if (autoPagedTimer) clearInterval(autoPagedTimer);
    if (autoResumeTimer) clearTimeout(autoResumeTimer);
    if (advanceTimer) clearTimeout(advanceTimer);
    clearLongPress();
    handle.destroy();
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('scroll', onScroll);
    root.removeEventListener('click', onRetryClick);
    root.removeEventListener('contextmenu', onContextMenu);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('dblclick', onDblClick);
    doc.removeEventListener('visibilitychange', onVisibility);
    resizeObserver?.disconnect();
    prefetch?.destroy();
    loader?.destroy();
    void wakeLock?.release().catch(() => {});
    wakeLock = null;
    mountedImgs.clear();
    emitter.clear();
    root.remove();
  }

  return { mount, goto, turn, setSettings, setKeymap, on, destroy, chapters: engineChapters };
}
