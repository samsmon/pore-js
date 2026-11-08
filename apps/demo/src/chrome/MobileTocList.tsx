import { useTableOfContents } from 'porejs-react';
import type { TocEntry } from 'porejs';
import { useMemo } from 'react';

export const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];
export const DEFAULT_HIGHLIGHT = HIGHLIGHT_COLORS[0]!;

export type MobileSheet = 'toc' | 'settings' | 'episodes' | null;

export function MobileTocList({ onSelect }: { onSelect: (href: string) => void }) {
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
    return <div className="mobile-toc__empty">No table of contents available for this book.</div>;
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
