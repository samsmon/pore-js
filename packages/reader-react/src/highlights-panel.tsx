import type { HighlightRecord, Position } from 'porejs';
import { useReader, useReaderHighlights, useReaderSelection } from './reader.js';

export interface HighlightsPanelProps {
  className?: string;
  /** Shown when there are no highlights yet. */
  emptyLabel?: string;
  /** Colours offered by each row's colour re-pick. */
  colors?: readonly string[];
  /** Called after a row's jump button fires (e.g. to close a popover). */
  onJump?: (highlight: HighlightRecord) => void;
  /** Max characters of the highlighted text shown per row (default 90). */
  previewChars?: number;
}

const DEFAULT_COLORS = ['#ffd54a', '#7bd88f', '#7cc4ff', '#ff9db1'] as const;

function jumpTargetOf(h: HighlightRecord): number | Position {
  if (h.kind === 'rect') return h.page;
  return {
    type: 'anchor',
    spine: h.range.spine,
    block: h.range.startBlock,
    offset: h.range.startOffset,
    percent: 0,
  };
}

/**
 * The book's highlights as an editable list — jump to one, recolour it, attach
 * or edit a note, delete it. Headless like {@link TableOfContents}: it renders
 * a plain `<ol>` with `data-pore-hl-*` hooks and no dialog chrome of its own;
 * the host wraps and styles it. Renders nothing on engines without highlights.
 */
export function HighlightsPanel({
  className,
  emptyLabel = 'Select text in the book to highlight it.',
  colors = DEFAULT_COLORS,
  onJump,
  previewChars = 90,
}: HighlightsPanelProps) {
  const highlights = useReaderHighlights();
  const { goto } = useReader();
  const { updateHighlight, removeHighlight } = useReaderSelection();

  if (highlights.length === 0) {
    return (
      <p {...(className ? { className } : {})} data-pore-hl-empty>
        {emptyLabel}
      </p>
    );
  }

  return (
    <ol {...(className ? { className } : {})} data-pore-hl-list>
      {highlights.map((h) => (
        // keyed by id to preserve focus and avoid DOM remounts while editing
        <li key={h.id} data-pore-hl-item>
          <button
            type="button"
            data-pore-hl-jump
            style={{ borderInlineStartColor: h.color }}
            onClick={() => {
              goto(jumpTargetOf(h));
              onJump?.(h);
            }}
          >
            {h.text.length > previewChars ? `${h.text.slice(0, previewChars)}…` : h.text}
          </button>

          <div data-pore-hl-colors role="group" aria-label="Highlight colour">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                data-pore-hl-swatch
                aria-label={`Recolour to ${c}`}
                aria-pressed={h.color === c}
                style={{ background: c }}
                onClick={() => updateHighlight(h.id, { color: c })}
              />
            ))}
          </div>

          <textarea
            key={h.note ?? ''}
            data-pore-hl-note
            aria-label="Note"
            placeholder="Add a note…"
            defaultValue={h.note ?? ''}
            rows={2}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== (h.note ?? '')) updateHighlight(h.id, { note: next });
            }}
          />

          <button
            type="button"
            data-pore-hl-remove
            aria-label="Remove highlight"
            onClick={() => removeHighlight(h.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ol>
  );
}
