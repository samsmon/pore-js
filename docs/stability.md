# API stability

From **`v1.0.0`**, `porejs` and `porejs-react` follow [SemVer](https://semver.org/).
The two are released **together on one version number**.

## What a `1.x` release will not break

- **Runtime exports** of `porejs` and `porejs-react` — the names, call
  signatures, and documented behaviour of everything re-exported from each
  package's entry point. The exact runtime lists are pinned by
  `src/public-api.test.ts` in each package; a change there is an API change.
- **`ReaderSource`** — the method set a host implements (`getManifest`,
  `getPage`, `getFile`, `loadProgress`, `saveProgress`, and the optional
  `loadHighlights` / `saveHighlights` / `loadBookmarks` / `saveBookmarks`).
- **`Position`** — treated as opaque JSON by hosts; its serialized form stays
  round-trippable across `1.x` (a `1.x` engine reads a `1.y` position).
- **`HighlightRecord` / `Bookmark` / `Manifest` shapes** — fields are added,
  never removed or retyped, within `1.x`. The portability bundle
  (`docs/portability-format.md`) is separately versioned.
- **`data-pore-*` DOM hooks** on the headless components, and the **engine
  event names** (`reader:*`).
- **`<Reader>` props** and the `useReader*` hook return shapes.
- **`<Book>` props** and **`createReaderSource` input shape** — the one-call
  convenience layer over `ReaderSource`.
- **Engine settings shape** (`ImageEngineSettings` / `TextEngineSettings`) and
  their exported unions (e.g. `ChromeGesture`) — fields and members are added,
  never removed or retyped, within `1.x`; `DEFAULT_*_SETTINGS` always carries
  every field.

Adding an engine event, a new optional `Manifest` / settings field, a new hook,
or a new headless component is a **minor** bump. Removing or renaming any of the
above, or changing a method signature, is **major**.

## Not covered

- **`porejs/internal`** — layout math, anchor/pagination internals, the
  store/emitter, fixture-manifest parsing, the low-level search index, TTS
  controller internals. Opt-in deep import for people extending or
  re-implementing an engine. **May change in any minor release.**
- **Type-only exports** are not pinned by the runtime surface test. They are
  reviewed by hand against this document; treat a type whose _shape_ changes
  incompatibly as a breaking change even though the guard test won't catch it.
- **CSS / visual output.** `porejs-react` ships no styles; the demo's
  `apps/demo/src/styles.css` is an example, not an API. The text engine's
  in-iframe stylesheet (`buildBaseStylesheet`) is internal.
- **`@experimental`** items (JSDoc-tagged): OPDS 2.0 support, anything under
  active design. Named in the changelog when they stabilise.
- **`apps/demo`** — private, never published, no compatibility promise.

## Packaging

- **ESM only.** `"type": "module"`, Node ≥ 20, evergreen browsers. No CommonJS
  build — `require('porejs')` is not supported. (Revisited only if a concrete
  consumer is blocked.)
- `porejs` hard-depends on `fflate` and `pdfjs-dist`. An app that never opens a
  PDF should tree-shake `pdfjs-dist` out of its bundle (it is only reached
  through `createPdfEngine` / `loadPdf` / `PdfImageSource`). See
  `docs/integration.md`.
- `gsap` is an **optional** peer of `porejs-react` (only `gsapAdapter` needs
  it).

## Deprecation policy

A deprecated export keeps working for the rest of the current major, carries an
`@deprecated` JSDoc tag pointing at the replacement, and is removed only in the
next major. Deprecations are listed in `CHANGELOG.md`.
