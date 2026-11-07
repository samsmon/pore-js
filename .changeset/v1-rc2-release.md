---
'porejs': patch
'porejs-react': patch
---

Release 1.0.0-rc.2:
- Mobile layout overhaul (compact top bar, floating bottom bar, bottom sheet drawer for TOC & Settings, touch zones, safe area insets).
- Zero-flicker & zero-delay manga page turns (synchronous prefetch lookup via `loader.getUrl()`, atomic spread replacement).
- Auto-fit image transitions on sidebar toggle.
- Security hardening: SEC-01 DOMPurify footnote HTML sanitization against Stored XSS.
- Accessibility fixes: A11Y-01 RTL scrubber ticks (`insetInlineStart`), A11Y-02 comic page announcements, A11Y-03 stable highlight note keys.
- Performance overhaul: PERF-01 partitioned `RuntimeContext` eliminating cascading re-renders, PERF-02 async mount destroyed guards, PERF-03 PDF `page.cleanup()` memory release.
- API & DX: API-01 subpath exports (`./reader`, `./primitives`, `./gsap`) in `porejs-react`, API-02 safe `import.meta.url` search worker.
- Anti-monolith modularization (`text-style.ts`, `text-tts-coordinator.ts`, `image-zoom.ts`, `image-autonav.ts`).
