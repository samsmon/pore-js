# Accessibility

What Pore.js does for keyboard, screen-reader, motion and contrast users — what
is tested automatically, and what still needs a manual pass.

## Keyboard

Every reader action is reachable without a pointer. The engine binds keys on its
**own focused element** (`.pore-text` / `.pore-image`, `tabindex="0"`), never on
`document` — an embedded reader doesn't steal the host page's shortcuts unless
it has focus.

| key                   | action                                                       |
| --------------------- | ------------------------------------------------------------ |
| `→` / `d` / `6`       | next page (forward — flips in RTL/vertical)                  |
| `←` / `a` / `4`       | previous page                                                |
| `w` / `s` (`8` / `2`) | scroll up / down (continuous & flow modes)                   |
| `,` / `.`             | previous / next chapter                                      |
| `Home` / `End`        | first / last page                                            |
| `m`                   | toggle the menu / chrome                                     |
| `f`                   | fullscreen · `i` cycle fit · `o` spread offset (image books) |

The key map is data — `useReaderKeymap()` / `handle.setKeymap()` rebinds it.

**Demo chrome** adds: `b` bookmark this page, `Enter` / `Shift+Enter` next/prev
search hit, `Esc` closes the open panel and returns focus to the control that
opened it. All rail buttons, the settings accordion, the TOC/scrubber, and the
selection toolbar are in the tab order with visible focus rings (one ring,
`--color-focus`).

The reading `<iframe>` is **not** a tab stop — its content is publisher markup;
navigation is the engine's job. In **flow mode** (`flowMode: 'flow'`, and
automatically under `forced-colors`) the chapter becomes a single semantic
scroll column that a screen reader walks normally.

## Screen readers

- `<ReaderAnnouncer>` (mount once inside `<Reader>`) is a visually-hidden
  `aria-live="polite"` region — it announces page / chapter changes and load
  errors.
- Headless components ship ARIA roles + names on their `data-pore-*` markup
  (`role="dialog"` panels, `aria-expanded` on the accordion, `role="slider"` on
  the scrubber thumb with an `aria-label`, `aria-pressed` on toggles).
- Progress is exposed as text (`useReaderProgress` → the demo's `.loc` is
  `role="status"`).

**Manual pass — still owed for `v1.0` (`docs/known-issues.md`):** a real
NVDA + VoiceOver walk-through (open → read → TOC → highlight → bookmark →
settings → search → home). The automated coverage below is a floor, not a
substitute.

## Automated coverage

- **axe-core** (`@axe-core/playwright`) on the demo chrome — landing, reader,
  every panel open, light **and** dark, WCAG 2.0/2.1 A + AA. Zero
  critical/serious violations gates CI. The publisher iframe is excluded (its
  markup isn't ours, and its `script-src 'none'` CSP blocks axe injection).
- **Keyboard-traversal e2e** — tab through the reader chrome, assert the key
  controls take focus, `Esc` closes a panel and restores focus.
- **`forced-colors` e2e** — the chrome emulated under Windows High Contrast
  stays outlined and axe-clean.
- **`prefers-reduced-motion`** — a global rule zeroes every
  animation/transition; a page turn applies instantly (e2e).

## Motion & contrast

- `prefers-reduced-motion: reduce` → no page-turn tween, no panel slide, no
  pulse; the GSAP transition adapter is reduced-motion aware too.
- `forced-colors: active` → the demo falls back to system colours
  (`CanvasText` borders, `Highlight` focus ring and active states); the text
  engine switches to flow mode so the OS colour override reads cleanly.
- The default palette meets AA contrast in light and dark; the reader's four
  themes (light / sepia / dark / oled) are checked in the dark-axe e2e.
