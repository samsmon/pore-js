import { createChromeHandle } from '../chrome-handle.js';
import type { EpubBook } from './epub/types.js';
import type { TextEngineSettings } from './types.js';

export interface TextInputControllerDeps {
  root: HTMLElement;
  doc: Document;
  getDocument: () => Document | null;
  getBook: () => EpubBook | null;
  getSettings: () => TextEngineSettings;
  isVertical: () => boolean;
  totalPages: () => number;
  currentHref: () => string;
  turn: (dir: 'forward' | 'back') => void;
  goto: (target: number) => void;
  onSelectionChange: () => void;
  onChromeToggle: (visible: boolean) => void;
  onOpenFootnote: (href: string) => void;
  onGotoRelativeHref: (href: string, fromHref: string) => void;
}

export function createTextInputController(deps: TextInputControllerDeps) {
  const { root, doc } = deps;
  let chromeVisible = true;
  let lastWheel = 0;
  let lastSwipeAt = 0;
  let lastPointerFwd = 0;
  let swipe: { x: number; y: number; t: number; id: number } | null = null;
  let lpTimer: ReturnType<typeof setTimeout> | null = null;

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

  const clearLp = (): void => {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = null;
    }
  };

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.pointerType === 'mouse') {
      swipe = null;
      return;
    }
    swipe = { x: ev.clientX, y: ev.clientY, t: Date.now(), id: ev.pointerId };
    handle.wake();
    clearLp();
    if (wantsLongPress()) {
      lpTimer = setTimeout(() => {
        lpTimer = null;
        swipe = null;
        try {
          navigator.vibrate?.(10);
        } catch {
          /* unsupported */
        }
        toggleChrome();
      }, 450);
    }
  };

  const onPointerMoveSwipe = (ev: PointerEvent): void => {
    if (swipe && Math.hypot(ev.clientX - swipe.x, ev.clientY - swipe.y) > 10) clearLp();
  };

  const onPointerUp = (ev: PointerEvent): void => {
    clearLp();
    if (!swipe || ev.pointerId !== swipe.id) return;
    const dx = ev.clientX - swipe.x;
    const dy = ev.clientY - swipe.y;
    const dt = Date.now() - swipe.t;
    swipe = null;
    if (dt > 600 || Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy)) return;
    const rtl = deps.getBook()?.metadata.direction === 'rtl';
    const forward = dx < 0 ? !rtl : rtl;
    lastSwipeAt = Date.now();
    deps.turn(forward ? 'forward' : 'back');
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    const reverse = deps.getBook()?.metadata.direction === 'rtl';
    const rightKeys = ['ArrowRight', 'd', 'D', 'l'];
    const leftKeys = ['ArrowLeft', 'a', 'A', 'h'];
    const horizFwd = reverse ? leftKeys : rightKeys;
    const horizBack = reverse ? rightKeys : leftKeys;
    const fwd = [...horizFwd, 'ArrowDown', 'PageDown', ' '].includes(k) && !ev.shiftKey;
    const back = [...horizBack, 'ArrowUp', 'PageUp'].includes(k) || (k === ' ' && ev.shiftKey);
    if (fwd) {
      ev.preventDefault();
      deps.turn('forward');
    } else if (back) {
      ev.preventDefault();
      deps.turn('back');
    } else if (k === 'Home') {
      ev.preventDefault();
      deps.goto(0);
    } else if (k === 'End') {
      ev.preventDefault();
      deps.goto(deps.totalPages() - 1);
    } else if (k === 'm' || k === 'M') {
      ev.preventDefault();
      toggleChrome();
    }
  };

  const onWheel = (ev: WheelEvent): void => {
    if (ev.ctrlKey) return;
    const now = Date.now();
    const horizontal = deps.isVertical() && Math.abs(ev.deltaX) > Math.abs(ev.deltaY);
    const delta = horizontal ? -ev.deltaX : ev.deltaY;
    if (Math.abs(delta) < 4 || now - lastWheel < 320) return;
    lastWheel = now;
    ev.preventDefault();
    deps.turn(delta > 0 ? 'forward' : 'back');
  };

  const onClick = (ev: MouseEvent): void => {
    if (Date.now() - lastSwipeAt < 450) return;
    if ((ev.target as Element | null)?.closest?.('a, button, [data-pore-chrome-handle]')) return;
    const rect = root.getBoundingClientRect();
    const r = rect.width > 0 ? (ev.clientX - rect.left) / rect.width : 0.5;
    const rtl = deps.getBook()?.metadata.direction === 'rtl';
    if (r < 1 / 3) deps.turn(rtl ? 'forward' : 'back');
    else if (r > 2 / 3) deps.turn(rtl ? 'back' : 'forward');
    else if (wantsCenterTap()) toggleChrome();
  };

  const forwardPointerActivity = (): void => {
    const now = Date.now();
    if (now - lastPointerFwd < 400) return;
    lastPointerFwd = now;
    root.dispatchEvent(new Event('pointermove', { bubbles: true }));
  };

  const wireFrameInput = (): void => {
    const cdoc = deps.getDocument();
    if (!cdoc) return;
    cdoc.addEventListener('keydown', onKey);
    cdoc.addEventListener('wheel', onWheel, { passive: false });
    cdoc.addEventListener('click', onClick);
    cdoc.addEventListener('selectionchange', deps.onSelectionChange);
    cdoc.addEventListener('pointermove', forwardPointerActivity, { passive: true });
    cdoc.addEventListener('pointerdown', onPointerDown);
    cdoc.addEventListener('pointermove', onPointerMoveSwipe, { passive: true });
    cdoc.addEventListener('pointerup', onPointerUp);
    cdoc.addEventListener('pointercancel', () => {
      swipe = null;
      clearLp();
    });
  };

  const wireFrameLinks = (): void => {
    const cdoc = deps.getDocument();
    if (!cdoc) return;
    cdoc.addEventListener('click', (ev) => {
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      const isNote =
        a.getAttribute('epub:type')?.includes('noteref') ||
        a.getAttribute('type')?.includes('noteref');
      if (href.startsWith('#') || isNote) {
        ev.preventDefault();
        deps.onOpenFootnote(href);
      } else if (!/^[a-z]+:/i.test(href)) {
        ev.preventDefault();
        deps.onGotoRelativeHref(href, deps.currentHref());
      }
    });
  };

  const wireRootInput = (): void => {
    root.addEventListener('keydown', onKey);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMoveSwipe, { passive: true });
    root.addEventListener('pointerup', onPointerUp);
  };

  const destroyInput = (): void => {
    clearLp();
    handle.destroy();
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('click', onClick);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMoveSwipe);
    root.removeEventListener('pointerup', onPointerUp);
  };

  return {
    getChromeVisible: () => chromeVisible,
    syncHandle,
    wireRootInput,
    wireFrameInput,
    wireFrameLinks,
    destroyInput,
  };
}
