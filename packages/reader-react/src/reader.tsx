import {
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
  type TextEngineSettings,
  type TextSelection,
  type HighlightRecord,
  type Manifest,
  type TtsState,
  type TocEntry,
} from 'porejs';
import { useReaderSource } from './provider.js';
import { createSettingsPersistence, type SettingsPersistence } from './settings-store.js';
import {
  ReaderAnnotationsContext,
  ReaderConfigContext,
  ReaderPositionContext,
  ReaderUIContext,
  type AnySettings,
  type EndPage,
  type EngineLike,
  type Footnote,
  type ReaderAnnotationsCtx,
  type ReaderConfigCtx,
  type ReaderErrorInfo,
  type ReaderHandle,
  type ReaderKind,
  type ReaderLocation,
  type ReaderPositionCtx,
  type ReaderUICtx,
} from './reader-contexts.js';

export * from './reader-contexts.js';
export * from './use-reader-features.js';

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
      let m: Manifest;
      try {
        m = await source.getManifest(bookId);
      } catch (err) {
        if (!disposed) setError({ error: err, at: Date.now() });
        return;
      }
      if (disposed) return;
      setManifest(m);
      const isText = m.type === 'epub';
      const isPdf = m.type === 'pdf';
      const rk: ReaderKind = isText ? 'text' : 'image';
      setKind(rk);
      const seeded = {
        ...persistence.initial(settingsKeyRef.current ?? bookId, rk),
        ...initialSettings,
      };
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
          setError({
            ...(q.index !== undefined ? { index: q.index } : {}),
            error: q.error,
            at: Date.now(),
          });
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
    () => ({ handle, source, bookId, kind, manifest, settings, keymap, toc, chapters }),
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
    () => ({ highlights, selection, ttsState }),
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
