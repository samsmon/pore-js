import { useEffect, useRef, useState } from 'react';
import { useReaderProgress } from './reader.js';

const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * A visually-hidden `aria-live` region that announces chapter and progress
 * changes to screen readers. Drop it once inside `<Reader>`. Announcements are
 * debounced and only fire when the chapter or the rounded percent changes.
 */
export function ReaderAnnouncer({ debounceMs = 700 }: { debounceMs?: number }) {
  const progress = useReaderProgress();
  const [message, setMessage] = useState('');
  const last = useRef('');

  useEffect(() => {
    if (!progress) return;
    const pct = Math.round(progress.percent * 100);
    const key = `${progress.chapterIndex}:${progress.page}:${pct}`;
    if (key === last.current) return;
    last.current = key;
    const t = setTimeout(() => {
      const chapter =
        progress.chapterCount > 1
          ? `${progress.chapterLabel}, chapter ${progress.chapterIndex + 1} of ${progress.chapterCount}. `
          : progress.chapterLabel
            ? `${progress.chapterLabel}. `
            : '';
      const totalPages = progress.pageCount ?? progress.locator?.total;
      const pageInfo =
        progress.page !== undefined && totalPages
          ? `Page ${progress.page + 1} of ${totalPages}. `
          : progress.page !== undefined
            ? `Page ${progress.page + 1}. `
            : '';
      const time = progress.minutesLeft > 0 ? ` About ${progress.minutesLeft} minutes left.` : '';
      setMessage(`${chapter}${pageInfo}${pct}% through the book.${time}`);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [progress, debounceMs]);

  return (
    <div aria-live="polite" aria-atomic="true" role="status" style={SR_ONLY}>
      {message}
    </div>
  );
}
