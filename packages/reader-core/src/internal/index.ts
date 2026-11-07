/**
 * porejs/internal — lower-level building blocks.
 *
 * NOT covered by the package's SemVer contract. These are the pieces the
 * engines are built from: layout math, the anchor/pagination internals, the
 * tiny store/emitter, fixture-manifest parsing. Useful if you are extending or
 * re-implementing an engine; expect them to move between minor versions.
 *
 * The stable surface is `porejs` (see docs/stability.md).
 */

// tiny reactive primitives
export { createStore } from './store.js';
export type { Store } from './store.js';
export { createEmitter } from './emitter.js';
export type { Emitter } from './emitter.js';

// image-engine internals: spread pairing, tap/swipe zones, virtualization math
export { buildSpreads, spreadIndexForPage, isNaturallyWide } from '../image/spreads.js';
export type { Spread } from '../image/spreads.js';
export { zoneForPoint, resolveTap, swipeTurn, clampZoom } from '../image/input.js';
export type { TapZone, TapResult, TapToTurn } from '../image/input.js';
export {
  estimateLinearLayout,
  estimateVerticalLayout,
  visibleRange,
  pageAtOffset,
  scrollForPage,
} from '../image/continuous.js';
export type { LinearLayout, ContinuousAxis } from '../image/continuous.js';
export { PageLoader } from '../image/page-loader.js';
export { PrefetchScheduler } from '../image/prefetch.js';
export type { PreloadSettings } from '../image/prefetch.js';

// settings/keymap merge plumbing
export { resolveSettings, resolveKeymap, mergeSettings, mergeKeymap } from '../settings/merge.js';

// progress estimation (`chapterProgress` is on the public surface)
export { PaceEstimator } from '../progress.js';

// fixture / image-manifest file parsing
export { parseImageManifestFile, naturalCompare } from '../source/manifest-file.js';
export type { ImageManifestFile, ParsedFixtureManifest } from '../source/manifest-file.js';

// text-engine internals: pagination + anchors + resource rewrite + EPUB paths
export {
  buildBaseStylesheet,
  computeTextLayout,
  pageCountFor,
  offsetForPage,
} from '../text/paginate.js';
export type { TextLayout } from '../text/paginate.js';
export {
  generateAnchor,
  resolveAnchor,
  blockElements,
  pageForElement,
  offsetForVisibleWord,
  rangeAtOffset,
} from '../text/anchor.js';
export type { Rect, RectOf, RangeRectOf } from '../text/anchor.js';
export {
  locateOffset,
  offsetOfPoint,
  rangeForHighlight,
  highlightRangeFromSelection,
} from '../text/highlight.js';
export { elementSteps } from '../text/cfi.js';
export { rewriteResources } from '../text/rewrite.js';
export { resolvePath, resolveHref, dirOf, stripHash, fragmentOf } from '../text/epub/path.js';
export { sanitizeFootnoteHtml } from '../text/sanitize.js';

// TTS controller internals (hosts use the engine's tts* methods / useTts)
export { segmentSentences, createTtsController } from '../text/tts.js';
export type {
  SentenceSpan,
  TtsSynthLike,
  TtsUtteranceLike,
  TtsController,
  TtsControllerOptions,
} from '../text/tts.js';

// low-level search index (hosts use SearchController)
export { buildSearchIndex, querySearchIndex } from '../search/search-index.js';
export type { SearchIndex, QueryOptions } from '../search/search-index.js';
