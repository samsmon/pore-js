# Pore.js annotation portability format

A small, versioned JSON document for moving your **reading position, highlights
and bookmarks** between browsers / devices. No backend — you export a file and
import it on the other side. Text highlights and bookmarks carry an `epubcfi`
anchor, so they still resolve after the book is re-paginated on a different
screen.

Reference implementation: [`apps/demo/src/portability.ts`](../apps/demo/src/portability.ts)
(`buildBundle` / `validateBundle` / `mergeBundle` / `downloadBundle`), covered by
[`portability.test.ts`](../apps/demo/src/portability.test.ts).

## Shape

```jsonc
{
  "format": "pore.js/annotations",
  "version": 1,
  "exportedAt": 1725600000000, // Date.now() at export
  "books": [
    {
      "id": "demo-book", // the source's book id — the merge key
      "title": "Novel (EPUB)",
      "position": {/* Position | null */}, // resume checkpoint, may be null
      "highlights": [/* HighlightRecord[] */],
      "bookmarks": [/* Bookmark[] */],
    },
  ],
}
```

`HighlightRecord` and `Bookmark` are re-exported from `porejs` (see
[`architecture.md`](architecture.md)). In brief:

- **Text highlight** (`kind: "text"`): `{ id, kind, color, text, note?,
createdAt, range, cfi: { start, end } }`. `cfi` is the portable anchor; `range`
  is a fast local re-resolve hint.
- **Rect highlight** (`kind: "rect"`, PDF / fixed pages): `{ id, kind, color,
text, note?, createdAt, page, rects: NormRect[] }`. Anchored to normalised
  page boxes — portable as long as the same PDF is used.
- **Bookmark**: `{ id, position, cfi?, page, percent, label, text?, createdAt }`.

## Validation

`validateBundle(raw)` checks: it's an object; `format === "pore.js/annotations"`;
`version === 1`; `books` is an array; every book has a non-empty string `id` and
`highlights` + `bookmarks` arrays. It does **not** deep-validate every record —
a malformed individual highlight is the exporter's bug, not the importer's
problem.

Unknown future versions are rejected with a clear message rather than
best-effort parsed.

## Merge semantics

`mergeBundle(existing, bundle, { overwrite? })` merges **by `id`** at two levels:

1. **Book** — matched on `book.id`. A new book is added; an existing one has its
   collections merged.
2. **Record** — highlights and bookmarks are matched on their own `id`. A record
   whose id is already present is **skipped** (kept as-is) unless `overwrite:
true`, in which case the incoming copy replaces it.

`position` is only taken from the import when the local book has none (or always,
under `overwrite`). The report returned counts `{ books, highlights, bookmarks,
skipped }` actually added.

Ids are stable (`crypto.randomUUID()` at creation), so re-importing the same
bundle is a no-op — every record is "already present".

## What's out of scope

- **Other tools' formats** (KOReader, Calibre, Readwise) — a separate import
  task, not this document.
- **The book files themselves** — this moves annotations, not content. The
  recipient needs the same book (matched by the source's `id`).
- **Real-time sync** — that needs a backend; `WhiteArchiveSource` (Project A) is
  its eventual home.
