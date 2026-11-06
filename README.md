<div align="center">

# Pore.js

### Source-Agnostic Web Reader Engine for Manga & Digital Text

A high-performance, source-agnostic web reader engine for manga, EPUB, PDF, and CBZ. Framework-agnostic core (`porejs`) + React 19 headless primitives (`porejs-react`) with custom pagination, zero shipped CSS, and offline caching.

[![CI Status](https://img.shields.io/github/actions/workflow/status/srytmj/pore-js/ci.yml?branch=main&style=flat-square)](https://github.com/srytmj/pore-js/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](#tech-stack--workspace-matrix)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](#tech-stack--workspace-matrix)
[![pnpm Workspace](https://img.shields.io/badge/pnpm-workspace-orange?style=flat-square&logo=pnpm&logoColor=white)](#workspace-layout)
[![Multi-Format](https://img.shields.io/badge/formats-CBZ%20%7C%20EPUB%20%7C%20PDF-success?style=flat-square)](#key-features)
[![License MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[Quick Start](#quick-start) · [Architecture](#engine-architecture) · [Features](#key-features) · [Integration](#integration-guide) · [Workspace](#workspace-layout) · [Documentation](#documentation-index)

</div>

---

> Built for developers building digital libraries: a complete, headless reader engine that decouples content sources from rendering — you supply the data stream, Pore.js handles the canvas, viewport virtualization, text layout, and gesture physics.

> [!NOTE]
> **Pre-release Dogfooding Status (M8 / v1.0.0-rc.1):** npm registry publishing is currently postponed while the engine is dogfooded in production homelab environments. Consume the packages locally via `pnpm pack:local` or workspace links per [`docs/releasing.md`](docs/releasing.md#consuming-it-locally).

---

## Engine Architecture

```mermaid
flowchart TD
    subgraph Sources[" Content Source Layer (ReaderSource) "]
        Demo["DemoSource / LocalFileSource<br/>(Local Files, CBZ, ZIP)"]
        Remote["KavitaSource / OpdsSource<br/>(Remote Stream / OPDS Catalog)"]
        Cache["CachedSource v2<br/>(IndexedDB + Cache API)"]
    end

    subgraph Core[" Engine Core (porejs) "]
        ImgEng["ImageEngine<br/>(Manga, CBZ, Webtoon)"]
        TxtEng["TextEngine<br/>(EPUB Reflow, CSS Multicol)"]
        PdfEng["PdfEngine<br/>(pdfjs-dist Canvas Pipeline)"]
    end

    subgraph Sandbox[" Reading Frame Sandbox "]
        Frame["Sandboxed Iframe Container<br/>(Strict CSP: script-src 'none')"]
        Virtual["Viewport Virtualization<br/>& Continuous Pagination"]
    end

    subgraph ReactBindings[" Headless React 19 Bindings (porejs-react) "]
        Provider["&lt;ReaderProvider&gt;<br/>State Management & Context"]
        ReaderComp["&lt;Reader&gt; Surface<br/>Viewport Virtualizer & Gesture Physics"]
        HeadlessUI["Headless Primitives & Hooks<br/>&lt;SettingsPanel&gt; · &lt;TableOfContents&gt;<br/>useReaderProgress · useReaderSearch · useTts"]
    end

    subgraph HostApp[" Host Application UI & Styling "]
        HostStyles["Host App Design System<br/>(Styled purely via semantic [data-pore-*] attributes)"]
    end

    Demo --> Core
    Remote --> Cache
    Cache --> Core
    Core --> Sandbox
    Sandbox --> ReactBindings
    ReactBindings --> HostApp
```

The engine enforces strict architectural separation across four distinct boundaries:
1. **Source Decoupling**: Data streams are ingested via abstract `ReaderSource` adapters (local files, OPDS, or remote servers) wrapped in a transparent caching layer.
2. **Framework-Agnostic Core**: Canvas rendering, pagination calculations, EPUB spine parsing, and locator offsets operate independently of any UI framework.
3. **Sandbox Isolation**: EPUB documents and untrusted markup execute inside a sandboxed iframe with strict Content Security Policy (`script-src 'none'`) preventing script execution.
4. **Headless Presentation**: React 19 bindings emit zero bundled styles, allowing the host application full layout control through semantic `data-pore-*` attributes.

---

## Key Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>Multi-Engine Rendering &amp; Layout</h4>
      <ul>
        <li><strong>Multi-Format Support</strong>: Unified reader engine handling image manga (CBZ/ZIP), EPUB text reflow, and PDF document rendering.</li>
        <li><strong>Advanced Manga Layouts</strong>: Seamless single-page, double-page spread pairing (with spread offset), and continuous vertical/horizontal scroll.</li>
        <li><strong>Flow Directions</strong>: Right-to-Left (manga) and Left-to-Right (western comics/books) with matching gestures and keyboard maps.</li>
        <li><strong>EPUB Reflow &amp; Pagination</strong>: CSS multi-column pagination running inside a sandboxed iframe (<code>script-src 'none'</code>).</li>
        <li><strong>PDF Rendering Pipeline</strong>: Offscreen canvas rendering via <code>pdfjs-dist</code> with hierarchical outline extraction and search.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h4>Headless Architecture &amp; Integration</h4>
      <ul>
        <li><strong>Zero Shipped CSS</strong>: Styled entirely via semantic <code>data-pore-*</code> markup and unstyled headless components.</li>
        <li><strong>Framework-Agnostic Core</strong>: Can be consumed directly without React using <code>createImageEngine</code>, <code>createTextEngine</code>, or <code>createPdfEngine</code>.</li>
        <li><strong>Offline Cache &amp; Resume</strong>: <code>CachedSource</code> v2 backed by IndexedDB and Cache API with byte-budgeted chapter preloading.</li>
        <li><strong>Text-to-Speech (TTS)</strong>: Sentence-level highlight synchronization and automatic page-turn via browser <code>SpeechSynthesis</code>.</li>
        <li><strong>Annotation Engine</strong>: CSS Custom Highlight API text highlights, notes, and portable <code>epubcfi</code> locators across devices.</li>
        <li><strong>Cross-Browser Fidelity</strong>: Automated Playwright test suite continuously validated across Chromium, Firefox, and WebKit (Safari).</li>
      </ul>
    </td>
  </tr>
</table>

---

## Workspace Layout

Pore.js is maintained as a pnpm monorepo cleanly isolating core algorithms from frontend UI bindings:

| Package | Directory | Role & Responsibility |
|---|---|---|
| `porejs` | `packages/reader-core` | Framework-agnostic reader core: sources, image/text/PDF engines, locator model, worker search |
| `porejs-react` | `packages/reader-react` | React 19 headless primitives: `<Reader>`, context providers, custom hooks, and UI controls |
| `@pore/demo` | `apps/demo` | Public demo application showcasing editorial reading UI, dark mode, and synthetic fixtures |
| `@pore/example-host-app` | `examples/host-app` | Minimal third-party embedding reference illustrating host integration |

---

## Tech Stack & Workspace Matrix

| Layer | Technology | Purpose |
|---|---|---|
| **Core Engine** | TypeScript 5.7+ | Strict type safety, engine algorithms, zero-dependency core architecture |
| **UI Bindings** | React 19 | Headless components, compound state context, declarative reactive hooks |
| **Text & PDF** | CSS Multi-Column / `pdfjs-dist` | Sandboxed EPUB reflow and canvas-based document rendering |
| **Offline Storage** | IndexedDB + Cache API | Resilient progress checkpoints, blob storage, and offline media cache |
| **Tooling & Test** | Vite 6 / tsup / Vitest / Playwright | Monorepo bundling, unit tests, and cross-browser e2e verification |

---

## Quick Start

### Prerequisites
- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0 (`corepack enable`)

### Monorepo Development

```bash
# 1. Enable corepack and install workspace dependencies
corepack enable
pnpm install

# 2. Generate synthetic CC0 demo fixtures (manga, EPUB, PDF)
pnpm gen:fixtures

# 3. Start local development server (demo app on http://localhost:5173)
pnpm dev

# 4. Verify test suites and build output
pnpm test          # Run Vitest across reader-core and reader-react
pnpm typecheck     # Typecheck all packages and applications via tsc
pnpm lint          # Run workspace code quality linters
pnpm build         # Build distributable packages via tsup and Vite

# 5. Run end-to-end browser tests
pnpm --filter @pore/demo e2e:install   # One-time Playwright browser download
pnpm --filter @pore/demo e2e           # Run e2e test suite across browsers
```

---

## Integration Guide

### 1. Basic React Integration

Install the packages in your project and mount `<Reader>` inside a `ReaderProvider`. Pore.js manages virtualization, continuous scrolling, and touch gestures:

```tsx
import { ReaderProvider, Reader } from 'porejs-react';
import { CachedSource, DemoSource } from 'porejs';

// Initialize data source (wrap in CachedSource for offline caching & resume)
const source = new CachedSource(new DemoSource());

export function ReaderView() {
  return (
    <ReaderProvider source={source}>
      <main className="reader-container">
        {/* Headless reader surface styled via [data-pore-*] CSS selectors */}
        <Reader bookId="demo-book" className="reader-host" />
      </main>
    </ReaderProvider>
  );
}
```

### 2. Headless Component Primitives

The `porejs-react` package exports unstyled headless components and hooks for building custom reader chrome:

- **Components**: `<SettingsPanel>`, `<TableOfContents>`, `<HighlightsPanel>`, `<ReaderScrubber>`, `<FootnotePopover>`, `<ReaderAnnouncer>`.
- **Hooks**: `useReaderProgress()`, `useReaderSearch()`, `useDownload()`, `useTts()`, `useReaderHistory()`, `useBookmarks()`.
- **Styling**: Target semantic attributes such as `[data-pore-layout]`, `[data-pore-flow]`, and `[data-pore-theme]` in your host stylesheet.

### 3. Custom Sources

To connect a proprietary backend or digital catalog, implement the `ReaderSource` interface:

```ts
import type { ReaderSource, Manifest, Position, Page } from 'porejs';

export class CustomLibrarySource implements ReaderSource {
  async getManifest(bookId: string): Promise<Manifest> {
    const res = await fetch(`/api/books/${bookId}/manifest`);
    return res.json();
  }

  async getPage(bookId: string, pageIndex: number): Promise<Page> {
    const res = await fetch(`/api/books/${bookId}/pages/${pageIndex}`);
    return res.json();
  }

  async loadProgress(bookId: string): Promise<Position | null> {
    const saved = localStorage.getItem(`progress:${bookId}`);
    return saved ? JSON.parse(saved) : null;
  }

  async saveProgress(bookId: string, position: Position): Promise<void> {
    localStorage.setItem(`progress:${bookId}`, JSON.stringify(position));
  }
}
```

---

## Browser Compatibility

The automated Playwright end-to-end test suite continuously validates rendering fidelity across all major engines:

| Feature / Engine | Chromium (Chrome, Edge) | Gecko (Firefox) | WebKit (Safari macOS/iOS) |
|---|---|---|---|
| **Image & Manga Engine** | ✅ Full Support | ✅ Full Support | ✅ Full Support |
| **EPUB Reflow (`TextEngine`)** | ✅ Full Support | ✅ Full Support | ✅ Full Support (`allow-scripts` + strict CSP) |
| **PDF Canvas Engine** | ✅ Full Support | ✅ Full Support | ✅ Canvas Fallback (where `OffscreenCanvas` absent) |
| **Highlights & Annotations** | ✅ Custom Highlight API | ✅ Custom Highlight API | ✅ Custom Highlight API |
| **Text-to-Speech (TTS)** | ✅ Native SpeechSynthesis | ✅ Native SpeechSynthesis | ✅ OS Voice Synthesis |

---

## Troubleshooting & Developer Notes

| Scenario | Probable Cause | Immediate Remediation |
|---|---|---|
| **Safari CSP Event Dropping** | Sandboxed iframes without `allow-scripts` drop user pointer events | Safari requires `allow-scripts` on iframe sandbox attribute; execution safety is enforced by strict `script-src 'none'` CSP header. |
| **WebGL & Memory Fallbacks** | GPU context exhaustion on large double-spread image buffers | `ImageEngine` automatically drops down to standard 2D canvas context and evicts inactive offscreen tiles outside viewport ring buffer. |
| **Canvas Fallback in PDF** | Some Safari / WebKit versions lack full `OffscreenCanvas` worker support | `PdfImageSource` automatically falls back to synchronous main-thread HTML5 2D canvas rendering without UI interruption. |
| **Local Package Dogfooding** | Packages are not published to npm registry during M8 stabilization | Run `pnpm pack:local` to generate local `.tgz` tarballs, or link directly using `pnpm link` (see [`docs/releasing.md`](docs/releasing.md)). |

---

## Documentation Index

Comprehensive technical specifications, design RFCs, and operational runbooks are maintained in the [`docs/`](docs/) directory:

| Document | Scope & Focus | Target Audience |
|---|---|---|
| [Getting Started](docs/getting-started.md) | First steps, fixture creation, and local app configuration | New Developers |
| [Architecture Guide](docs/architecture.md) | Internal engine mechanics, CSP sandboxing, and data lifecycles | System Architects |
| [Integration Guide](docs/integration.md) | In-depth API reference for `ReaderSource`, hooks, and headless UI | Frontend Engineers |
| [AI Agent Guide](docs/ai-agent-guide.md) | Monorepo invariants, automation rules, and development conventions | AI Coding Agents |
| [Milestone 8 Plan](docs/m8-plan.md) | Hardening roadmap, API freeze checklist, and release gates | Core Contributors |
| [Changelog](CHANGELOG.md) | Release history, breaking changes, and version notes | All Developers |

---

## License

Distributed under the [MIT License](LICENSE).

[↑ Back to top](#porejs)
