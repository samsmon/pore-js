import {
  BookmarksPanel,
  FootnotePopover,
  HighlightsPanel,
  ReaderScrubber,
  type EndPage,
  type ReaderHandle,
  type ReaderProgress,
  type ReaderSearch,
  type TtsVoiceLike,
  type UseBookmarks,
  type UseReaderError,
  type UseTts,
} from 'porejs-react';
import type { HighlightRecord, TextSelection } from 'porejs';
import type { ReactNode } from 'react';
import { citation, copyText, deepLink } from '../share.js';
import type { SampleBook } from '../Landing.js';
import { DEFAULT_HIGHLIGHT, HIGHLIGHT_COLORS } from './MobileTocList.js';

export interface ChromeOverlaysProps {
  loading: boolean;
  progressStyle: 'normal' | 'lightbar' | 'hidden';
  progressPos: 'bottom' | 'left' | 'right';
  progressThickness: number;
  progressPercent: number;
  barHidden: boolean;
  isMobile: boolean;
  mobileBarHidden: boolean;
  isRtl: boolean;
  scrubberOpen: boolean;
  pinChrome: () => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  canSearch: boolean;
  search: ReaderSearch;
  endPage: EndPage | null;
  progress: ReaderProgress | null;
  nextBook: SampleBook | undefined;
  prevBook: SampleBook | undefined;
  onBook: (id: string) => void;
  reader: ReaderHandle;
  barControls: ReactNode;
  canAnnotate: boolean;
  selection: TextSelection | null;
  isPdf: boolean;
  isText: boolean;
  highlight: (opts?: { color?: string; note?: string }) => HighlightRecord | null;
  setHighlightsOpen: (v: boolean) => void;
  bookId: string;
  setPosNotice: (msg: string | null) => void;
  highlightsOpen: boolean;
  onRight: boolean;
  bm: UseBookmarks;
  bookmarksOpen: boolean;
  setBookmarksOpen: (v: boolean) => void;
  ttsOpen: boolean;
  tts: UseTts;
  ttsPlaying: boolean;
  ttsCanResume: boolean;
  voices: TtsVoiceLike[];
  posNotice: string | null;
  showSkeleton: boolean;
  readerError: UseReaderError;
  resumed: number | null;
  dismissed: boolean;
  setDismissed: (v: boolean) => void;
}

export function ChromeOverlays(props: ChromeOverlaysProps) {
  const {
    loading,
    progressStyle,
    progressPos,
    progressThickness,
    progressPercent,
    barHidden,
    isMobile,
    mobileBarHidden,
    isRtl,
    scrubberOpen,
    pinChrome,
    searchOpen,
    setSearchOpen,
    canSearch,
    search,
    endPage,
    progress,
    nextBook,
    prevBook,
    onBook,
    reader,
    barControls,
    canAnnotate,
    selection,
    isPdf,
    isText,
    highlight,
    setHighlightsOpen,
    bookId,
    setPosNotice,
    highlightsOpen,
    onRight,
    bm,
    bookmarksOpen,
    setBookmarksOpen,
    ttsOpen,
    tts,
    ttsPlaying,
    ttsCanResume,
    voices,
    posNotice,
    showSkeleton,
    readerError,
    resumed,
    dismissed,
    setDismissed,
  } = props;

  return (
    <>
      {loading && <div className="progress progress--loading" aria-hidden />}

      {progressStyle !== 'hidden' &&
        (progressStyle === 'lightbar' || barHidden || (isMobile && mobileBarHidden)) && (
          <div
            className={`pore-lightbar pore-lightbar--${progressPos}${
              isMobile && mobileBarHidden ? ' pore-lightbar--mobile-edge' : ''
            }`}
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
                ? `${progress.chapterCount} chapter${
                    progress.chapterCount === 1 ? '' : 's'
                  } · finished`
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
          <BookmarksPanel
            className="highlights-panel__body"
            onJump={() => setBookmarksOpen(false)}
          />
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

      {readerError.error && readerError.error.index === undefined && (
        <div className="error-tile" role="alert">
          <p>Couldn&apos;t load this book.</p>
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
