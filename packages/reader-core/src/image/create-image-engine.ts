import type { ImageManifest } from '../source/types.js';
import type { Position } from '../position/types.js';
import type { ImageEngineSettings } from '../settings/types.js';
import type { Keymap } from '../settings/keymap.js';
import { resolveKeymap, resolveSettings } from '../settings/merge.js';
import { clampPagePosition } from '../position/position.js';
import type { TurnDirection } from '../types.js';
import { createEmitter } from '../internal/emitter.js';
import { PaceEstimator } from '../progress.js';
import { instantTransitions } from '../transitions.js';
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
  pageAtOffset,
  scrollForPage,
  type ContinuousAxis,
  type LinearLayout,
} from './continuous.js';
import { PageLoader } from './page-loader.js';
import { PrefetchScheduler } from './prefetch.js';
import { ImageZoomController } from './image-zoom.js';
import { ImageAutoNavCoordinator } from './image-autonav.js';
import {
  applyImageContainerStyle,
  applyImageFilters,
  applyImageFitStyle,
  buildImageLocationAndProgress,
  createImageDomShell,
  engineChaptersForManifest,
  isReverseDirection,
  physicalToLogical,
  syncImagePrefetchAndRetain,
} from './image-fit-style.js';
import {
  OVERSCAN_PX,
  computeContinuousLayoutState,
  loadIntoImageElement,
  renderContinuousStripDom,
  renderPagedSpreadDom,
} from './image-render-helpers.js';
import { createImageInputController } from './image-input-handlers.js';

export { isReverseDirection, physicalToLogical };

const SAVE_DEBOUNCE_MS = 800;

export function createImageEngine(options: ImageEngineOptions): ImageEngine {
  const emitter = createEmitter<ImageEngineEvents>();
  const { container, source, bookId } = options;
  const doc = container.ownerDocument;
  let settings = resolveSettings(options.settings);
  let keymap: Keymap = resolveKeymap(options.keymap);
  const transitions = options.transitions ?? instantTransitions;
  const pace = new PaceEstimator(8);
  let manifest: ImageManifest | null = null;
  let loader: PageLoader | null = null;
  let prefetch: PrefetchScheduler | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let cappedNotified = false;
  let currentSpread = 0;
  let renderedSpread = -1;
  let pagedRenderToken = 0;
  let spreads: Spread[] = [];
  let slotToPage: number[] = [];
  let clayout: LinearLayout = { sizes: [], offsets: [], total: 0 };
  const measured = new Map<number, number>();
  const mountedImgs = new Map<number, HTMLImageElement>();

  const prefersReducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isContinuous = () =>
    settings.layout === 'continuous-vertical' || settings.layout === 'continuous-horizontal';
  const axis = (): ContinuousAxis => (settings.layout === 'continuous-horizontal' ? 'x' : 'y');
  const scrollMain = (): number => (axis() === 'x' ? root.scrollLeft : root.scrollTop);
  const setScrollMain = (v: number) => {
    if (axis() === 'x') root.scrollLeft = v;
    else root.scrollTop = v;
  };
  const animateScrollMain = (v: number) =>
    transitions.scrollTo(
      root,
      axis() === 'x' ? 'scrollLeft' : 'scrollTop',
      v,
      prefersReducedMotion(),
    );
  const viewportMain = (): number => (axis() === 'x' ? root.clientWidth : root.clientHeight) || 1;
  const stripWidth = (): number => {
    const w = root.clientWidth || 800;
    return settings.maxWidth && settings.maxWidth > 0 ? Math.min(w, settings.maxWidth) : w;
  };

  const { root, viewport, dimEl } = createImageDomShell(doc);
  const zoomController = new ImageZoomController({
    viewport,
    isContinuous,
    prefersReducedMotion,
    transitions,
    onZoomChange: (scale) => emitter.emit('reader:zoomchange', { scale }),
  });
  const autonav = new ImageAutoNavCoordinator({
    isContinuous,
    prefersReducedMotion,
    getSettings: () => settings,
    getManifest: () => manifest,
    getCurrentPage: () => currentPage(),
    scrollMain,
    setScrollMain,
    viewportMain,
    turn: (dir) => turn(dir),
    goto: (target) => goto(target),
    onScroll: () => onScroll(),
    emitAutoscroll: (running) => emitter.emit('reader:autoscroll', { running }),
    emitAutoAdvance: (payload) => emitter.emit('reader:autoadvance', payload),
    emitEnd: (payload) => emitter.emit('reader:end', payload),
  });
  const currentPage = (): number =>
    !isContinuous()
      ? (spreads[currentSpread]?.leading ?? 0)
      : (slotToPage[pageAtOffset(clayout, scrollMain())] ?? 0);
  const positionFor = (): Position => {
    const total = manifest?.pageCount ?? 0;
    const value = clayout.total > 0 ? scrollMain() / clayout.total : 0;
    return isContinuous()
      ? { type: 'scroll', value, total, page: currentPage() }
      : { type: 'page', value: currentPage(), total };
  };
  const flushSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (manifest && !destroyed) void source.saveProgress(bookId, positionFor()).catch(() => {});
  };
  const emitLocation = () => {
    if (!manifest) return;
    const { loc, progress } = buildImageLocationAndProgress({
      manifest,
      page: currentPage(),
      position: positionFor(),
      chapters: engineChaptersForManifest(manifest),
      pace,
    });
    emitter.emit('reader:locationchange', loc);
    emitter.emit('reader:progress', progress);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };
  const loadInto = (img: HTMLImageElement, pageIndex: number) =>
    loadIntoImageElement({
      img,
      pageIndex,
      loader,
      isDestroyed: () => destroyed,
      onLoadingState: (index, state) => emitter.emit('reader:loadingstate', { index, state }),
      onError: (index, error) => emitter.emit('reader:error', { index, error }),
    });
  const onRetryClick = (ev: MouseEvent) => {
    const img = (ev.target as HTMLElement | null)?.closest?.(
      'img[data-pore-page-error]',
    ) as HTMLImageElement | null;
    const n = Number(img?.getAttribute('data-pore-page-error'));
    if (!img || !Number.isFinite(n) || n < 1) return;
    ev.stopPropagation();
    img.removeAttribute('role');
    applyImageFitStyle(
      img,
      settings,
      !isContinuous() && spreads[currentSpread]?.pages.length === 2,
      prefersReducedMotion(),
    );
    loader?.forget(n - 1);
    loadInto(img, n - 1);
  };

  const maybeDiscoverWideDims = (pageIndex: number, w: number, h: number) => {
    const p = manifest?.pages[pageIndex];
    if (
      destroyed ||
      !manifest ||
      settings.layout !== 'paged-double' ||
      !p ||
      p.isWide !== undefined
    )
      return;
    if (!isNaturallyWide(p, w, h)) return;
    p.isWide = true;
    rebuildSpreads(currentPage());
    render();
  };

  const recomputeLayout = () => {
    if (!manifest) return;
    const next = computeContinuousLayoutState({
      manifest,
      rtlHorizontal: axis() === 'x' && settings.direction === 'rtl',
      measured,
      axis: axis(),
      crossSize: axis() === 'x' ? root.clientHeight || 1000 : stripWidth(),
      fallbackMain: viewportMain(),
      gap: settings.pageGap,
    });
    slotToPage = next.slotToPage;
    clayout = next.clayout;
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

  const renderContinuous = () => {
    if (manifest)
      renderContinuousStripDom({
        doc,
        viewport,
        manifest,
        axis: axis(),
        clayout,
        slotToPage,
        mountedImgs,
        scrollMain: scrollMain(),
        viewportMain: viewportMain(),
        stripWidth: stripWidth(),
        prefersReducedMotion: prefersReducedMotion(),
        loadInto,
        onMeasurePage: measurePage,
      });
  };

  const finishRenderPass = () => {
    applyImageFilters(viewport, settings);
    syncImagePrefetchAndRetain({
      loader,
      prefetch,
      manifest,
      settings,
      page: currentPage(),
      isContinuous: isContinuous(),
      clayout,
      slotToPage,
      scrollMain: scrollMain(),
      viewportMain: viewportMain(),
      overscanPx: OVERSCAN_PX,
    });
    emitLocation();
  };

  const render = () => {
    if (!manifest || destroyed) return;
    applyImageContainerStyle(root, dimEl, settings, isContinuous(), axis());
    if (isContinuous()) {
      recomputeLayout();
      renderContinuous();
    } else {
      const spread = spreads[currentSpread];
      if (spread)
        renderPagedSpreadDom({
          doc,
          viewport,
          spread,
          currentSpread,
          renderedSpread,
          setRenderedSpread: (s) => (renderedSpread = s),
          nextToken: () => ++pagedRenderToken,
          getToken: () => pagedRenderToken,
          getCurrentSpread: () => currentSpread,
          isDestroyed: () => destroyed,
          bitmapMode: settings.loadingMethod === 'bitmap' && settings.preloadStrategy !== 'all',
          loader,
          manifest,
          settings,
          prefersReducedMotion: prefersReducedMotion(),
          loadInto,
          maybeDiscoverWideDims,
        });
      zoomController.apply();
    }
    finishRenderPass();
  };

  const onScroll = () => {
    if (destroyed || !isContinuous()) return;
    renderContinuous();
    finishRenderPass();
  };

  const rebuildSpreads = (preserveLeadingPage?: number) => {
    if (!manifest) return;
    pagedRenderToken++;
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

  const inputCtrl = createImageInputController({
    root,
    doc,
    getSettings: () => settings,
    getKeymap: () => keymap,
    getManifest: () => manifest,
    getZoom: () => zoomController.zoom,
    isContinuous,
    scrollMain,
    setScrollMain,
    viewportMain,
    turn: (dir) => turn(dir),
    goto: (target) => goto(target),
    setSettings: (patch) => setSettings(patch),
    cancelAutoAdvance: () => autonav.cancelAutoAdvance(),
    pauseAutoscroll: () => autonav.pauseAutoscroll(),
    flushSave,
    onScroll: () => onScroll(),
    onRetryClick,
    onChromeToggle: (visible) => emitter.emit('reader:chrometoggle', { visible }),
  });

  function turn(dir: TurnDirection): void {
    if (!manifest) return;
    if (isContinuous()) {
      if (dir === 'back' && scrollMain() <= 0) return emitter.emit('reader:start', {});
      if (dir === 'forward' && scrollMain() + viewportMain() >= clayout.total - 1) {
        emitter.emit('reader:end', { auto: settings.nextChapterAfterLastPage });
        const nextCh = manifest.chapters?.[autonav.chapterIndexOf(currentPage()) + 1];
        if (nextCh) autonav.armChapterAdvance(nextCh);
        return;
      }
      transitions.cancel();
      animateScrollMain(scrollMain() + (dir === 'forward' ? 1 : -1) * viewportMain() * 0.9);
      return;
    }
    const target = currentSpread + (dir === 'forward' ? 1 : -1);
    if (target < 0) return emitter.emit('reader:start', {});
    if (target >= spreads.length)
      return emitter.emit('reader:end', { auto: settings.nextChapterAfterLastPage });
    if (dir === 'forward' && autonav.interceptChapterBoundary(spreads[target]!.leading)) return;
    currentSpread = clampSpreadIndex(spreads, target);
    render();
  }

  function goto(pageIndex: number): void {
    if (!manifest) return;
    const p = Math.round(pageIndex);
    if (isContinuous()) {
      transitions.cancel();
      recomputeLayout();
      animateScrollMain(scrollForPage(clayout, Math.max(0, slotToPage.indexOf(p))));
      onScroll();
    } else {
      currentSpread = clampSpreadIndex(spreads, spreadIndexForPage(spreads, p));
      render();
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
    if (
      isContinuous() &&
      (settings.maxWidth !== prev.maxWidth || settings.maxHeight !== prev.maxHeight)
    )
      measured.clear();
    if (structural) {
      measured.clear();
      mountedImgs.clear();
      viewport.replaceChildren();
      zoomController.reset();
      rebuildSpreads(page);
    }
    prefetch?.setSettings(settings);
    render();
    if (structural && isContinuous()) goto(page);
    if (settings.autoscroll !== prev.autoscroll) {
      if (settings.autoscroll) autonav.startAutoscroll();
      else autonav.stopAutoscroll();
    }
    if (settings.pagedAutoAdvanceSeconds !== prev.pagedAutoAdvanceSeconds || structural) {
      autonav.stopPagedAutoAdvance();
      autonav.startPagedAutoAdvance();
    }
    if (settings.chromeGesture !== prev.chromeGesture) inputCtrl.syncHandle();
    emitter.emit('reader:settingschange', { settings, keymap });
  }

  function setKeymap(patch: Partial<Keymap>): void {
    keymap = { ...keymap, ...patch };
    emitter.emit('reader:settingschange', { settings, keymap });
  }
  async function mount(): Promise<void> {
    const m = await source.getManifest(bookId);
    if (destroyed) return;
    if (m.type !== 'image')
      throw new Error(`createImageEngine: "${bookId}" is a ${m.type} book, not an image book`);
    manifest = m;
    const effectiveMethod =
      settings.loadingMethod === 'bitmap' && settings.preloadStrategy === 'all'
        ? 'blob'
        : settings.loadingMethod;
    if (effectiveMethod !== settings.loadingMethod)
      console.warn('[pore] loadingMethod "bitmap" with preloadStrategy "all" → using "blob"');
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
        if (!cappedNotified) {
          cappedNotified = true;
          emitter.emit('reader:error', { error: 'preload-all-capped' });
        }
      },
    });
    rebuildSpreads(0);
    const saved = await source.loadProgress(bookId).catch(() => null);
    if (destroyed) return;
    const restoredPage = saved ? clampPagePosition(saved, m.pageCount) : 0;
    emitter.emit('reader:resumed', { position: saved ?? null, page: restoredPage });
    container.replaceChildren(root);
    currentSpread = spreadIndexForPage(spreads, restoredPage);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => render());
      resizeObserver.observe(root);
    }
    inputCtrl.wireRootInput();
    emitter.emit('reader:ready', { manifest: m });
    emitter.emit('reader:settingschange', { settings, keymap });
    render();
    if (isContinuous() && restoredPage > 0) goto(restoredPage);
    if (settings.autoscroll) autonav.startAutoscroll();
    autonav.startPagedAutoAdvance();
  }
  function destroy(): void {
    flushSave();
    destroyed = true;
    pagedRenderToken++;
    renderedSpread = -1;
    transitions.cancel();
    autonav.destroy();
    inputCtrl.destroyInput();
    resizeObserver?.disconnect();
    prefetch?.destroy();
    loader?.destroy();
    mountedImgs.clear();
    emitter.clear();
    root.remove();
  }

  return {
    mount,
    goto,
    turn,
    setSettings,
    setKeymap,
    on: (ev, h) => emitter.on(ev, h),
    destroy,
    chapters: () => engineChaptersForManifest(manifest),
  };
}
