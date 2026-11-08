import {
  useEndPage,
  useReader,
  useReaderHistory,
  useReaderKind,
  useReaderManifest,
  useReaderLoading,
  useReaderError,
  useReaderSearch,
  useReaderLocation,
  useReaderProgress,
  useReaderSettings,
  useReaderHighlights,
  useReaderSelection,
  useBookmarks,
  useTts,
  useResumedFromPage,
  useChromeVisible,
  type ImageEngineSettings,
  type TextEngineSettings,
  type TtsVoiceLike,
} from 'porejs-react';
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from './theme.js';
import { useAutoHide } from './use-auto-hide.js';
import type { MenuBar } from './use-menu-bar.js';
import type { SampleBook } from './Landing.js';
import type { MobileSheet } from './chrome/MobileTocList.js';
import { DesktopRailCollapseButton, DesktopRailControls } from './chrome/DesktopRailControls.js';
import { MobileChrome } from './chrome/MobileChrome.js';
import { ChromeOverlays } from './chrome/ChromeOverlays.js';

export function Chrome({
  books,
  bookId,
  onBook,
  onHome,
  droppedName,
  opdsOpen,
  onToggleOpds,
  menu,
  isFullscreen,
  animate,
  onToggleAnimate,
  settingsOpen,
  onToggleSettings,
}: {
  books: SampleBook[];
  bookId: string;
  onBook: (id: string) => void;
  onHome: () => void;
  droppedName?: string | null;
  opdsOpen: boolean;
  onToggleOpds: () => void;
  menu: MenuBar;
  isFullscreen: boolean;
  animate: boolean;
  onToggleAnimate: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const loc = useReaderLocation();
  const progress = useReaderProgress();
  const search = useReaderSearch();
  const loading = useReaderLoading();
  const readerError = useReaderError();
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const reader = useReader();
  const kind = useReaderKind();
  const manifest = useReaderManifest();
  const [imgSettings, setImgSettings] = useReaderSettings<ImageEngineSettings>();
  const [textSettings, setTextSettings] = useReaderSettings<TextEngineSettings>();
  const resumed = useResumedFromPage();
  const endPage = useEndPage();
  const [dismissed, setDismissed] = useState(false);
  const [posNotice, setPosNotice] = useState<string | null>(null);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const { selection, highlight } = useReaderSelection();
  const highlights = useReaderHighlights();
  const bm = useBookmarks();
  const tts = useTts();
  const [ttsOpen, setTtsOpen] = useState(false);
  const [voices, setVoices] = useState<TtsVoiceLike[]>([]);
  const chromeVisible = useChromeVisible();

  useEffect(() => {
    if (ttsOpen) setVoices(tts.listVoices());
    else tts.stop();
  }, [ttsOpen]);
  const ttsPlaying = tts.state?.playing ?? false;
  const ttsCanResume = !ttsPlaying && !!tts.state?.sentence;

  useReaderHistory({ mode: 'url-and-title' });
  useEffect(() => setDismissed(false), [bookId]);

  useEffect(() => {
    if (resumed === null) return;
    const t = setTimeout(() => setDismissed(true), 15_000);
    return () => clearTimeout(t);
  }, [resumed]);

  useEffect(() => {
    if (!loading) {
      setShowSkeleton(false);
      return;
    }
    const t = setTimeout(() => setShowSkeleton(true), 220);
    return () => clearTimeout(t);
  }, [loading]);

  const isImage = kind === 'image';
  const isText = kind === 'text';
  const isPdf =
    manifest?.type === 'pdf' || (isImage && /\.pdf$|^demo-pdf$/i.test(bookId || droppedName || ''));
  const canSearch = isText || isPdf;
  const canAnnotate = isText || isPdf;
  const menuPos = menu.placement;

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false,
  );

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [scrubberOpen, setScrubberOpen] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);

  useEffect(() => {
    setMobileChromeVisible(chromeVisible);
  }, [chromeVisible]);

  useEffect(() => {
    if (isMobile) {
      if (settingsOpen && mobileSheet !== 'settings') {
        setMobileSheet('settings');
      } else if (!settingsOpen && mobileSheet === 'settings') {
        setMobileSheet(null);
      }
    }
  }, [isMobile, settingsOpen, mobileSheet]);

  const closeMobileSheet = useCallback(() => {
    if (mobileSheet === 'settings' && settingsOpen) {
      onToggleSettings();
    }
    setMobileSheet(null);
  }, [mobileSheet, settingsOpen, onToggleSettings]);

  const overlayOpen =
    settingsOpen ||
    searchOpen ||
    endPage !== null ||
    highlightsOpen ||
    bookmarksOpen ||
    ttsOpen ||
    mobileSheet !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'b' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (!bm.supported) return;
      bm.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mobileSheet !== null) {
        closeMobileSheet();
        e.stopPropagation();
        return;
      }
      const close: [boolean, () => void, string][] = [
        [ttsOpen, () => setTtsOpen(false), 'Text to speech'],
        [bookmarksOpen, () => setBookmarksOpen(false), 'Bookmarks'],
        [highlightsOpen, () => setHighlightsOpen(false), 'Highlights'],
        [searchOpen, () => setSearchOpen(false), 'Search in book'],
        [settingsOpen, onToggleSettings, 'Reader settings'],
      ];
      const hit = close.find(([open]) => open);
      if (!hit) return;
      hit[1]();
      (
        document.querySelector(`.bar button[aria-label="${hit[2]}"]`) as HTMLElement | null
      )?.focus();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    ttsOpen,
    bookmarksOpen,
    highlightsOpen,
    searchOpen,
    settingsOpen,
    onToggleSettings,
    mobileSheet,
    closeMobileSheet,
  ]);

  useEffect(() => {
    const onWindowClick = (e: MouseEvent) => {
      if (overlayOpen || mobileSheet !== null) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          'button, a, input, select, textarea, [data-pore-chrome-handle], .bar, .bar--collapsed, .mobile-header, .mobile-bottom-bar, .mobile-sheet, .highlights-panel, .search, .selection-toolbar, .toast, .notice, .endpage, .pore-select-content, [role="menu"], [role="dialog"], [role="listbox"], [role="button"], [data-pore-settings-inline], .footnote',
        )
      ) {
        return;
      }
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 0) return;

      const r = e.clientX / window.innerWidth;
      if (r >= 0.3 && r <= 0.7) {
        if (window.innerWidth > 768) {
          menu.toggleCollapsed();
        } else {
          setMobileChromeVisible((v) => !v);
        }
      }
    };

    window.addEventListener('click', onWindowClick);
    return () => window.removeEventListener('click', onWindowClick);
  }, [overlayOpen, mobileSheet, menu]);

  const isAuto = menu.behaviour === 'auto-hide';
  const autoHiding = (isFullscreen || isAuto) && !overlayOpen;
  const [autoHidden, pinChrome, hideChrome] = useAutoHide(2600, autoHiding);

  useEffect(() => {
    if (overlayOpen || mobileSheet !== null) pinChrome();
  }, [overlayOpen, mobileSheet, pinChrome]);

  useEffect(() => {
    if (chromeVisible) pinChrome();
    else hideChrome();
  }, [chromeVisible, pinChrome, hideChrome]);

  const barHidden = autoHiding && autoHidden;
  const mobileBarHidden =
    (!mobileChromeVisible || barHidden) && mobileSheet === null && !overlayOpen;

  const currentSample = books.find((b) => b.id === bookId);
  const currentBookLabel = currentSample?.label || (droppedName ?? 'Book');
  const series = currentSample?.series;
  const seriesBooks = series ? books.filter((b) => b.series?.id === series.id) : [];
  const nextBook = series?.nextBookId ? books.find((b) => b.id === series.nextBookId) : undefined;
  const prevBook = series?.prevBookId ? books.find((b) => b.id === series.prevBookId) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === ']' && nextBook) onBook(nextBook.id);
      else if (e.key === '[' && prevBook) onBook(prevBook.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextBook, prevBook, onBook]);

  const pageDisplay =
    loc?.page !== undefined && loc?.total
      ? `p. ${loc.page + 1} / ${loc.total}`
      : (loc?.label ?? '…');

  const collapsed = menu.collapsed && !settingsOpen;
  const onRight = menuPos === 'right';
  const isRtl = isImage && imgSettings?.direction === 'rtl';
  const progressSettings = isImage
    ? (imgSettings?.progressBar ?? { style: 'normal', position: 'bottom', thickness: 3 })
    : { style: 'normal' as const, position: 'bottom' as const, thickness: 3 };
  const progressStyle = progressSettings.style;
  const progressPos = progressSettings.position ?? 'bottom';
  const progressThickness = progressSettings.thickness || 3;
  const progressPercent = Math.min(100, Math.max(0, (progress?.percent ?? 0) * 100));

  const barControls = (
    <DesktopRailControls
      books={books}
      bookId={bookId}
      onBook={onBook}
      onHome={onHome}
      droppedName={droppedName ?? null}
      opdsOpen={opdsOpen}
      onToggleOpds={onToggleOpds}
      menu={menu}
      animate={animate}
      onToggleAnimate={onToggleAnimate}
      settingsOpen={settingsOpen}
      onToggleSettings={onToggleSettings}
      collapsed={collapsed}
      series={series}
      seriesBooks={seriesBooks}
      prevBook={prevBook}
      nextBook={nextBook}
      isImage={isImage}
      isText={isText}
      isPdf={isPdf}
      canSearch={canSearch}
      canAnnotate={canAnnotate}
      imgSettings={imgSettings}
      setImgSettings={setImgSettings}
      textSettings={textSettings}
      setTextSettings={setTextSettings}
      theme={theme}
      toggleTheme={toggleTheme}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      bookmarksOpen={bookmarksOpen}
      setBookmarksOpen={setBookmarksOpen}
      highlightsOpen={highlightsOpen}
      setHighlightsOpen={setHighlightsOpen}
      ttsOpen={ttsOpen}
      setTtsOpen={setTtsOpen}
      bm={bm}
      highlights={highlights}
      reader={reader}
      loc={loc}
      progress={progress}
      setPosNotice={setPosNotice}
    />
  );

  return (
    <>
      <MobileChrome
        mobileBarHidden={mobileBarHidden}
        onHome={onHome}
        currentBookLabel={currentBookLabel}
        progress={progress}
        canSearch={canSearch}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        bm={bm}
        theme={theme}
        toggleTheme={toggleTheme}
        mobileSheet={mobileSheet}
        setMobileSheet={setMobileSheet}
        closeMobileSheet={closeMobileSheet}
        settingsOpen={settingsOpen}
        onToggleSettings={onToggleSettings}
        series={series}
        seriesBooks={seriesBooks}
        prevBook={prevBook}
        nextBook={nextBook}
        bookId={bookId}
        onBook={onBook}
        scrubberOpen={scrubberOpen}
        setScrubberOpen={setScrubberOpen}
        pageDisplay={pageDisplay}
        progressPercent={progressPercent}
        reader={reader}
        menu={menu}
        animate={animate}
        onToggleAnimate={onToggleAnimate}
      />

      <header
        className={`bar bar--${menuPos}${barHidden ? ' bar--hidden' : ''}${
          collapsed ? ' bar--collapsed' : ''
        }${settingsOpen ? ' bar--settings' : ''}`}
        onPointerEnter={pinChrome}
      >
        <DesktopRailCollapseButton menu={menu} />
        {barControls}
      </header>

      <ChromeOverlays
        loading={loading}
        progressStyle={progressStyle}
        progressPos={progressPos}
        progressThickness={progressThickness}
        progressPercent={progressPercent}
        barHidden={barHidden}
        isMobile={isMobile}
        mobileBarHidden={mobileBarHidden}
        isRtl={isRtl}
        scrubberOpen={scrubberOpen}
        pinChrome={pinChrome}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        canSearch={canSearch}
        search={search}
        endPage={endPage}
        progress={progress}
        nextBook={nextBook}
        prevBook={prevBook}
        onBook={onBook}
        reader={reader}
        barControls={barControls}
        canAnnotate={canAnnotate}
        selection={selection}
        isPdf={isPdf}
        isText={isText}
        highlight={highlight}
        setHighlightsOpen={setHighlightsOpen}
        bookId={bookId}
        setPosNotice={setPosNotice}
        highlightsOpen={highlightsOpen}
        onRight={onRight}
        bm={bm}
        bookmarksOpen={bookmarksOpen}
        setBookmarksOpen={setBookmarksOpen}
        ttsOpen={ttsOpen}
        tts={tts}
        ttsPlaying={ttsPlaying}
        ttsCanResume={ttsCanResume}
        voices={voices}
        posNotice={posNotice}
        showSkeleton={showSkeleton}
        readerError={readerError}
        resumed={resumed}
        dismissed={dismissed}
        setDismissed={setDismissed}
      />
    </>
  );
}
