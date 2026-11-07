import type { ReaderTransitions } from '../transitions.js';
import { clampZoom } from './input.js';

export { clampZoom };

/** Calculate new zoom level from mouse wheel delta. */
export function calculateWheelZoom(currentZoom: number, deltaY: number): number {
  return currentZoom * (deltaY < 0 ? 1.1 : 0.9);
}

/** Toggle zoom level (fit ↔ 2×). */
export function calculateToggleZoom(currentZoom: number): number {
  return currentZoom > 1 ? 1 : 2;
}

export interface ImageZoomControllerOptions {
  viewport: HTMLElement;
  isContinuous: () => boolean;
  prefersReducedMotion: () => boolean;
  transitions: ReaderTransitions;
  onZoomChange?: ((scale: number) => void) | undefined;
}

/**
 * Owns zoom scale and pan coordinates for fixed-paged image reading.
 * Manages viewport CSS transforms, wheel zooming, and double-tap toggle zoom.
 */
export class ImageZoomController {
  #viewport: HTMLElement;
  #isContinuous: () => boolean;
  #prefersReducedMotion: () => boolean;
  #transitions: ReaderTransitions;
  #onZoomChange?: ((scale: number) => void) | undefined;

  #zoom = 1;
  #panX = 0;
  #panY = 0;

  constructor(opts: ImageZoomControllerOptions) {
    this.#viewport = opts.viewport;
    this.#isContinuous = opts.isContinuous;
    this.#prefersReducedMotion = opts.prefersReducedMotion;
    this.#transitions = opts.transitions;
    this.#onZoomChange = opts.onZoomChange;
  }

  get zoom(): number {
    return this.#zoom;
  }

  get panX(): number {
    return this.#panX;
  }

  get panY(): number {
    return this.#panY;
  }

  apply(): void {
    if (this.#isContinuous()) return;
    const value =
      this.#zoom === 1 && this.#panX === 0 && this.#panY === 0
        ? ''
        : `translate(${this.#panX}px, ${this.#panY}px) scale(${this.#zoom})`;
    this.#transitions.zoom(this.#viewport, value, this.#prefersReducedMotion());
  }

  setZoom(next: number, originX = 0.5, originY = 0.5): void {
    const clamped = clampZoom(next);
    if (clamped === this.#zoom) return;
    this.#zoom = clamped;
    if (this.#zoom === 1) {
      this.#panX = 0;
      this.#panY = 0;
    } else {
      this.#viewport.style.transformOrigin = `${originX * 100}% ${originY * 100}%`;
    }
    this.apply();
    this.#onZoomChange?.(this.#zoom);
  }

  panBy(dx: number, dy: number): void {
    if (this.#zoom === 1) return;
    this.#panX += dx;
    this.#panY += dy;
    this.apply();
  }

  reset(): void {
    this.#zoom = 1;
    this.#panX = 0;
    this.#panY = 0;
  }

  handleWheel(ev: WheelEvent, rect: DOMRect): boolean {
    if (!ev.ctrlKey) return false;
    ev.preventDefault();
    this.setZoom(
      calculateWheelZoom(this.#zoom, ev.deltaY),
      (ev.clientX - rect.left) / rect.width,
      (ev.clientY - rect.top) / rect.height,
    );
    return true;
  }

  handleDoubleTap(clientX: number, clientY: number, rect: DOMRect): void {
    const next = calculateToggleZoom(this.#zoom);
    this.setZoom(next, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
  }

  toggleZoom(originX = 0.5, originY = 0.5): void {
    const next = calculateToggleZoom(this.#zoom);
    this.setZoom(next, originX, originY);
  }
}
