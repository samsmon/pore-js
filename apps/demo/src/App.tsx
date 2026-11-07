import {
  CachedSource,
  DemoSource,
  LocalFileSource,
  type Position,
  type ReaderSource,
} from 'porejs';
import {
  Reader,
  ReaderAnnouncer,
  ReaderProvider,
  gsapAdapter,
  useReader,
  useReaderLocation,
} from 'porejs-react';
import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { Chrome } from './Chrome.js';
import { OpdsBrowser } from './OpdsBrowser.js';
import { AnnotationsReview, type JumpTarget } from './AnnotationsReview.js';
import { Landing, type SampleBook } from './Landing.js';
import { useMenuBar } from './use-menu-bar.js';
import { useFullscreen } from './use-fullscreen.js';
import { readerFontFaceCss } from './reader-fonts.js';
import { useLibrary } from './use-library.js';
import type { ModeGlyph } from './Landing.js';

export function useAnimations() {
  const [animate, setAnimate] = useState(() => {
    return localStorage.getItem('pore-animate') !== 'false';
  });
  const toggleAnimate = () => {
    setAnimate((prev) => {
      const next = !prev;
      localStorage.setItem('pore-animate', String(next));
      return next;
    });
  };
  return [animate, toggleAnimate] as const;
}

const defaultTransitions = gsapAdapter(gsap);

/** Applies a one-shot jump (from the annotations review) once the engine is ready. */
function PendingNav({
  navRef,
  onArrived,
}: {
  navRef: MutableRefObject<{ cfi?: string; position?: Position; pulse?: boolean } | null>;
  onArrived: (pulse: boolean) => void;
}) {
  const handle = useReader();
  const location = useReaderLocation();
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !location) return;
    navRef.current = null;
    if (nav.cfi) handle.goToCfi(nav.cfi);
    else if (nav.position) handle.goto(nav.position);
    onArrived(!!nav.pulse);
  }, [location, handle, navRef, onArrived]);
  return null;
}

const BOOKS: SampleBook[] = [
  {
    id: 'demo-manga',
    label: 'Manga (Vol 1)',
    blurb: 'Right-to-left, double-page spreads',
    glyph: 'spread',
    settings: { layout: 'paged-double', direction: 'rtl' },
    series: {
      id: 'series-manga',
      title: 'Demo Manga',
      episodeIndex: 1,
      totalEpisodes: 3,
      nextBookId: 'demo-manga-vol2',
    },
  },
  {
    id: 'demo-manga-vol2',
    label: 'Manga (Vol 2)',
    blurb: 'Volume 2 — The Journey continues',
    glyph: 'spread',
    settings: { layout: 'paged-double', direction: 'rtl' },
    series: {
      id: 'series-manga',
      title: 'Demo Manga',
      episodeIndex: 2,
      totalEpisodes: 3,
      prevBookId: 'demo-manga',
      nextBookId: 'demo-manga-vol3',
    },
  },
  {
    id: 'demo-manga-vol3',
    label: 'Manga (Vol 3)',
    blurb: 'Volume 3 — The Climax and Epilogue',
    glyph: 'spread',
    settings: { layout: 'paged-double', direction: 'rtl' },
    series: {
      id: 'series-manga',
      title: 'Demo Manga',
      episodeIndex: 3,
      totalEpisodes: 3,
      prevBookId: 'demo-manga-vol2',
    },
  },
  {
    id: 'demo-webtoon',
    label: 'Webtoon',
    blurb: 'One long, continuous vertical strip',
    glyph: 'strip',
    settings: { layout: 'continuous-vertical' },
  },
  {
    id: 'demo-book',
    label: 'Novel (EPUB)',
    blurb: 'Reflowable text, adjustable typography',
    glyph: 'text',
  },
  { id: 'demo-vertical', label: '縦書き', blurb: 'Vertical Japanese (tategaki)', glyph: 'vertical' },
  { id: 'demo-rtl', label: 'عربي', blurb: 'Right-to-left prose (Arabic)', glyph: 'rtl' },
  {
    id: 'demo-fixed',
    label: 'Fixed-layout',
    blurb: 'Pre-paginated EPUB, scaled to fit',
    glyph: 'page',
  },
  {
    id: 'demo-pdf',
    label: 'PDF',
    blurb: 'Rendered pages + a searchable text layer',
    glyph: 'pdf',
    settings: { direction: 'ltr' },
  },
];

type View =
  | { kind: 'landing' }
  | { kind: 'sample'; bookId: string }
  | { kind: 'file'; source: ReaderSource; bookId: string; name: string };

function initialView(): View {
  const fromUrl = new URLSearchParams(location.search).get('book');
  return fromUrl && BOOKS.some((b) => b.id === fromUrl)
    ? { kind: 'sample', bookId: fromUrl }
    : { kind: 'landing' };
}

export function App() {
  const demoSource = useMemo(() => new CachedSource(new DemoSource()), []);
  const [view, setView] = useState<View>(initialView);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [opdsOpen, setOpdsOpen] = useState(false);
  const menu = useMenuBar();
  const [isFullscreen] = useFullscreen();
  const [animate, toggleAnimate] = useAnimations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const library = useLibrary();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const pendingNavRef = useRef<{ cfi?: string; position?: Position; pulse?: boolean } | null>(
    (() => {
      const cfi = new URLSearchParams(location.search).get('cfi');
      return cfi ? { cfi, pulse: true } : null;
    })(),
  );
  // A docked bar takes real space — inset the reader so it isn't covered.
  const isDocked = menu.behaviour === 'always' && !isFullscreen;
  // one rail: menu + inline settings accordion. Width is constant whether or
  // not settings is open; only the explicit collapse toggle changes it.
  const railWidth = menu.collapsed ? '3.25rem' : '16rem';
  const hostClass =
    (isDocked ? `reader-host reader-host--${menu.placement}` : 'reader-host') +
    (pulse ? ' reader-host--pulse' : '');
  const shellClass = `shell${isDocked ? ` shell--docked-${menu.placement}` : ''}`;
  const shellStyle = { '--rail-w': railWidth } as CSSProperties;

  useEffect(() => {
    const url = new URL(location.href);
    if (view.kind === 'sample') url.searchParams.set('book', view.bookId);
    else url.searchParams.delete('book');
    url.searchParams.delete('cfi'); // consumed once on load
    history.replaceState(null, '', url);
  }, [view]);

  const openFiles = (files: FileList | File[]) => {
    if (!('length' in files) || files.length === 0) return;
    setNotice(null);
    const local = new LocalFileSource(files);
    const first = files[0];
    const name = (first && 'name' in first ? first.name : '') || local.bookId;
    const ext = name.toLowerCase().split('.').pop() ?? '';
    const glyph: ModeGlyph =
      ext === 'pdf' ? 'pdf' : ext === 'epub' ? 'text' : ext === 'cbz' || ext === 'zip' ? 'spread' : 'strip';
    setView({ kind: 'file', source: new CachedSource(local), bookId: local.bookId, name });
    library.record({ id: local.bookId, title: name.replace(/\.[^.]+$/, ''), glyph, kind: 'file' });
    void local.getManifest(local.bookId).then(() => {
      if (local.fixedLayout) setNotice('Fixed-layout EPUB — pre-paginated view (beta)');
    });
  };

  const openSample = (id: string) => {
    setNotice(null);
    setView({ kind: 'sample', bookId: id });
    const b = BOOKS.find((x) => x.id === id);
    if (b) library.record({ id, title: b.label, glyph: b.glyph, kind: 'sample' });
  };

  const forget = (id: string) => {
    library.remove(id);
    // free the offline copy (re-downloadable); annotations are kept on purpose —
    // they reappear if the book is opened again.
    void demoSource.removeDownload(id).catch(() => {});
  };

  const onArrived = (doPulse: boolean) => {
    if (!doPulse) return;
    setPulse(true);
    setTimeout(() => setPulse(false), 2000);
  };

  const onJump = (t: JumpTarget) => {
    pendingNavRef.current = t.cfi
      ? { cfi: t.cfi, pulse: true }
      : t.position
        ? { position: t.position, pulse: true }
        : null;
    setReviewOpen(false);
    openSample(t.bookId);
  };

  const goHome = () => {
    setNotice(null);
    setOpdsOpen(false);
    document.title = 'Pore.js — demo';
    setView({ kind: 'landing' });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files);
  };

  const sample = view.kind === 'sample' ? BOOKS.find((b) => b.id === view.bookId) : undefined;
  const source = view.kind === 'file' ? view.source : demoSource;
  const activeBook = view.kind === 'file' ? view.bookId : view.kind === 'sample' ? view.bookId : '';

  return (
    <main
      className={shellClass}
      style={shellStyle}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {view.kind === 'landing' ? (
        <>
          <Landing
            books={BOOKS}
            onFiles={openFiles}
            onSample={openSample}
            recent={library.entries}
            onResume={(e) => (e.kind === 'sample' ? openSample(e.id) : undefined)}
            onForget={forget}
            {...(library.entries.some((e) => e.kind === 'sample')
              ? { onReview: () => setReviewOpen(true) }
              : {})}
          />
          <AnnotationsReview
            open={reviewOpen}
            onClose={() => setReviewOpen(false)}
            entries={library.entries}
            source={demoSource}
            onJump={onJump}
          />
        </>
      ) : (
        <ReaderProvider source={source}>
          <Reader
            key={activeBook}
            bookId={activeBook}
            fontFaceCss={readerFontFaceCss}
            onPositionChange={(loc) => {
              if (activeBook) library.setProgress(activeBook, loc.percent);
            }}
            {...(animate ? { transitions: defaultTransitions } : {})}
            className={hostClass}
            {...(sample?.settings ? { initialSettings: sample.settings } : {})}
          >
            <ReaderAnnouncer />
            <PendingNav navRef={pendingNavRef} onArrived={onArrived} />
            <Chrome
              books={BOOKS}
              bookId={view.kind === 'sample' ? view.bookId : ''}
              onBook={openSample}
              onHome={goHome}
              droppedName={view.kind === 'file' ? view.name : null}
              opdsOpen={opdsOpen}
              onToggleOpds={() => setOpdsOpen((v) => !v)}
              menu={menu}
              isFullscreen={isFullscreen}
              animate={animate}
              onToggleAnimate={toggleAnimate}
              settingsOpen={settingsOpen}
              onToggleSettings={() => setSettingsOpen((v) => !v)}
            />
          </Reader>
          <OpdsBrowser
            open={opdsOpen}
            onClose={() => setOpdsOpen(false)}
            onOpen={(opdsSource, id) => {
              setNotice(null);
              setView({ kind: 'file', source: new CachedSource(opdsSource), bookId: id, name: id });
              setOpdsOpen(false);
            }}
          />
        </ReaderProvider>
      )}

      {dragging && (
        <div className="dropzone">
          <div className="dropzone__card">
            <div className="dropzone__icon" aria-hidden>
              ⇩
            </div>
            <div className="dropzone__title">Drop to open</div>
            <div className="dropzone__hint">.cbz, .epub, .pdf, or loose images</div>
          </div>
        </div>
      )}
      {notice && (
        <div className="notice" role="status" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </main>
  );
}
