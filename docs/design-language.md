# Design language — the demo

Set in M6 D0 (`docs/m6-plan.md`). One page. If you are restyling any part of
`apps/demo`, work from these tokens — don't hard-code colours, sizes or fonts.

## Principle: the chrome recedes

This is a reading app. The page is the content; everything else — the menu
rail, panels, toasts — is quiet furniture that gets out of the way. Warm paper
tones, strong typography, generous whitespace, low-contrast surfaces. Reference
points: Apple Books, iA Writer, Readwise Reader.

## Colour — warm, accent-less

The palette is **monochrome on warm neutrals**. There is no decorative accent
colour. The only non-neutral colours are functional:

| token             | light     | dark      | use                                                                         |
| ----------------- | --------- | --------- | --------------------------------------------------------------------------- |
| `--color-canvas`  | `#faf7f1` | `#17150f` | the page ground                                                             |
| `--color-surface` | `#fffdf8` | `#211e17` | panels, cards, the rail                                                     |
| `--color-fg`      | `#23201a` | `#ece7dc` | ink — text, borders on active controls, filled toggles                      |
| `--color-muted`   | `#6b6357` | `#a39a89` | secondary text (≥ 4.6:1 on canvas)                                          |
| `--color-line`    | `#e6dfd1` | `#383327` | hairlines                                                                   |
| `--color-focus`   | `#3a6ea5` | `#86b0da` | **the one functional colour** — `:focus-visible` rings, links inside chrome |
| `--color-danger`  | `#a8322a` | `#e58a82` | destructive actions, error text                                             |

Tailwind utilities: `bg-canvas`, `bg-surface`, `text-fg`, `text-muted`,
`border-line`, `ring-focus`, `border-focus`, `outline-focus`, `text-danger`.

- **Active / selected controls** fill with the ink: `bg-fg text-canvas`. Never
  a coloured fill.
- **Links inside the chrome** (not book content) are underlined ink; use
  `--color-focus` only for the focus ring.
- Dark mode is `<html class="dark">` and follows the reader's own dark / oled
  theme on a book page.

### Reading themes

`THEME_COLORS` in `packages/reader-core/src/text/create-text-engine.ts` is
injected into the sandboxed iframe and **must track this palette**:

| theme | background | text      |
| ----- | ---------- | --------- |
| light | `#faf7f1`  | `#23201a` |
| sepia | `#f2e7d3`  | `#4a3f30` |
| dark  | `#17150f`  | `#d8d1c4` |
| oled  | `#000000`  | `#cfc8bb` |

## Type

- **UI** — `--font-sans` = **Hanken Grotesk** (variable, self-hosted via
  `@fontsource-variable/hanken-grotesk`, imported in `main.tsx`). Warm humanist
  grotesque; not Inter.
- **Display / reading** — `--font-serif` = **Literata** (variable, self-hosted).
  Google Play Books' screen-reading serif. Used for the landing hero and
  chapter headings; the reader's in-iframe font is a separate choice (D4 wires
  it into the font menu).
- No webfont CDN — both faces are bundled into the app.
- Size scale: Tailwind's default (`text-sm … text-4xl`) for now. Revisit with
  an explicit modular scale only if it proves necessary.

## Space, radius, elevation

- Space: Tailwind's default 4px scale.
- Radius: `--radius-control` `9px` (buttons, inputs, select), `--radius-panel`
  `14px` (dialogs, cards, the rail's settings block).
- Elevation: two soft, warm-tinted shadows — `--shadow-panel` (dialogs,
  panels), `--shadow-popover` (small dropdowns). No hard `shadow-2xl`.

## Motion

One duration (`~0.22–0.24s`) and one easing (`cubic-bezier(0.16, 1, 0.3, 1)`)
for panel/accordion/rail transitions. The GSAP page-turn path has its own.
Everything is `prefers-reduced-motion` aware.
