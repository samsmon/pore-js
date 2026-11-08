import type { Position } from '../position/types.js';
import { blockElements, resolveAnchor, type RectOf, type RangeRectOf } from './anchor.js';
import { resolveCfiElement, type ParsedCfi } from './cfi.js';
import type { EpubBook, TocEntry } from './epub/types.js';
import { dirOf, resolveHref, stripHash } from './epub/path.js';
import { sanitizeFootnoteHtml } from './sanitize.js';
import { THEME_COLORS } from './text-style.js';
import type { SearchSection } from '../search/search-index.js';
import {
  fixedLayoutScale,
  FLOW_ID,
  parseFixedViewportMeta,
  VIEWPORT_ID,
  type FixedPageSize,
} from './paginate.js';
import type { TextEngineSettings } from './types.js';

export function fixedPageSizeFor(cdoc: Document): FixedPageSize {
  return parseFixedViewportMeta(
    cdoc.querySelector('meta[name="viewport"]')?.getAttribute('content'),
  );
}

export function applyFixedLayoutTransform(
  cdoc: Document | null,
  flow: HTMLElement | null,
  root: HTMLElement,
): void {
  if (!cdoc || !flow) return;
  const size = fixedPageSizeFor(cdoc);
  const cw = root.clientWidth || size.width;
  const ch = root.clientHeight || size.height;
  const { scale, offsetX, offsetY } = fixedLayoutScale(cw, ch, size);
  flow.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

export function wrapContent(cdoc: Document | null): void {
  if (!cdoc?.body || cdoc.getElementById(FLOW_ID)) return;
  const viewport = cdoc.createElement('div');
  viewport.id = VIEWPORT_ID;
  const flow = cdoc.createElement('div');
  flow.id = FLOW_ID;
  while (cdoc.body.firstChild) flow.appendChild(cdoc.body.firstChild);
  viewport.appendChild(flow);
  cdoc.body.appendChild(viewport);
}

export function chapterLabelForBook(book: EpubBook | null, i: number): string {
  if (!book) return `Chapter ${i + 1}`;
  const href = book.spine[i]?.href;
  const flat = (entries: TocEntry[]): TocEntry[] =>
    entries.flatMap((e) => [e, ...flat(e.children)]);
  const hit = flat(book.toc).find((e) => stripHash(e.href) === href);
  return hit?.label ?? `Chapter ${i + 1}`;
}

export function buildSearchSections(book: EpubBook | null, parser: DOMParser): SearchSection[] {
  if (!book) return [];
  return book.spine.map((item, index) => {
    const res = book.resource(item.href);
    const doc = parser.parseFromString(res ? new TextDecoder().decode(res.bytes) : '', 'text/html');
    doc.querySelectorAll('script, style').forEach((el) => el.remove());
    return { id: item.idref ?? String(index), index, text: doc.body?.textContent ?? '' };
  });
}

export function blockForOffset(
  doc: Document,
  offset: number,
): { el: Element | null; fraction: number } {
  const blocks = blockElements(doc);
  let seen = 0;
  let total = 0;
  const lens = blocks.map((el) => {
    const len = (el.textContent ?? '').replace(/\s+/g, ' ').trim().length + 1;
    total += len;
    return len;
  });
  for (let i = 0; i < blocks.length; i++) {
    if (seen + lens[i]! > offset) {
      return { el: blocks[i]!, fraction: total > 0 ? seen / total : 0 };
    }
    seen += lens[i]!;
  }
  return { el: blocks.at(-1) ?? null, fraction: total > 0 ? seen / total : 0 };
}

export function resolveCfiToAnchor(
  cdoc: Document,
  parsed: ParsedCfi,
  spineIndex: number,
): Extract<Position, { type: 'anchor' }> | null {
  const el = resolveCfiElement(cdoc, parsed.steps);
  if (!el) return null;
  const blocks = blockElements(cdoc);
  let b: Element | null = el;
  while (b && !blocks.includes(b)) b = b.parentElement;
  const block = b ? blocks.indexOf(b) : -1;
  if (block < 0 || !b) return null;
  let offset = parsed.offset;
  if (b !== el) {
    const walker = cdoc.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (el.contains(n)) break;
      offset += n.textContent?.length ?? 0;
    }
  }
  return { type: 'anchor', spine: spineIndex, block, offset, percent: 0 };
}

export function resolveAnchorToPage(
  cdoc: Document,
  anchor: Extract<Position, { type: 'anchor' }>,
  opts: {
    fixedLayout: boolean;
    flowEl: HTMLElement | null;
    spinePageCount: number;
    pageStep: number;
    byPercent: boolean;
    relRectOf: RectOf;
    relRangeRectOf: RangeRectOf;
  },
): number {
  if (opts.fixedLayout) return 0;
  if (opts.flowEl) opts.flowEl.style.transform = 'translateX(0)';
  const { page: resolved } = resolveAnchor(
    cdoc,
    anchor,
    {
      spinePages: opts.spinePageCount,
      pageStep: opts.pageStep,
      byPercent: opts.byPercent,
    },
    opts.relRectOf,
    opts.relRangeRectOf,
  );
  return Math.min(Math.max(resolved, 0), opts.spinePageCount - 1);
}

export function renderEndCardDom(opts: {
  doc: Document;
  endEl: HTMLElement;
  book: EpubBook;
  spineIndex: number;
  lastSpine: number;
  settings: TextEngineSettings;
  chapterLabel: (i: number) => string;
  onRestart: () => void;
  onContents: () => void;
  onContinue: () => void;
}): void {
  const { doc, endEl, book, spineIndex, lastSpine, settings, chapterLabel } = opts;
  const bookEnd = spineIndex === lastSpine;
  const theme = THEME_COLORS[settings.theme];
  endEl.style.background = theme.background || '#fff';
  endEl.style.color = theme.color || '#111';
  endEl.replaceChildren();

  const title = doc.createElement('div');
  title.style.cssText = 'font-size:1.4rem;font-weight:700;';
  title.textContent = bookEnd ? 'The End' : `End of ${chapterLabel(spineIndex)}`;
  const sub = doc.createElement('div');
  sub.style.cssText = 'opacity:.7;font-size:.95rem;';
  sub.textContent = bookEnd ? book.metadata.title : 'Next: ' + chapterLabel(spineIndex + 1);
  const row = doc.createElement('div');
  row.style.cssText = 'display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;';

  const btn = (text: string, onClick: () => void) => {
    const b = doc.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'font:inherit;padding:.4rem .9rem;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  };
  if (bookEnd) {
    row.append(btn('Restart', opts.onRestart), btn('Contents', opts.onContents));
  } else {
    row.append(btn('Continue →', opts.onContinue));
  }
  endEl.append(title, sub, row);
}

export function extractFootnoteHtml(opts: {
  href: string;
  currentHref: string;
  cdoc: Document | null;
  book: EpubBook | null;
  parser: DOMParser;
}): string | null {
  const { href, currentHref, cdoc, book, parser } = opts;
  if (!book || !cdoc) return null;
  const [pathPart, frag] = href.split('#');
  let targetDoc = cdoc;
  if (pathPart) {
    const resolved = resolveHref(dirOf(currentHref), pathPart);
    const res = book.resource(resolved);
    if (res) {
      targetDoc = parser.parseFromString(new TextDecoder().decode(res.bytes), 'text/html');
    }
  }
  const el = frag ? targetDoc.getElementById(frag) : null;
  const noteHtml = (el?.innerHTML ?? el?.textContent ?? '').trim();
  if (!noteHtml) return null;
  const safeHtml = sanitizeFootnoteHtml(noteHtml);
  return safeHtml || null;
}
