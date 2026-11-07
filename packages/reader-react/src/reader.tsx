import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import {
  createImageEngine,
  createPdfEngine,
  createTextEngine,
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_KEYMAP,
  DEFAULT_TEXT_SETTINGS,
  type ImageEngineSettings,
  type Keymap,
  type Chapter,
  type Locator,
  type ReaderTransitions,
  type Position,
  type ReaderProgress,
  type SearchHit,
  type TextEngineSettings,
  type TextSelection,
  type HighlightRecord,
  type Bookmark,
  type Manifest,
  type ReaderSource,
  type TtsState,
  type TtsVoiceLike,
  type TocEntry,
  type TurnDirection,
} from 'porejs';
import { useReaderSource } from './provider.js';
import { createSettingsPersistence, type SettingsPersistence } from './settings-store.js';

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
  /** Full-text search — resolves `[]` on engines without it (image/PDF). */
  search(query: string): Promise<SearchHit[]>;
  gotoHit(hit: SearchHit): void;
  /** Portable `epubcfi(...)` for the current position — `null` on engines without one (image/PDF). */
  getCfi(): string | null;
  /** Navigate to a portable `epubcfi(...)` — a no-op on engines without one (image/PDF). */
  goToCfi(cfi: string): void;
  /** Highlight the current text selection — `null` on engines without one (image/PDF), or if there's no live selection. */
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

interface EngineLike {
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

export interface ReaderProps {
  bookId: string;
  initialSettings?: Partial<AnySettings>;
  onPositionChange?: (loc: ReaderLocation) => void;
  /**
   * Fires when the reader reaches an end-of-chapter / end-of-book card.
   * `kind: 'book'` = the last page of this `bookId`; use it to load the next
   * chapter (swap `bookId`) in a host that serves chapters separately.
   */
  onEnd?: (info: { kind: 'book' | 'chapter'; hasNext: boolean }) => void;
  /**
   * Key the per-book settings layer by this instead of `bookId`. Use a series
   * id when you serve chapters as separate `bookId`s, so a reader's fit /
   * direction / zoom choices carry across chapters. Defaults to `bookId`.
   */
  settingsKey?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  ref?: Ref<ReaderHandle>;
  /**
   * Persist settings between sessions (global prefs + a per-book layout layer).
   * `true` (default) uses localStorage; `false` disables; or pass your own.
   */
  persistSettings?: boolean | SettingsPersistence;
  /**
   * Animation seam for page turns / zoom / scroll. Defaults to instant.
   * Pass `gsapAdapter(gsap)` for smooth transitions.
   */
  transitions?: ReaderTransitions;
  /**
   * `@font-face` CSS injected into the reading iframe so the Serif / Sans
   * typography options can use webfonts the app bundles (files must be
   * same-origin). EPUB/PDF only.
   */
  fontFaceCss?: string;
}

export function Reader({
  bookId,
  initialSettings,
  onPositionChange,
  onEnd,
  settingsKey,
  className,
  style,
  children,
  ref,
  persistSettings = true,
  transitions,
  fontFaceCss,
}: ReaderProps) {
  const source = useReaderSource();
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineLike | null>(null);
  const onPosRef = useRef(onPositionChange);
  onPosRef.current = onPositionChange;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const settingsKeyRef = useRef(settingsKey);
  settingsKeyRef.current = settingsKey;
  const transitionsRef = useRef(transitions);
  transitionsRef.current = transitions;
  const fontFaceCssRef = useRef(fontFaceCss);
  fontFaceCssRef.current = fontFaceCss;
  const persistence = useMemo<SettingsPersistence>(
    () =>
      persistSettings === false
        ? { initial: () => ({}), save: () => {} }
        : persistSettings === true
          ? createSettingsPersistence()
          : persistSettings,
    [persistSettings],
  );

  const [kind, setKind] = useState<ReaderKind | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [settings, setSettings] = useState<AnySettings>(() => ({
    ...DEFAULT_IMAGE_SETTINGS,
    ...initialSettings,
  }));
  const [keymap, setKeymap] = useState<Keymap>(DEFAULT_KEYMAP);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [footnote, setFootnote] = useState<Footnote | null>(null);
  const [endPage, setEndPage] = useState<EndPage | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [resumedFromPage, setResumedFromPage] = useState<number | null>(null);
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [error, setError] = useState<ReaderErrorInfo | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [ttsState, setTtsState] = useState<TtsState | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const offs: Array<() => void> = [];

    void (async () => {
      let manifest: Manifest;
      try {
        manifest = await source.getManifest(bookId);
      } catch (err) {
        if (!disposed) setError({ error: err, at: Date.now() });
        return;
      }
      if (disposed) return;
      setManifest(manifest);
      const isText = manifest.type === 'epub';
      const isPdf = manifest.type === 'pdf';
      // pdf uses the image settings shape (it's the image engine underneath)
      const rk: ReaderKind = isText ? 'text' : 'image';
      setKind(rk);
      const seeded = { ...persistence.initial(settingsKeyRef.current ?? bookId, rk), ...initialSettings };
      setSettings({
        ...(isText ? DEFAULT_TEXT_SETTINGS : DEFAULT_IMAGE_SETTINGS),
        ...seeded,
      });

      const txOpt = transitionsRef.current ? { transitions: transitionsRef.current } : {};
      const engine = (isText
        ? createTextEngine({
            container: host,
            source,
            bookId,
            settings: seeded as Partial<TextEngineSettings>,
            ...(fontFaceCssRef.current ? { fontFaceCss: fontFaceCssRef.current } : {}),
            ...txOpt,
          })
        : isPdf
        ? createPdfEngine({
            container: host,
            source,
            bookId,
            settings: seeded as Partial<ImageEngineSettings>,
            ...txOpt,
          })
        : createImageEngine({
            container: host,
            source,
            bookId,
            settings: seeded as Partial<ImageEngineSettings>,
            ...txOpt,
          })) as unknown as EngineLike;
      engineRef.current = engine;

      const refreshChapters = () => setChapters(engine.chapters?.() ?? []);

      offs.push(
        engine.on('reader:locationchange', (p: never) => {
          const loc = p as Locator;
          setLocation(loc);
          onPosRef.current?.(loc);
        }),
        engine.on('reader:ready', () => refreshChapters()),
        engine.on('reader:progress', (p: never) => setProgress(p as ReaderProgress)),
        engine.on('reader:resumed', (p: never) => {
          const q = p as { position: Position | null; page?: number };
          setResumedFromPage(q.position ? (q.page ?? 1) : null);
        }),
        engine.on('reader:settingschange', (p: never) => {
          const q = p as { settings: AnySettings; keymap?: Keymap };
          setSettings(q.settings);
          if (q.keymap) setKeymap(q.keymap);
          persistence.save(settingsKeyRef.current ?? bookId, rk, q.settings);
        }),
        engine.on('reader:toc', (p: never) => {
          setToc((p as { toc: TocEntry[] }).toc);
          refreshChapters();
        }),
        engine.on('reader:loadingstate', (p: never) => {
          const q = p as { index?: number; spine?: number; state: string };
          const key = String(q.index ?? q.spine ?? 0);
          setLoading((prev) => {
            const next = new Set(prev);
            if (q.state === 'loading') next.add(key);
            else next.delete(key);
            return next.size === prev.size && [...next].every((k) => prev.has(k)) ? prev : next;
          });
        }),
        engine.on('reader:footnote', (p: never) => setFootnote(p as Footnote)),
        engine.on('reader:endpage', (p: never) => {
          const q = p as EndPage & { visible: boolean };
          setEndPage(q.visible ? { kind: q.kind, label: q.label, hasNext: q.hasNext } : null);
          if (q.visible) onEndRef.current?.({ kind: q.kind, hasNext: q.hasNext });
        }),
        engine.on('reader:chrometoggle', (p: never) =>
          setChromeVisible((p as { visible: boolean }).visible),
        ),
        engine.on('reader:error', (p: never) => {
          const q = p as { index?: number; error: unknown };
          setError({ ...(q.index !== undefined ? { index: q.index } : {}), error: q.error, at: Date.now() });
        }),
        engine.on('reader:selection', (p: never) => setSelection(p as TextSelection | null)),
        engine.on('reader:highlightschange', (p: never) =>
          setHighlights((p as { highlights: HighlightRecord[] }).highlights),
        ),
        engine.on('reader:ttsstate', (p: never) => setTtsState(p as TtsState)),
      );

      try {
        await engine.mount();
      } catch (err) {
        if (!disposed) setError({ error: err, at: Date.now() });
      }
    })();

    return () => {
      disposed = true;
      for (const off of offs) off();
      engineRef.current?.destroy();
      engineRef.current = null;
      setManifest(null);
      setSelection(null);
      setTtsState(null);
    };
  }, [source, bookId]);

  const handle = useMemo<ReaderHandle>(
    () => ({
      turn: (d) => engineRef.current?.turn(d),
      goto: (t) => engineRef.current?.goto(t as never),
      goToHref: (href) => engineRef.current?.goToHref?.(href),
      search: (q) => engineRef.current?.search?.(q) ?? Promise.resolve([]),
      gotoHit: (hit) => engineRef.current?.gotoHit?.(hit),
      getCfi: () => engineRef.current?.getCfi?.() ?? null,
      goToCfi: (cfi) => engineRef.current?.goToCfi?.(cfi),
      addHighlight: (opts) => engineRef.current?.addHighlight?.(opts) ?? null,
      removeHighlight: (id) => engineRef.current?.removeHighlight?.(id),
      updateHighlight: (id, patch) => engineRef.current?.updateHighlight?.(id, patch) ?? null,
      listHighlights: () => engineRef.current?.listHighlights?.() ?? [],
      ttsPlay: () => engineRef.current?.ttsPlay?.(),
      ttsPause: () => engineRef.current?.ttsPause?.(),
      ttsResume: () => engineRef.current?.ttsResume?.(),
      ttsStop: () => engineRef.current?.ttsStop?.(),
      ttsSetRate: (rate) => engineRef.current?.ttsSetRate?.(rate),
      ttsSetVoice: (voice) => engineRef.current?.ttsSetVoice?.(voice),
      ttsListVoices: () => engineRef.current?.ttsListVoices?.() ?? [],
      setSettings: (patch) => engineRef.current?.setSettings(patch as never),
      setKeymap: (patch) => engineRef.current?.setKeymap?.(patch),
      chapters: () => engineRef.current?.chapters?.() ?? [],
    }),
    [],
  );
  const clearFootnote = useMemo(() => () => setFootnote(null), []);
  const clearError = useMemo(() => () => setError(null), []);

  useImperativeHandle(ref, () => handle, [handle]);

  const positionCtx = useMemo<ReaderPositionCtx>(
    () => ({ location, progress }),
    [location, progress],
  );

  const configCtx = useMemo<ReaderConfigCtx>(
    () => ({
      handle,
      source,
      bookId,
      kind,
      manifest,
      settings,
      keymap,
      toc,
      chapters,
    }),
    [handle, source, bookId, kind, manifest, settings, keymap, toc, chapters],
  );

  const uiCtx = useMemo<ReaderUICtx>(
    () => ({
      chromeVisible,
      footnote,
      clearFootnote,
      endPage,
      resumedFromPage,
      loading: loading.size > 0,
      error,
      clearError,
    }),
    [chromeVisible, footnote, clearFootnote, endPage, resumedFromPage, loading, error, clearError],
  );

  const annotationsCtx = useMemo<ReaderAnnotationsCtx>(
    () => ({
      highlights,
      selection,
      ttsState,
    }),
    [highlights, selection, ttsState],
  );

  return (
    <ReaderConfigContext.Provider value={configCtx}>
      <ReaderUIContext.Provider value={uiCtx}>
        <ReaderAnnotationsContext.Provider value={annotationsCtx}>
          <ReaderPositionContext.Provider value={positionCtx}>
            {children}
            <div
              ref={hostRef}
              className={className}
              style={{ flex: 1, minHeight: 0, minWidth: 0, ...style }}
            />
          </ReaderPositionContext.Provider>
        </ReaderAnnotationsContext.Provider>
      </ReaderUIContext.Provider>
    </ReaderConfigContext.Provider>
  );
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

export interface UseReaderError {
  error: ReaderErrorInfo | null;
  dismiss: () => void;
  /** Nudge the engine to reload the current page — `goto`'s the current position. */
  retry: () => void;
}

/** The most recent `reader:error`, with a dismiss and a best-effort retry. */
export function useReaderError(): UseReaderError {
  const { error, clearError } = useReaderUI();
  const { location } = useReaderPosition();
  const { handle } = useReaderConfig();
  const retry = useCallback(() => {
    if (location) handle.goto(location.page);
    clearError();
  }, [location, handle, clearError]);
  return { error, dismiss: clearError, retry };
}

export function useReader(): ReaderHandle {
  return useReaderConfig().handle;
}

export function useResumedFromPage(): number | null {
  return useReaderUI().resumedFromPage;
}

export interface ReaderSearch {
  query: string;
  setQuery(q: string): void;
  hits: SearchHit[];
  /** Index into `hits` of the last-jumped hit, or -1. */
  activeIndex: number;
  busy: boolean;
  go(index: number): void;
  next(): void;
  prev(): void;
  clear(): void;
}

/** Debounced in-book search wired to the active engine (text only today). */
export function useReaderSearch(opts?: { debounceMs?: number }): ReaderSearch {
  const { handle, kind } = useReaderConfig();
  const debounceMs = opts?.debounceMs ?? 200;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    setQuery('');
    setHits([]);
    setActiveIndex(-1);
  }, [kind]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setActiveIndex(-1);
      return;
    }
    const id = ++runId.current;
    setBusy(true);
    const t = setTimeout(() => {
      void handle.search(q).then((res) => {
        if (id !== runId.current) return;
        setHits(res);
        setActiveIndex(-1);
        setBusy(false);
      });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [query, handle, debounceMs]);

  const go = useCallback(
    (index: number) => {
      const hit = hits[index];
      if (!hit) return;
      setActiveIndex(index);
      handle.gotoHit(hit);
    },
    [hits, handle],
  );

  return {
    query,
    setQuery,
    hits,
    activeIndex,
    busy,
    go,
    next: () => go(activeIndex + 1 < hits.length ? activeIndex + 1 : 0),
    prev: () => go(activeIndex > 0 ? activeIndex - 1 : hits.length - 1),
    clear: () => setQuery(''),
  };
}

/** The book's saved highlights (empty on engines without one, e.g. image/PDF). */
export function useReaderHighlights(): HighlightRecord[] {
  return useReaderAnnotations().highlights;
}
export const useHighlights = useReaderHighlights;

export interface UseBookmarks {
  bookmarks: Bookmark[];
  /** `true` when the current page already has a bookmark. */
  isBookmarkedHere: boolean;
  /** Whether the active source can persist bookmarks at all. */
  supported: boolean;
  add(label?: string): void;
  remove(id: string): void;
  rename(id: string, label: string): void;
  goTo(bookmark: Bookmark): void;
  /** Add a bookmark at the current page, or remove the one that's there. */
  toggle(): void;
}

/**
 * Named bookmarks — a per-book collection persisted through the source's
 * optional `loadBookmarks` / `saveBookmarks`. Uses the handle's `getCfi()` /
 * `goToCfi()` so a bookmark survives re-pagination on a reflowable book.
 */
export function useBookmarks(): UseBookmarks {
  const { bookId, source, handle } = useReaderConfig();
  const { location } = useReaderPosition();
  const supported =
    typeof source.loadBookmarks === 'function' && typeof source.saveBookmarks === 'function';
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    void source.loadBookmarks?.(bookId).then((b) => {
      if (live) setBookmarks(b);
    });
    return () => {
      live = false;
    };
  }, [supported, source, bookId]);

  const persist = useCallback(
    (next: Bookmark[]) => {
      const sorted = [...next].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
      setBookmarks(sorted);
      void source.saveBookmarks?.(bookId, sorted).catch(() => {});
    },
    [source, bookId],
  );

  const here = bookmarks.find((b) => b.page === (location?.page ?? -1)) ?? null;

  const add = useCallback(
    (label?: string) => {
      if (!supported || !location) return;
      const cfi = handle.getCfi() ?? undefined;
      const bm: Bookmark = {
        id: `bm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        position: location.position,
        ...(cfi ? { cfi } : {}),
        page: location.page,
        percent: location.percent,
        label: label?.trim() || location.label,
        createdAt: Date.now(),
      };
      persist([...bookmarks.filter((b) => b.page !== location.page), bm]);
    },
    [supported, location, handle, bookmarks, persist],
  );

  const remove = useCallback(
    (id: string) => persist(bookmarks.filter((b) => b.id !== id)),
    [bookmarks, persist],
  );

  const rename = useCallback(
    (id: string, label: string) =>
      persist(bookmarks.map((b) => (b.id === id ? { ...b, label } : b))),
    [bookmarks, persist],
  );

  const goTo = useCallback(
    (bm: Bookmark) => {
      // `position` is exact for the current pagination; `cfi` (kept for export /
      // cross-device) is the fallback if the position can't be honoured.
      if (bm.position) handle.goto(bm.position);
      else if (bm.cfi) handle.goToCfi(bm.cfi);
    },
    [handle],
  );

  const toggle = useCallback(() => {
    if (here) remove(here.id);
    else add();
  }, [here, remove, add]);

  return { bookmarks, isBookmarkedHere: !!here, supported, add, remove, rename, goTo, toggle };
}

export interface ReaderSelectionApi {
  /** The live text selection inside the reader, or `null` when nothing's selected. */
  selection: TextSelection | null;
  /** Highlight the current selection; returns `null` if there's nothing selected. */
  highlight(opts?: { color?: string; note?: string }): HighlightRecord | null;
  removeHighlight(id: string): void;
  /** Change an existing highlight's colour and/or note (`note: ''` clears it). */
  updateHighlight(id: string, patch: { color?: string; note?: string }): HighlightRecord | null;
}

/** Selection-driven highlighting — pair with `selection` to position a floating toolbar. */
export function useReaderSelection(): ReaderSelectionApi {
  const { selection } = useReaderAnnotations();
  const { handle } = useReaderConfig();
  return {
    selection,
    highlight: (opts) => handle.addHighlight(opts),
    removeHighlight: (id) => handle.removeHighlight(id),
    updateHighlight: (id, patch) => handle.updateHighlight(id, patch),
  };
}
export const useTextSelection = useReaderSelection;

export interface UseTts {
  /** `null` before the engine reports any state (or on engines without TTS, e.g. image/PDF). */
  state: TtsState | null;
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
  setVoice(voice: TtsVoiceLike | null): void;
  /** `[]` when the Web Speech API is unsupported. */
  listVoices(): TtsVoiceLike[];
}

/** Text-to-speech (stretch goal, EPUB-only) — safe to use on any engine; it's just inert without one. */
export function useTts(): UseTts {
  const { ttsState } = useReaderAnnotations();
  const { handle } = useReaderConfig();
  return {
    state: ttsState,
    play: () => handle.ttsPlay(),
    pause: () => handle.ttsPause(),
    resume: () => handle.ttsResume(),
    stop: () => handle.ttsStop(),
    setRate: (rate) => handle.ttsSetRate(rate),
    setVoice: (voice) => handle.ttsSetVoice(voice),
    listVoices: () => handle.ttsListVoices(),
  };
}
