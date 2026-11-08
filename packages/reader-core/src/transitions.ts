/**
 * The animation seam. `reader-core` never imports an animation library; it
 * routes every visually-animatable move (page slide, zoom, programmatic scroll)
 * through a {@link ReaderTransitions} the host supplies. The default,
 * {@link instantTransitions}, applies changes synchronously — identical to the
 * pre-seam behaviour and zero cost.
 *
 * `porejs-react` ships a `gsapAdapter(gsap)` that implements this.
 */

export interface TransitionContext {
  /** Axis the move happens on. */
  axis: 'x' | 'y';
  /** +1 forward, -1 backward, 0 for a jump/resize. */
  dir: -1 | 0 | 1;
  /** `prefers-reduced-motion` is active — adapters should apply instantly. */
  reduced: boolean;
}

export interface ReaderTransitions {
  /**
   * Move a paginated flow element from `from`px to `to`px along `ctx.axis`
   * (a `translate` on that axis). The default just sets the final transform.
   */
  page(el: HTMLElement, from: number, to: number, ctx: TransitionContext): void;
  /** Apply a zoom / pan transform string to `el`. */
  zoom(el: HTMLElement, transform: string, reduced: boolean): void;
  /** Move `el[prop]` (a scroll offset) to `to`. */
  scrollTo(el: HTMLElement, prop: 'scrollTop' | 'scrollLeft', to: number, reduced: boolean): void;
  /** Kill any in-flight animation — called on rapid input so nothing queues. */
  cancel(): void;
}

const translate = (axis: 'x' | 'y', px: number): string =>
  axis === 'x' ? `translateX(${px}px)` : `translateY(${px}px)`;

/** Synchronous, allocation-free. The engines' default. */
export const instantTransitions: ReaderTransitions = {
  page(el, _from, to, ctx) {
    el.style.transform = translate(ctx.axis, to);
  },
  zoom(el, transform) {
    el.style.transform = transform;
  },
  scrollTo(el, prop, to) {
    el[prop] = to;
  },
  cancel() {},
};
