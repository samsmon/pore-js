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
    return 1;
  }

  get panX(): number {
    return 0;
  }

  get panY(): number {
    return 0;
  }

  apply(): void {
    if (this.#isContinuous()) return;
    this.#transitions.zoom(this.#viewport, '', this.#prefersReducedMotion());
  }

  setZoom(_next: number, _originX = 0.5, _originY = 0.5): void {
    this.#zoom = 1;
    this.#panX = 0;
    this.#panY = 0;
    this.apply();
  }

  panBy(_dx: number, _dy: number): void {
    // Zoom is locked at 1.0; no panning
  }

  reset(): void {
    this.#zoom = 1;
    this.#panX = 0;
    this.#panY = 0;
    this.apply();
  }

  handleWheel(_ev: WheelEvent, _rect: DOMRect): boolean {
    return false;
  }

  handleDoubleTap(_clientX: number, _clientY: number, _rect: DOMRect): void {
    // Zooming is disabled
  }

  toggleZoom(_originX = 0.5, _originY = 0.5): void {
    // Zooming is disabled
  }
}
