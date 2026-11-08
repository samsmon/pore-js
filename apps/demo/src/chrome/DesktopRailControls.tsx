import {
  SettingsPanelBody,
  TableOfContents,
  type ImageEngineSettings,
  type ReaderHandle,
  type ReaderLocation,
  type ReaderProgress,
  type TextEngineSettings,
  type UseBookmarks,
} from 'porejs-react';
import type { HighlightRecord } from 'porejs';
import {
  Home,
  Library,
  Search,
  Link as LinkIcon,
  Highlighter,
  Volume2,
  Sun,
  Moon,
  Coffee,
  Settings,
  ArrowLeft,
  ArrowRight,
  Pin,
  PinOff,
  Bookmark,
  BookmarkCheck,
  File,
  BookOpen,
  ArrowDownToLine,
  ArrowRightToLine,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type { MenuBar } from '../use-menu-bar.js';
import { MenuBarSettings } from '../MenuBarSettings.js';
import { copyText, deepLink } from '../share.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import type { SampleBook } from '../Landing.js';

export interface DesktopRailControlsProps {
  books: SampleBook[];
  bookId: string;
  onBook: (id: string) => void;
  onHome: () => void;
  droppedName?: string | null;
  opdsOpen: boolean;
  onToggleOpds: () => void;
  menu: MenuBar;
  animate: boolean;
  onToggleAnimate: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  collapsed: boolean;
  series: SampleBook['series'];
  seriesBooks: SampleBook[];
  prevBook: SampleBook | undefined;
  nextBook: SampleBook | undefined;
  isImage: boolean;
  isText: boolean;
  isPdf: boolean;
  canSearch: boolean;
  canAnnotate: boolean;
  imgSettings: ImageEngineSettings;
  setImgSettings: (patch: Partial<ImageEngineSettings>) => void;
  textSettings: TextEngineSettings;
  setTextSettings: (patch: Partial<TextEngineSettings>) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  searchOpen: boolean;
  setSearchOpen: (fn: (v: boolean) => boolean) => void;
  bookmarksOpen: boolean;
  setBookmarksOpen: (fn: (v: boolean) => boolean) => void;
  highlightsOpen: boolean;
  setHighlightsOpen: (fn: (v: boolean) => boolean) => void;
  ttsOpen: boolean;
  setTtsOpen: (fn: (v: boolean) => boolean) => void;
  bm: UseBookmarks;
  highlights: HighlightRecord[];
  reader: ReaderHandle;
  loc: ReaderLocation | null;
  progress: ReaderProgress | null;
  setPosNotice: (msg: string | null) => void;
}

export function DesktopRailCollapseButton({ menu }: { menu: MenuBar }) {
  const onRight = menu.placement === 'right';
  const CollapseIcon = menu.collapsed
    ? onRight
      ? PanelRightOpen
      : PanelLeftOpen
    : onRight
      ? PanelRightClose
      : PanelLeftClose;

  return (
    <button
      className="bar__collapse"
      onClick={menu.toggleCollapsed}
      aria-label={menu.collapsed ? 'Expand menu' : 'Collapse menu'}
      title={menu.collapsed ? 'Expand menu' : 'Collapse menu'}
    >
      <span className="icon">
        <CollapseIcon size={18} />
      </span>
      <span>Collapse</span>
    </button>
  );
}

export function DesktopRailControls(props: DesktopRailControlsProps) {
  const {
    books,
    bookId,
    onBook,
    onHome,
    droppedName,
    opdsOpen,
    onToggleOpds,
    menu,
    animate,
    onToggleAnimate,
    settingsOpen,
    onToggleSettings,
    collapsed,
    series,
    seriesBooks,
    prevBook,
    nextBook,
    isImage,
    isText,
    isPdf,
    canSearch,
    canAnnotate,
    imgSettings,
    setImgSettings,
    textSettings,
    setTextSettings,
    theme,
    toggleTheme,
    searchOpen,
    setSearchOpen,
    bookmarksOpen,
    setBookmarksOpen,
    highlightsOpen,
    setHighlightsOpen,
    ttsOpen,
    setTtsOpen,
    bm,
    highlights,
    reader,
    loc,
    progress,
    setPosNotice,
  } = props;

  return (
    <>
      <button className="home" onClick={onHome} aria-label="Back to start" title="Back to start">
        <span className="icon">
          <Home size={18} />
        </span>
        <span>Pore.js</span>
      </button>
      {!collapsed && (
        <Select value={droppedName ? '' : bookId} onValueChange={(val) => val && onBook(val)}>
          <SelectTrigger
            aria-label="Book"
            className="w-[180px] h-8 text-[0.85rem] border-transparent bg-transparent hover:bg-fg/5 transition-colors"
          >
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
            <Select value={bookId} onValueChange={(val) => val && onBook(val)}>
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
        <span className="icon">
          <Library size={18} />
        </span>
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
              {imgSettings.layout === 'paged-single' ? (
                <File size={18} />
              ) : imgSettings.layout === 'paged-double' ? (
                <BookOpen size={18} />
              ) : imgSettings.layout === 'continuous-vertical' ? (
                <ArrowDownToLine size={18} />
              ) : (
                <ArrowRightToLine size={18} />
              )}
            </span>
            <span>
              {imgSettings.layout === 'paged-single'
                ? 'Single'
                : imgSettings.layout === 'paged-double'
                  ? 'Double'
                  : imgSettings.layout === 'continuous-vertical'
                    ? 'Webtoon'
                    : 'Horizontal'}
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
            onClick={() =>
              setImgSettings({ direction: imgSettings.direction === 'rtl' ? 'ltr' : 'rtl' })
            }
            title={
              imgSettings.direction === 'rtl'
                ? 'Reading direction: Right to Left (RTL). Click for Left to Right.'
                : 'Reading direction: Left to Right (LTR). Click for Right to Left.'
            }
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
          <span className="icon">
            <Search size={18} />
          </span>
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
          <span className="icon">
            <LinkIcon size={18} />
          </span>
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
          <span className="icon">
            <Highlighter size={18} />
          </span>
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
          <span className="icon">
            <Volume2 size={18} />
          </span>
          <span>Listen</span>
        </button>
      )}
      <div className="bar__separator" />

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
            <span className="icon">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </span>
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

      <button
        className={`bar__settings-btn${settingsOpen ? ' active' : ''}`}
        onClick={onToggleSettings}
        aria-label="Reader settings"
        aria-expanded={settingsOpen}
        title="Reader settings"
      >
        <span className="icon">
          <Settings size={18} />
        </span>
        <span>Settings</span>
      </button>
      {settingsOpen && (
        <div className="bar__settings-inline" data-pore-settings-inline>
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
}
