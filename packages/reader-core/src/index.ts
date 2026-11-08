/**
 * porejs — framework-agnostic web reader engine.
 *
 * This module is the **stable public surface** (SemVer-covered from 1.0 — see
 * docs/stability.md). Lower-level building blocks live in `porejs/internal`
 * and are not part of the contract.
 */

/** Package version, injected at build time. */
export const VERSION: string =
  typeof __POREJS_VERSION__ === 'string' ? __POREJS_VERSION__ : '0.0.0-dev';

// ── Shared vocabulary ────────────────────────────────────────────────────────
export type {
  Direction,
  LayoutMode,
  FitMode,
  Variant,
  TurnDirection,
  ChromeGesture,
} from './types.js';

// ── The source seam ──────────────────────────────────────────────────────────
export type {
  ReaderSource,
  Manifest,
  ManifestMeta,
  ImageManifest,
  TextManifest,
  ImagePage,
  GetPageOpts,
  GetFileOpts,
} from './source/types.js';

// ── Annotations (per-book collections) ───────────────────────────────────────
export type {
  HighlightRange,
  HighlightRecord,
  TextHighlightRecord,
  RectHighlightRecord,
  NormRect,
  Bookmark,
} from './source/types.js';

// ── Position ─────────────────────────────────────────────────────────────────
export type { Position } from './position/types.js';
export { clampPagePosition, isPagePosition, isScrollPosition } from './position/position.js';

// ── Engine contract (shared) ─────────────────────────────────────────────────
export type {
  Locator,
  ReaderEngine,
  CommonEngineEvents,
  Chapter,
  ReaderProgress,
} from './reader-engine.js';
export { chapterProgress } from './progress.js';

// ── Animation seam ───────────────────────────────────────────────────────────
export { instantTransitions } from './transitions.js';
export type { ReaderTransitions, TransitionContext } from './transitions.js';

// ── Settings & keymap ────────────────────────────────────────────────────────
export type { ImageEngineSettings, ProgressBarSettings } from './settings/types.js';
export { DEFAULT_IMAGE_SETTINGS } from './settings/types.js';
export type { Keymap, ActionId } from './settings/keymap.js';
export { DEFAULT_KEYMAP, resolveAction } from './settings/keymap.js';

// ── Image engine ─────────────────────────────────────────────────────────────
export {
  createImageEngine,
  physicalToLogical,
  isReverseDirection,
} from './image/create-image-engine.js';
export type { ImageEngine, ImageEngineOptions, Unsubscribe } from './image/engine.js';
export type { ImageEngineEvents, ImageEngineEventName, PageLoadState } from './image/types.js';

// ── Text engine ──────────────────────────────────────────────────────────────
export { createTextEngine } from './text/create-text-engine.js';
export type { CreateTextEngineOptions } from './text/create-text-engine.js';
export { DEFAULT_TEXT_SETTINGS } from './text/types.js';
export type {
  TextEngine,
  TextEngineEvents,
  TextEngineSettings,
  TextSelection,
  TtsState,
  TtsSentence,
  TtsVoiceLike,
} from './text/types.js';
export type { Rect } from './text/anchor.js';

// ── PDF engine ───────────────────────────────────────────────────────────────
export { createPdfEngine } from './pdf/create-pdf-engine.js';
export type { CreatePdfEngineOptions, PdfEngineEvents } from './pdf/create-pdf-engine.js';
export { loadPdf, setPdfWorkerSrc } from './pdf/parse.js';
export type { PdfDoc } from './pdf/parse.js';
export { PdfImageSource } from './pdf/pdf-source.js';
export type { PdfSourceOptions } from './pdf/pdf-source.js';

// ── EPUB parsing ─────────────────────────────────────────────────────────────
export { parseEpub } from './text/epub/parse.js';
export type {
  EpubBook,
  EpubMetadata,
  EpubResource,
  SpineItem,
  TocEntry,
} from './text/epub/types.js';

// ── Portable positions (epubcfi-shaped) ──────────────────────────────────────
export { serializeCfi, parseCfi, resolveCfiElement, resolveCfiRange } from './text/cfi.js';
export type { ParsedCfi } from './text/cfi.js';

// ── Sources ──────────────────────────────────────────────────────────────────
export { DemoSource } from './source/demo-source.js';
export type { DemoSourceOptions } from './source/demo-source.js';
export { CachedSource } from './source/cached-source.js';
export type {
  CachedSourceOptions,
  DownloadState,
  DownloadStatus,
  DownloadOptions,
} from './source/cached-source.js';
export { LocalFileSource } from './source/local-file-source.js';
export type { LocalFileSourceOptions } from './source/local-file-source.js';
export { createReaderSource, readerSourceKey } from './source/create-reader-source.js';
export type { CreateReaderSourceInput, ReaderMeta } from './source/create-reader-source.js';
export {
  KavitaSource,
  KavitaAuthError,
  KavitaDownloadForbiddenError,
} from './source/kavita-source.js';
export type { KavitaSourceOptions } from './source/kavita-source.js';
export { OpdsSource } from './source/opds-source.js';
export type { OpdsAuth, OpdsSourceOptions } from './source/opds-source.js';
export { parseOpdsFeed, acquisitionLink, guessFilename } from './source/opds-parse.js';
export type { OpdsFeed, OpdsEntry, OpdsLink } from './source/opds-parse.js';

// ── Offline ──────────────────────────────────────────────────────────────────
export { MediaCache } from './offline/media-cache.js';
export type { BookCacheMeta } from './offline/media-cache.js';
export { openKvStore } from './offline/idb.js';
export type { KvStore } from './offline/idb.js';

// ── In-book search ───────────────────────────────────────────────────────────
export { SearchController } from './search/search-controller.js';
export type { SearchControllerOptions } from './search/search-controller.js';
export type { SearchSection, SearchHit } from './search/search-index.js';
