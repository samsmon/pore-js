import {
  FootnotePopover,
  HighlightsPanel,
  BookmarksPanel,
  SettingsPanelBody,
  TableOfContents,
  useEndPage,
  useReader,
  useReaderHistory,
  useReaderKind,
  ReaderScrubber,
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
  useTableOfContents,
  type ImageEngineSettings,
  type TextEngineSettings,
  type TtsVoiceLike,
} from 'porejs-react';
import type { TocEntry } from 'porejs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Home, Library, Search, Link as LinkIcon, Highlighter, Volume2,
  Sun, Moon, Coffee, Settings, ArrowLeft, ArrowRight, Pin, PinOff,
  Bookmark, BookmarkCheck,
  File, BookOpen, ArrowDownToLine, ArrowRightToLine,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Layers,
} from 'lucide-react';
import { useTheme } from './theme.js';
import { useAutoHide } from './use-auto-hide.js';
import type { MenuBar } from './use-menu-bar.js';
import { MenuBarSettings } from './MenuBarSettings.js';
import { citation, copyText, deepLink } from './share.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select.js';
import type { SampleBook } from './Landing.js';

const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];
const DEFAULT_HIGHLIGHT = HIGHLIGHT_COLORS[0]!;

function MobileTocList({ onSelect }: { onSelect: (href: string) => void }) {
  const toc = useTableOfContents();
  const items = useMemo(() => {
    function flatten(
      entries: TocEntry[],
      depth = 0,
    ): { label: string; href: string; depth: number }[] {
      return entries.flatMap((e) => [
        { label: e.label, href: e.href, depth },
        ...flatten(e.children, depth + 1),
      ]);
    }
    return flatten(toc).filter((e) => e.href);
  }, [toc]);

  if (items.length === 0) {
    return (
      <div className="mobile-toc__empty">
        No table of contents available for this book.
      </div>
    );
  }

  return (
    <nav className="mobile-toc" aria-label="Table of contents">
      <ul className="mobile-toc__list" role="list">
        {items.map((item, i) => (
          <li key={`${item.href}-${i}`} className="mobile-toc__item-wrap">
            <button
              className="mobile-toc__item"
              style={{ paddingLeft: `${0.75 + item.depth * 1}rem` }}
              onClick={() => onSelect(item.href)}
            >
              <span className="mobile-toc__label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

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

  // The "Resumed from p.N" toast auto-dismisses after 15s.
  useEffect(() => {
    if (resumed === null) return;
    const t = setTimeout(() => setDismissed(true), 15_000);
    return () => clearTimeout(t);
  }, [resumed]);

  // Only show the skeleton for loads that take a moment — avoids a flash on
  // cache-warm / fast page turns.
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
  // The reader kind for PDF is 'image' (it's the image engine underneath);
  // search is only meaningful when there's a text layer, so key off the id.
  const isPdf = isImage && /\.pdf$|^demo-pdf$/i.test(bookId);
  const canSearch = isText || isPdf;
  const canAnnotate = isText || isPdf;
  const menuPos = menu.placement;

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  type MobileSheet = 'toc' | 'settings' | 'episodes' | null;
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [scrubberOpen, setScrubberOpen] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);

  // Sync reader chrome-toggle with mobile visibility
  useEffect(() => {
    setMobileChromeVisible(chromeVisible);
  }, [chromeVisible]);

  // Keep settingsOpen and mobileSheet in sync on mobile
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
    settingsOpen || searchOpen || endPage !== null || highlightsOpen || bookmarksOpen || ttsOpen || mobileSheet !== null;

  // `b` toggles a bookmark at the current page (unless typing in a field)
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

  // Escape closes the top-most open panel and returns focus to the rail button
  // that opened it (the panels are plain divs, not Radix dialogs).
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
      (document.querySelector(`.bar button[aria-label="${hit[2]}"]`) as HTMLElement | null)?.focus();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ttsOpen, bookmarksOpen, highlightsOpen, searchOpen, settingsOpen, onToggleSettings, mobileSheet, closeMobileSheet]);

  // Center area click/tap handler: toggles desktop sidebar or mobile chrome
  useEffect(() => {
    const onWindowClick = (e: MouseEvent) => {
      if (overlayOpen || mobileSheet !== null) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          'button, a, input, select, textarea, [data-pore-chrome-handle], .bar, .bar--collapsed, .mobile-header, .mobile-bottom-bar, .mobile-sheet, .highlights-panel, .search, .selection-toolbar, .toast, .notice, .endpage, .pore-select-content, [role="menu"], [role="dialog"], [role="listbox"], [role="button"], [data-pore-settings-inline], .footnote'
        )
      ) {
        return;
      }
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 0) return;

      const r = e.clientX / window.innerWidth;
      if (r >= 0.30 && r <= 0.70) {
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

  // Auto-hide when the user chose it, or always in fullscreen. Panels pin it open.
  const isAuto = menu.behaviour === 'auto-hide';
  const autoHiding = (isFullscreen || isAuto) && !overlayOpen;
  const [autoHidden, pinChrome, hideChrome] = useAutoHide(2600, autoHiding);

  useEffect(() => {
    if (overlayOpen || mobileSheet !== null) pinChrome();
  }, [overlayOpen, mobileSheet, pinChrome]);

  // Sync reader chrome-toggle with auto-hide
  useEffect(() => {
    if (chromeVisible) {
      pinChrome();
    } else {
      hideChrome();
    }
  }, [chromeVisible, pinChrome, hideChrome]);

  const barHidden = autoHiding && autoHidden;
  const mobileBarHidden = (!mobileChromeVisible || barHidden) && mobileSheet === null && !overlayOpen;
  
  const currentSample = books.find((b) => b.id === bookId);
  const currentBookLabel = currentSample?.label || (droppedName ?? 'Book');
  const series = currentSample?.series;
  const seriesBooks = series ? books.filter((b) => b.series?.id === series.id) : [];
  const nextBook = series?.nextBookId ? books.find((b) => b.id === series.nextBookId) : undefined;
  const prevBook = series?.prevBookId ? books.find((b) => b.id === series.prevBookId) : undefined;

  // Keyboard navigation for series volumes: `[` for prev, `]` for next
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === ']' && nextBook) {
        onBook(nextBook.id);
      } else if (e.key === '[' && prevBook) {
        onBook(prevBook.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextBook, prevBook, onBook]);

  const pageDisplay =
    loc?.page !== undefined && loc?.total
      ? `p. ${loc.page + 1} / ${loc.total}`
      : loc?.label ?? '…';


  const collapsed = menu.collapsed && !settingsOpen;

  // Settings expands inline right under its own button in the same rail, as a
  // stacked accordion — no separate view, no navigating away from the menu.
  const settingsInline = settingsOpen && (
    <div className="bar__settings-inline" data-pore-settings-inline>
      <SettingsPanelBody
        layout="accordion"
        extraTabs={[
          {
            id: 'menubar',
            label: 'Menu bar',
            content: (
              <MenuBarSettings menu={menu} animate={animate} onToggleAnimate={onToggleAnimate} />
            ),
          },
        ]}
      />
    </div>
  );

  const barControls = (
    <>
      <button className="home" onClick={onHome} aria-label="Back to start" title="Back to start">
        <span className="icon"><Home size={18} /></span>
        <span>Pore.js</span>
      </button>
      {!collapsed && (
        <Select
          value={droppedName ? '' : bookId}
          onValueChange={(val) => val && onBook(val)}
        >
          <SelectTrigger aria-label="Book" className="w-[180px] h-8 text-[0.85rem] border-transparent bg-transparent hover:bg-fg/5 transition-colors">
            <SelectValue placeholder="Select a book" />
          </SelectTrigger>
          <SelectContent>
            {droppedName && <SelectItem value="">{droppedName}</SelectItem>}
            {books.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {!collapsed && series && seriesBooks.length > 1 && (
        <div className="bar__series" title={series.title}>
          <div className="bar__series-header">
            <span className="bar__series-title">{series.title}</span>
            <span className="bar__series-badge">
              Vol {series.episodeIndex}/{series.totalEpisodes}
            </span>
          </div>
          <div className="bar__series-row">
            <button
              type="button"
              className="bar__series-arrow"
              disabled={!prevBook}
              onClick={() => prevBook && onBook(prevBook.id)}
              title={prevBook ? `Previous: ${prevBook.label}` : 'No previous volume'}
              aria-label="Previous volume"
            >
              ←
            </button>
            <Select
              value={bookId}
              onValueChange={(val) => val && onBook(val)}
            >
              <SelectTrigger
                aria-label="Volume / Episode"
                className="flex-1 h-7 text-[0.78rem] border border-fg/10 bg-fg/5 hover:bg-fg/10 transition-colors"
              >
                <SelectValue placeholder="Volume" />
              </SelectTrigger>
              <SelectContent>
                {seriesBooks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              className="bar__series-arrow"
              disabled={!nextBook}
              onClick={() => nextBook && onBook(nextBook.id)}
              title={nextBook ? `Next: ${nextBook.label}` : 'No next volume'}
              aria-label="Next volume"
            >
              →
            </button>
          </div>
        </div>
      )}

      <button
        className={opdsOpen ? 'active' : ''}
        onClick={onToggleOpds}
        aria-label="Browse OPDS catalog"
        title="Browse an OPDS catalog"
      >
        <span className="icon"><Library size={18} /></span>
        <span>Catalog</span>
      </button>

      {!collapsed && <TableOfContents />}

      {isImage && !isPdf && (
        <>
          <button
            onClick={() => {
              const layouts = [
                'paged-single',
                'paged-double',
                'continuous-vertical',
                'continuous-horizontal',
              ] as const;
              const next = layouts[(layouts.indexOf(imgSettings.layout) + 1) % layouts.length]!;
              setImgSettings({ layout: next });
            }}
            title="Cycle Layout"
          >
            <span className="icon">
              {imgSettings.layout === 'paged-single' ? <File size={18} /> :
               imgSettings.layout === 'paged-double' ? <BookOpen size={18} /> :
               imgSettings.layout === 'continuous-vertical' ? <ArrowDownToLine size={18} /> :
               <ArrowRightToLine size={18} />}
            </span>
            <span>
              {imgSettings.layout === 'paged-single' ? 'Single' :
               imgSettings.layout === 'paged-double' ? 'Double' :
               imgSettings.layout === 'continuous-vertical' ? 'Webtoon' :
               'Horizontal'}
            </span>
          </button>
          {imgSettings.layout === 'continuous-vertical' && !collapsed && (
            <div className="slider" title="Webtoon Image Width">
              <input
                type="range"
                min={300}
                max={1500}
                step={50}
                value={imgSettings.maxWidth ?? 1500}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setImgSettings({ maxWidth: val >= 1500 ? null : val });
                }}
              />
              <span>{imgSettings.maxWidth ? `${imgSettings.maxWidth}px` : 'Fit'}</span>
            </div>
          )}
          <button
            onClick={() => setImgSettings({ direction: imgSettings.direction === 'rtl' ? 'ltr' : 'rtl' })}
            title={imgSettings.direction === 'rtl' ? 'Reading direction: Right to Left (RTL). Click for Left to Right.' : 'Reading direction: Left to Right (LTR). Click for Right to Left.'}
          >
            <span className="icon">
              {imgSettings.direction === 'rtl' ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
            </span>
            <span>{imgSettings.direction === 'rtl' ? 'RTL' : 'LTR'}</span>
          </button>
        </>
      )}
      {canSearch && (
        <button
          className={searchOpen ? 'active' : ''}
          onClick={() => setSearchOpen((v) => !v)}
          aria-label="Search in book"
        >
          <span className="icon"><Search size={18} /></span>
          <span>Search</span>
        </button>
      )}
      {isText && (
        <button
          onClick={() => {
            const cfi = reader.getCfi();
            if (!cfi) return;
            void copyText(deepLink(bookId, cfi));
            setPosNotice('Link to this page copied');
            setTimeout(() => setPosNotice(null), 4000);
          }}
          aria-label="Copy a link to this page"
          title="Copy a portable link to this page (epubcfi)"
        >
          <span className="icon"><LinkIcon size={18} /></span>
          <span>Copy Link</span>
        </button>
      )}
      {bm.supported && (
        <button
          className={bookmarksOpen ? 'active' : ''}
          onClick={() => setBookmarksOpen((v) => !v)}
          aria-label="Bookmarks"
          title="Bookmarks (b to toggle one here)"
        >
          <span className="icon">
            {bm.isBookmarkedHere ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
          </span>
          <span>Bookmarks{bm.bookmarks.length > 0 ? ` (${bm.bookmarks.length})` : ''}</span>
        </button>
      )}
      {canAnnotate && (
        <button
          className={highlightsOpen ? 'active' : ''}
          onClick={() => setHighlightsOpen((v) => !v)}
          aria-label="Highlights"
          title={isPdf ? 'Highlights — Shift-drag on the page to add' : 'Highlights'}
        >
          <span className="icon"><Highlighter size={18} /></span>
          <span>Highlights{highlights.length > 0 ? ` (${highlights.length})` : ''}</span>
        </button>
      )}
      {isText && (
        <button
          className={ttsOpen ? 'active' : ''}
          onClick={() => setTtsOpen((v) => !v)}
          aria-label="Text to speech"
          title="Listen (text-to-speech)"
        >
          <span className="icon"><Volume2 size={18} /></span>
          <span>Listen</span>
        </button>
      )}
      {/* ---- separator ---- */}
      <div className="bar__separator" />

      {/* Theme + Pin, side by side, above Settings */}
      <div className="bar__pair">
        {isText ? (
          <button
            onClick={() => {
              const t = textSettings.theme;
              const next = t === 'light' ? 'sepia' : t === 'sepia' ? 'dark' : 'light';
              setTextSettings({ theme: next });
              if ((next === 'dark') !== (theme === 'dark')) toggleTheme();
            }}
            aria-label={`Reading theme: ${textSettings.theme}`}
            title="Reading theme — light · sepia · dark"
          >
            <span className="icon">
              {textSettings.theme === 'sepia' ? (
                <Coffee size={18} />
              ) : textSettings.theme === 'light' ? (
                <Sun size={18} />
              ) : (
                <Moon size={18} />
              )}
            </span>
            <span>Theme</span>
          </button>
        ) : (
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <span className="icon">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</span>
            <span>Theme</span>
          </button>
        )}
        <button
          onClick={() => menu.setBehaviour(menu.behaviour === 'always' ? 'auto-hide' : 'always')}
          title={
            menu.behaviour === 'always' ? 'Unpin (menu auto-hides)' : 'Pin (keep menu visible)'
          }
          aria-label={menu.behaviour === 'always' ? 'Unpin menu' : 'Pin menu'}
          aria-pressed={menu.behaviour === 'always'}
          className={menu.behaviour === 'always' ? 'active' : ''}
        >
          <span className="icon">
            {menu.behaviour === 'always' ? <Pin size={18} /> : <PinOff size={18} />}
          </span>
          <span>{menu.behaviour === 'always' ? 'Pinned' : 'Unpinned'}</span>
        </button>
      </div>

      {/* Settings — expands its sub-sections inline right below, same rail */}
      <button
        className={`bar__settings-btn${settingsOpen ? ' active' : ''}`}
        onClick={onToggleSettings}
        aria-label="Reader settings"
        aria-expanded={settingsOpen}
        title="Reader settings"
      >
        <span className="icon"><Settings size={18} /></span>
        <span>Settings</span>
      </button>
      {settingsInline}

      {!collapsed && (
        <span className="loc" role="status" aria-live="polite">
          {loc?.label ?? '…'}
          {progress && progress.chapterCount > 1 && (
            <span className="loc__sub">
              {' · '}Ch {progress.chapterIndex + 1}/{progress.chapterCount}
              {progress.minutesLeft > 0 && ` · ${progress.minutesLeft} min left`}
            </span>
          )}
        </span>
      )}
    </>
  );

  const onRight = menuPos === 'right';
  const CollapseIcon = menu.collapsed
    ? onRight
      ? PanelRightOpen
      : PanelLeftOpen
    : onRight
      ? PanelRightClose
      : PanelLeftClose;

  const collapseToggle = (
    <button
      className="bar__collapse"
      onClick={menu.toggleCollapsed}
      aria-label={menu.collapsed ? 'Expand menu' : 'Collapse menu'}
      title={menu.collapsed ? 'Expand menu' : 'Collapse menu'}
    >
      <span className="icon"><CollapseIcon size={18} /></span>
      <span>Collapse</span>
    </button>
  );

  const isRtl = isImage && imgSettings?.direction === 'rtl';
  const progressSettings = isImage
    ? (imgSettings?.progressBar ?? { style: 'normal', position: 'bottom', thickness: 3 })
    : { style: 'normal' as const, position: 'bottom' as const, thickness: 3 };
  const progressStyle = progressSettings.style;
  const progressPos = progressSettings.position ?? 'bottom';
  const progressThickness = progressSettings.thickness || 3;
  const progressPercent = Math.min(100, Math.max(0, (progress?.percent ?? 0) * 100));

  return (
    <>
      {/* Mobile Top Header */}
      <header
        className={`mobile-header${mobileBarHidden ? ' mobile-header--hidden' : ''}`}
        role="banner"
      >
        <button
          className="mobile-header__btn"
          onClick={onHome}
          aria-label="Back to start"
          title="Back to start"
        >
          <ArrowLeft size={18} />
        </button>

        <div className="mobile-header__title-wrap">
          <span className="mobile-header__book-title">{currentBookLabel}</span>
          {progress && progress.chapterCount > 1 && (
            <span className="mobile-header__chapter-badge">
              Ch {progress.chapterIndex + 1}/{progress.chapterCount}
            </span>
          )}
        </div>

        <div className="mobile-header__actions">
          {canSearch && (
            <button
              className={`mobile-header__btn${searchOpen ? ' active' : ''}`}
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search in book"
              title="Search"
            >
              <Search size={18} />
            </button>
          )}
          {bm.supported && (
            <button
              className={`mobile-header__btn${bm.isBookmarkedHere ? ' active' : ''}`}
              onClick={() => bm.toggle()}
              aria-label={bm.isBookmarkedHere ? 'Remove bookmark' : 'Bookmark this page'}
              title="Bookmark"
            >
              {bm.isBookmarkedHere ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
            </button>
          )}
          <button
            className="mobile-header__btn"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className={`mobile-header__btn${mobileSheet === 'settings' ? ' active' : ''}`}
            onClick={() => {
              if (mobileSheet === 'settings') closeMobileSheet();
              else {
                if (!settingsOpen) onToggleSettings();
                setMobileSheet('settings');
              }
            }}
            aria-label="Reader settings"
            title="Reader settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Mobile Ergonomic Tap Zones */}
      <div className="mobile-tap-zones" aria-hidden="true">
        <div className="mobile-tap-zone mobile-tap-zone--left" />
        <div className="mobile-tap-zone mobile-tap-zone--center" />
        <div className="mobile-tap-zone mobile-tap-zone--right" />
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        className={`mobile-bottom-bar${mobileBarHidden ? ' mobile-bottom-bar--hidden' : ''}`}
        role="navigation"
        aria-label="Mobile reader controls"
      >
        <button
          className="mobile-btn"
          onClick={onHome}
          aria-label="Back to start"
          title="Back to start"
        >
          <Home size={19} />
          <span className="mobile-btn__label">Home</span>
        </button>

        <button
          className={`mobile-btn${mobileSheet === 'toc' ? ' active' : ''}`}
          onClick={() => {
            if (mobileSheet === 'toc') closeMobileSheet();
            else {
              if (settingsOpen) onToggleSettings();
              setMobileSheet('toc');
            }
          }}
          aria-label="Table of contents"
          title="Table of contents"
        >
          <BookOpen size={19} />
          <span className="mobile-btn__label">TOC</span>
        </button>

        {seriesBooks.length > 1 && (
          <button
            className={`mobile-btn${mobileSheet === 'episodes' ? ' active' : ''}`}
            onClick={() => {
              if (mobileSheet === 'episodes') closeMobileSheet();
              else {
                if (settingsOpen) onToggleSettings();
                setMobileSheet('episodes');
              }
            }}
            aria-label="Episodes & Volumes"
            title="Volumes / Episodes"
          >
            <Layers size={19} />
            <span className="mobile-btn__label">Volumes</span>
          </button>
        )}

        {/* Chapter & Page position indicator */}
        <button
          className={`mobile-pos-indicator${scrubberOpen ? ' active' : ''}`}
          onClick={() => setScrubberOpen((v) => !v)}
          aria-label="Toggle scrubber"
          title="Toggle quick scrubber"
        >
          <span className="mobile-pos-indicator__main">{pageDisplay}</span>
          {progress && (
            <span className="mobile-pos-indicator__sub">
              {progress.chapterCount > 1
                ? `Ch ${progress.chapterIndex + 1}/${progress.chapterCount}`
                : `${Math.round(progressPercent)}%`}
            </span>
          )}
        </button>
      </nav>

      {/* Mobile Bottom Sheet Drawer for Settings & TOC */}
      {mobileSheet !== null && (
        <>
          <div
            className="mobile-sheet-backdrop"
            onClick={closeMobileSheet}
            aria-hidden="true"
          />
          <div
            className="mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={mobileSheet === 'toc' ? 'Table of Contents' : 'Reader Settings'}
          >
            <div className="mobile-sheet__handle-bar" onClick={closeMobileSheet}>
              <div className="mobile-sheet__drag-handle" />
            </div>

            <div className="mobile-sheet__header">
              <h2 className="mobile-sheet__title">
                {mobileSheet === 'toc'
                  ? 'Table of Contents'
                  : mobileSheet === 'episodes'
                    ? 'Episodes & Volumes'
                    : 'Settings'}
              </h2>
              <button
                className="mobile-sheet__close"
                onClick={closeMobileSheet}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="mobile-sheet__body">
              {(mobileSheet === 'toc' || mobileSheet === 'episodes') && seriesBooks.length > 1 && (
                <div className="mobile-sheet__tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobileSheet === 'toc'}
                    className={`mobile-sheet__tab${mobileSheet === 'toc' ? ' active' : ''}`}
                    onClick={() => setMobileSheet('toc')}
                  >
                    Chapters
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobileSheet === 'episodes'}
                    className={`mobile-sheet__tab${mobileSheet === 'episodes' ? ' active' : ''}`}
                    onClick={() => setMobileSheet('episodes')}
                  >
                    Volumes ({seriesBooks.length})
                  </button>
                </div>
              )}

              {mobileSheet === 'episodes' ? (
                <div className="mobile-episodes">
                  <div className="mobile-episodes__quick-nav">
                    <button
                      type="button"
                      className="mobile-episodes__nav-btn"
                      disabled={!prevBook}
                      onClick={() => {
                        if (prevBook) {
                          onBook(prevBook.id);
                          closeMobileSheet();
                        }
                      }}
                    >
                      ← Prev Vol
                    </button>
                    <span className="mobile-episodes__current-badge">
                      Vol {series?.episodeIndex} of {series?.totalEpisodes}
                    </span>
                    <button
                      type="button"
                      className="mobile-episodes__nav-btn"
                      disabled={!nextBook}
                      onClick={() => {
                        if (nextBook) {
                          onBook(nextBook.id);
                          closeMobileSheet();
                        }
                      }}
                    >
                      Next Vol →
                    </button>
                  </div>
                  <ul className="mobile-episodes__list" role="list">
                    {seriesBooks.map((b) => {
                      const isActive = b.id === bookId;
                      return (
                        <li key={b.id} className="mobile-episodes__item-wrap">
                          <button
                            type="button"
                            className={`mobile-episodes__item${isActive ? ' active' : ''}`}
                            onClick={() => {
                              onBook(b.id);
                              closeMobileSheet();
                            }}
                          >
                            <div className="mobile-episodes__item-info">
                              <span className="mobile-episodes__item-label">{b.label}</span>
                              <span className="mobile-episodes__item-blurb">{b.blurb}</span>
                            </div>
                            {isActive && (
                              <span className="mobile-episodes__current-pill">Reading</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : mobileSheet === 'toc' ? (
                <MobileTocList
                  onSelect={(href) => {
                    reader.goToHref(href);
                    closeMobileSheet();
                  }}
                />
              ) : (
                <div className="mobile-sheet__settings">
                  <SettingsPanelBody
                    layout="accordion"
                    extraTabs={[
                      {
                        id: 'menubar',
                        label: 'Menu bar',
                        content: (
                          <MenuBarSettings
                            menu={menu}
                            animate={animate}
                            onToggleAnimate={onToggleAnimate}
                          />
                        ),
                      },
                    ]}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <header
        className={`bar bar--${menuPos}${barHidden ? ' bar--hidden' : ''}${
          collapsed ? ' bar--collapsed' : ''
        }${settingsOpen ? ' bar--settings' : ''}`}
        onPointerEnter={pinChrome}
      >
        {collapseToggle}
        {barControls}
      </header>

      {loading && <div className="progress progress--loading" aria-hidden />}

      {/* Minimal edge lightbar when style is 'lightbar', or when style is 'normal' and chrome is hidden */}
      {progressStyle !== 'hidden' && (progressStyle === 'lightbar' || barHidden || (isMobile && mobileBarHidden)) && (
        <div
          className={`pore-lightbar pore-lightbar--${progressPos}${isMobile && mobileBarHidden ? ' pore-lightbar--mobile-edge' : ''}`}
          style={
            progressPos === 'bottom'
              ? { height: isMobile && mobileBarHidden ? '2px' : `${progressThickness}px` }
              : { width: isMobile && mobileBarHidden ? '2px' : `${progressThickness}px` }
          }
          role="progressbar"
          aria-valuenow={Math.round(progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="pore-lightbar__fill"
            style={
              progressPos === 'bottom'
                ? {
                    width: `${progressPercent}%`,
                    ...(isRtl
                      ? { marginRight: 0, marginLeft: 'auto' }
                      : { marginLeft: 0, marginRight: 'auto' }),
                  }
                : {
                    height: `${progressPercent}%`,
                    marginTop: 'auto',
                    marginBottom: 0,
                  }
            }
          />
        </div>
      )}

      {/* Interactive scrubber dock in normal mode: on mobile only shown when scrubberOpen is true and chrome visible */}
      {progressStyle === 'normal' && (!isMobile || (scrubberOpen && !mobileBarHidden)) && (
        <div
          className={`scrubber-dock${barHidden && !scrubberOpen ? ' scrubber-dock--hidden' : ''}${
            scrubberOpen ? ' scrubber-dock--mobile-active' : ''
          }`}
          onPointerEnter={pinChrome}
        >
          <ReaderScrubber dir={isRtl ? 'rtl' : 'ltr'} />
        </div>
      )}



      {searchOpen && canSearch && (
        <div className="search" role="search">
          <div className="search__row">
            <input
              autoFocus
              type="search"
              placeholder="Search in book…"
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.shiftKey ? search.prev() : search.next())}
            />
            <span className="search__count">
              {search.busy
                ? '…'
                : search.hits.length
                  ? `${search.activeIndex + 1 || '–'}/${search.hits.length}`
                  : search.query.trim().length >= 2
                    ? '0'
                    : ''}
            </span>
            <button onClick={() => setSearchOpen(false)} aria-label="Close search">
              ×
            </button>
          </div>
          <ol className="search__hits">
            {search.hits.slice(0, 50).map((hit, i) => (
              <li key={`${hit.sectionId}-${hit.start}`}>
                <button
                  className={i === search.activeIndex ? 'active' : ''}
                  onClick={() => search.go(i)}
                >
                  <span className="search__pre">{hit.snippet.slice(0, hit.snippetRange[0])}</span>
                  <mark>{hit.snippet.slice(hit.snippetRange[0], hit.snippetRange[1])}</mark>
                  <span>{hit.snippet.slice(hit.snippetRange[1])}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {endPage && (
        <div className="endpage" role="status">
          <div className="endpage__icon" aria-hidden>
            {endPage.kind === 'book' ? '✓' : '·'}
          </div>
          <div className="endpage__title">{endPage.label}</div>
          {progress && (
            <div className="endpage__subtitle">
              {endPage.kind === 'book'
                ? `${progress.chapterCount} chapter${progress.chapterCount === 1 ? '' : 's'} · finished`
                : `Chapter ${progress.chapterIndex + 1} of ${progress.chapterCount}`}
            </div>
          )}
          <div className="endpage__actions">
            {endPage.kind === 'book' ? (
              <>
                {nextBook && (
                  <button className="primary" onClick={() => onBook(nextBook.id)}>
                    Next: {nextBook.label} →
                  </button>
                )}
                {prevBook && (
                  <button className="secondary" onClick={() => onBook(prevBook.id)}>
                    ← Previous: {prevBook.label}
                  </button>
                )}
                <button
                  className={nextBook ? 'secondary' : 'primary'}
                  onClick={() => reader.goto(0)}
                >
                  Restart from the beginning
                </button>
              </>
            ) : (
              endPage.hasNext && (
                <button className="primary" onClick={() => reader.turn('forward')}>
                  Continue →
                </button>
              )
            )}
          </div>
          <div className="endpage__menu">{barControls}</div>
        </div>
      )}

      <FootnotePopover />

      {canAnnotate && selection && (isPdf || selection.text.trim().length > 0) && (
        <div className="selection-toolbar" role="toolbar" aria-label="Highlight selection">
          <span className="selection-toolbar__text">
            {selection.text.trim() ? `"${selection.text.slice(0, 40)}"` : 'Selected region'}
          </span>
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              className="selection-toolbar__swatch"
              style={{ background: color }}
              aria-label={`Highlight in ${color}`}
              onClick={() => highlight({ color })}
            />
          ))}
          <button
            className="selection-toolbar__note"
            aria-label="Highlight and add a note"
            title="Highlight and add a note"
            onClick={() => {
              if (highlight({ color: DEFAULT_HIGHLIGHT })) setHighlightsOpen(true);
            }}
          >
            ✎
          </button>
          {isText && selection.text.trim().length > 0 && (
            <button
              className="selection-toolbar__quote"
              aria-label="Copy quote with a link"
              title="Copy the passage + a link back to it"
              onClick={() => {
                const cfi = reader.getCfi();
                const locator =
                  progress && progress.chapterCount > 1
                    ? `Ch ${progress.chapterIndex + 1}/${progress.chapterCount}`
                    : undefined;
                const text = citation(
                  selection.text,
                  locator,
                  cfi ? deepLink(bookId, cfi) : location.href,
                );
                void copyText(text);
                setPosNotice('Quote + link copied');
                setTimeout(() => setPosNotice(null), 4000);
              }}
            >
              ❝
            </button>
          )}
        </div>
      )}

      {canAnnotate && highlightsOpen && (
        <div
          className={`highlights-panel${onRight ? ' highlights-panel--left' : ''}`}
          role="dialog"
          aria-label="Highlights"
        >
          <div className="highlights-panel__header">
            <strong>Highlights</strong>
            <button onClick={() => setHighlightsOpen(false)} aria-label="Close highlights">
              ×
            </button>
          </div>
          <HighlightsPanel
            className="highlights-panel__body"
            colors={HIGHLIGHT_COLORS}
            emptyLabel={
              isPdf
                ? 'Shift-drag over the page to highlight a passage.'
                : 'Select text in the book to highlight it.'
            }
            onJump={() => setHighlightsOpen(false)}
          />
        </div>
      )}

      {bm.supported && bookmarksOpen && (
        <div
          className={`highlights-panel${onRight ? ' highlights-panel--left' : ''}`}
          role="dialog"
          aria-label="Bookmarks"
        >
          <div className="highlights-panel__header">
            <strong>Bookmarks</strong>
            <div className="highlights-panel__head-actions">
              <button
                className="bm-add"
                onClick={() => bm.toggle()}
                aria-pressed={bm.isBookmarkedHere}
              >
                {bm.isBookmarkedHere ? 'Remove this page' : 'Bookmark this page'}
              </button>
              <button onClick={() => setBookmarksOpen(false)} aria-label="Close bookmarks">
                ×
              </button>
            </div>
          </div>
          <BookmarksPanel className="highlights-panel__body" onJump={() => setBookmarksOpen(false)} />
        </div>
      )}

      {isText && ttsOpen && (
        <div className="tts-bar" role="group" aria-label="Text to speech controls">
          <button
            onClick={() => {
              if (ttsPlaying) tts.pause();
              else if (ttsCanResume) tts.resume();
              else tts.play();
            }}
            aria-label={ttsPlaying ? 'Pause' : ttsCanResume ? 'Resume' : 'Play'}
          >
            {ttsPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={() => tts.stop()} aria-label="Stop" disabled={!tts.state?.sentence}>
            ⏹
          </button>
          <select
            value={tts.state?.rate ?? 1}
            onChange={(e) => tts.setRate(Number(e.target.value))}
            aria-label="Speech rate"
          >
            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          {voices.length > 0 && (
            <select
              value={tts.state?.voice?.voiceURI ?? ''}
              onChange={(e) =>
                tts.setVoice(voices.find((v) => v.voiceURI === e.target.value) ?? null)
              }
              aria-label="Voice"
            >
              <option value="">Default voice</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          {tts.state?.sentence && (
            <span className="tts-bar__sentence">{tts.state.sentence.text}</span>
          )}
        </div>
      )}

      {posNotice && (
        <div className="notice" role="status" onClick={() => setPosNotice(null)}>
          {posNotice}
        </div>
      )}

      {showSkeleton && !readerError.error && (
        <div className="skeleton" aria-hidden>
          <div className="skeleton__tile" />
        </div>
      )}

      {/* only a fatal / whole-book error gets the blocking card — a single
          failed page shows the engine's inline "tap to retry" tile instead */}
      {readerError.error && readerError.error.index === undefined && (
        <div className="error-tile" role="alert">
          <p>Couldn't load this book.</p>
          <div className="error-tile__actions">
            <button onClick={readerError.retry}>Retry</button>
            <button onClick={readerError.dismiss}>Dismiss</button>
          </div>
        </div>
      )}

      {resumed !== null && !dismissed && (
        <div className="toast">
          Resumed from p.{resumed + 1}
          <button
            onClick={() => {
              reader.goto(0);
              setDismissed(true);
            }}
          >
            Restart
          </button>
          <button onClick={() => setDismissed(true)}>×</button>
        </div>
      )}
    </>
  );
}
