/**
 * Shared primitive types used across sources, settings, and engines.
 * Kept in one place so every module agrees on the vocabulary.
 */

/** Reading / page-progression direction. */
export type Direction = 'ltr' | 'rtl' | 'vertical';

/** Image-book layout mode. See docs/image-engine-spec.md §3. */
export type LayoutMode =
  'paged-single' | 'paged-double' | 'continuous-vertical' | 'continuous-horizontal';

/** Image fit mode. See docs/image-engine-spec.md §4.1. */
export type FitMode = 'width' | 'height' | 'contain' | 'original' | 'smart';

/** Server-side image variant a source may offer. */
export type Variant = 'orig' | 'w800' | 'w1600' | 'webp';

/** Logical turn direction, resolved from physical input via {@link Direction}. */
export type TurnDirection = 'forward' | 'back';

/**
 * How the reader surface asks to toggle the host chrome (`reader:chrometoggle`).
 * - `handle`  — a small idle-fading affordance at the bottom-centre (default)
 * - `tap-center` — a tap in the middle third of the surface
 * - `long-press` — a ~450ms press that doesn't move
 * - `handle+long-press` — both
 * - `none` — the engine never asks; the host drives it
 */
export type ChromeGesture = 'handle' | 'tap-center' | 'long-press' | 'handle+long-press' | 'none';
