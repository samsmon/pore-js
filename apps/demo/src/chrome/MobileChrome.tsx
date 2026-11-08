import {
  SettingsPanelBody,
  type ReaderHandle,
  type ReaderProgress,
  type UseBookmarks,
} from 'porejs-react';
import {
  Home,
  Search,
  Sun,
  Moon,
  Settings,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Layers,
} from 'lucide-react';
import type { MenuBar } from '../use-menu-bar.js';
import { MenuBarSettings } from '../MenuBarSettings.js';
import type { SampleBook } from '../Landing.js';
import { MobileTocList, type MobileSheet } from './MobileTocList.js';

export interface MobileChromeProps {
  mobileBarHidden: boolean;
  onHome: () => void;
  currentBookLabel: string;
  progress: ReaderProgress | null;
  canSearch: boolean;
  searchOpen: boolean;
  setSearchOpen: (fn: (v: boolean) => boolean) => void;
  bm: UseBookmarks;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  mobileSheet: MobileSheet;
  setMobileSheet: (sheet: MobileSheet) => void;
  closeMobileSheet: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  series: SampleBook['series'];
  seriesBooks: SampleBook[];
  prevBook: SampleBook | undefined;
  nextBook: SampleBook | undefined;
  bookId: string;
  onBook: (id: string) => void;
  scrubberOpen: boolean;
  setScrubberOpen: (fn: (v: boolean) => boolean) => void;
  pageDisplay: string;
  progressPercent: number;
  reader: ReaderHandle;
  menu: MenuBar;
  animate: boolean;
  onToggleAnimate: () => void;
}

export function MobileChrome(props: MobileChromeProps) {
  const {
    mobileBarHidden,
    onHome,
    currentBookLabel,
    progress,
    canSearch,
    searchOpen,
    setSearchOpen,
    bm,
    theme,
    toggleTheme,
    mobileSheet,
    setMobileSheet,
    closeMobileSheet,
    settingsOpen,
    onToggleSettings,
    series,
    seriesBooks,
    prevBook,
    nextBook,
    bookId,
    onBook,
    scrubberOpen,
    setScrubberOpen,
    pageDisplay,
    progressPercent,
    reader,
    menu,
    animate,
    onToggleAnimate,
  } = props;

  return (
    <>
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

      <div className="mobile-tap-zones" aria-hidden="true">
        <div className="mobile-tap-zone mobile-tap-zone--left" />
        <div className="mobile-tap-zone mobile-tap-zone--center" />
        <div className="mobile-tap-zone mobile-tap-zone--right" />
      </div>

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

      {mobileSheet !== null && (
        <>
          <div className="mobile-sheet-backdrop" onClick={closeMobileSheet} aria-hidden="true" />
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
              <button className="mobile-sheet__close" onClick={closeMobileSheet} aria-label="Close">
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
    </>
  );
}
