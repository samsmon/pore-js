import { createContext, useContext, useMemo } from 'react';
import type {
  ImageEngineSettings,
  Keymap,
  Chapter,
  Locator,
  Position,
  ReaderProgress,
  SearchHit,
  TextEngineSettings,
  TextSelection,
  HighlightRecord,
  Manifest,
  ReaderSource,
  TtsState,
  TtsVoiceLike,
  TocEntry,
  TurnDirection,
} from 'porejs';

export type ReaderKind = 'image' | 'text';
export type AnySettings = ImageEngineSettings | TextEngineSettings;

export type ReaderLocation = Locator;
export type { ReaderProgress, Chapter } from 'porejs';

export interface Footnote {
  html: string;
  href: string;
}

export interface ReaderErrorInfo {
  /** Book-level page or spine index the error happened on, if known. */
  index?: number;
  error: unknown;
  /** Bumped on every occurrence so consumers can re-key a toast even if the message repeats. */
  at: number;
}

export interface EndPage {
  kind: 'chapter' | 'book';
  label: string;
  hasNext: boolean;
}

export interface ReaderHandle {
  turn(dir: TurnDirection): void;
  goto(target: number | Position): void;
  goToHref(href: string): void;
  setSettings(patch: Partial<AnySettings>): void;
  setKeymap(patch: Partial<Keymap>): void;
  chapters(): Chapter[];
  /** Full-text search (EPUB and PDF) — resolves `[]` on image-only engines. */
  search(query: string): Promise<SearchHit[]>;
  gotoHit(hit: SearchHit): void;
  /** Portable `epubcfi(...)` for the current position — `null` on engines without one (image/PDF). */
  getCfi(): string | null;
  /** Navigate to a portable `epubcfi(...)` — a no-op on engines without one (image/PDF). */
  goToCfi(cfi: string): void;
  /** Highlight the current selection (EPUB text or PDF page) — `null` on image engines or when nothing is selected. */
  addHighlight(opts?: { color?: string; note?: string }): HighlightRecord | null;
  removeHighlight(id: string): void;
  /** Change a highlight's colour and/or note (`note: ''` clears it) — `null` on engines without highlights or an unknown id. */
  updateHighlight(id: string, patch: { color?: string; note?: string }): HighlightRecord | null;
  listHighlights(): HighlightRecord[];
  /** Text-to-speech (stretch goal, EPUB-only) — safe to call on engines without one; it simply never plays. */
  ttsPlay(): void;
  ttsPause(): void;
  ttsResume(): void;
  ttsStop(): void;
  ttsSetRate(rate: number): void;
  ttsSetVoice(voice: TtsVoiceLike | null): void;
  ttsListVoices(): TtsVoiceLike[];
}

export interface EngineLike {
  mount(): Promise<void>;
  turn(dir: TurnDirection): void;
  goto(target: never): void;
  goToHref?(href: string): void;
  setSettings(patch: never): void;
  setKeymap?(patch: Partial<Keymap>): void;
  chapters?(): Chapter[];
  search?(query: string): Promise<SearchHit[]>;
  gotoHit?(hit: SearchHit): void;
  getCfi?(): string | null;
  goToCfi?(cfi: string): void;
  addHighlight?(opts?: { color?: string; note?: string }): HighlightRecord | null;
  removeHighlight?(id: string): void;
  updateHighlight?(id: string, patch: { color?: string; note?: string }): HighlightRecord | null;
  listHighlights?(): HighlightRecord[];
  ttsPlay?(): void;
  ttsPause?(): void;
  ttsResume?(): void;
  ttsStop?(): void;
  ttsSetRate?(rate: number): void;
  ttsSetVoice?(voice: TtsVoiceLike | null): void;
  ttsListVoices?(): TtsVoiceLike[];
  on(event: string, handler: (payload: never) => void): () => void;
  destroy(): void;
}

export interface ReaderPositionCtx {
  location: ReaderLocation | null;
  progress: ReaderProgress | null;
}

export interface ReaderConfigCtx {
  handle: ReaderHandle;
  source: ReaderSource;
  bookId: string;
  kind: ReaderKind | null;
  manifest: Manifest | null;
  settings: AnySettings;
  keymap: Keymap;
  toc: TocEntry[];
  chapters: Chapter[];
}

export interface ReaderUICtx {
  chromeVisible: boolean;
  footnote: Footnote | null;
  clearFootnote: () => void;
  endPage: EndPage | null;
  resumedFromPage: number | null;
  loading: boolean;
  error: ReaderErrorInfo | null;
  clearError: () => void;
}

export interface ReaderAnnotationsCtx {
  highlights: HighlightRecord[];
  selection: TextSelection | null;
  ttsState: TtsState | null;
}

export type ReaderCtx = ReaderPositionCtx & ReaderConfigCtx & ReaderUICtx & ReaderAnnotationsCtx;

export const ReaderPositionContext = createContext<ReaderPositionCtx | null>(null);
export const ReaderConfigContext = createContext<ReaderConfigCtx | null>(null);
export const ReaderUIContext = createContext<ReaderUICtx | null>(null);
export const ReaderAnnotationsContext = createContext<ReaderAnnotationsCtx | null>(null);

export function useReaderPosition(): ReaderPositionCtx {
  const ctx = useContext(ReaderPositionContext);
  if (!ctx) throw new Error('Reader hooks must be used inside <Reader>');
  return ctx;
}

export function useReaderConfig(): ReaderConfigCtx {
  const ctx = useContext(ReaderConfigContext);
  if (!ctx) throw new Error('Reader hooks must be used inside <Reader>');
  return ctx;
}

export function useReaderUI(): ReaderUICtx {
  const ctx = useContext(ReaderUIContext);
  if (!ctx) throw new Error('Reader hooks must be used inside <Reader>');
  return ctx;
}

export function useReaderAnnotations(): ReaderAnnotationsCtx {
  const ctx = useContext(ReaderAnnotationsContext);
  if (!ctx) throw new Error('Reader hooks must be used inside <Reader>');
  return ctx;
}

export function useRuntime(): ReaderCtx {
  const config = useReaderConfig();
  const position = useReaderPosition();
  const ui = useReaderUI();
  const annotations = useReaderAnnotations();
  return useMemo<ReaderCtx>(
    () => ({
      ...config,
      ...position,
      ...ui,
      ...annotations,
    }),
    [config, position, ui, annotations],
  );
}

export function useReaderKind(): ReaderKind | null {
  return useReaderConfig().kind;
}

/** The current book's manifest (title, type, page/spine metadata) — `null` until loaded. */
export function useReaderManifest(): Manifest | null {
  return useReaderConfig().manifest;
}

export function useReaderLocation(): ReaderLocation | null {
  return useReaderPosition().location;
}

/** The shell's "Ch 4 of 12 · 18 min left" data. `null` until the first paint. */
export function useReaderProgress(): ReaderProgress | null {
  return useReaderPosition().progress;
}

export function useReaderSettings<T extends AnySettings = AnySettings>(): [
  T,
  (patch: Partial<T>) => void,
] {
  const { settings, handle } = useReaderConfig();
  return [settings as T, handle.setSettings as (patch: Partial<T>) => void];
}

export function useReaderKeymap(): [Keymap, ReaderHandle['setKeymap']] {
  const { keymap, handle } = useReaderConfig();
  return [keymap, handle.setKeymap];
}

export function useTableOfContents(): TocEntry[] {
  return useReaderConfig().toc;
}

export function useFootnote(): [Footnote | null, () => void] {
  const { footnote, clearFootnote } = useReaderUI();
  return [footnote, clearFootnote];
}

export function useEndPage(): EndPage | null {
  return useReaderUI().endPage;
}

export function useChromeVisible(): boolean {
  return useReaderUI().chromeVisible;
}

/** `true` while any page / spine image is still loading. */
export function useReaderLoading(): boolean {
  return useReaderUI().loading;
}

/** The book's chapters (`{ id, label, startPage, startPercent }`), empty until known. */
export function useReaderChapters(): Chapter[] {
  return useReaderConfig().chapters;
}

export function useReader(): ReaderHandle {
  return useReaderConfig().handle;
}

export function useResumedFromPage(): number | null {
  return useReaderUI().resumedFromPage;
}
