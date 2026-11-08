import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Bookmark,
  HighlightRecord,
  SearchHit,
  TextSelection,
  TtsState,
  TtsVoiceLike,
} from 'porejs';
import {
  useReaderAnnotations,
  useReaderConfig,
  useReaderPosition,
  useReaderUI,
  type ReaderErrorInfo,
} from './reader-contexts.js';

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

/** Debounced in-book search wired to the active engine (EPUB and PDF). */
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

/** The book's saved highlights (EPUB and PDF; empty on image-only engines). */
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
