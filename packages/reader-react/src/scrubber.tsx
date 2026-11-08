import { useState, type ReactNode } from 'react';
import * as RSlider from '@radix-ui/react-slider';
import { useReader, useReaderChapters, useReaderLocation, useReaderProgress } from './reader.js';

export interface ScrubberLabelInfo {
  /** 0-based page being pointed at (the drag position while dragging). */
  page: number;
  total: number;
  percent: number;
  /** Chapter that page falls in, if the book has chapters. */
  chapterIndex: number;
  chapterCount: number;
  chapterLabel: string;
  /** Estimated minutes left from the *current* position (not the drag target). */
  minutesLeft: number;
  dragging: boolean;
}

export interface ReaderScrubberProps {
  className?: string;
  /** Chapter tick marks on the track. Default `true`. */
  ticks?: boolean;
  /** Custom label. Return `false` (or pass `label={false}`) to hide it. */
  label?: ((info: ScrubberLabelInfo) => ReactNode) | false;
  /** Direction for the slider track (e.g. 'rtl' for manga). Default 'ltr'. */
  dir?: 'ltr' | 'rtl';
}

function defaultLabel(i: ScrubberLabelInfo): ReactNode {
  const parts: string[] = [];
  if (i.chapterCount > 1) parts.push(`Ch ${i.chapterIndex + 1}/${i.chapterCount}`);
  parts.push(`${Math.round(i.percent * 100)}%`);
  if (!i.dragging && i.minutesLeft > 0) parts.push(`${i.minutesLeft} min left`);
  return parts.join(' · ');
}

/**
 * A draggable progress bar bound to the reader position (Radix `Slider`, so
 * keyboard-seekable and labelled). Chapter tick marks, a live "Ch 3/12 · 47%"
 * label. Renders nothing until the book has more than one page.
 */
export function ReaderScrubber({
  className,
  ticks = true,
  label,
  dir = 'ltr',
}: ReaderScrubberProps) {
  const loc = useReaderLocation();
  const progress = useReaderProgress();
  const chapters = useReaderChapters();
  const { goto } = useReader();
  const [drag, setDrag] = useState<number | null>(null);

  if (!loc || loc.total <= 1) return null;
  const max = loc.total - 1;
  const page = Math.min(Math.max(drag ?? loc.page, 0), max);
  const dragging = drag !== null;

  let chapterIndex = 0;
  for (let i = 0; i < chapters.length; i++) if (chapters[i]!.startPage <= page) chapterIndex = i;

  const info: ScrubberLabelInfo = {
    page,
    total: loc.total,
    percent: max > 0 ? page / max : 0,
    chapterIndex,
    chapterCount: progress?.chapterCount ?? chapters.length,
    chapterLabel: chapters[chapterIndex]?.label ?? progress?.chapterLabel ?? '',
    minutesLeft: progress?.minutesLeft ?? 0,
    dragging,
  };

  return (
    <div className={className ?? 'pore-scrubber'} data-pore-scrubber>
      <RSlider.Root
        className="pore-scrubber__slider"
        data-pore-scrubber-slider
        dir={dir}
        min={0}
        max={max}
        step={1}
        value={[page]}
        onValueChange={([v]) => setDrag(v ?? 0)}
        onValueCommit={([v]) => {
          if (v != null) goto(v);
          setDrag(null);
        }}
        aria-label="Seek through the book"
      >
        <RSlider.Track className="pore-scrubber__track" data-pore-scrubber-track>
          <RSlider.Range className="pore-scrubber__range" />
        </RSlider.Track>
        {ticks &&
          chapters.map((c) =>
            c.startPage > 0 && c.startPage < max ? (
              <span
                key={c.id}
                className="pore-scrubber__tick"
                data-pore-scrubber-tick
                style={{ insetInlineStart: `${(c.startPage / max) * 100}%` }}
                title={c.label}
                aria-hidden
              />
            ) : null,
          )}
        <RSlider.Thumb className="pore-scrubber__thumb" aria-label="Seek" />
      </RSlider.Root>
      {label !== false && (
        <div className="pore-scrubber__label" data-pore-scrubber-label aria-live="off">
          {label ? label(info) : defaultLabel(info)}
        </div>
      )}
    </div>
  );
}
