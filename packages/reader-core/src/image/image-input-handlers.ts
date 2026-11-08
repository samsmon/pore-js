import type { ImageManifest } from '../source/types.js';
import type { ImageEngineSettings } from '../settings/types.js';
import type { Keymap } from '../settings/keymap.js';
import { resolveAction } from '../settings/keymap.js';
import type { TurnDirection } from '../types.js';
import { createChromeHandle } from '../chrome-handle.js';
import { resolveTap, swipeTurn, zoneForPoint } from './input.js';
import { FIT_CYCLE, physicalToLogical } from './image-fit-style.js';

const TAP_SLOP = 10;
const TAP_MS = 350;

export interface ImageInputControllerDeps {
  root: HTMLElement;
  doc: Document;
  getSettings: () => ImageEngineSettings;
  getKeymap: () => Keymap;
  getManifest: () => ImageManifest | null;
  getZoom: () => number;
  isContinuous: () => boolean;
  scrollMain: () => number;
  setScrollMain: (v: number) => void;
  viewportMain: () => number;
  turn: (dir: TurnDirection) => void;
  goto: (target: number) => void;
  setSettings: (patch: Partial<ImageEngineSettings>) => void;
  cancelAutoAdvance: () => void;
  pauseAutoscroll: () => void;
  flushSave: () => void;
  onScroll: () => void;
  onRetryClick: (ev: MouseEvent) => void;
  onChromeToggle: (visible: boolean) => void;
}

export function createImageInputController(deps: ImageInputControllerDeps) {
  const { root, doc } = deps;
  let chromeVisible = deps.getSettings().headerVisible;
  let pointer: { x: number; y: number; t: number; id: number } | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  let touchDblTapAt = 0;

  const toggleChrome = (): void => {
    chromeVisible = !chromeVisible;
    handle.setChromeOpen(chromeVisible);
    deps.onChromeToggle(chromeVisible);
  };

  const handle = createChromeHandle({ root, doc, onToggle: toggleChrome });

  const syncHandle = (): void => {
    const g = deps.getSettings().chromeGesture;
    handle.setActive(g === 'handle' || g === 'handle+long-press');
  };

  const wantsLongPress = (): boolean => {
    const g = deps.getSettings().chromeGesture;
    return g === 'long-press' || g === 'handle+long-press';
  };

  const wantsCenterTap = (): boolean => deps.getSettings().chromeGesture === 'tap-center';

  const clearLongPress = (): void => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
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

  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') {
      deps.flushSave();
      deps.pauseAutoscroll();
    } else if (!wakeLock) void acquireWakeLock();
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const settings = deps.getSettings();
    const action = resolveAction(deps.getKeymap(), ev.key);
    if (!action) return;
    switch (action) {
      case 'page-right':
      case 'page-left':
        ev.preventDefault();
        deps.turn(physicalToLogical(action, settings.direction));
        break;
      case 'scroll-up':
      case 'scroll-down':
        if (deps.isContinuous()) {
          ev.preventDefault();
          deps.setScrollMain(
            deps.scrollMain() + (action === 'scroll-down' ? 1 : -1) * deps.viewportMain() * 0.9,
          );
        }
        break;
      case 'first-page':
        ev.preventDefault();
        deps.goto(0);
        break;
      case 'last-page':
        ev.preventDefault();
        deps.goto((deps.getManifest()?.pageCount ?? 1) - 1);
        break;
      case 'cycle-fit':
        ev.preventDefault();
        deps.setSettings({
          fit: FIT_CYCLE[(FIT_CYCLE.indexOf(settings.fit) + 1) % FIT_CYCLE.length]!,
        });
        break;
      case 'toggle-spread-offset':
        ev.preventDefault();
        deps.setSettings({ spreadOffset: settings.spreadOffset === 1 ? 0 : 1 });
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
        deps.setSettings({ autoscroll: !settings.autoscroll });
        break;
      default:
        break;
    }
    if (action === 'page-right' || action === 'page-left' || action === 'first-page') {
      deps.cancelAutoAdvance();
    }
  };

  const onPointerDown = (ev: PointerEvent): void => {
    pointer = { x: ev.clientX, y: ev.clientY, t: Date.now(), id: ev.pointerId };
    deps.cancelAutoAdvance();
    deps.pauseAutoscroll();
    handle.wake();
    clearLongPress();
    if (wantsLongPress() && deps.getZoom() === 1 && ev.pointerType !== 'mouse') {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        pointer = null;
        try {
          navigator.vibrate?.(10);
        } catch {
          /* not supported */
        }
        toggleChrome();
      }, 450);
    }
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!pointer || ev.pointerId !== pointer.id) return;
    if (Math.hypot(ev.clientX - pointer.x, ev.clientY - pointer.y) > TAP_SLOP) clearLongPress();
  };

  const onPointerUp = (ev: PointerEvent): void => {
    clearLongPress();
    if (!pointer || ev.pointerId !== pointer.id) return;
    if ((ev.target as HTMLElement | null)?.closest?.('img[data-pore-page-error]')) {
      pointer = null;
      return;
    }
    const dx = ev.clientX - pointer.x;
    const dy = ev.clientY - pointer.y;
    const dt = Date.now() - pointer.t;
    pointer = null;
    const isTouch = ev.pointerType !== 'mouse';
    const settings = deps.getSettings();

    const dist = Math.hypot(dx, dy);
    if (dist <= TAP_SLOP && dt <= TAP_MS) {
      const now = Date.now();
      if (isTouch && now - lastTap.t < 300) {
        touchDblTapAt = now;
      }
      lastTap = { t: now, x: ev.clientX, y: ev.clientY };
      const rect = root.getBoundingClientRect();
      const zone = zoneForPoint(ev.clientX - rect.left, rect.width);
      const result = resolveTap(zone, settings.tapToTurn, settings.direction);
      if (result === 'toggle-chrome') {
        if (wantsCenterTap()) toggleChrome();
      } else if (result) deps.turn(result);
      return;
    }
    if (!deps.isContinuous() && Math.abs(dx) > Math.abs(dy)) {
      const t = swipeTurn(dx, settings.direction);
      if (t) deps.turn(t);
    }
  };

  const onPointerCancel = (): void => {
    pointer = null;
    clearLongPress();
  };

  const onContextMenu = (ev: Event): void => {
    if (wantsLongPress()) ev.preventDefault();
  };

  const onWheel = (ev: WheelEvent): void => {
    if (ev.ctrlKey || deps.isContinuous()) return;
    const mode = deps.getSettings().scrollToTurn;
    if (mode === 'wheel' || mode === 'both') {
      ev.preventDefault();
      deps.turn(ev.deltaY > 0 ? 'forward' : 'back');
    }
  };

  const onDblClick = (): void => {
    if (Date.now() - touchDblTapAt < 500) return;
    if (deps.getSettings().doubleClickFullscreen) void toggleFullscreen();
  };

  const wireRootInput = (): void => {
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('scroll', deps.onScroll, { passive: true });
    root.addEventListener('click', deps.onRetryClick);
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerCancel);
    syncHandle();
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('dblclick', onDblClick);
    doc.addEventListener('visibilitychange', onVisibility);
    void acquireWakeLock();
  };

  const destroyInput = (): void => {
    clearLongPress();
    handle.destroy();
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('scroll', deps.onScroll);
    root.removeEventListener('click', deps.onRetryClick);
    root.removeEventListener('contextmenu', onContextMenu);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('dblclick', onDblClick);
    doc.removeEventListener('visibilitychange', onVisibility);
    void wakeLock?.release().catch(() => {});
    wakeLock = null;
  };

  return {
    syncHandle,
    wireRootInput,
    destroyInput,
  };
}
