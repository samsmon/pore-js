import type { Bookmark, HighlightRecord, Position } from 'porejs';

/** One book's portable annotation set. `position` is the resume checkpoint. */
export interface PortableBook {
  id: string;
  title: string;
  position?: Position | null;
  highlights: HighlightRecord[];
  bookmarks: Bookmark[];
}

export const PORTABILITY_FORMAT = 'pore.js/annotations';
export const PORTABILITY_VERSION = 1;

export interface PortabilityBundle {
  format: typeof PORTABILITY_FORMAT;
  version: typeof PORTABILITY_VERSION;
  exportedAt: number;
  books: PortableBook[];
}

export function buildBundle(books: PortableBook[]): PortabilityBundle {
  return {
    format: PORTABILITY_FORMAT,
    version: PORTABILITY_VERSION,
    exportedAt: Date.now(),
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      position: b.position ?? null,
      highlights: b.highlights,
      bookmarks: b.bookmarks,
    })),
  };
}

export type ValidationResult =
  { ok: true; bundle: PortabilityBundle } | { ok: false; error: string };

export const CFI_RE = /^epubcfi\(.+\)$/;
export const SAFE_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;

/** Validate CFI string syntax (must match epubcfi(...)). */
export function isValidCfi(cfi: unknown): boolean {
  return typeof cfi === 'string' && CFI_RE.test(cfi.trim());
}

/** Validate CSS highlight color token to prevent CSS injection. */
export function isValidHighlightColor(color: unknown): color is string {
  return typeof color === 'string' && SAFE_COLOR_RE.test(color.trim());
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/** Element-level runtime validator for imported highlights. */
export function isValidHighlight(raw: unknown): raw is HighlightRecord {
  if (typeof raw !== 'object' || raw === null) return false;
  const h = raw as Record<string, unknown>;
  if (typeof h.id !== 'string' || !h.id.trim()) return false;
  if (!isValidHighlightColor(h.color)) return false;
  if (typeof h.text !== 'string') return false;
  if (typeof h.createdAt !== 'number' || !Number.isFinite(h.createdAt)) return false;
  if (h.note !== undefined && typeof h.note !== 'string') return false;

  if (h.kind === 'text') {
    if (typeof h.range !== 'object' || h.range === null) return false;
    const rng = h.range as Record<string, unknown>;
    if (
      !isNonNegInt(rng.spine) ||
      !isNonNegInt(rng.startBlock) ||
      !isNonNegInt(rng.startOffset) ||
      !isNonNegInt(rng.endBlock) ||
      !isNonNegInt(rng.endOffset)
    ) {
      return false;
    }
    if (typeof h.cfi !== 'object' || h.cfi === null) return false;
    const cfi = h.cfi as Record<string, unknown>;
    if (!isValidCfi(cfi.start) || !isValidCfi(cfi.end)) return false;
    return true;
  }
  if (h.kind === 'rect') {
    if (typeof h.page !== 'number' || !Number.isFinite(h.page) || h.page < 0) return false;
    if (!Array.isArray(h.rects)) return false;
    for (const r of h.rects) {
      if (typeof r !== 'object' || r === null) return false;
      const rect = r as Record<string, unknown>;
      if (
        typeof rect.x !== 'number' ||
        !Number.isFinite(rect.x) ||
        typeof rect.y !== 'number' ||
        !Number.isFinite(rect.y) ||
        typeof rect.width !== 'number' ||
        !Number.isFinite(rect.width) ||
        typeof rect.height !== 'number' ||
        !Number.isFinite(rect.height)
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/** Element-level runtime validator for imported bookmarks. */
export function isValidBookmark(raw: unknown): raw is Bookmark {
  if (typeof raw !== 'object' || raw === null) return false;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== 'string' || !b.id.trim()) return false;
  if (typeof b.page !== 'number' || !Number.isFinite(b.page) || b.page < 0) return false;
  if (
    typeof b.percent !== 'number' ||
    !Number.isFinite(b.percent) ||
    b.percent < 0 ||
    b.percent > 1
  ) {
    return false;
  }
  if (typeof b.label !== 'string') return false;
  if (typeof b.createdAt !== 'number' || !Number.isFinite(b.createdAt)) return false;
  if (typeof b.position !== 'object' || b.position === null) return false;
  if (b.text !== undefined && typeof b.text !== 'string') return false;
  if (b.cfi !== undefined && !isValidCfi(b.cfi)) return false;
  return true;
}

/** Structural validation — enough to trust a merge, not a full schema. */
export function validateBundle(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Not a JSON object.' };
  const b = raw as Record<string, unknown>;
  if (b.format !== PORTABILITY_FORMAT)
    return { ok: false, error: `Unrecognised format: ${String(b.format)}` };
  if (b.version !== PORTABILITY_VERSION)
    return {
      ok: false,
      error: `Unsupported version: ${String(b.version)} (expected ${PORTABILITY_VERSION})`,
    };
  if (!Array.isArray(b.books)) return { ok: false, error: 'Missing "books" array.' };
  for (const [i, book] of (b.books as unknown[]).entries()) {
    if (typeof book !== 'object' || book === null)
      return { ok: false, error: `books[${i}] is not an object.` };
    const bk = book as Record<string, unknown>;
    if (typeof bk.id !== 'string' || !bk.id)
      return { ok: false, error: `books[${i}].id is missing.` };
    if (!Array.isArray(bk.highlights) || !Array.isArray(bk.bookmarks))
      return { ok: false, error: `books[${i}] is missing highlights/bookmarks arrays.` };
    for (const [j, hl] of (bk.highlights as unknown[]).entries()) {
      if (!isValidHighlight(hl)) {
        return { ok: false, error: `books[${i}].highlights[${j}] is invalid.` };
      }
    }
    for (const [j, bm] of (bk.bookmarks as unknown[]).entries()) {
      if (!isValidBookmark(bm)) {
        return { ok: false, error: `books[${i}].bookmarks[${j}] is invalid.` };
      }
    }
  }
  return { ok: true, bundle: raw as PortabilityBundle };
}

export interface MergeReport {
  books: number;
  highlights: number;
  bookmarks: number;
  skipped: number;
}

function mergeById<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  overwrite: boolean,
): { merged: T[]; added: number; skipped: number } {
  const byId = new Map(existing.map((x) => [x.id, x]));
  let added = 0;
  let skipped = 0;
  for (const item of incoming) {
    if (byId.has(item.id)) {
      if (overwrite) byId.set(item.id, item);
      else skipped++;
    } else {
      byId.set(item.id, item);
      added++;
    }
  }
  return { merged: [...byId.values()], added, skipped };
}

/**
 * Merge an imported bundle into the local per-book sets. Existing entries with
 * the same id are kept unless `overwrite`. Returns the new per-book sets plus a
 * report of what changed.
 */
export function mergeBundle(
  existing: PortableBook[],
  incoming: PortabilityBundle,
  opts: { overwrite?: boolean } = {},
): { merged: PortableBook[]; report: MergeReport } {
  const overwrite = opts.overwrite ?? false;
  const byId = new Map(existing.map((b) => [b.id, b]));
  const report: MergeReport = { books: 0, highlights: 0, bookmarks: 0, skipped: 0 };

  for (const book of incoming.books) {
    const prev = byId.get(book.id);
    if (!prev) report.books++;
    const hs = mergeById(prev?.highlights ?? [], book.highlights, overwrite);
    const bs = mergeById(prev?.bookmarks ?? [], book.bookmarks, overwrite);
    report.highlights += hs.added;
    report.bookmarks += bs.added;
    report.skipped += hs.skipped + bs.skipped;
    byId.set(book.id, {
      id: book.id,
      title: book.title || prev?.title || book.id,
      position: overwrite
        ? (book.position ?? prev?.position ?? null)
        : (prev?.position ?? book.position ?? null),
      highlights: hs.merged,
      bookmarks: bs.merged,
    });
  }

  return { merged: [...byId.values()], report };
}

/** Trigger a client-side download of a JSON bundle — Blob + object URL, no backend. */
export function downloadBundle(bundle: PortabilityBundle, filename: string): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
