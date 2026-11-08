import {
  createReaderSource,
  readerSourceKey,
  type CreateReaderSourceInput,
  type Position,
  type ReaderMeta,
} from 'porejs';
import { useMemo, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { ReaderProvider } from './provider.js';
import { Reader, type ReaderHandle, type ReaderLocation, type ReaderProps } from './reader.js';

export interface BookProps extends Pick<
  ReaderProps,
  | 'className'
  | 'children'
  | 'transitions'
  | 'persistSettings'
  | 'fontFaceCss'
  | 'ref'
  | 'initialSettings'
> {
  /** A URL to a `.cbz` / `.zip` / `.epub` / `.pdf`. */
  src?: string;
  /** A list of image URLs — one manga chapter, comic pages, a scan. */
  pages?: string[];
  /** A `File` / `Blob` you already have. */
  file?: File | Blob;
  /** Name for `file`/`src` type-detection, and the re-mount key. */
  name?: string;
  meta?: ReaderMeta;
  /**
   * A series id — when you render `<Book>` per chapter, this keeps the reader's
   * fit / direction / zoom choices across chapters (settings key + progress
   * namespace). Optional.
   */
  seriesId?: string;
  /** Add auth / `Referer` headers for a CDN. */
  fetch?: CreateReaderSourceInput['fetch'];
  /** Seed the position (a value from `onProgress`). */
  progress?: Position | null;
  /** Fires when the reader saves a new position — persist it yourself. */
  onProgress?: (position: Position, percent: number) => void;
  /** Fires at an end-of-chapter / end-of-book card — load the next chapter. */
  onEnd?: (info: { kind: 'book' | 'chapter'; hasNext: boolean }) => void;
  onPositionChange?: (loc: ReaderLocation) => void;
  style?: CSSProperties;
}

/**
 * The one-call reader. Point it at a file URL, a list of image URLs, or a
 * `File`; add metadata if you have it; you get a full reader. No
 * `<ReaderProvider>`, no `ReaderSource` to implement.
 *
 * ```tsx
 * <Book
 *   src="https://cdn/one-piece/ch-1074.cbz"
 *   meta={{ title: 'One Piece', volume: 108, chapter: 1074, direction: 'rtl' }}
 *   progress={saved}
 *   onProgress={(pos) => saveToDb(pos)}
 *   onEnd={() => loadNextChapter()}
 * />
 * ```
 *
 * For a real backend (auth, streaming, offline) drop to `<ReaderProvider>` +
 * your own `ReaderSource`.
 */
export function Book({
  src,
  pages,
  file,
  name,
  meta,
  seriesId,
  fetch,
  progress,
  onProgress,
  onEnd,
  onPositionChange,
  initialSettings,
  style,
  className,
  children,
  transitions,
  persistSettings,
  fontFaceCss,
  ref,
}: BookProps) {
  const percentRef = useRef(0);

  const input: CreateReaderSourceInput = {
    ...(src !== undefined ? { src } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(file !== undefined ? { file } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(meta !== undefined ? { meta } : {}),
    ...(fetch !== undefined ? { fetch } : {}),
    ...(progress !== undefined ? { initialProgress: progress } : {}),
  };
  const key = readerSourceKey(input);

  // re-create the source only when the *target* changes (`key`), not on every
  // render — `input` / `onProgress` are captured deliberately.
  const source = useMemo(
    () =>
      createReaderSource({ ...input, onProgress: (pos) => onProgress?.(pos, percentRef.current) }),
    [key],
  );

  const settings = {
    ...(meta?.direction ? { direction: meta.direction } : {}),
    ...initialSettings,
  } as ReaderProps['initialSettings'];

  return (
    <ReaderProvider source={source}>
      <Reader
        key={key}
        bookId={key}
        {...(className !== undefined ? { className } : {})}
        {...(style !== undefined ? { style } : {})}
        {...(settings && Object.keys(settings).length ? { initialSettings: settings } : {})}
        {...(transitions ? { transitions } : {})}
        {...(persistSettings !== undefined ? { persistSettings } : {})}
        {...(fontFaceCss ? { fontFaceCss } : {})}
        {...(ref ? { ref: ref as Ref<ReaderHandle> } : {})}
        {...(onEnd ? { onEnd } : {})}
        {...(seriesId ? { settingsKey: seriesId } : {})}
        onPositionChange={(loc) => {
          percentRef.current = loc.percent;
          onPositionChange?.(loc);
        }}
      >
        {children as ReactNode}
      </Reader>
    </ReaderProvider>
  );
}
